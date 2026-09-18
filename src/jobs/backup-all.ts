import { BackupService } from "../services/backup-service.js";
import { RepoBundleService } from "../services/repo-bundle-service.js";
import { SecretEscrowService } from "../services/secret-escrow-service.js";
import { PruningService } from "../services/pruning-service.js";
import { GoogleDriveService } from "../services/google-drive-service.js";
import { DiscordNotifier } from "../services/discord-notifier.js";

async function main() {
  const startTime = Date.now();
  console.log("=====================================================================");
  console.log("  Ambiakshi Full Ecosystem Disaster Recovery & Cold Backup Suite");
  console.log("=====================================================================");

  // 1. Supabase logical backup
  console.log("\n[1/4] Running Supabase Database Logical Backup...");
  const supabaseSummary = await BackupService.backupAllProjects();
  console.log(`  -> Dumped ${supabaseSummary.totalRowsDumped} rows across ${supabaseSummary.projects.length} project(s)`);

  // 2. Git repo bundles
  console.log("\n[2/4] Creating Git Repository Cold Bundles...");
  const repoSummary = await RepoBundleService.bundleAllRepos();
  console.log(`  -> Bundled ${repoSummary.reposBundledCount} / ${repoSummary.totalReposConfigured} repositories (${(repoSummary.totalBytesWritten / (1024 * 1024)).toFixed(2)} MB)`);

  // 3. Encrypted secrets escrow
  console.log("\n[3/4] Creating AES-256-GCM Encrypted Secret Escrow Archive...");
  const secretSummary = await SecretEscrowService.createSecretBackup();
  if (secretSummary.success) {
    console.log(`  -> Encrypted ${secretSummary.filesCapturedCount} environment/secret files (${(secretSummary.fileSizeBytes / 1024).toFixed(1)} KB)`);
  } else {
    console.log(`  -> Secret backup notice: ${secretSummary.errorMessage}`);
  }

  // 4. Log rotation and retention pruning
  console.log("\n[4/4] Executing Housekeeping Pruning & Log Rotation...");
  const pruneSummary = await PruningService.runFullPruning();
  if (pruneSummary.logsRotated.length > 0) {
    console.log(`  -> Rotated logs: ${pruneSummary.logsRotated.join(", ")}`);
  }
  if (pruneSummary.reportsDeletedCount > 0) {
    console.log(`  -> Pruned ${pruneSummary.reportsDeletedCount} stale reports`);
  }
  console.log(`  -> Pruning complete. Reclaimed ${(pruneSummary.spaceReclaimedBytes / 1024).toFixed(1)} KB.`);

  // 5. Sync backups directly to Google Drive
  console.log("\n[5/6] Uploading Backups Directly to Google Drive Cloud...");
  const driveSummary = await GoogleDriveService.syncAllBackupsToDrive();
  if (driveSummary.filesUploadedCount > 0) {
    console.log(`  -> Synced ${driveSummary.filesUploadedCount} files to Google Drive (${(driveSummary.totalBytesUploaded / (1024 * 1024)).toFixed(2)} MB)`);
    console.log(`  -> Folder URL: ${driveSummary.folderUrl}`);
  } else if (driveSummary.errorMessage) {
    console.log(`  -> Google Drive notice: ${driveSummary.errorMessage}`);
  }

  const durationSeconds = (Date.now() - startTime) / 1000;

  // 6. Send unified Discord summary
  console.log("\n[6/6] Dispatching Discord Status Notification...");
  await DiscordNotifier.sendBackupSummary({
    supabaseSummary: {
      totalRowsDumped: supabaseSummary.totalRowsDumped,
      totalBytesWritten: supabaseSummary.totalBytesWritten,
      allSuccessful: supabaseSummary.allSuccessful,
      projects: supabaseSummary.projects.map((p) => ({
        projectId: p.projectId,
        projectName: p.projectName,
        totalRows: p.totalRows,
        fileSizeBytes: p.fileSizeBytes,
        success: p.success,
      })),
    },
    repoSummary: {
      totalReposConfigured: repoSummary.totalReposConfigured,
      reposBundledCount: repoSummary.reposBundledCount,
      totalBytesWritten: repoSummary.totalBytesWritten,
      allSuccessful: repoSummary.allSuccessful,
      results: repoSummary.results.map((r) => ({
        id: r.id,
        name: r.name,
        branch: r.branch,
        fileSizeBytes: r.fileSizeBytes,
        success: r.success,
      })),
    },
    secretSummary: {
      filesCapturedCount: secretSummary.filesCapturedCount,
      fileSizeBytes: secretSummary.fileSizeBytes,
      success: secretSummary.success,
    },
    driveSummary: driveSummary.filesUploadedCount > 0 ? {
      filesUploadedCount: driveSummary.filesUploadedCount,
      totalBytesUploaded: driveSummary.totalBytesUploaded,
      folderUrl: driveSummary.folderUrl,
      allSuccessful: driveSummary.allSuccessful,
    } : undefined,
    durationSeconds,
  });

  console.log(`\n=====================================================================`);
  console.log(`  Disaster Recovery Suite Completed Successfully in ${durationSeconds.toFixed(1)}s`);
  console.log(`=====================================================================`);
}

main().catch((err) => {
  console.error("Fatal error during disaster recovery run:", err);
  process.exit(1);
});
