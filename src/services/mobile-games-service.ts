import fs from "node:fs/promises";
import path from "node:path";
import { config, MobileGameConfig } from "../config.js";

export interface GameEndpointResult {
  url: string;
  type: "play" | "item" | "extra" | "asset";
  httpStatus: number;
  isOk: boolean;
  responseTimeMs: number;
  contentType?: string;
  contentLengthBytes?: number;
  errorMessage?: string;
}

export interface LocalRepoStatus {
  isCloned: boolean;
  localPath: string;
  branch?: string;
  version?: string;
  packageDependenciesCount?: number;
  hasBuildArtifacts: boolean;
  buildDirDetected?: string;
  detectedMigrations: string[];
  scriptsAvailable: string[];
  message?: string;
}

export interface SingleGameReport {
  id: string;
  name: string;
  repoName: string;
  repoUrl: string;
  localRepo: LocalRepoStatus;
  endpoints: GameEndpointResult[];
  assets: GameEndpointResult[];
  isHealthy: boolean;
  averageLatencyMs: number;
}

export interface MobileGamesAuditSummary {
  timestamp: string;
  durationSeconds: number;
  totalGames: number;
  healthyGamesCount: number;
  totalEndpointsChecked: number;
  endpointsOkCount: number;
  endpointsFailedCount: number;
  averageLatencyMs: number;
  games: SingleGameReport[];
  overallHealthScore: number;
}

export class MobileGamesService {
  /**
   * Probe an individual URL with latency tracking and timeout
   */
  static async probeEndpoint(
    url: string,
    type: "play" | "item" | "extra" | "asset",
    timeoutMs: number = 10000
  ): Promise<GameEndpointResult> {
    const startTime = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Ambiakshi-Mobile-Games-Monitor/1.0 (+https://mobile.ambiakshi.com)",
          Accept: type === "asset" ? "*/*" : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      clearTimeout(timeoutId);

      const responseTimeMs = Date.now() - startTime;
      const isOk = response.status >= 200 && response.status < 400;
      const contentType = response.headers.get("content-type") || undefined;
      const contentLengthHeader = response.headers.get("content-length");
      const contentLengthBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : undefined;

      let errorMessage: string | undefined;
      if (!isOk) {
        errorMessage = `HTTP ${response.status} ${response.statusText}`;
      }

      return {
        url,
        type,
        httpStatus: response.status,
        isOk,
        responseTimeMs,
        contentType,
        contentLengthBytes,
        errorMessage,
      };
    } catch (err: any) {
      const responseTimeMs = Date.now() - startTime;
      return {
        url,
        type,
        httpStatus: 0,
        isOk: false,
        responseTimeMs,
        errorMessage: err?.name === "AbortError" ? `Request timed out after ${timeoutMs}ms` : err?.message || String(err),
      };
    }
  }

  /**
   * Inspect a local git repository on the host machine using pure fs calls
   */
  static async inspectLocalRepo(game: MobileGameConfig): Promise<LocalRepoStatus> {
    const localPath = game.localPath;

    try {
      await fs.access(localPath);
    } catch {
      return {
        isCloned: false,
        localPath,
        hasBuildArtifacts: false,
        detectedMigrations: [],
        scriptsAvailable: [],
        message: "Repository not found locally at path (CI or un-cloned environment)",
      };
    }

    let branch: string | undefined;
    let version: string | undefined;
    let dependenciesCount = 0;
    const scriptsAvailable: string[] = [];
    const detectedMigrations: string[] = [];
    let hasBuildArtifacts = false;
    let buildDirDetected: string | undefined;

    // 1. Detect Git branch from .git/HEAD
    try {
      const headFile = path.join(localPath, ".git", "HEAD");
      const headContent = await fs.readFile(headFile, "utf8");
      const match = headContent.match(/ref:\s*refs\/heads\/([^\s\r\n]+)/);
      if (match) {
        branch = match[1];
      } else {
        branch = headContent.trim().substring(0, 8); // detached head hash
      }
    } catch {
      branch = "unknown";
    }

    // 2. Read package.json
    try {
      const pkgFile = path.join(localPath, "package.json");
      const pkgContent = await fs.readFile(pkgFile, "utf8");
      const pkg = JSON.parse(pkgContent);
      version = pkg.version || "1.0.0";
      const deps = Object.keys(pkg.dependencies || {}).length;
      const devDeps = Object.keys(pkg.devDependencies || {}).length;
      dependenciesCount = deps + devDeps;
      if (pkg.scripts) {
        scriptsAvailable.push(...Object.keys(pkg.scripts));
      }
    } catch {
      version = undefined;
    }

    // 3. Detect build artifacts (dist, build, out, .next)
    const possibleBuildDirs = ["dist", "build", "out", ".next"];
    for (const bDir of possibleBuildDirs) {
      try {
        const fullBuildPath = path.join(localPath, bDir);
        const stat = await fs.stat(fullBuildPath);
        if (stat.isDirectory()) {
          hasBuildArtifacts = true;
          buildDirDetected = bDir;
          break;
        }
      } catch {
        // Not present
      }
    }

    // 4. Detect migrations/schema files
    const migrationDirs = [
      path.join(localPath, "supabase", "migrations"),
      path.join(localPath, "prisma"),
      path.join(localPath, "migrations"),
      path.join(localPath, "sql"),
    ];
    for (const mDir of migrationDirs) {
      try {
        const files = await fs.readdir(mDir);
        for (const f of files) {
          if (f.endsWith(".sql") || f.endsWith(".prisma")) {
            detectedMigrations.push(f);
          }
        }
      } catch {
        // Ignore
      }
    }

    return {
      isCloned: true,
      localPath,
      branch,
      version,
      packageDependenciesCount: dependenciesCount,
      hasBuildArtifacts,
      buildDirDetected,
      detectedMigrations,
      scriptsAvailable,
    };
  }

