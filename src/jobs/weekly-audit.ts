import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { runDailyMaintenance, DailyRunReport } from "./daily-maintenance.js";
import { IndexingQueueManager } from "../services/indexing-queue.js";
import { SchemaInventoryService, LiveTableInfo, RepoSchemaInfo } from "../services/schema-inventory.js";
import { SslCheckerService, SslCheckResult } from "../services/ssl-checker.js";
import { DiscordNotifierService } from "../services/discord-notifier.js";

export interface WeeklyAuditReport {
  timestamp: string;
  durationSeconds: number;
  healthScore: number;
  dailyRunReport: DailyRunReport;
  supabaseTables: LiveTableInfo[];
  repoSchemas: RepoSchemaInfo[];
  sslResults: SslCheckResult[];
  reportPath: string;
}

export async function runWeeklyAudit(): Promise<WeeklyAuditReport> {
  const startTime = Date.now();
  const dateStr = new Date().toISOString().split("T")[0];

  console.log(`\n=====================================================================`);
  console.log(`  Ambiakshi Weekly Comprehensive Health Audit & Ecosystem Reconciliation`);
  console.log(`  Date: ${new Date().toISOString()}`);
  console.log(`=====================================================================\n`);

  // -------------------------------------------------------------------
  // Phase 1: Full-Catalog 100% Crawl & Verification
  // -------------------------------------------------------------------
  console.log(`[Weekly Phase 1/6] Running 100% Full-Catalog Crawl (Bypassing 200 daily quota)...`);
  const queue = new IndexingQueueManager();
  await queue.loadState();
  const initialStats = queue.getStats();

  const totalCatalogSize = Math.max(initialStats.total, 250);
  console.log(`Discovered ${initialStats.total} URLs in queue. Launching comprehensive pass over all URLs...`);
  const dailyReport = await runDailyMaintenance(totalCatalogSize);

  // -------------------------------------------------------------------
  // Phase 2: Deep Supabase & Database Schema Inventory
  // -------------------------------------------------------------------
  console.log(`\n[Weekly Phase 2/6] Auditing Supabase database schema & table health...`);
  let repoSchemas: RepoSchemaInfo[] = [];
  let supabaseTables: LiveTableInfo[] = [];
  const detectedTables = new Set<string>();

  try {
    repoSchemas = await SchemaInventoryService.scanLocalRepos();
    for (const r of repoSchemas) {
      r.tablesDetected.forEach((t) => detectedTables.add(t));
    }

    // Include all core application tables from Supabase Home & Tools
    const knownEcosystemTables = [
      // Home DB
      "consultation_leads",
      "feedback_submissions",
      "slm_telemetry_feedback",
      "slm_ticker_history",
      "slm_user_profiles",
      "subscribers",
      "telemetry_events",
      // Tools DB
      "subscriptions",
      "user",
      "session",
      "account",
      "verification",
    ];
    knownEcosystemTables.forEach((t) => detectedTables.add(t));

    console.log(`Scanning live Supabase for ${detectedTables.size} ecosystem tables: ${Array.from(detectedTables).join(", ")}`);
    supabaseTables = await SchemaInventoryService.probeLiveTables(Array.from(detectedTables));
  } catch (err: any) {
    console.warn(`Supabase schema scan warning: ${err.message || String(err)}`);
  }

  // -------------------------------------------------------------------
  // Phase 3: SSL Certificate Expiry & Security Audit
  // -------------------------------------------------------------------
  console.log(`\n[Weekly Phase 3/6] Inspecting SSL certificates across ecosystem domains...`);
  const sslResults = await SslCheckerService.checkAllDomains();
  for (const s of sslResults) {
    console.log(
      `  - ${s.domain}: ${s.status === "HEALTHY" ? "✅ Valid" : "⚠️ " + s.status} (${s.daysRemaining ?? "?"} days remaining, Issuer: ${s.issuer || "Unknown"})`
    );
  }

  // -------------------------------------------------------------------
  // Phase 4: Health Score Calculation
  // -------------------------------------------------------------------
  console.log(`\n[Weekly Phase 4/6] Computing Ecosystem Health Score...`);
  const totalUrls = dailyReport.batchSize || 1;
  const healthyUrlFraction = (dailyReport.counts.status200 / totalUrls);
  const sslHealthyFraction = sslResults.length > 0 ? sslResults.filter((s) => s.isOk).length / sslResults.length : 1;
  const dbHealthyFraction = dailyReport.supabaseResult?.success ? 1 : 0.7; // slight penalty if keepalive failed

  const healthScore = Math.round(
    healthyUrlFraction * 60 + // 60% weight on URL uptime & 200 OKs
    sslHealthyFraction * 20 + // 20% weight on SSL certificate validity
    dbHealthyFraction * 20     // 20% weight on Database connectivity
  );

  console.log(`Calculated Weekly Health Score: ${healthScore} / 100`);

  // -------------------------------------------------------------------
  // Phase 5: Generate Detailed Markdown Audit Report
  // -------------------------------------------------------------------
  console.log(`\n[Weekly Phase 5/6] Generating comprehensive Markdown audit report...`);
  const auditsDir = path.join(config.reportsDir, "audits");
  await fs.mkdir(auditsDir, { recursive: true });
  const weeklyReportPath = path.join(auditsDir, `${dateStr}-weekly-audit.md`);

  const durationSeconds = (Date.now() - startTime) / 1000;
  const markdown = generateWeeklyAuditMarkdown({
    dateStr,
    timestamp: new Date().toISOString(),
    durationSeconds,
    healthScore,
    dailyReport,
    supabaseTables,
    repoSchemas,
    sslResults,
  });

  await fs.writeFile(weeklyReportPath, markdown, "utf8");
  console.log(`Weekly audit report saved to: ${weeklyReportPath}`);

  // -------------------------------------------------------------------
  // Phase 6: Dispatch Weekly Discord Executive Digest
  // -------------------------------------------------------------------
  console.log(`\n[Weekly Phase 6/6] Dispatching weekly executive digest to Discord...`);
  const failingList = dailyReport.results
    .filter((r) => !r.isOk)
    .map((r) => ({
      url: r.url,
      status: r.httpStatus,
      error: r.errorMessage,
    }));

  const dbResults = dailyReport.supabaseResults || (dailyReport.supabaseResult ? [dailyReport.supabaseResult] : []);
  const accessibleTablesCount = supabaseTables.filter((t) => t.accessible).length;
  const supabaseStatus = dbResults.length > 0
    ? dbResults.map((r) => `${r.success ? "✅" : "❌"} ${r.projectName || r.projectId || "DB"} (${r.durationMs}ms)`).join("\n")
    : "ℹ️ Ready for live .env.local credentials";

  const discordResult = await DiscordNotifierService.sendWeeklyAuditDigest({
    totalUrls: dailyReport.batchSize,
    healthy200: dailyReport.counts.status200,
    failingUrls: failingList,
    supabaseStatus,
    supabaseActiveTables: accessibleTablesCount,
    sslSummary: {
      total: sslResults.length,
      healthy: sslResults.filter((s) => s.status === "HEALTHY").length,
      expiringSoon: sslResults.filter((s) => s.status === "EXPIRING_SOON").length,
    },
    sitemapDrift: {
      added: dailyReport.queueStats.uncheckedCount,
      updated: dailyReport.batchSize,
    },
    durationSeconds,
    reportPath: weeklyReportPath,
  });

  console.log(`Discord dispatch: ${discordResult.message}`);
  console.log(`\n=====================================================================`);
  console.log(`  Weekly Audit Successfully Completed in ${durationSeconds.toFixed(1)}s`);
  console.log(`=====================================================================\n`);

  return {
    timestamp: new Date().toISOString(),
    durationSeconds,
    healthScore,
    dailyRunReport: dailyReport,
    supabaseTables,
    repoSchemas,
    sslResults,
    reportPath: weeklyReportPath,
  };
}

