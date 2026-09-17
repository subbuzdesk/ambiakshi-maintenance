import { RepoBundleService } from "../services/repo-bundle-service.js";
import { DiscordNotifier } from "../services/discord-notifier.js";

async function main() {
  console.log("=====================================================================");
  console.log("  Ambiakshi Git Repository Cold-Backup & Bundle Escrow");
  console.log("=====================================================================");

  const summary = await RepoBundleService.bundleAllRepos();

  console.log(`\nBundling completed in ${summary.durationSeconds.toFixed(1)}s`);
  console.log(`- Repositories Bundled: ${summary.reposBundledCount} / ${summary.totalReposConfigured}`);
  console.log(`- Total Archive Size: ${(summary.totalBytesWritten / (1024 * 1024)).toFixed(2)} MB`);

  for (const r of summary.results) {
    if (r.success) {
      console.log(`  ✅ ${r.name.padEnd(28)} [${r.branch || "main"} @ ${r.headCommit || "head"}] -> ${(r.fileSizeBytes / 1024).toFixed(0)} KB (Verified)`);
    } else {
      console.log(`  ⚠️ ${r.name.padEnd(28)} Skipped/Error: ${r.errorMessage}`);
    }
  }

  // Send Discord notification
  await DiscordNotifier.sendBackupSummary({
    repoSummary: {
      totalReposConfigured: summary.totalReposConfigured,
      reposBundledCount: summary.reposBundledCount,
      totalBytesWritten: summary.totalBytesWritten,
      allSuccessful: summary.allSuccessful,
      results: summary.results.map((r) => ({
        id: r.id,
        name: r.name,
        branch: r.branch,
        fileSizeBytes: r.fileSizeBytes,
        success: r.success,
      })),
    },
    durationSeconds: summary.durationSeconds,
  });

  console.log("\n✅ Repository bundles created and verified.");
}

main().catch((err) => {
  console.error("Fatal error during repo bundling:", err);
  process.exit(1);
});