  /**
   * Run full audit across all configured mobile games
   */
  static async auditAllGames(games?: MobileGameConfig[]): Promise<MobileGamesAuditSummary> {
    const startTime = Date.now();
    const targetGames = games || config.mobileGames;
    const gameReports: SingleGameReport[] = [];

    let totalEndpointsChecked = 0;
    let endpointsOkCount = 0;
    let endpointsFailedCount = 0;
    let totalLatencyMs = 0;

    for (const game of targetGames) {
      // 1. Audit local repo hygiene
      const localRepo = await this.inspectLocalRepo(game);

      // 2. Probe endpoints
      const endpointProbes: Promise<GameEndpointResult>[] = [];
      endpointProbes.push(this.probeEndpoint(game.liveUrls.play, "play"));
      endpointProbes.push(this.probeEndpoint(game.liveUrls.item, "item"));

      if (game.liveUrls.extra) {
        for (const extraUrl of game.liveUrls.extra) {
          endpointProbes.push(this.probeEndpoint(extraUrl, "extra"));
        }
      }

      // 3. Probe assets
      const assetProbes: Promise<GameEndpointResult>[] = [];
      if (game.monitoredAssets) {
        for (const assetUrl of game.monitoredAssets) {
          assetProbes.push(this.probeEndpoint(assetUrl, "asset"));
        }
      }

      const endpoints = await Promise.all(endpointProbes);
      const assets = await Promise.all(assetProbes);

      // Evaluate health for this game
      const gameEndpointsOk = endpoints.every((e) => e.isOk);
      const gameAssetsOk = assets.every((a) => a.isOk);
      const isHealthy = gameEndpointsOk && gameAssetsOk;

      const gameLatencySum = endpoints.reduce((sum, e) => sum + e.responseTimeMs, 0);
      const averageLatencyMs = endpoints.length > 0 ? Math.round(gameLatencySum / endpoints.length) : 0;

      for (const ep of endpoints) {
        totalEndpointsChecked++;
        if (ep.isOk) endpointsOkCount++;
        else endpointsFailedCount++;
        totalLatencyMs += ep.responseTimeMs;
      }

      for (const a of assets) {
        totalEndpointsChecked++;
        if (a.isOk) endpointsOkCount++;
        else endpointsFailedCount++;
        totalLatencyMs += a.responseTimeMs;
      }

      gameReports.push({
        id: game.id,
        name: game.name,
        repoName: game.repoName,
        repoUrl: game.repoUrl,
        localRepo,
        endpoints,
        assets,
        isHealthy,
        averageLatencyMs,
      });
    }

    const durationSeconds = (Date.now() - startTime) / 1000;
    const overallAverageLatency = totalEndpointsChecked > 0 ? Math.round(totalLatencyMs / totalEndpointsChecked) : 0;
    const healthyGamesCount = gameReports.filter((g) => g.isHealthy).length;

    // Calculate score (0-100)
    const endpointFraction = totalEndpointsChecked > 0 ? endpointsOkCount / totalEndpointsChecked : 1;
    const latencyPenalty = overallAverageLatency > 800 ? 0.8 : 1.0;
    const overallHealthScore = Math.round(endpointFraction * latencyPenalty * 100);

    return {
      timestamp: new Date().toISOString(),
      durationSeconds,
      totalGames: targetGames.length,
      healthyGamesCount,
      totalEndpointsChecked,
      endpointsOkCount,
      endpointsFailedCount,
      averageLatencyMs: overallAverageLatency,
      games: gameReports,
      overallHealthScore,
    };
  }
}