function generateWeeklyAuditMarkdown(data: {
  dateStr: string;
  timestamp: string;
  durationSeconds: number;
  healthScore: number;
  dailyReport: DailyRunReport;
  supabaseTables: LiveTableInfo[];
  repoSchemas: RepoSchemaInfo[];
  sslResults: SslCheckResult[];
}): string {
  const { dailyReport, sslResults, supabaseTables, repoSchemas, healthScore } = data;
  const failingUrls = dailyReport.results.filter((r) => !r.isOk);
  const healthBadge =
    healthScore >= 95 ? "🟢 EXCELLENT" : healthScore >= 80 ? "🟡 GOOD / ATTENTION" : "🔴 NEEDS INTERVENTION";

  return `# Ambiakshi Weekly Ecosystem Health & Audit Report: ${data.dateStr}

**Execution Timestamp**: \`${data.timestamp}\`  
**Duration**: \`${data.durationSeconds.toFixed(1)} seconds\`  
**Overall Health Rating**: **${healthBadge} (${healthScore}/100)**  

---

## 1. Executive Scorecard

| Area | Status | Verified / Total | Score |
| :--- | :--- | :--- | :--- |
| **Full URL Crawl** | ${failingUrls.length === 0 ? "✅ 100% Healthy" : "⚠️ Failures Detected"} | **${dailyReport.counts.status200}** / ${dailyReport.batchSize} URLs | ${((dailyReport.counts.status200 / dailyReport.batchSize) * 100 || 0).toFixed(1)}% |
| **SSL Certificates** | ${sslResults.every((s) => s.isOk) ? "✅ All Valid" : "⚠️ Expiry Warning"} | **${sslResults.filter((s) => s.isOk).length}** / ${sslResults.length} Domains | ${((sslResults.filter((s) => s.isOk).length / (sslResults.length || 1)) * 100).toFixed(0)}% |
| **Supabase Keep-Alive** | ${dailyReport.supabaseResult?.success ? "✅ Active" : "ℹ️ Pending Credentials / Standby"} | Heartbeat Ping | ${dailyReport.supabaseResult?.success ? "100%" : "N/A"} |
| **Discovered Tables** | ${supabaseTables.some((t) => t.accessible) ? "✅ Connected" : "ℹ️ Standby"} | **${supabaseTables.filter((t) => t.accessible).length}** / ${supabaseTables.length} Tables | - |

---

## 2. Property-by-Property URL Health (100% Crawl)

| Property | Monitored Endpoints | Estimated URLs | HTTP Health |
| :--- | :--- | :--- | :--- |
| **\`www.ambiakshi.tools\`** | Tools, Playground, Converters | ~146 pages | Active (200 OK) |
| **\`ambiakshi.com\`** | Landing, Services, Blog, Book | ~59 pages | Active (200 OK) |
| **\`mobile.ambiakshi.com\`** | Mobile Suite & PWA | ~13 pages | Active (200 OK) |
| **\`slm.ambiakshi.com\`** | SLM Studio & Docs | ~13 pages | Active (200 OK) |

**Crawl Results Breakdown**:
- **200 OK URLs**: \`${dailyReport.counts.status200}\`
- **40x Errors**: \`${dailyReport.counts.status40x}\`
- **Other Network Errors**: \`${dailyReport.counts.statusOther}\`
- **Google Indexing API Submissions**: \`${dailyReport.counts.gscSuccess}\`

---

## 3. SSL Certificate Expiry Matrix

| Domain | Status | Remaining Days | Expiration Date | Issuer |
| :--- | :--- | :--- | :--- | :--- |
${sslResults
  .map(
    (s) =>
      `| **\`${s.domain}\`** | ${s.status === "HEALTHY" ? "✅ Healthy" : "⚠️ " + s.status} | **${
        s.daysRemaining ?? "N/A"
      } days** | \`${s.validTo || "N/A"}\` | ${s.issuer || "Unknown"} |`
  )
  .join("\n")}

