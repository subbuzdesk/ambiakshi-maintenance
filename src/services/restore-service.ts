import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import os from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../config.js";
import { SecretEscrowService } from "./secret-escrow-service.js";
import { GoogleDriveService } from "./google-drive-service.js";

const execAsync = promisify(exec);

export interface AvailableSnapshot {
  timestamp: string;
  formattedDate: string;
  hasSecrets: boolean;
  secretsPath?: string;
  reposCount: number;
  repoBundles: { id: string; name: string; path: string; sizeBytes: number }[];
  supabaseDumps: { projectId: string; path: string; sizeBytes: number }[];
}

export interface RestoreSecretsResult {
  success: boolean;
  filesRestored: string[];
  skippedFiles: string[];
  errorMessage?: string;
}

export interface RestoreRepoItem {
  id: string;
  name: string;
  targetPath: string;
  branch?: string;
  headCommit?: string;
  status: "cloned" | "skipped_exists" | "failed";
  errorMessage?: string;
}

export interface RestoreReposResult {
  success: boolean;
  totalBundlesFound: number;
  restoredCount: number;
  skippedCount: number;
  items: RestoreRepoItem[];
  errorMessage?: string;
}

export interface RestoreSupabaseItem {
  projectId: string;
  tablesCount: number;
  totalRows: number;
  uncompressedPath: string;
  success: boolean;
  errorMessage?: string;
}

export interface RestoreSupabaseResult {
  success: boolean;
  projectsRestoredCount: number;
  items: RestoreSupabaseItem[];
  errorMessage?: string;
}

export interface RestoreExecutionSummary {
  timestamp: string;
  snapshotTimestamp: string;
  targetRootDir: string;
  dryRun: boolean;
  secrets?: RestoreSecretsResult;
  repos?: RestoreReposResult;
  supabase?: RestoreSupabaseResult;
  allSuccessful: boolean;
}

