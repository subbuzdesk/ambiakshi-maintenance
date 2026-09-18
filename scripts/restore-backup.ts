import readline from "node:readline";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { config } from "../src/config.js";
import {
  RestoreService,
  AvailableSnapshot,
  RestoreExecutionSummary,
} from "../src/services/restore-service.js";

function promptUser(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed: {
    all?: boolean;
    secrets?: boolean;
    repos?: boolean;
    supabase?: boolean;
    fromDrive?: boolean;
    list?: boolean;
    dryRun?: boolean;
    force?: boolean;
    timestamp?: string;
    targetDir?: string;
    passphrase?: string;
  } = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--all") parsed.all = true;
    else if (arg === "--secrets") parsed.secrets = true;
    else if (arg === "--repos") parsed.repos = true;
    else if (arg === "--supabase") parsed.supabase = true;
    else if (arg === "--from-drive") parsed.fromDrive = true;
    else if (arg === "--list") parsed.list = true;
    else if (arg === "--dry-run") parsed.dryRun = true;
    else if (arg === "--force") parsed.force = true;
    else if (arg === "--timestamp" && args[i + 1]) {
      parsed.timestamp = args[++i];
    } else if (arg === "--target-dir" && args[i + 1]) {
      parsed.targetDir = path.resolve(args[++i]);
    } else if (arg === "--passphrase" && args[i + 1]) {
      parsed.passphrase = args[++i];
    }
  }

  return parsed;
}

