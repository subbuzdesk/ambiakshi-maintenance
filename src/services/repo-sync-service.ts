import fs from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { config, EcosystemRepo } from "../config.js";

const execAsync = promisify(exec);

export type RepoSyncStatus =
  | "up_to_date"
  | "updated"
  | "ahead"
  | "diverged"
  | "dirty_skipped"
  | "missing_local"
  | "not_git_repo"
  | "error";

export interface RepoSyncItem {
  id: string;
  name: string;
  localPath: string;
  branch?: string;
  status: RepoSyncStatus;
  beforeCommit?: string;
  afterCommit?: string;
  commitsPulledCount?: number;
  uncommittedFilesCount?: number;
  details?: string;
  errorMessage?: string;
}

export interface RepoSyncSummary {
  timestamp: string;
  durationSeconds: number;
  totalReposConfigured: number;
  upToDateCount: number;
  updatedCount: number;
  aheadCount: number;
  divergedCount: number;
  dirtyCount: number;
  errorCount: number;
  results: RepoSyncItem[];
  allSuccessful: boolean;
}

export class RepoSyncService {
  /**
   * Sync and pull changes from origin for a single repository
   */
  static async syncRepo(
    repo: EcosystemRepo,
    options: {
      force?: boolean;
      stashAndPull?: boolean;
      align?: boolean;
      remoteName?: string;
    } = {}
  ): Promise<RepoSyncItem> {
    const remote = options.remoteName || "origin";

    // 1. Verify existence
    try {
      await fs.access(repo.path);
    } catch {
      return {
        id: repo.id,
        name: repo.name,
        localPath: repo.path,
        status: "missing_local",
        details: "Repository directory does not exist on local disk.",
      };
    }

    // 2. Verify .git directory
    const gitDir = path.join(repo.path, ".git");
    try {
      await fs.access(gitDir);
    } catch {
      return {
        id: repo.id,
        name: repo.name,
        localPath: repo.path,
        status: "not_git_repo",
        details: "Directory is not a valid Git repository (missing .git).",
      };
    }

    try {
      // 3. Ensure remote URL is configured
      if (repo.repoUrl) {
        try {
          const { stdout: currentRemote } = await execAsync(`git remote get-url ${remote}`, {
            cwd: repo.path,
          });
          if (
            currentRemote.trim() !== repo.repoUrl &&
            !currentRemote.trim().includes(".bundle")
          ) {
            // Keep existing valid URL if different protocol, but update if bundle path
          } else if (currentRemote.trim().includes(".bundle")) {
            await execAsync(`git remote set-url ${remote} "${repo.repoUrl}"`, {
              cwd: repo.path,
            });
          }
        } catch {
          // Add remote if missing
          await execAsync(`git remote add ${remote} "${repo.repoUrl}"`, {
            cwd: repo.path,
          });
        }
      }

      // 4. Identify current branch
      const { stdout: branchOut } = await execAsync("git rev-parse --abbrev-ref HEAD", {
        cwd: repo.path,
      });
      const branch = branchOut.trim();

      // 5. Check for uncommitted working tree changes
      const { stdout: statusOut } = await execAsync("git status --porcelain", {
        cwd: repo.path,
      });
      const dirtyLines = statusOut.trim() ? statusOut.trim().split("\n") : [];

      if (dirtyLines.length > 0 && !options.force && !options.stashAndPull) {
        const { stdout: headOut } = await execAsync("git rev-parse --short HEAD", {
          cwd: repo.path,
        });
        return {
          id: repo.id,
          name: repo.name,
          localPath: repo.path,
          branch,
          status: "dirty_skipped",
          beforeCommit: headOut.trim(),
          uncommittedFilesCount: dirtyLines.length,
          details: `Skipped pull because working directory has ${dirtyLines.length} uncommitted file(s). Use --force to stash and pull.`,
        };
      }

      // 6. Optionally stash changes if requested
      let didStash = false;
      if (dirtyLines.length > 0 && (options.force || options.stashAndPull)) {
        await execAsync(`git stash push -m "ambiakshi-auto-sync-${Date.now()}"`, {
          cwd: repo.path,
        });
        didStash = true;
      }

      // 7. Get initial HEAD commit
      const { stdout: initialHead } = await execAsync("git rev-parse --short HEAD", {
        cwd: repo.path,
      });
      const beforeCommit = initialHead.trim();

      // 8. Fetch remote refs
      await execAsync(`git fetch ${remote}`, { cwd: repo.path });

      // 9. Compare local HEAD with remote branch
      const remoteBranchRef = `${remote}/${branch}`;
      let hasRemoteBranch = false;
      try {
        await execAsync(`git rev-parse --verify "${remoteBranchRef}"`, {
          cwd: repo.path,
        });
        hasRemoteBranch = true;
      } catch {
        // Remote branch doesn't exist yet
      }

      if (!hasRemoteBranch) {
        if (didStash) {
          try {
            await execAsync("git stash pop", { cwd: repo.path });
          } catch {}
        }
        return {
          id: repo.id,
          name: repo.name,
          localPath: repo.path,
          branch,
          status: "ahead",
          beforeCommit,
          afterCommit: beforeCommit,
          details: `Branch '${branch}' has no upstream remote '${remoteBranchRef}'.`,
        };
      }

      const { stdout: localFull } = await execAsync("git rev-parse HEAD", {
        cwd: repo.path,
      });
      const { stdout: remoteFull } = await execAsync(`git rev-parse "${remoteBranchRef}"`, {
        cwd: repo.path,
      });

      if (localFull.trim() === remoteFull.trim()) {
        if (didStash) {
          try {
            await execAsync("git stash pop", { cwd: repo.path });
          } catch {}
        }
        return {
          id: repo.id,
          name: repo.name,
          localPath: repo.path,
          branch,
          status: "up_to_date",
          beforeCommit,
          afterCommit: beforeCommit,
          commitsPulledCount: 0,
          details: `Already completely up-to-date with ${remoteBranchRef} (${beforeCommit}).`,
        };
      }

      // Check if local is behind remote (fast-forward possible)
      let mergeBase = "";
      try {
        const { stdout: baseOut } = await execAsync(
          `git merge-base HEAD "${remoteBranchRef}"`,
          { cwd: repo.path }
        );
        mergeBase = baseOut.trim();
      } catch {
        // No common ancestor found / unrelated histories
        mergeBase = "";
      }

      if (!mergeBase) {
        if (options.align) {
          const backupBranch = `backup-diverged-${Date.now()}`;
          await execAsync(`git branch ${backupBranch}`, { cwd: repo.path });
          await execAsync(`git reset --hard "${remoteBranchRef}"`, { cwd: repo.path });
          await execAsync(`git branch --set-upstream-to="${remoteBranchRef}" ${branch}`, { cwd: repo.path });
          const { stdout: newHead } = await execAsync("git rev-parse --short HEAD", { cwd: repo.path });
          return {
            id: repo.id,
            name: repo.name,
            localPath: repo.path,
            branch,
            status: "updated",
            beforeCommit,
            afterCommit: newHead.trim(),
            commitsPulledCount: 1,
            details: `Force-aligned with ${remoteBranchRef} (saved prior local commits to branch '${backupBranch}').`,
          };
        }

        if (didStash) {
          try {
            await execAsync("git stash pop", { cwd: repo.path });
          } catch {}
        }
        return {
          id: repo.id,
          name: repo.name,
          localPath: repo.path,
          branch,
          status: "diverged",
          beforeCommit,
          afterCommit: beforeCommit,
          details: `Branches have diverged with unrelated histories (no common ancestor with ${remoteBranchRef}). Use --align to reset to origin.`,
        };
      }

      if (mergeBase === localFull.trim()) {
        // Local is strictly behind remote -> Fast-forward pull
        const { stdout: countOut } = await execAsync(
          `git rev-list --count HEAD.."${remoteBranchRef}"`,
          { cwd: repo.path }
        );
        const commitsToPull = parseInt(countOut.trim(), 10) || 0;

        await execAsync(`git pull --ff-only ${remote} ${branch}`, {
          cwd: repo.path,
        });

        const { stdout: newHead } = await execAsync("git rev-parse --short HEAD", {
          cwd: repo.path,
        });
        const afterCommit = newHead.trim();

        if (didStash) {
          try {
            await execAsync("git stash pop", { cwd: repo.path });
          } catch {}
        }

        return {
          id: repo.id,
          name: repo.name,
          localPath: repo.path,
          branch,
          status: "updated",
          beforeCommit,
          afterCommit,
          commitsPulledCount: commitsToPull,
          details: `Successfully pulled ${commitsToPull} new commit(s): ${beforeCommit} -> ${afterCommit}.`,
        };
      } else if (mergeBase === remoteFull.trim()) {
        // Local is strictly ahead of remote
        const { stdout: countOut } = await execAsync(
          `git rev-list --count "${remoteBranchRef}"..HEAD`,
          { cwd: repo.path }
        );
        const commitsAhead = parseInt(countOut.trim(), 10) || 0;

        if (didStash) {
          try {
            await execAsync("git stash pop", { cwd: repo.path });
          } catch {}
        }

        return {
          id: repo.id,
          name: repo.name,
          localPath: repo.path,
          branch,
          status: "ahead",
          beforeCommit,
          afterCommit: beforeCommit,
          commitsPulledCount: 0,
          details: `Local branch is ${commitsAhead} commit(s) ahead of ${remoteBranchRef}.`,
        };
      } else {
        // Diverged
        const { stdout: aheadOut } = await execAsync(
          `git rev-list --count "${remoteBranchRef}"..HEAD`,
          { cwd: repo.path }
        );
        const { stdout: behindOut } = await execAsync(
          `git rev-list --count HEAD.."${remoteBranchRef}"`,
          { cwd: repo.path }
        );
        const aheadCount = parseInt(aheadOut.trim(), 10) || 0;
        const behindCount = parseInt(behindOut.trim(), 10) || 0;

        if (didStash) {
          try {
            await execAsync("git stash pop", { cwd: repo.path });
          } catch {}
        }

        return {
          id: repo.id,
          name: repo.name,
          localPath: repo.path,
          branch,
          status: "diverged",
          beforeCommit,
          afterCommit: beforeCommit,
          details: `Branches have diverged (${aheadCount} commit(s) ahead, ${behindCount} commit(s) behind ${remoteBranchRef}).`,
        };
      }
    } catch (err: any) {
      return {
        id: repo.id,
        name: repo.name,
        localPath: repo.path,
        status: "error",
        errorMessage: err?.message || String(err),
        details: `Git pull operation encountered an error: ${err?.message || err}`,
      };
    }
  }

