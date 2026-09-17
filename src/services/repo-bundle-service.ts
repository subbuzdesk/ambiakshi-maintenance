import fs from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { config, EcosystemRepo } from "../config.js";

const execAsync = promisify(exec);

export interface SingleRepoBundleResult {
  id: string;
  name: string;
  localPath: string;
  isGitRepo: boolean;
  branch?: string;
  headCommit?: string;
  bundlePath?: string;
  fileSizeBytes: number;
  verified: boolean;
  success: boolean;
  errorMessage?: string;
}

export interface RepoBundleSummary {
  timestamp: string;
  durationSeconds: number;
  totalReposConfigured: number;
  reposBundledCount: number;
  totalBytesWritten: number;
  results: SingleRepoBundleResult[];
  allSuccessful: boolean;
}

export class RepoBundleService {
  /**
   * Ensure backup directories exist
   */
  static async ensureDirectories(): Promise<void> {
    await fs.mkdir(config.backupReposDir, { recursive: true });
  }

  /**
   * Create a git bundle for a single repository
   */
  static async bundleRepo(
    repo: EcosystemRepo,
    dateStamp: string
  ): Promise<SingleRepoBundleResult> {
    // 1. Verify existence
    try {
      await fs.access(repo.path);
    } catch {
      return {
        id: repo.id,
        name: repo.name,
        localPath: repo.path,
        isGitRepo: false,
        fileSizeBytes: 0,
        verified: false,
        success: false,
        errorMessage: "Directory not found on local machine (CI/Cloud mode)",
      };
    }

    // 2. Check for .git
    const gitDir = path.join(repo.path, ".git");
    try {
      await fs.access(gitDir);
    } catch {
      return {
        id: repo.id,
        name: repo.name,
        localPath: repo.path,
        isGitRepo: false,
        fileSizeBytes: 0,
        verified: false,
        success: false,
        errorMessage: "Not a git repository (missing .git)",
      };
    }

    // 3. Inspect branch & commit
    let branch = "master";
    let headCommit = "";
    try {
      const { stdout: branchOut } = await execAsync("git rev-parse --abbrev-ref HEAD", {
        cwd: repo.path,
      });
      branch = branchOut.trim();

      const { stdout: commitOut } = await execAsync("git rev-parse --short HEAD", {
        cwd: repo.path,
      });
      headCommit = commitOut.trim();
    } catch (err: any) {
      // Ignore git probe failure
    }

    // 4. Execute git bundle create
    const bundleFilename = `${repo.id}_${dateStamp}.bundle`;
    const bundleFilePath = path.join(config.backupReposDir, bundleFilename);

    try {
      // Remove any existing file with same name
      await fs.rm(bundleFilePath, { force: true });

      // Run bundle create --all
      await execAsync(`git bundle create "${bundleFilePath}" --all`, {
        cwd: repo.path,
      });

      // Verify bundle
      await execAsync(`git bundle verify "${bundleFilePath}"`, {
        cwd: repo.path,
      });

      const stat = await fs.stat(bundleFilePath);

      return {
        id: repo.id,
        name: repo.name,
        localPath: repo.path,
        isGitRepo: true,
        branch,
        headCommit,
        bundlePath: bundleFilePath,
        fileSizeBytes: stat.size,
        verified: true,
        success: true,
      };
    } catch (err: any) {
      return {
        id: repo.id,
        name: repo.name,
        localPath: repo.path,
        isGitRepo: true,
        branch,
        headCommit,
        fileSizeBytes: 0,
        verified: false,
        success: false,
        errorMessage: err?.message || String(err),
      };
    }
  }

  /**
   * Bundle all configured ecosystem repositories
   */
  static async bundleAllRepos(): Promise<RepoBundleSummary> {
    const startTime = Date.now();
    await this.ensureDirectories();

    const dateStamp = new Date().toISOString().replace(/[:.]/g, "-");
    const results: SingleRepoBundleResult[] = [];

    for (const repo of config.ecosystemRepos) {
      const res = await this.bundleRepo(repo, dateStamp);
      results.push(res);
    }

    // Prune old bundles exceeding retention threshold
    await this.pruneOldBundles(config.backupReposDir, config.backupRetentionDays);

    const durationSeconds = (Date.now() - startTime) / 1000;
    const reposBundledCount = results.filter((r) => r.success).length;
    const totalBytesWritten = results.reduce((acc, r) => acc + r.fileSizeBytes, 0);
    const allSuccessful = results.length > 0 && results.every((r) => r.success || !r.isGitRepo);

    return {
      timestamp: new Date().toISOString(),
      durationSeconds,
      totalReposConfigured: config.ecosystemRepos.length,
      reposBundledCount,
      totalBytesWritten,
      results,
      allSuccessful,
    };
  }

  /**
   * Prune bundles older than retention threshold
   */
  private static async pruneOldBundles(dirPath: string, retentionDays: number): Promise<number> {
    try {
      const files = await fs.readdir(dirPath);
      const bundleFiles = files.filter((f) => f.endsWith(".bundle"));
      if (bundleFiles.length <= config.ecosystemRepos.length) return 0;

      const now = Date.now();
      const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;
      let prunedCount = 0;

      for (const file of bundleFiles) {
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
