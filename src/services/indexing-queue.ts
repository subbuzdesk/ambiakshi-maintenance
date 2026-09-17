import fs from "node:fs/promises";
import { config } from "../config.js";
import { SitemapEntry } from "./sitemap-fetcher.js";

export interface UrlRecord {
  url: string;
  domain: string;
  sitemapSource: string;
  lastHttpStatus?: number;
  lastCheckedAt?: string;
  lastSuccessAt?: string;
  lastErrorAt?: string;
  lastErrorMessage?: string;
  failureCount: number;
  isFailed: boolean;
  checkCount: number;
  gscNotificationStatus?: "SUCCESS" | "FAILED" | "SKIPPED";
  gscNotificationAt?: string;
}

export interface IndexingState {
  version: string;
  lastRunAt?: string;
  totalUrls: number;
  stats: {
    total200Ok: number;
    total40xErrors: number;
    totalOtherErrors: number;
    totalNeverChecked: number;
  };
  urls: Record<string, UrlRecord>;
}

export class IndexingQueueManager {
  private state: IndexingState = {
    version: "1.0",
    totalUrls: 0,
    stats: {
      total200Ok: 0,
      total40xErrors: 0,
      totalOtherErrors: 0,
      totalNeverChecked: 0,
    },
    urls: {},
  };

  /**
   * Load state from disk or initialize fresh
   */
  async loadState(): Promise<void> {
    try {
      const data = await fs.readFile(config.stateFilePath, "utf8");
      this.state = JSON.parse(data);
    } catch {
      // File doesn't exist yet, start with default empty state
      this.state = {
        version: "1.0",
        totalUrls: 0,
        stats: {
          total200Ok: 0,
          total40xErrors: 0,
          totalOtherErrors: 0,
          totalNeverChecked: 0,
        },
        urls: {},
      };
    }
  }

  /**
   * Sync active sitemap entries into state store, preserving historical results
   */
  syncEntries(entries: SitemapEntry[]): { added: number; updated: number } {
    let added = 0;
    let updated = 0;

    for (const entry of entries) {
      const existing = this.state.urls[entry.url];
      if (!existing) {
        this.state.urls[entry.url] = {
          url: entry.url,
          domain: entry.domain,
          sitemapSource: entry.sitemapSource,
          failureCount: 0,
          isFailed: false,
          checkCount: 0,
        };
        added++;
      } else {
        existing.sitemapSource = entry.sitemapSource;
        existing.domain = entry.domain;
        updated++;
      }
    }

    this.recalculateStats();
    return { added, updated };
  }

  /**
   * Select daily batch according to requirements:
   * 1. Priority to URLs that previously failed (40x or network error)
   * 2. Remaining slots filled round-robin by oldest or never-checked URLs
   */
  selectDailyBatch(quota: number = config.dailyQuota): UrlRecord[] {
    const allRecords = Object.values(this.state.urls);

    // 1. Partition into failed vs healthy/unseen
    const failedRecords = allRecords
      .filter((r) => r.isFailed)
      .sort((a, b) => {
        // High failure count first, then oldest checked
        if (b.failureCount !== a.failureCount) {
          return b.failureCount - a.failureCount;
        }
        const timeA = a.lastCheckedAt ? new Date(a.lastCheckedAt).getTime() : 0;
        const timeB = b.lastCheckedAt ? new Date(b.lastCheckedAt).getTime() : 0;
        return timeA - timeB;
      });

    const healthyOrUnchecked = allRecords
      .filter((r) => !r.isFailed)
      .sort((a, b) => {
        // Never checked first
        if (!a.lastCheckedAt && b.lastCheckedAt) return -1;
        if (a.lastCheckedAt && !b.lastCheckedAt) return 1;
        if (!a.lastCheckedAt && !b.lastCheckedAt) return 0;
        // Oldest checked date first
        return new Date(a.lastCheckedAt!).getTime() - new Date(b.lastCheckedAt!).getTime();
      });

    // 2. Select failed items first up to quota
    const selected: UrlRecord[] = [];
    for (const item of failedRecords) {
      if (selected.length < quota) {
        selected.push(item);
      }
    }

    // 3. Fill remaining quota from top of healthy/round-robin queue
    for (const item of healthyOrUnchecked) {
      if (selected.length < quota) {
        selected.push(item);
      } else {
        break;
      }
    }

    return selected;
  }

  /**
   * Update record result following inspection / indexing
   */
  recordResult(
    url: string,
    result: {
      httpStatus: number;
      isOk: boolean;
      errorMessage?: string;
      gscStatus?: "SUCCESS" | "FAILED" | "SKIPPED";
    }
  ): void {
    const record = this.state.urls[url];
    if (!record) return;

    const now = new Date().toISOString();
    record.lastCheckedAt = now;
    record.lastHttpStatus = result.httpStatus;
    record.checkCount++;

    if (result.gscStatus) {
      record.gscNotificationStatus = result.gscStatus;
      record.gscNotificationAt = now;
    }

    if (result.isOk && result.httpStatus >= 200 && result.httpStatus < 300) {
      record.isFailed = false;
      record.lastSuccessAt = now;
      record.failureCount = 0;
      record.lastErrorMessage = undefined;
    } else {
      record.isFailed = true;
      record.lastErrorAt = now;
      record.failureCount++;
      record.lastErrorMessage =
        result.errorMessage || `HTTP ${result.httpStatus} received`;
    }
  }

  /**
   * Save current state to disk
   */
  async saveState(): Promise<void> {
    this.recalculateStats();
    this.state.lastRunAt = new Date().toISOString();
    await fs.mkdir(config.dataDir, { recursive: true });
    await fs.writeFile(config.stateFilePath, JSON.stringify(this.state, null, 2), "utf8");
  }

  /**
   * Get queue health metrics
   */
  getStats() {
    this.recalculateStats();
    const all = Object.values(this.state.urls);
    const total = all.length;
    const failed = all.filter((r) => r.isFailed);
    const healthy = all.filter((r) => !r.isFailed && r.checkCount > 0);
    const unchecked = all.filter((r) => r.checkCount === 0);

    return {
      total,
      healthy200Count: healthy.length,
      failedCount: failed.length,
      uncheckedCount: unchecked.length,
      dailyQuota: config.dailyQuota,
      estimatedDaysForFullCycle: total > 0 ? (total / config.dailyQuota).toFixed(2) : "0",
      weeklyPassesPerUrl:
        total > 0 ? ((config.dailyQuota * 7) / total).toFixed(1) : "0",
      failedUrls: failed.map((f) => ({
        url: f.url,
        status: f.lastHttpStatus,
        error: f.lastErrorMessage,
        failureCount: f.failureCount,
      })),
    };
  }

  private recalculateStats(): void {
    const list = Object.values(this.state.urls);
    this.state.totalUrls = list.length;
    let ok = 0;
    let errors40x = 0;
    let otherErrors = 0;
    let neverChecked = 0;

    for (const r of list) {
      if (r.checkCount === 0) {
        neverChecked++;
      } else if (r.lastHttpStatus && r.lastHttpStatus >= 200 && r.lastHttpStatus < 300) {
        ok++;
      } else if (r.lastHttpStatus && r.lastHttpStatus >= 400 && r.lastHttpStatus < 500) {
        errors40x++;
      } else {
        otherErrors++;
      }
    }

    this.state.stats = {
      total200Ok: ok,
      total40xErrors: errors40x,
      totalOtherErrors: otherErrors,
      totalNeverChecked: neverChecked,
    };
  }
}
