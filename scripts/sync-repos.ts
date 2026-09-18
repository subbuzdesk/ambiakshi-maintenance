import { RepoSyncService } from "../src/services/repo-sync-service.js";

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed: {
    force?: boolean;
    align?: boolean;
    repo?: string;
  } = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--force") parsed.force = true;
    else if (arg === "--align") parsed.align = true;
    else if (arg === "--repo" && args[i + 1]) {
      parsed.repo = args[++i];
    }
  }

  return parsed;
}

async function main() {
  console.log("=====================================================================");
  console.log("  Ambiakshi Ecosystem Git Pull & Synchronization Suite");
  console.log("=====================================================================");
  console.log("Fetches and pulls origin across all local repositories to keep them up to date.\n");

  const flags = parseArgs();

  const summary = await RepoSyncService.syncAllRepos({
    force: flags.force,
    align: flags.align,
    repos: flags.repo ? [flags.repo] : undefined,
  });

  for (const item of summary.results) {
    const branchLabel = item.branch ? `[${item.branch}]` : "";
    if (item.status === "up_to_date") {
      console.log(`  ✓ ${item.id.padEnd(24)} ${branchLabel.padEnd(10)} Up-to-date (${item.beforeCommit || "ok"})`);
    } else if (item.status === "updated") {
      console.log(`  🚀 ${item.id.padEnd(24)} ${branchLabel.padEnd(10)} PULLED ${item.commitsPulledCount} commit(s): ${item.beforeCommit} -> ${item.afterCommit}`);
    } else if (item.status === "ahead") {
      console.log(`  ⭐ ${item.id.padEnd(24)} ${branchLabel.padEnd(10)} Local ahead of remote (${item.details})`);
    } else if (item.status === "diverged") {
      console.log(`  ⚠️ ${item.id.padEnd(24)} ${branchLabel.padEnd(10)} DIVERGED (${item.details})`);
    } else if (item.status === "dirty_skipped") {
      console.log(`  ⏳ ${item.id.padEnd(24)} ${branchLabel.padEnd(10)} SKIPPED: Working directory dirty (${item.uncommittedFilesCount} files). Pass --force to stash & pull.`);
    } else if (item.status === "missing_local") {
      console.log(`  ❌ ${item.id.padEnd(24)} Directory missing on local machine`);
    } else {
      console.error(`  ✗ ${item.id.padEnd(24)} Error: ${item.errorMessage || item.details}`);
    }
  }

  console.log("\n---------------------------------------------------------------------");
  console.log(`  Total Repositories: ${summary.totalReposConfigured}`);
  console.log(`  Already Up-to-Date: ${summary.upToDateCount}`);
  console.log(`  Updated / Pulled:   ${summary.updatedCount}`);
  if (summary.aheadCount > 0) console.log(`  Ahead of Origin:    ${summary.aheadCount}`);
  if (summary.divergedCount > 0) console.log(`  Diverged:           ${summary.divergedCount}`);
  if (summary.dirtyCount > 0) console.log(`  Skipped (Dirty):    ${summary.dirtyCount}`);
  console.log(`  Duration:           ${summary.durationSeconds.toFixed(1)}s`);
  console.log("=====================================================================\n");
}

main().catch((err) => {
  console.error("Fatal error during repository sync:", err?.message || err);
  process.exit(1);
});
