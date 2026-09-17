import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

export interface PruneSummary {
  timestamp: string;
  logsRotated: string[];
  reportsDeletedCount: number;
  backupsDeletedCount: number;
  spaceReclaimedBytes: number;
}

export class PruningService {
  /**
   * Rotate and truncate oversized log files (> 5MB)
   */
  static async rotateLogs(maxLogSizeBytes = 5 * 1024 * 1024): Promise<{ rotated: string[]; bytesFreed: number }> {
    const logsDir = path.join(config.rootDir, "logs");
    const rotated: string[] = [];
    let bytesFreed = 0;

    try {
      await fs.access(logsDir);
    } catch {
      return { rotated, bytesFreed };
    }

    try {
      const files = await fs.readdir(logsDir);
      for (const file of files) {
        if (!file.endsWith(".log")) continue;
        const filePath = path.join(logsDir, file);
        const stat = await fs.stat(filePath);

        if (stat.size > maxLogSizeBytes) {
          // Read the tail (last 1MB)
          const content = await fs.readFile(filePath, "utf8");
          const keepTail = content.slice(-1024 * 1024); // Keep last 1MB
          await fs.writeFile(filePath, `--- LOG ROTATED AT ${new Date().toISOString()} ---\n` + keepTail);
          const freed = stat.size - (1024 * 1024);
          bytesFreed += freed > 0 ? freed : 0;
          rotated.push(`${file} (${(stat.size / (1024 * 1024)).toFixed(1)}MB -> 1MB)`);
        }
      }
    } catch (err: any) {
      console.warn("Log rotation warning:", err?.message || err);
    }

    return { rotated, bytesFreed };
  }

  /**
   * Prune markdown reports older than retentionDays (default 30 days)
   */
  static async pruneReports(maxAgeDays = 30): Promise<{ count: number; bytesFreed: number }> {
    const reportsDir = config.reportsDir;
    let count = 0;
    let bytesFreed = 0;

    try {
      await fs.access(reportsDir);
    } catch {
      return { count, bytesFreed };
    }

    const now = Date.now();
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

    async function scanAndPrune(dir: string) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await scanAndPrune(fullPath);
          } else if (entry.isFile() && entry.name.endsWith(".md")) {
            const stat = await fs.stat(fullPath);
            if (now - stat.mtimeMs > maxAgeMs) {
              await fs.unlink(fullPath);
              count++;
              bytesFreed += stat.size;
            }
          }
        }
      } catch {}
    }

    await scanAndPrune(reportsDir);
    return { count, bytesFreed };
  }

  /**
   * Run full ecosystem pruning routine
   */
  static async runFullPruning(): Promise<PruneSummary> {
    const { rotated, bytesFreed: logBytes } = await this.rotateLogs();
    const { count: reportCount, bytesFreed: reportBytes } = await this.pruneReports(30);

    return {
      timestamp: new Date().toISOString(),
      logsRotated: rotated,
      reportsDeletedCount: reportCount,
      backupsDeletedCount: 0,
      spaceReclaimedBytes: logBytes + reportBytes,
    };
  }
}
