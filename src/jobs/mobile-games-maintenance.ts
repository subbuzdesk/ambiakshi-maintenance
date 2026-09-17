import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { MobileGamesService, MobileGamesAuditSummary } from "../services/mobile-games-service.js";
import { SslCheckerService, SslCheckResult } from "../services/ssl-checker.js";
import { DiscordNotifierService } from "../services/discord-notifier.js";

export interface MobileGamesJobReport {
  summary: MobileGamesAuditSummary;
  ssl: SslCheckResult;
  reportPath: string;
}

export async function runMobileGamesMaintenance(): Promise<MobileGamesJobReport> {
  const startTime = Date.now();
  const dateStr = new Date().toISOString().split("T")[0];

  console.log(`\n=====================================================================`);
  console.log(`  Ambiakshi Mobile Games Ecosystem Maintenance & Health Audit`);
  console.log(`  Target Repos: promptcraft-mobile, digitle-game, vectoshift`);
  console.log(`  Host Domain:  mobile.ambiakshi.com`);
  console.log(`  Date:         ${new Date().toISOString()}`);
  console.log(`=====================================================================\n`);

  // 1. Audit Live Endpoints & Local Repositories
  console.log(`[Step 1/4] Probing mobile games live endpoints and local repositories...`);
  const summary = await MobileGamesService.auditAllGames();

  for (const game of summary.games) {
    console.log(`\n🎮 ${game.name} (${game.repoName}):`);
    console.log(`   - Health: ${game.isHealthy ? "✅ All Endpoints OK" : "❌ Issues Detected"} (Avg Latency: ${game.averageLatencyMs}ms)`);
    console.log(`   - Local Repo: ${game.localRepo.isCloned ? `Cloned at ${game.localRepo.localPath} (branch: ${game.localRepo.branch}, v${game.localRepo.version})` : "Not cloned locally (Cloud mode)"}`);
    for (const ep of game.endpoints) {
      console.log(`     • [${ep.type.toUpperCase()}] ${ep.url} -> ${ep.isOk ? "200 OK" : `FAIL (${ep.httpStatus})`} (${ep.responseTimeMs}ms)`);
    }
  }

  // 2. Audit Mobile Domain SSL
  console.log(`\n[Step 2/4] Checking SSL certificate on mobile.ambiakshi.com...`);
  const ssl = await SslCheckerService.checkDomain("mobile.ambiakshi.com");
  console.log(`   - Status: ${ssl.isOk ? "✅ Valid" : "⚠️ " + ssl.status} (${ssl.daysRemaining ?? "?"} days remaining, Issuer: ${ssl.issuer || "Unknown"})`);

  // 3. Generate Markdown Report
  console.log(`\n[Step 3/4] Generating comprehensive Markdown report...`);
  const reportsDir = path.join(config.reportsDir, "mobile-games");
  await fs.mkdir(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, `${dateStr}-mobile-games.md`);

  const reportMarkdown = generateMobileGamesMarkdown(summary, ssl);
  await fs.writeFile(reportPath, reportMarkdown, "utf8");
  console.log(`Report generated: ${reportPath}`);

  // 4. Dispatch Discord Digest
  console.log(`\n[Step 4/4] Dispatching Mobile Games digest to Discord...`);
  const discordResult = await DiscordNotifierService.sendMobileGamesMaintenanceDigest({
    totalGames: summary.totalGames,
    healthyGamesCount: summary.healthyGamesCount,
    totalEndpointsChecked: summary.totalEndpointsChecked,
    endpointsOkCount: summary.endpointsOkCount,
    endpointsFailedCount: summary.endpointsFailedCount,
    averageLatencyMs: summary.averageLatencyMs,
    overallHealthScore: summary.overallHealthScore,
    durationSeconds: (Date.now() - startTime) / 1000,
    sslStatus: ssl.status,
    sslDaysRemaining: ssl.daysRemaining,
    games: summary.games.map((g) => ({
      name: g.name,
      repoName: g.repoName,
      isHealthy: g.isHealthy,
      averageLatencyMs: g.averageLatencyMs,
      endpoints: g.endpoints.map((e) => ({
        url: e.url,
        isOk: e.isOk,
        httpStatus: e.httpStatus,
        responseTimeMs: e.responseTimeMs,
        type: e.type,
        errorMessage: e.errorMessage,
      })),
      localRepo: {
        isCloned: g.localRepo.isCloned,
        branch: g.localRepo.branch,
        version: g.localRepo.version,
        packageDependenciesCount: g.localRepo.packageDependenciesCount,
        hasBuildArtifacts: g.localRepo.hasBuildArtifacts,
        detectedMigrations: g.localRepo.detectedMigrations,
      },
    })),
  });
  console.log(`Discord dispatch: ${discordResult.message}`);

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nMobile Games Maintenance completed in ${totalDuration}s. Health Score: ${summary.overallHealthScore}/100.\n`);

  return {
    summary,
    ssl,
    reportPath,
  };
}

function generateMobileGamesMarkdown(summary: MobileGamesAuditSummary, ssl: SslCheckResult): string {
  const dateStr = summary.timestamp.split("T")[0];

  return `# Ambiakshi Mobile Games Ecosystem Maintenance Report: ${dateStr}

**Execution Timestamp**: \`${summary.timestamp}\`  
**Host Domain**: [\`mobile.ambiakshi.com\`](https://mobile.ambiakshi.com)  
**Overall Games Health Score**: **${summary.overallHealthScore} / 100**  
**Total Games Monitored**: **${summary.totalGames}**  
**Healthy Games**: **${summary.healthyGamesCount} / ${summary.totalGames}**  
**Average Latency**: **${summary.averageLatencyMs}ms**  

---

## 1. Monitored Mobile Games Overview

| Game | Repository | Local Path | Branch & Version | Play Page | Latency | Health Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
${summary.games
  .map((g) => {
    const playEp = g.endpoints.find((e) => e.type === "play");
    const playStatus = playEp?.isOk ? `✅ 200 OK` : `❌ ${playEp?.httpStatus || "ERR"}`;
    const repoInfo = g.localRepo.isCloned
      ? `\`v${g.localRepo.version || "1.0.0"}\` (\`${g.localRepo.branch || "main"}\`)`
      : `*Not cloned*`;
    return `| **${g.name}** | [\`${g.repoName}\`](${g.repoUrl}) | \`${g.localRepo.localPath}\` | ${repoInfo} | ${playStatus} | \`${g.averageLatencyMs}ms\` | ${g.isHealthy ? "🟢 Healthy" : "🔴 Attention"} |`;
  })
  .join("\n")}

