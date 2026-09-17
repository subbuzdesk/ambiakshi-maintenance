import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { runDailyMaintenance } from "./daily-maintenance.js";
import { IndexingQueueManager } from "../services/indexing-queue.js";

export async function runWeeklyAudit() {
  console.log(`\n=====================================================================`);
  console.log(`  Ambiakshi Weekly Comprehensive Health Audit & Queue Reconciliation`);
  console.log(`=====================================================================\n`);

  // Run full batch covering all URLs in catalog
  const queue = new IndexingQueueManager();
  await queue.loadState();
  const statsBefore = queue.getStats();

  console.log(`Total URLs registered across ecosystem: ${statsBefore.total}`);
  console.log(`Initiating complete pass over all ${statsBefore.total} URLs...`);

  // Force full quota equal to total URLs
  const report = await runDailyMaintenance(statsBefore.total || 300);

  const auditsDir = path.join(config.reportsDir, "audits");
  await fs.mkdir(auditsDir, { recursive: true });
  const weeklyReportPath = path.join(auditsDir, `${new Date().toISOString().split("T")[0]}-weekly-audit.md`);

  const markdown = `# Ambiakshi Weekly Ecosystem Health Audit

**Date**: \`${new Date().toISOString()}\`  
**Total URLs Tested**: **${report.batchSize}**  
**Healthy 200 OK URLs**: **${report.counts.status200}** (${((report.counts.status200 / report.batchSize) * 100 || 0).toFixed(1)}%)  
**Failing URLs**: **${report.counts.status40x + report.counts.statusOther}**  

## Property Breakdown
- **tools.ambiakshi.com / www.ambiakshi.tools**: ~146 pages
- **ambiakshi.com**: ~59 pages
- **mobile.ambiakshi.com**: ~13 pages
- **slm.ambiakshi.com**: ~13 pages

## Status Details
Refer to detailed daily run log for raw latency and headers.
`;

  await fs.writeFile(weeklyReportPath, markdown, "utf8");
  console.log(`Weekly audit report written to: ${weeklyReportPath}`);
}

if (process.argv[1]?.includes("weekly-audit")) {
  runWeeklyAudit().catch((err) => {
    console.error("Weekly audit error:", err);
    process.exit(1);
  });
}
