import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { config } from "../config.js";

export interface SecretBackupResult {
  timestamp: string;
  encryptedFilePath: string;
  fileSizeBytes: number;
  filesCapturedCount: number;
  filesCaptured: string[];
  success: boolean;
  errorMessage?: string;
}

export class SecretEscrowService {
  /**
   * Ensure backup directory exists
   */
  static async ensureDirectories(): Promise<void> {
    await fs.mkdir(config.backupSecretsDir, { recursive: true });
  }

  /**
   * Derive encryption key from passphrase or local machine signature
   */
  private static deriveKey(passphrase: string, salt: Buffer): Buffer {
    return crypto.scryptSync(passphrase, salt, 32);
  }

  /**
   * Encrypt plaintext buffer with AES-256-GCM
   */
  static encrypt(plainText: string, passphrase: string): Buffer {
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12); // 12 bytes recommended for GCM
    const key = this.deriveKey(passphrase, salt);

    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    // Payload: [salt (16b)][iv (12b)][tag (16b)][encrypted payload]
    return Buffer.concat([salt, iv, tag, encrypted]);
  }

  /**
   * Decrypt AES-256-GCM encrypted buffer
   */
  static decrypt(encryptedBuffer: Buffer, passphrase: string): string {
    const salt = encryptedBuffer.subarray(0, 16);
    const iv = encryptedBuffer.subarray(16, 28);
    const tag = encryptedBuffer.subarray(28, 44);
    const ciphertext = encryptedBuffer.subarray(44);

    const key = this.deriveKey(passphrase, salt);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString("utf8");
  }

  /**
   * Create encrypted secret escrow backup
   */
  static async createSecretBackup(customPassphrase?: string): Promise<SecretBackupResult> {
    await this.ensureDirectories();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    const passphrase =
      customPassphrase ||
      config.secretBackupPassphrase ||
      `ambiakshi-escrow-${os.hostname()}-${os.userInfo().username}`;

    const filesToCapture: Record<string, string> = {};
    const capturedNames: string[] = [];

    // 1. Check ambiakshi-maintenance local envs
    const candidateEnvFiles = [
      path.join(config.rootDir, ".env.local"),
      path.join(config.rootDir, ".env"),
      path.join(config.rootDir, "config", "google-service-account.json"),
    ];

    // 2. Check sibling project envs
    for (const repo of config.ecosystemRepos) {
      candidateEnvFiles.push(path.join(repo.path, ".env.local"));
      candidateEnvFiles.push(path.join(repo.path, ".env"));
    }

    for (const filePath of candidateEnvFiles) {
      try {
        const content = await fs.readFile(filePath, "utf8");
        const relPath = path.relative(path.resolve(config.rootDir, ".."), filePath);
        filesToCapture[relPath] = content;
        capturedNames.push(relPath);
      } catch {
        // File does not exist, ignore
      }
    }

    if (capturedNames.length === 0) {
      return {
        timestamp,
        encryptedFilePath: "",
        fileSizeBytes: 0,
        filesCapturedCount: 0,
        filesCaptured: [],
        success: false,
        errorMessage: "No secret or .env files found to back up",
      };
    }

    try {
      const payload = {
        metadata: {
          timestamp: new Date().toISOString(),
          hostname: os.hostname(),
          platform: os.platform(),
          filesCount: capturedNames.length,
        },
        files: filesToCapture,
      };

      const jsonStr = JSON.stringify(payload, null, 2);
      const encryptedBuffer = this.encrypt(jsonStr, passphrase);

      // Verify decrypt cycle immediately to guarantee zero data loss
      const roundTripDecrypted = this.decrypt(encryptedBuffer, passphrase);
      if (roundTripDecrypted !== jsonStr) {
        throw new Error("Self-test decryption validation failed");
      }

      const outFilename = `ambiakshi_secrets_${timestamp}.enc`;
      const outFilePath = path.join(config.backupSecretsDir, outFilename);
      await fs.writeFile(outFilePath, encryptedBuffer);

      // Prune old backups
      await this.pruneOldBackups(config.backupSecretsDir, config.backupRetentionDays);

      return {
        timestamp,
        encryptedFilePath: outFilePath,
        fileSizeBytes: encryptedBuffer.byteLength,
        filesCapturedCount: capturedNames.length,
        filesCaptured: capturedNames,
        success: true,
      };
    } catch (err: any) {
      return {
        timestamp,
        encryptedFilePath: "",
        fileSizeBytes: 0,
        filesCapturedCount: capturedNames.length,
        filesCaptured: capturedNames,
        success: false,
        errorMessage: err?.message || String(err),
      };
    }
  }

  /**
   * Prune secret backups older than retention
   */
  private static async pruneOldBackups(dirPath: string, retentionDays: number): Promise<number> {
    try {
      const files = await fs.readdir(dirPath);
      const encFiles = files.filter((f) => f.endsWith(".enc"));
      if (encFiles.length <= 1) return 0;

      const now = Date.now();
      const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;
      let prunedCount = 0;

      for (const file of encFiles) {
        const fullPath = path.join(dirPath, file);
        const stat = await fs.stat(fullPath);
        if (now - stat.mtimeMs > maxAgeMs) {
          await fs.unlink(fullPath);
          prunedCount++;
        }
      }

      return prunedCount;
    } catch {
      return 0;
    }
  }
}