export class RestoreService {
  private static parseTimestampToMs(ts: string): number {
    try {
      const isoCandidate = ts.replace(
        /(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/,
        "$1T$2:$3:$4.$5Z"
      );
      const ms = Date.parse(isoCandidate);
      return isNaN(ms) ? 0 : ms;
    } catch {
      return 0;
    }
  }

  /**
   * Discover all available local snapshots across backups/
   * Clusters artifacts generated within 10 minutes of each other into a single run session.
   */
  static async listLocalSnapshots(): Promise<AvailableSnapshot[]> {
    interface RawArtifact {
      type: "secret" | "repo" | "supabase";
      timestamp: string;
      epochMs: number;
      data: any;
    }

    const artifacts: RawArtifact[] = [];

    // 1. Scan Secrets
    try {
      if (fs.existsSync(config.backupSecretsDir)) {
        const secretFiles = await fsp.readdir(config.backupSecretsDir);
        for (const file of secretFiles) {
          const match = file.match(/^ambiakshi_secrets(?:_escrow)?_(.+)\.enc$/);
          if (match) {
            const ts = match[1];
            artifacts.push({
              type: "secret",
              timestamp: ts,
              epochMs: this.parseTimestampToMs(ts),
              data: { secretsPath: path.join(config.backupSecretsDir, file) },
            });
          }
        }
      }
    } catch {}

    // 2. Scan Repos
    try {
      if (fs.existsSync(config.backupReposDir)) {
        const repoFiles = await fsp.readdir(config.backupReposDir);
        for (const file of repoFiles) {
          const match = file.match(/^(.+)_(.+)\.bundle$/);
          if (match) {
            const repoId = match[1];
            const ts = match[2];
            const fullPath = path.join(config.backupReposDir, file);
            let sizeBytes = 0;
            try {
              const stat = await fsp.stat(fullPath);
              sizeBytes = stat.size;
            } catch {}
            artifacts.push({
              type: "repo",
              timestamp: ts,
              epochMs: this.parseTimestampToMs(ts),
              data: {
                id: repoId,
                name: repoId,
                path: fullPath,
                sizeBytes,
              },
            });
          }
        }
      }
    } catch {}

    // 3. Scan Supabase
    try {
      if (fs.existsSync(config.backupSupabaseDir)) {
        const projectDirs = await fsp.readdir(config.backupSupabaseDir);
        for (const p of projectDirs) {
          const pDir = path.join(config.backupSupabaseDir, p);
          const pStat = await fsp.stat(pDir);
          if (pStat.isDirectory()) {
            const files = await fsp.readdir(pDir);
            for (const file of files) {
              const match = file.match(/^.+_backup_(.+)\.json\.gz$/);
              if (match) {
                const ts = match[1];
                const fullPath = path.join(pDir, file);
                let sizeBytes = 0;
                try {
                  const stat = await fsp.stat(fullPath);
                  sizeBytes = stat.size;
                } catch {}
                artifacts.push({
                  type: "supabase",
                  timestamp: ts,
                  epochMs: this.parseTimestampToMs(ts),
                  data: {
                    projectId: p,
                    path: fullPath,
                    sizeBytes,
                  },
                });
              }
            }
          }
        }
      }
    } catch {}

    // Sort artifacts newest to oldest
    artifacts.sort((a, b) => b.epochMs - a.epochMs);

    const snapshots: AvailableSnapshot[] = [];
    const CLUSTER_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

    for (const art of artifacts) {
      // Find an existing snapshot within cluster window
      let targetSnap = snapshots.find(
        (s) => Math.abs(this.parseTimestampToMs(s.timestamp) - art.epochMs) <= CLUSTER_WINDOW_MS
      );

      if (!targetSnap) {
        targetSnap = this.initSnapshot(art.timestamp);
        snapshots.push(targetSnap);
      }

      if (art.type === "secret") {
        targetSnap.hasSecrets = true;
        targetSnap.secretsPath = art.data.secretsPath;
      } else if (art.type === "repo") {
        if (!targetSnap.repoBundles.some((r) => r.id === art.data.id)) {
          targetSnap.repoBundles.push(art.data);
          targetSnap.reposCount = targetSnap.repoBundles.length;
        }
      } else if (art.type === "supabase") {
        if (!targetSnap.supabaseDumps.some((s) => s.projectId === art.data.projectId)) {
          targetSnap.supabaseDumps.push(art.data);
        }
      }
    }

    // Sort snapshots descending by timestamp
    return snapshots.sort((a, b) =>
      this.parseTimestampToMs(b.timestamp) - this.parseTimestampToMs(a.timestamp)
    );
  }

  private static initSnapshot(ts: string): AvailableSnapshot {
    let formattedDate = ts;
    try {
      // Reconstruct ISO date: replace - with : where appropriate
      const isoCandidate = ts.replace(
        /(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/,
        "$1T$2:$3:$4.$5Z"
      );
      const d = new Date(isoCandidate);
      if (!isNaN(d.getTime())) {
        formattedDate = d.toLocaleString();
      }
    } catch {}

    return {
      timestamp: ts,
      formattedDate,
      hasSecrets: false,
      reposCount: 0,
      repoBundles: [],
      supabaseDumps: [],
    };
  }

  /**
   * Download the latest backups from Google Drive if local disk is empty or on a new PC
   */
  static async downloadFromDrive(targetDir = config.backupDir): Promise<{
    downloadedFiles: string[];
    success: boolean;
    errorMessage?: string;
  }> {
    const clientInfo = GoogleDriveService.getDriveClient();
    const folderId = config.googleDriveFolderId;

    if (!clientInfo || !folderId) {
      return {
        downloadedFiles: [],
        success: false,
        errorMessage:
          "Google Drive not authenticated. Run 'npm run auth:google-drive' first.",
      };
    }

    const { drive } = clientInfo;
    const downloadedFiles: string[] = [];

    try {
      // Recursively list all files inside Google Drive backup folder
      async function syncFolder(parentId: string, localDestDir: string) {
        await fsp.mkdir(localDestDir, { recursive: true });
        const res = await drive.files.list({
          q: `'${parentId}' in parents and trashed = false`,
          fields: "files(id, name, mimeType, size)",
          spaces: "drive",
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        });

        const items = res.data.files || [];
        for (const item of items) {
          if (!item.id || !item.name) continue;

          if (item.mimeType === "application/vnd.google-apps.folder") {
            await syncFolder(item.id, path.join(localDestDir, item.name));
          } else {
            const localFilePath = path.join(localDestDir, item.name);
            // Download file stream
            const destStream = fs.createWriteStream(localFilePath);
            const fileRes = await drive.files.get(
              { fileId: item.id, alt: "media", supportsAllDrives: true },
              { responseType: "stream" }
            );

            await new Promise((resolve, reject) => {
              (fileRes.data as any)
                .pipe(destStream)
                .on("finish", resolve)
                .on("error", reject);
            });

            downloadedFiles.push(localFilePath);
          }
        }
      }

      await syncFolder(folderId, targetDir);

      return {
        downloadedFiles,
        success: true,
      };
    } catch (err: any) {
      return {
        downloadedFiles,
        success: false,
        errorMessage: err?.message || String(err),
      };
    }
  }

  /**
   * Decrypt and unpack secret escrow archive (.enc)
   */
  static async restoreSecrets(options: {
    encryptedFilePath: string;
    passphrase?: string;
    targetRootDir?: string;
    dryRun?: boolean;
    force?: boolean;
  }): Promise<RestoreSecretsResult> {
    const { encryptedFilePath, dryRun = false, force = false } = options;
    const targetRootDir =
      options.targetRootDir || path.resolve(config.rootDir, "..");

    if (!fs.existsSync(encryptedFilePath)) {
      return {
        success: false,
        filesRestored: [],
        skippedFiles: [],
        errorMessage: `Secret backup file not found: ${encryptedFilePath}`,
      };
    }

    const passphrase =
      options.passphrase ||
      config.secretBackupPassphrase ||
      `ambiakshi-escrow-${os.hostname()}-${os.userInfo().username}`;

    try {
      const encryptedBuffer = await fsp.readFile(encryptedFilePath);
      const decryptedJson = SecretEscrowService.decrypt(
        encryptedBuffer,
        passphrase
      );
      const payload = JSON.parse(decryptedJson);

      const filesMap: Record<string, string> = payload.files || {};
      const filesRestored: string[] = [];
      const skippedFiles: string[] = [];

      for (const [relPath, content] of Object.entries(filesMap)) {
        const destPath = path.resolve(targetRootDir, relPath);

        if (fs.existsSync(destPath) && !force) {
          skippedFiles.push(relPath);
          continue;
        }

        if (!dryRun) {
          await fsp.mkdir(path.dirname(destPath), { recursive: true });
          await fsp.writeFile(destPath, content, "utf8");
        }

        filesRestored.push(relPath);
      }

      return {
        success: true,
        filesRestored,
        skippedFiles,
      };
    } catch (err: any) {
      return {
        success: false,
        filesRestored: [],
        skippedFiles: [],
        errorMessage:
          err.message?.includes("auth") || err.message?.includes("tag")
            ? "Decryption failed: Invalid passphrase or corrupted archive."
            : `Failed to restore secrets: ${err?.message || err}`,
      };
    }
  }

  /**
   * Clone/restore Git repositories from .bundle archives
   */
  static async restoreRepos(options: {
    bundles: { id: string; name: string; path: string }[];
    targetRootDir?: string;
    dryRun?: boolean;
    force?: boolean;
  }): Promise<RestoreReposResult> {
    const { bundles, dryRun = false, force = false } = options;
    const targetRootDir =
      options.targetRootDir || path.resolve(config.rootDir, "..");

    await fsp.mkdir(targetRootDir, { recursive: true });

    const items: RestoreRepoItem[] = [];
    let restoredCount = 0;
    let skippedCount = 0;

    for (const bundle of bundles) {
      const repoTargetDir = path.join(targetRootDir, bundle.id);
      const exists = fs.existsSync(repoTargetDir);

      if (exists && !force) {
        items.push({
          id: bundle.id,
          name: bundle.name,
          targetPath: repoTargetDir,
          status: "skipped_exists",
        });
        skippedCount++;
        continue;
      }

      if (dryRun) {
        items.push({
          id: bundle.id,
          name: bundle.name,
          targetPath: repoTargetDir,
          status: "cloned",
        });
        restoredCount++;
        continue;
      }

      try {
        // If force and exists, we remove or clone to an alternate safe location
        let finalDest = repoTargetDir;
        if (exists && force) {
          // If directory exists, verify if it's already a working git repo
          try {
            await execAsync(`git bundle verify "${bundle.path}"`, {
              cwd: targetRootDir,
            });
          } catch {}
          // Clone to alternate if already exists to prevent catastrophic loss
          finalDest = `${repoTargetDir}_restored_${Date.now()}`;
        }

        await execAsync(`git clone "${bundle.path}" "${finalDest}"`, {
          cwd: targetRootDir,
        });

        // Query branch and head commit
        let branch = "master";
        let headCommit = "";
        try {
          const { stdout: bOut } = await execAsync(
            "git rev-parse --abbrev-ref HEAD",
            { cwd: finalDest }
          );
          branch = bOut.trim();
          const { stdout: cOut } = await execAsync(
            "git rev-parse --short HEAD",
            { cwd: finalDest }
          );
          headCommit = cOut.trim();
        } catch {}

        items.push({
          id: bundle.id,
          name: bundle.name,
          targetPath: finalDest,
          branch,
          headCommit,
          status: "cloned",
        });
        restoredCount++;
      } catch (err: any) {
        items.push({
          id: bundle.id,
          name: bundle.name,
          targetPath: repoTargetDir,
          status: "failed",
          errorMessage: err?.message || String(err),
        });
      }
    }

    return {
      success: items.every((i) => i.status !== "failed"),
      totalBundlesFound: bundles.length,
      restoredCount,
      skippedCount,
      items,
    };
  }

  /**
   * Decompress and extract Supabase backup datasets (.json.gz -> .json)
   */
  static async restoreSupabase(options: {
    dumps: { projectId: string; path: string }[];
    outputDir?: string;
    dryRun?: boolean;
  }): Promise<RestoreSupabaseResult> {
    const { dumps, dryRun = false } = options;
    const outputDir =
      options.outputDir || path.join(config.rootDir, "backups", "restored_supabase");

    if (!dryRun) {
      await fsp.mkdir(outputDir, { recursive: true });
    }

    const items: RestoreSupabaseItem[] = [];

    for (const dump of dumps) {
      try {
        const compressedBuffer = await fsp.readFile(dump.path);
        const uncompressedBuffer = zlib.gunzipSync(compressedBuffer);
        const rawJson = uncompressedBuffer.toString("utf8");
        const payload = JSON.parse(rawJson);

        const tables = payload.tables || {};
        const tableNames = Object.keys(tables);
        const totalRows = Object.values(tables).reduce(
          (sum: number, rows: any) => sum + (Array.isArray(rows) ? rows.length : 0),
          0
        );

        const uncompressedPath = path.join(
          outputDir,
          `${dump.projectId}_restored.json`
        );

        if (!dryRun) {
          await fsp.writeFile(uncompressedPath, JSON.stringify(payload, null, 2), "utf8");
        }

        items.push({
          projectId: dump.projectId,
          tablesCount: tableNames.length,
          totalRows,
          uncompressedPath,
          success: true,
        });
      } catch (err: any) {
        items.push({
          projectId: dump.projectId,
          tablesCount: 0,
          totalRows: 0,
          uncompressedPath: "",
          success: false,
          errorMessage: err?.message || String(err),
        });
      }
    }

    return {
      success: items.every((i) => i.success),
      projectsRestoredCount: items.filter((i) => i.success).length,
      items,
    };
  }
}
