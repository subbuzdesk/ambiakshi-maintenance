import { BackupService } from "../services/backup-service.js";
import { DiscordNotifier } from "../services/discord-notifier.js";

async function main() {
  console.log("=====================================================================");
  console.log("  Ambiakshi Supabase Automated Logical Backup Routine");
  console.log("=====================================================================");

  const summary = await BackupService.backupAllProjects();

  console.log(`\nBackup finished in ${summary.durationSeconds.toFixed(1)}s`);
  console.log(`- Total Rows Dumped: ${summary.totalRowsDumped}`);
  console.log(`- Total Compressed Bytes: ${(summary.totalBytesWritten / 1024).toFixed(1)} KB`);

  for (const p of summary.projects) {
    console.log(`\nProject: ${p.projectName} (${p.projectId})`);
    if (p.success) {
      console.log(`  Status: ✅ Success`);
      console.log(`  File: ${p.backupFilePath}`);
      console.log(`  Size: ${(p.fileSizeBytes / 1024).toFixed(1)} KB`);
      console.log(`  SHA-256: ${p.compressedSha256}`);
      console.log(`  Tables Dumped:`);
      for (const t of p.tables.filter((t) => t.success)) {
        console.log(`    - ${t.tableName}: ${t.rowCount} rows`);
      }
    } else {
      console.log(`  Status: ❌ Failed (${p.errorMessage || "Unknown error"})`);
    }
  }

  // Dispatch Discord alert
  await DiscordNotifier.sendBackupSummary({
    supabaseSummary: {
      totalRowsDumped: summary.totalRowsDumped,
      totalBytesWritten: summary.totalBytesWritten,
      allSuccessful: summary.allSuccessful,
      projects: summary.projects.map((p) => ({
        projectId: p.projectId,
        projectName: p.projectName,
        totalRows: p.totalRows,
        fileSizeBytes: p.fileSizeBytes,
        success: p.success,
      })),
    },
    durationSeconds: summary.durationSeconds,
  });

  if (!summary.allSuccessful) {
    console.warn("\n⚠️ Some Supabase projects failed to back up cleanly.");
    process.exit(1);
  }

  console.log("\n✅ All configured Supabase projects backed up successfully.");
}

main().catch((err) => {
  console.error("Fatal error during Supabase backup:", err);
  process.exit(1);
});