  /**
   * Pull and synchronize all configured ecosystem repositories from origin
   */
  static async syncAllRepos(options: {
    force?: boolean;
    stashAndPull?: boolean;
    align?: boolean;
    repos?: string[];
  } = {}): Promise<RepoSyncSummary> {
    const startTime = Date.now();
    const targetRepos = options.repos
      ? config.ecosystemRepos.filter((r) => options.repos!.includes(r.id))
      : config.ecosystemRepos;

    const results: RepoSyncItem[] = [];

    for (const repo of targetRepos) {
      const res = await this.syncRepo(repo, options);
      results.push(res);
    }

    const durationSeconds = (Date.now() - startTime) / 1000;
    const upToDateCount = results.filter((r) => r.status === "up_to_date").length;
    const updatedCount = results.filter((r) => r.status === "updated").length;
    const aheadCount = results.filter((r) => r.status === "ahead").length;
    const divergedCount = results.filter((r) => r.status === "diverged").length;
    const dirtyCount = results.filter((r) => r.status === "dirty_skipped").length;
    const errorCount = results.filter(
      (r) => r.status === "error" || r.status === "missing_local"
    ).length;

    const allSuccessful = results.every(
      (r) => r.status === "up_to_date" || r.status === "updated" || r.status === "ahead"
    );

    return {
      timestamp: new Date().toISOString(),
      durationSeconds,
      totalReposConfigured: targetRepos.length,
      upToDateCount,
      updatedCount,
      aheadCount,
      divergedCount,
      dirtyCount,
      errorCount,
      results,
      allSuccessful,
    };
  }
}
