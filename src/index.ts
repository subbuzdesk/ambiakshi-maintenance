import { runDailyMaintenance } from "./jobs/daily-maintenance.js";
import { runWeeklyAudit } from "./jobs/weekly-audit.js";
import { runMobileGamesMaintenance } from "./jobs/mobile-games-maintenance.js";
import { IndexingQueueManager } from "./services/indexing-queue.js";
import { SupabaseKeepAliveService } from "./services/supabase-keepalive.js";
import { SchemaInventoryService } from "./services/schema-inventory.js";
import { SslCheckerService } from "./services/ssl-checker.js";
import { config } from "./config.js";

async function main() {
  const args = process.argv.slice(2);
  const modeArg = args.find((a) => a.startsWith("--mode="))?.split("=")[1] || "daily";
  const quotaArg = args.find((a) => a.startsWith("--quota="))?.split("=")[1];
  const allFlag = args.includes("--all");

  console.log(`[Ambiakshi Maintenance CLI] Mode: ${modeArg}`);

  switch (modeArg) {
    case "daily":
    case "maintenance": {
      const quota = quotaArg ? parseInt(quotaArg, 10) : config.dailyQuota;
      await runDailyMaintenance(quota);
      break;
    }

    case "indexing": {
      const queue = new IndexingQueueManager();
      await queue.loadState();
      const stats = queue.getStats();
      const quota = allFlag ? stats.total || 300 : quotaArg ? parseInt(quotaArg, 10) : config.dailyQuota;
      await runDailyMaintenance(quota);
      break;
    }

    case "keepalive": {
      console.log(`Running Supabase Keep-Alive check across all configured projects...`);
      const keepalive = new SupabaseKeepAliveService();
      const results = await keepalive.executeAllHeartbeats();

      console.log(`\n========================================================`);
      console.log(`  Supabase Keep-Alive Results (${results.length} Project${results.length === 1 ? "" : "s"})`);
      console.log(`========================================================`);
      for (const res of results) {
        console.log(`\nProject: ${res.projectName || res.projectId || "Supabase"}`);
        console.log(`  Status:    ${res.success ? "✅ Active" : "❌ Failed"}`);
        console.log(`  Latency:   ${res.durationMs}ms`);
        console.log(`  Table:     ${res.table}`);
        console.log(`  Operation: ${res.operation}`);
        console.log(`  Message:   ${res.message}`);
      }
      console.log(`\n========================================================\n`);
      break;
    }

    case "status": {
      const queue = new IndexingQueueManager();
      await queue.loadState();
      const stats = queue.getStats();
      console.log(`\n========================================================`);
      console.log(`  Ambiakshi Indexing Queue Status`);
      console.log(`========================================================`);
      console.log(`Total URLs in Catalog:      ${stats.total}`);
      console.log(`Verified 200 OK:            ${stats.healthy200Count}`);
      console.log(`Currently Failing (40x):    ${stats.failedCount}`);
      console.log(`Unchecked:                  ${stats.uncheckedCount}`);
      console.log(`Daily Quota:                ${stats.dailyQuota}`);
      console.log(`Full Cycle Duration:        ${stats.estimatedDaysForFullCycle} days`);
      console.log(`Weekly Passes per URL:      ${stats.weeklyPassesPerUrl}x`);
      if (stats.failedUrls.length > 0) {
        console.log(`\nFailing URLs queued for priority retry:`);
        for (const f of stats.failedUrls) {
          console.log(`  - [${f.status || "ERR"}] ${f.url} (Failed ${f.failureCount}x: ${f.error})`);
        }
      } else {
        console.log(`\nAll URLs currently healthy!`);
      }
      console.log(`========================================================\n`);
      break;
    }

    case "inventory": {
      console.log(`\nScanning adjacent local Git repositories for Supabase tables...`);
      const repoSchemas = await SchemaInventoryService.scanLocalRepos();
      const allDetectedTables = new Set<string>();

      for (const repo of repoSchemas) {
        console.log(`\nRepository: ${repo.repoName}`);
        console.log(`  Path: ${repo.repoPath}`);
        console.log(`  Found schema/migration files: ${repo.foundFiles.length}`);
        if (repo.tablesDetected.length > 0) {
          console.log(`  Tables detected: ${repo.tablesDetected.join(", ")}`);
          repo.tablesDetected.forEach((t) => allDetectedTables.add(t));
        } else {
          console.log(`  No SQL CREATE TABLE statements detected in standard folders.`);
        }
      }

      // Add all live ecosystem tables from Supabase Home & Tools
      [
        // Home DB tables
        "consultation_leads",
        "feedback_submissions",
        "slm_telemetry_feedback",
        "slm_ticker_history",
        "slm_user_profiles",
        "subscribers",
        "telemetry_events",
        // Tools DB tables
        "subscriptions",
        "user",
        "session",
        "account",
        "verification",
      ].forEach((t) => allDetectedTables.add(t));

      console.log(`\nProbing live Supabase databases for ${allDetectedTables.size} detected tables...`);
      if (allDetectedTables.size > 0) {
        const probeResults = await SchemaInventoryService.probeLiveTables(
          Array.from(allDetectedTables)
        );

        const byProject = new Map<string, typeof probeResults>();
        for (const p of probeResults) {
          const key = p.projectName || p.projectId || "Supabase";
          if (!byProject.has(key)) byProject.set(key, []);
          byProject.get(key)!.push(p);
        }

        for (const [proj, list] of byProject.entries()) {
          console.log(`\n========================================================`);
          console.log(`  Database Schema Inventory: ${proj}`);
          console.log(`========================================================`);
          const accessible = list.filter((p) => p.accessible);
          if (accessible.length > 0) {
            for (const p of accessible) {
              console.log(`  ✅ Table '${p.tableName}': Accessible (${p.rowCountEstimate} rows)`);
            }
          } else {
            console.log(`  No matching tables detected in this project schema.`);
          }
        }
      } else {
        console.log(`  No candidate tables detected from local files yet.`);
      }
      break;
    }

    case "weekly":
    case "audit": {
      console.log(`Starting Weekly Comprehensive Ecosystem Health Audit...`);
      await runWeeklyAudit();
      break;
    }

    case "ssl": {
      console.log(`\nInspecting SSL certificate expiry across ecosystem domains...`);
      const sslResults = await SslCheckerService.checkAllDomains();
      console.log(`\n========================================================`);
      console.log(`  SSL Certificate Expiry Status`);
      console.log(`========================================================`);
      for (const s of sslResults) {
        console.log(
          `  - ${s.domain.padEnd(26)}: ${s.status === "HEALTHY" ? "✅ Valid" : "⚠️ " + s.status} (${s.daysRemaining ?? "?"} days remaining, Valid to: ${s.validTo || "N/A"})`
        );
      }
      console.log(`========================================================\n`);
      break;
    }

    case "mobile":
    case "mobile-games": {
      console.log(`Starting Mobile Games Ecosystem Maintenance...`);
      await runMobileGamesMaintenance();
      break;
    }

    default:
      console.log(`Unknown mode: ${modeArg}`);
      console.log(`Available modes: daily, weekly, indexing, keepalive, status, inventory, ssl, mobile`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("CLI fatal error:", err);
  process.exit(1);
});