---

## 2. Detailed Endpoints & Latency Diagnostics

| Game | Endpoint Type | URL | HTTP Status | Response Time | Content-Type |
| :--- | :--- | :--- | :--- | :--- | :--- |
${summary.games
  .flatMap((g) =>
    g.endpoints.map(
      (e) =>
        `| ${g.name} | \`${e.type.toUpperCase()}\` | [\`${e.url}\`](${e.url}) | \`${e.httpStatus || "ERR"}\` ${e.isOk ? "✅" : "❌"} | \`${e.responseTimeMs}ms\` | \`${e.contentType || "N/A"}\` |`
    )
  )
  .join("\n")}

---

## 3. Local Repository Hygiene & Dependencies

${summary.games
  .map((g) => {
    const r = g.localRepo;
    if (!r.isCloned) {
      return `### ${g.name} (\`${g.repoName}\`)
- **Status**: ⚠️ Not present in local directory (\`${r.localPath}\`).
- **Remote**: [GitHub Repository](${g.repoUrl})
`;
    }

    return `### ${g.name} (\`${g.repoName}\`)
- **Path**: \`${r.localPath}\`
- **Git Branch**: \`${r.branch || "main"}\`
- **Package Version**: \`${r.version || "N/A"}\`
- **Dependencies Count**: **${r.packageDependenciesCount || 0}** packages
- **Build Artifacts**: ${r.hasBuildArtifacts ? `✅ Found in \`${r.buildDirDetected}\`` : "ℹ️ Source only (no dist folder)"}
- **Available Scripts**: ${r.scriptsAvailable.length > 0 ? r.scriptsAvailable.map((s) => `\`${s}\``).join(", ") : "None detected"}
- **Detected Migrations/Schemas**: ${r.detectedMigrations.length > 0 ? r.detectedMigrations.map((m) => `\`${m}\``).join(", ") : "None (client-side state)"}
`;
  })
  .join("\n")}

---

## 4. Mobile Domain SSL & Infrastructure Security

| Domain | Port | Status | Days Remaining | Issuer | Valid Until |
| :--- | :--- | :--- | :--- | :--- | :--- |
| \`mobile.ambiakshi.com\` | \`443\` | **${ssl.status}** ${ssl.isOk ? "✅" : "⚠️"} | **${ssl.daysRemaining ?? "N/A"}** | ${ssl.issuer || "Unknown"} | \`${ssl.validTo || "N/A"}\` |

---

## 5. Summary & Operational Recommendations

${
  summary.endpointsFailedCount === 0
    ? `✅ **All ${summary.totalEndpointsChecked} mobile game endpoints and assets responded with valid 200 OK.** Games are active and responsive on \`mobile.ambiakshi.com\`.`
    : `⚠️ **${summary.endpointsFailedCount} endpoints failed inspection.** Review the failing endpoints table above and deploy required fixes.`
}

*This report was automatically generated by the Ambiakshi Mobile Games Maintenance Routine.*
`;
}

// Allow direct CLI invocation
if (process.argv[1]?.includes("mobile-games-maintenance")) {
  runMobileGamesMaintenance().catch((err) => {
    console.error("Mobile games maintenance error:", err);
    process.exit(1);
  });
}
