import { runDailyMaintenance } from "./jobs/daily-maintenance.js";
import { IndexingQueueManager } from "./services/indexing-queue.js";
import { SupabaseKeepAliveService } from "./services/supabase-keepalive.js";
import { SchemaInventoryService } from "./services/schema-inventory.js";
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
      console.log(`Running standalone Supabase Keep-Alive check...`);
      const keepalive = new SupabaseKeepAliveService();
      const res = await keepalive.executeHeartbeat();
      console.log(`Result:`, res);
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

      console.log(`\nProbing live Supabase database for detected tables...`);
      if (allDetectedTables.size > 0) {
        const probeResults = await SchemaInventoryService.probeLiveTables(
          Array.from(allDetectedTables)
        );
        for (const p of probeResults) {
          console.log(
            `  - Table '${p.tableName}': ${p.accessible ? `Accessible (${p.rowCountEstimate} rows)` : `Error: ${p.status}`}`
          );
        }
      } else {
        console.log(`  No candidate tables detected from local files yet.`);
      }
      break;
    }

    default:
      console.log(`Unknown mode: ${modeArg}`);
      console.log(`Available modes: daily, indexing, keepalive, status, inventory`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("CLI fatal error:", err);
  process.exit(1);
});