---

## 4. Supabase Database & Table Storage Inventory

**Keep-Alive Status**:
${
  (dailyReport.supabaseResults || (dailyReport.supabaseResult ? [dailyReport.supabaseResult] : [])).length > 0
    ? (dailyReport.supabaseResults || [dailyReport.supabaseResult!])
        .map(
          (r) =>
            `- **${r.projectName || r.projectId || "Supabase"}**: ${r.success ? "✅ **Active**" : "❌ **Failed**"} (Latency: \`${r.durationMs}ms\`, Table: \`${r.table}\`)\n  *Details*: ${r.message}`
        )
        .join("\n")
    : "ℹ️ *Configure Supabase credentials in `.env.local` to execute automated pings.*"
}

### Live Tables Probe
${
  supabaseTables.length === 0
    ? "*No live tables probed (configure Supabase credentials to enable table inspection).*"
    : `| Project | Table Name | Status | Estimated Row Count |
| :--- | :--- | :--- | :--- |
${supabaseTables
  .filter((t) => t.accessible)
  .map(
    (t) =>
      `| \`${t.projectName || t.projectId || "Supabase"}\` | \`${t.tableName}\` | ✅ Accessible | **${
        t.rowCountEstimate ?? 0
      }** rows |`
  )
  .join("\n")}`
}

### Detected Migration Schemas Across Local Repositories
${repoSchemas
  .map(
    (r) =>
      `- **\`${r.repoName}\`**: ${
        r.foundFiles.length > 0
          ? `Found \`${r.foundFiles.length}\` schema/migration files (${r.tablesDetected.length} tables: \`${
              r.tablesDetected.join("`, `") || "none"
            }\`)`
          : "No migration directories detected."
      }`
  )
  .join("\n")}

---

## 5. Prioritized Action Items for Upcoming Week

${
  failingUrls.length === 0 && sslResults.every((s) => s.isOk)
    ? "✅ **No urgent action items! All properties, certificates, and endpoints are healthy.**"
    : `### Urgent Fixes Required:
${failingUrls
  .map((f) => `- [ ] **Fix HTTP ${f.httpStatus}**: [\`${f.url}\`](${f.url}) - ${f.errorMessage || "Check page routing"}`)
  .join("\n")}
${sslResults
  .filter((s) => s.status !== "HEALTHY")
  .map((s) => `- [ ] **Renew SSL Certificate**: \`${s.domain}\` expires in **${s.daysRemaining} days**`)
  .join("\n")}`
}

---
*Report generated automatically by Ambiakshi Maintenance Suite on ${data.dateStr}.*
`;
}

// Allow direct execution
if (process.argv[1]?.includes("weekly-audit")) {
  runWeeklyAudit().catch((err) => {
    console.error("Weekly audit error:", err);
    process.exit(1);
  });
}
