import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { fetchAllSitemaps } from "../services/sitemap-fetcher.js";
import { IndexingQueueManager, UrlRecord } from "../services/indexing-queue.js";
import { GscIndexerService, UrlInspectionResult } from "../services/gsc-indexer.js";
import { SupabaseKeepAliveService, KeepAliveResult } from "../services/supabase-keepalive.js";

export interface DailyRunReport {
  timestamp: string;
  totalCatalogUrls: number;
  batchSize: number;
  results: UrlInspectionResult[];
  counts: {
    status200: number;
    status40x: number;
    statusOther: number;
    gscSuccess: number;
    gscSkipped: number;
    gscFailed: number;
  };
  supabaseResult?: KeepAliveResult;
  supabaseResults?: KeepAliveResult[];
  queueStats: ReturnType<IndexingQueueManager["getStats"]>;
}

/**
 * Execute batch items with controlled concurrency
 */
async function processBatchWithConcurrency(
  items: UrlRecord[],
  indexer: GscIndexerService,
  concurrency: number = 5
): Promise<UrlInspectionResult[]> {
  const results: UrlInspectionResult[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = items[index++];
      try {
        const res = await indexer.processUrl(current.url);
        results.push(res);
      } catch (err: any) {
        results.push({
          url: current.url,
          httpStatus: 0,
          isOk: false,
          responseTimeMs: 0,
          hasNoIndex: false,
          errorMessage: err?.message || String(err),
          gscNotificationStatus: "FAILED",
        });
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function runDailyMaintenance(customQuota?: number): Promise<DailyRunReport> {
  const startTime = Date.now();
  const dateStr = new Date().toISOString().split("T")[0];
  console.log(`\n=====================================================================`);
  console.log(`  Ambiakshi Daily Housekeeping & Maintenance Run [${new Date().toISOString()}]`);
  console.log(`=====================================================================\n`);

  // 1. Fetch live sitemaps
  console.log(`[Step 1/5] Fetching live sitemaps from 4 properties...`);
  const { allEntries, summary, errors } = await fetchAllSitemaps();
  console.log(`- tools: ${summary["www.ambiakshi.tools"] || summary["tools.ambiakshi.com"] || 0} URLs`);
  console.log(`- mobile: ${summary["mobile.ambiakshi.com"] || 0} URLs`);
  console.log(`- home: ${summary["ambiakshi.com"] || 0} URLs`);
  console.log(`- slm: ${summary["slm.ambiakshi.com"] || 0} URLs`);
  console.log(`Total live URLs retrieved: ${allEntries.length}`);

  if (Object.keys(errors).length > 0) {
    console.warn(`[Warning] Errors encountered while fetching sitemaps:`, errors);
  }

  // 2. Sync entries to indexing state queue
  console.log(`\n[Step 2/5] Synchronizing URLs with persistent queue...`);
  const queue = new IndexingQueueManager();
  await queue.loadState();
  const { added, updated } = queue.syncEntries(allEntries);
  console.log(`Queue state synced: +${added} new URLs registered, ${updated} updated.`);

  // 3. Select 200 URLs with failure prioritization
  const quota = customQuota || config.dailyQuota;
  const batch = queue.selectDailyBatch(quota);
  const prioritizedFailures = batch.filter((r) => r.isFailed).length;
  console.log(
    `Selected daily batch: ${batch.length} URLs (Prioritized retries: ${prioritizedFailures}, Round-robin: ${
      batch.length - prioritizedFailures
    })`
  );

  // 4. Process HTTP inspection & Google Indexing submissions
  console.log(`\n[Step 3/5] Inspecting HTTP status & submitting to Google Indexing API...`);
  const indexer = new GscIndexerService();
  const results = await processBatchWithConcurrency(batch, indexer, 5);

  let status200 = 0;
  let status40x = 0;
  let statusOther = 0;
  let gscSuccess = 0;
  let gscSkipped = 0;
  let gscFailed = 0;

  for (const res of results) {
    queue.recordResult(res.url, {
      httpStatus: res.httpStatus,
      isOk: res.isOk,
      errorMessage: res.errorMessage,
      gscStatus: res.gscNotificationStatus,
    });

    if (res.httpStatus >= 200 && res.httpStatus < 300) status200++;
    else if (res.httpStatus >= 400 && res.httpStatus < 500) status40x++;
    else statusOther++;

    if (res.gscNotificationStatus === "SUCCESS") gscSuccess++;
    else if (res.gscNotificationStatus === "SKIPPED") gscSkipped++;
    else gscFailed++;
  }

  console.log(`Inspected ${results.length} URLs:`);
  console.log(`  - 200 OK: ${status200}`);
  console.log(`  - 40x Errors: ${status40x}`);
  console.log(`  - Other Statuses: ${statusOther}`);
  console.log(
    `  - Google API: ${gscSuccess} submitted, ${gscSkipped} skipped, ${gscFailed} failed`
  );

  // 5. Supabase Keep-Alive
  console.log(`\n[Step 4/5] Executing Supabase Keep-Alive heartbeat across configured projects...`);
  const keepalive = new SupabaseKeepAliveService();
  const supabaseResults = await keepalive.executeAllHeartbeats();
  const supabaseResult = supabaseResults[0];

  if (supabaseResults.length > 0) {
    for (const r of supabaseResults) {
      console.log(`  - [${r.projectName || r.projectId || "Supabase"}]: ${r.success ? "✅ Active" : "❌ Failed"} (${r.durationMs}ms) - ${r.message}`);
    }
  } else {
    console.log(
      `Supabase keep-alive skipped: No Supabase URLs / keys configured in .env.`
    );
  }

  // 6. Save updated queue state
  console.log(`\n[Step 5/5] Saving persistent state and generating markdown report...`);
  await queue.saveState();
  const queueStats = queue.getStats();

  // 7. Write Markdown Run Report
  const reportsDir = path.join(config.reportsDir, "indexing");
  await fs.mkdir(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, `${dateStr}-daily-run.md`);

  const reportMarkdown = generateReportMarkdown({
    timestamp: new Date().toISOString(),
    totalCatalogUrls: allEntries.length,
    batchSize: batch.length,
    results,
    counts: {
      status200,
      status40x,
      statusOther,
      gscSuccess,
      gscSkipped,
      gscFailed,
    },
    supabaseResult,
    supabaseResults,
    queueStats,
  });

  await fs.writeFile(reportPath, reportMarkdown, "utf8");
  console.log(`Report generated: ${reportPath}`);
  console.log(
    `Batch completed in ${((Date.now() - startTime) / 1000).toFixed(1)}s. Next run scheduled for 4:00 AM EST.`
  );

  return {
    timestamp: new Date().toISOString(),
    totalCatalogUrls: allEntries.length,
    batchSize: batch.length,
    results,
    counts: {
      status200,
      status40x,
      statusOther,
      gscSuccess,
      gscSkipped,
      gscFailed,
    },
    supabaseResult,
    supabaseResults,
    queueStats,
  };
}

function generateReportMarkdown(data: DailyRunReport): string {
  const errors = data.results.filter((r) => !r.isOk);
  const dbResults = data.supabaseResults || (data.supabaseResult ? [data.supabaseResult] : []);

  return `# Ambiakshi Daily Maintenance Report: ${data.timestamp.split("T")[0]}

**Execution Timestamp**: \`${data.timestamp}\`  
**Total URLs in Sitemaps**: **${data.totalCatalogUrls}**  
**Batch Processed**: **${data.batchSize}**  
**Estimated Full Cycle Period**: **${data.queueStats.estimatedDaysForFullCycle} days** (averaging **${data.queueStats.weeklyPassesPerUrl} passes/week per URL**)

---

## 1. Indexing & HTTP Inspection Summary

| Metric | Count | Percentage |
| :--- | :--- | :--- |
| **200 OK** | \`${data.counts.status200}\` | ${((data.counts.status200 / data.batchSize) * 100 || 0).toFixed(1)}% |
| **40x Errors** | \`${data.counts.status40x}\` | ${((data.counts.status40x / data.batchSize) * 100 || 0).toFixed(1)}% |
| **Other / Network Errors** | \`${data.counts.statusOther}\` | ${((data.counts.statusOther / data.batchSize) * 100 || 0).toFixed(1)}% |
| **GSC Submissions** | \`${data.counts.gscSuccess}\` | - |
| **GSC Skipped (Unconfigured/Failed)** | \`${data.counts.gscSkipped + data.counts.gscFailed}\` | - |

---

## 2. Supabase Keep-Alive Status

${
  dbResults.length > 0
    ? dbResults
        .map(
          (r) =>
            `- **${r.projectName || r.projectId || "Supabase"}**: ${r.success ? "✅ Active" : "❌ Failed"} (\`${r.durationMs}ms\` on \`${r.table}\`)\n  *Details*: ${r.message}`
        )
        .join("\n\n")
    : "- *Note: Configure Supabase credentials in `.env.local` to enable automated daily keepalive heartbeat.*"
}

---

## 3. Prioritized Retries for Tomorrow (Failed URLs)

${
  errors.length === 0
    ? "✅ **No errors detected in this batch.** All processed pages returned valid 200 OK responses."
    : `The following **${errors.length} URLs failed** and will be prioritized at the front of tomorrow's 4:00 AM EST batch:

| URL | Status | Details |
| :--- | :--- | :--- |
${errors
  .map(
    (e) =>
      `| [\`${e.url}\`](${e.url}) | \`${e.httpStatus || "ERR"}\` | ${
        e.errorMessage || (e.hasNoIndex ? "noindex detected" : "HTTP Error")
      } |`
  )
  .join("\n")}`
}

---

## 4. Inspected URLs Detail (First 20 in Batch)

| URL | HTTP Status | Latency | GSC Indexing |
| :--- | :--- | :--- | :--- |
${data.results
  .slice(0, 20)
  .map(
    (r) =>
      `| [\`${r.url}\`](${r.url}) | \`${r.httpStatus}\` | \`${r.responseTimeMs}ms\` | \`${r.gscNotificationStatus}\` |`
  )
  .join("\n")}
${data.results.length > 20 ? `\n*...and ${data.results.length - 20} more URLs verified.*` : ""}
`;
}

// Allow direct execution
if (process.argv[1]?.includes("daily-maintenance")) {
  runDailyMaintenance().catch((err) => {
    console.error("Daily maintenance error:", err);
    process.exit(1);
  });
}