async function main() {
  console.log("=====================================================================");
  console.log("  Ambiakshi One-Click Disaster Recovery Restore Utility");
  console.log("=====================================================================");

  const flags = parseArgs();

  // 1. Google Drive download if requested or local backups/ empty
  if (flags.fromDrive) {
    console.log("\n[Drive Sync] Fetching backup archives from Google Drive...");
    const driveRes = await RestoreService.downloadFromDrive();
    if (driveRes.success) {
      console.log(
        `  -> Successfully downloaded ${driveRes.downloadedFiles.length} files from Google Drive.`
      );
    } else {
      console.error(`  -> Failed to download from Google Drive: ${driveRes.errorMessage}`);
      process.exit(1);
    }
  }

  // 2. Discover available snapshots
  let snapshots = await RestoreService.listLocalSnapshots();

  if (snapshots.length === 0) {
    console.log("\nNo local backup snapshots found in 'backups/' directory.");
    console.log("Would you like to download the latest backup directly from Google Drive?");
    const answer = await promptUser("Download from Google Drive now? (y/N): ");
    if (answer.toLowerCase() === "y" || answer.toLowerCase() === "yes") {
      const driveRes = await RestoreService.downloadFromDrive();
      if (driveRes.success) {
        console.log(`Downloaded ${driveRes.downloadedFiles.length} files from Google Drive.`);
        snapshots = await RestoreService.listLocalSnapshots();
      } else {
        console.error(`Download failed: ${driveRes.errorMessage}`);
        process.exit(1);
      }
    } else {
      console.log("Exiting restore. Please place backup files in 'backups/' or pass --from-drive.");
      process.exit(0);
    }
  }

  // Handle --list flag
  if (flags.list) {
    console.log("\nAvailable Backup Snapshots:\n");
    snapshots.forEach((s, idx) => {
      console.log(
        `[${idx + 1}] Timestamp: ${s.timestamp} (${s.formattedDate})`
      );
      console.log(`    - Secrets Escrow: ${s.hasSecrets ? "✅ Available" : "❌ None"}`);
      console.log(`    - Repositories: ${s.reposCount} bundles`);
      console.log(`    - Supabase: ${s.supabaseDumps.length} database dumps\n`);
    });
    return;
  }

  // Select Snapshot
  let selectedSnapshot: AvailableSnapshot | undefined;
  if (flags.timestamp) {
    selectedSnapshot = snapshots.find((s) => s.timestamp.includes(flags.timestamp!));
    if (!selectedSnapshot) {
      console.error(`Error: Snapshot matching timestamp '${flags.timestamp}' not found.`);
      process.exit(1);
    }
  } else if (flags.all || flags.secrets || flags.repos || flags.supabase) {
    // Non-interactive flag mode defaults to latest snapshot
    selectedSnapshot = snapshots[0];
    console.log(`\nAuto-selected latest snapshot: ${selectedSnapshot.timestamp} (${selectedSnapshot.formattedDate})`);
  } else {
    // Interactive snapshot selection
    console.log("\nAvailable Backup Snapshots:");
    snapshots.slice(0, 5).forEach((s, idx) => {
      console.log(
        `  [${idx + 1}] ${s.formattedDate} (${s.timestamp}) - ${s.reposCount} repos, ${s.supabaseDumps.length} db dumps`
      );
    });

    const choice = await promptUser(`\nSelect snapshot (1-${Math.min(snapshots.length, 5)}, default: 1): `);
    const chosenIdx = parseInt(choice || "1", 10) - 1;
    selectedSnapshot = snapshots[chosenIdx] || snapshots[0];
  }

  console.log(`\nTarget Snapshot: ${selectedSnapshot.timestamp} (${selectedSnapshot.formattedDate})`);

  // Determine what components to restore
  let restoreSecrets = flags.secrets || flags.all;
  let restoreRepos = flags.repos || flags.all;
  let restoreSupabase = flags.supabase || flags.all;

  if (!flags.secrets && !flags.repos && !flags.supabase && !flags.all) {
    console.log("\nSelect components to restore:");
    console.log("  [1] Everything (Secrets, Repositories, Database Dumps) [Default]");
    console.log("  [2] Secrets Escrow Only (.env, credentials)");
    console.log("  [3] Git Repositories Only (.bundle clones)");
    console.log("  [4] Supabase Database Dumps Only");
    const compChoice = await promptUser("Enter choice (1-4, default: 1): ");
    if (compChoice === "2") {
      restoreSecrets = true;
    } else if (compChoice === "3") {
      restoreRepos = true;
    } else if (compChoice === "4") {
      restoreSupabase = true;
    } else {
      restoreSecrets = true;
      restoreRepos = true;
      restoreSupabase = true;
    }
  }

  // Determine Target Directory
  let targetRootDir = flags.targetDir;
  if (!targetRootDir) {
    const defaultParent = path.resolve(config.rootDir, "..");
    if (!flags.all && !flags.secrets && !flags.repos && !flags.supabase) {
      console.log(`\nTarget Directory for ecosystem repositories & configurations:`);
      console.log(`  Default: ${defaultParent} (sibling to ambiakshi-maintenance)`);
      const customPath = await promptUser(`Enter target path or press Enter to accept default: `);
      targetRootDir = customPath ? path.resolve(customPath) : defaultParent;
    } else {
      targetRootDir = defaultParent;
    }
  }

  console.log(`\nUnpack Target Directory: ${targetRootDir}`);
  if (flags.dryRun) {
    console.log(">>> DRY-RUN MODE: Simulating restoration without writing files <<<\n");
  }

  const summary: RestoreExecutionSummary = {
    timestamp: new Date().toISOString(),
    snapshotTimestamp: selectedSnapshot.timestamp,
    targetRootDir,
    dryRun: Boolean(flags.dryRun),
    allSuccessful: true,
  };

  // 1. Restore Git Repositories
  if (restoreRepos) {
    console.log(`\n[1/3] Restoring Git Repositories from Bundles (${selectedSnapshot.repoBundles.length} bundles)...`);
    const repoRes = await RestoreService.restoreRepos({
      bundles: selectedSnapshot.repoBundles,
      targetRootDir,
      dryRun: flags.dryRun,
      force: flags.force,
    });

    summary.repos = repoRes;
    repoRes.items.forEach((item) => {
      if (item.status === "cloned") {
        console.log(`  ✓ ${item.name} -> ${item.targetPath} (branch: ${item.branch || "HEAD"}, commit: ${item.headCommit || "ok"})`);
      } else if (item.status === "skipped_exists") {
        console.log(`  - ${item.name}: Directory exists, skipped (use --force to clone to alternate)`);
      } else {
        console.error(`  ✗ ${item.name}: Failed (${item.errorMessage})`);
      }
    });

    console.log(`  -> Restored: ${repoRes.restoredCount}, Skipped: ${repoRes.skippedCount}, Total: ${repoRes.totalBundlesFound}`);
    if (!repoRes.success) {
      summary.allSuccessful = false;
    }
  }

  // 2. Restore Secrets Escrow
  if (restoreSecrets) {
    if (!selectedSnapshot.hasSecrets || !selectedSnapshot.secretsPath) {
      console.log("\n[2/3] Skipping Secrets: No encrypted secret escrow file found in this snapshot.");
    } else {
      console.log("\n[2/3] Decrypting Secret Escrow Archive...");
      let passphrase = flags.passphrase || config.secretBackupPassphrase;
      if (!passphrase) {
        // Try OS derivation first quietly
        const defaultOsPassphrase = `ambiakshi-escrow-${os.hostname()}-${os.userInfo().username}`;
        try {
          const testBuffer = fs.readFileSync(selectedSnapshot.secretsPath);
          RestoreService.restoreSecrets({
            encryptedFilePath: selectedSnapshot.secretsPath,
            passphrase: defaultOsPassphrase,
            dryRun: true,
          });
          passphrase = defaultOsPassphrase;
        } catch {
          passphrase = await promptUser("Enter Secret Escrow Passphrase to decrypt: ");
        }
      }

      const secRes = await RestoreService.restoreSecrets({
        encryptedFilePath: selectedSnapshot.secretsPath,
        passphrase,
        targetRootDir,
        dryRun: flags.dryRun,
        force: flags.force,
      });

      summary.secrets = secRes;
      if (secRes.success) {
        console.log(`  -> Restored ${secRes.filesRestored.length} environment & secret file(s)`);
        secRes.filesRestored.forEach((f) => console.log(`     ✓ ${f}`));
        if (secRes.skippedFiles.length > 0) {
          console.log(`  -> Skipped ${secRes.skippedFiles.length} existing file(s) (use --force to overwrite)`);
        }
      } else {
        console.error(`  -> Secret Restoration Error: ${secRes.errorMessage}`);
        summary.allSuccessful = false;
      }
    }
  }

  // 3. Restore Supabase Database Dumps
  if (restoreSupabase) {
    console.log(`\n[3/3] Decompressing Supabase Database Dumps (${selectedSnapshot.supabaseDumps.length} projects)...`);
    const spRes = await RestoreService.restoreSupabase({
      dumps: selectedSnapshot.supabaseDumps,
      dryRun: flags.dryRun,
    });

    summary.supabase = spRes;
    spRes.items.forEach((item) => {
      if (item.success) {
        console.log(`  ✓ Project: ${item.projectId} (${item.tablesCount} tables, ${item.totalRows} rows)`);
        console.log(`    Decompressed: ${item.uncompressedPath}`);
      } else {
        console.error(`  ✗ Project: ${item.projectId}: ${item.errorMessage}`);
      }
    });

    if (!spRes.success) {
      summary.allSuccessful = false;
    }
  }

  console.log("\n=====================================================================");
  if (summary.allSuccessful) {
    console.log("  Disaster Recovery Restoration Completed Successfully! ✅");
  } else {
    console.log("  Restoration Completed with Warnings or Errors. Check log above. ⚠️");
  }
  console.log("=====================================================================\n");
}

main().catch((err) => {
  console.error("Fatal error during restore execution:", err?.message || err);
  process.exit(1);
});
