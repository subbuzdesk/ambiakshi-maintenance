import { config } from "../config.js";

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title: string;
  description?: string;
  color?: number;
  fields?: DiscordEmbedField[];
  footer?: { text: string };
  timestamp?: string;
}

export interface DiscordPayload {
  username?: string;
  avatar_url?: string;
  content?: string;
  embeds?: DiscordEmbed[];
}

export class DiscordNotifierService {
  /**
   * Send notification payload to configured Discord Webhook URL
   */
  static async sendNotification(
    payload: DiscordPayload,
    customWebhookUrl?: string
  ): Promise<{ success: boolean; message: string }> {
    const webhookUrl = customWebhookUrl || config.discordMobileWebhookUrl || config.discordWebhookUrl;
    if (!webhookUrl) {
      return {
        success: true,
        message: "Discord notification skipped: DISCORD_WEBHOOK_URL not configured in .env",
      };
    }

    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: payload.username || "Ambiakshi Maintenance Bot",
          avatar_url: payload.avatar_url,
          content: payload.content,
          embeds: payload.embeds,
        }),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        return {
          success: false,
          message: `Discord webhook rejected request (HTTP ${response.status}): ${errText}`,
        };
      }

      return {
        success: true,
        message: "Discord notification dispatched successfully.",
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Failed to dispatch Discord notification: ${err.message || String(err)}`,
      };
    }
  }

  /**
   * Send structured Weekly Audit Digest to Discord
   */
  static async sendWeeklyAuditDigest(data: {
    totalUrls: number;
    healthy200: number;
    failingUrls: Array<{ url: string; status: number | string; error?: string }>;
    supabaseStatus: string;
    supabaseActiveTables: number;
    sslSummary: { total: number; healthy: number; expiringSoon: number };
    sitemapDrift: { added: number; updated: number };
    durationSeconds: number;
    reportPath?: string;
  }): Promise<{ success: boolean; message: string }> {
    const healthPercent = ((data.healthy200 / data.totalUrls) * 100 || 0).toFixed(1);
    const hasFailures = data.failingUrls.length > 0;
    const hasSslWarnings = data.sslSummary.expiringSoon > 0;

    // Determine embed color: Green, Amber, or Red
    let color = 0x10b981; // Emerald Green
    let statusEmoji = "🟢";

    if (hasFailures) {
      color = 0xef4444; // Red
      statusEmoji = "🚨";
    } else if (hasSslWarnings) {
      color = 0xf59e0b; // Amber
      statusEmoji = "⚠️";
    }

    const fields: DiscordEmbedField[] = [
      {
        name: "🌐 URL Health (100% Crawl)",
        value: `**${data.healthy200} / ${data.totalUrls}** Verified OK (\`${healthPercent}%\`)\n${
          hasFailures
            ? `⚠️ **${data.failingUrls.length} failing URLs detected**`
            : "✅ All pages returning 200 OK"
        }`,
        inline: true,
      },
      {
        name: "🗄️ Supabase Integrity",
        value: `${data.supabaseStatus}\nActive Discovered Tables: **${data.supabaseActiveTables}**`,
        inline: true,
      },
      {
        name: "🔒 SSL & Domain Expiry",
        value: `**${data.sslSummary.healthy} / ${data.sslSummary.total}** Domains Healthy\n${
          data.sslSummary.expiringSoon > 0
            ? `⚠️ **${data.sslSummary.expiringSoon} expiring within 30 days**`
            : "✅ No certificates expiring soon"
        }`,
        inline: true,
      },
      {
        name: "🗺️ Sitemap Catalog Drift",
        value: `New URLs: **+${data.sitemapDrift.added}**\nUpdated: **${data.sitemapDrift.updated}**`,
        inline: true,
      },
      {
        name: "⏱️ Execution Duration",
        value: `\`${data.durationSeconds.toFixed(1)}s\` total runtime`,
        inline: true,
      },
    ];

    if (hasFailures) {
      const failingList = data.failingUrls
        .slice(0, 5)
        .map((f) => `• [\`${f.status}\`] ${f.url}`)
        .join("\n");

      fields.push({
        name: "🚨 Top Failing URLs (Action Required)",
        value: `${failingList}${
          data.failingUrls.length > 5 ? `\n*...and ${data.failingUrls.length - 5} more.*` : ""
        }`,
        inline: false,
      });
    }

    const embed: DiscordEmbed = {
      title: `${statusEmoji} Ambiakshi Weekly Ecosystem Health Digest`,
      description: `Comprehensive weekly scan completed across **www.ambiakshi.tools**, **ambiakshi.com**, **mobile.ambiakshi.com**, and **slm.ambiakshi.com**.`,
      color,
      fields,
      footer: { text: "Ambiakshi Automated Maintenance Suite • Sunday 3:00 AM EST Audit" },
      timestamp: new Date().toISOString(),
    };

    return this.sendNotification({
      username: "Ambiakshi Ecosystem Auditor",
      embeds: [embed],
    });
  }

  /**
   * Send structured Daily Maintenance Digest to Discord
   */
  static async sendDailyMaintenanceDigest(data: {
    batchSize: number;
    status200: number;
    status40x: number;
    statusOther: number;
    gscSuccess: number;
    gscSkipped: number;
    gscFailed: number;
    supabaseResults: Array<{ projectName?: string; projectId?: string; success: boolean; durationMs: number; table: string }>;
    durationSeconds: number;
  }): Promise<{ success: boolean; message: string }> {
    const hasErrors = data.status40x > 0 || data.gscFailed > 0;
    const color = hasErrors ? 0xef4444 : 0x10b981;
    const statusEmoji = hasErrors ? "⚠️" : "🟢";

    const supabaseSummary =
      data.supabaseResults.length > 0
        ? data.supabaseResults
            .map(
              (r) =>
                `• **${r.projectName || r.projectId}**: ${r.success ? "✅ Active" : "❌ Failed"} (\`${r.durationMs}ms\`)`
            )
            .join("\n")
        : "ℹ️ No Supabase databases configured";

    const fields: DiscordEmbedField[] = [
      {
        name: "🌐 URL Health Check",
        value: `**${data.status200} / ${data.batchSize}** OK (200)\n${
          data.status40x > 0 ? `⚠️ **${data.status40x} 40x errors**` : "✅ All inspected URLs healthy"
        }`,
        inline: true,
      },
      {
        name: "🔍 Google Indexing API",
        value: `Submitted: **${data.gscSuccess}**\nSkipped: **${data.gscSkipped}** | Failed: **${data.gscFailed}**`,
        inline: true,
      },
      {
        name: "⏱️ Batch Runtime",
        value: `\`${data.durationSeconds.toFixed(1)}s\` total`,
        inline: true,
      },
      {
        name: "🗄️ Supabase Keep-Alive",
        value: supabaseSummary,
        inline: false,
      },
    ];

    const embed: DiscordEmbed = {
      title: `${statusEmoji} Ambiakshi Daily Maintenance & Keep-Alive Run`,
      description: `Daily batch of **${data.batchSize} URLs** checked and submitted to Google Indexing API. Both Supabase instances pinged to maintain active compute.`,
      color,
      fields,
      footer: { text: "Ambiakshi Automated Maintenance Suite • Daily 4:00 AM EST Run" },
      timestamp: new Date().toISOString(),
    };

    return this.sendNotification({
      username: "Ambiakshi Daily Maintenance Bot",
      embeds: [embed],
    });
  }

  /**
   * Send structured Mobile Games Maintenance Digest to Discord
   */
  static async sendMobileGamesMaintenanceDigest(data: {
    totalGames: number;
    healthyGamesCount: number;
    totalEndpointsChecked: number;
    endpointsOkCount: number;
    endpointsFailedCount: number;
    averageLatencyMs: number;
    overallHealthScore: number;
    durationSeconds: number;
    sslStatus?: string;
    sslDaysRemaining?: number;
    games: Array<{
      name: string;
      repoName: string;
      isHealthy: boolean;
      averageLatencyMs: number;
      endpoints: Array<{ url: string; isOk: boolean; httpStatus: number; responseTimeMs: number; type: string; errorMessage?: string }>;
      localRepo: {
        isCloned: boolean;
        branch?: string;
        version?: string;
        packageDependenciesCount?: number;
        hasBuildArtifacts: boolean;
        detectedMigrations?: string[];
      };
    }>;
  }): Promise<{ success: boolean; message: string }> {
    const hasFailures = data.endpointsFailedCount > 0;
    const isSlow = data.averageLatencyMs > 600;

    let color = 0x8b5cf6; // Vibrant Purple / Game theme
    let statusEmoji = "🎮";

    if (hasFailures) {
      color = 0xef4444; // Red
      statusEmoji = "🚨";
    } else if (isSlow) {
      color = 0xf59e0b; // Amber
      statusEmoji = "⚠️";
    }

    const fields: DiscordEmbedField[] = [
      {
        name: "🕹️ Mobile Games Operational Health",
        value: `**${data.healthyGamesCount} / ${data.totalGames}** Games Fully Healthy\n**${data.endpointsOkCount} / ${data.totalEndpointsChecked}** Endpoints OK (\`${data.overallHealthScore}%\` Health Score)`,
        inline: true,
      },
      {
        name: "⚡ Latency & Runtime",
        value: `Avg Latency: **${data.averageLatencyMs}ms**\nRun Duration: **${data.durationSeconds.toFixed(1)}s**`,
        inline: true,
      },
      {
        name: "🔒 Mobile Domain SSL",
        value: `Domain: \`mobile.ambiakshi.com\`\nStatus: **${data.sslStatus || "HEALTHY"}** (${data.sslDaysRemaining ?? "30+"} days remaining)`,
        inline: true,
      },
    ];

    // Add per-game detail cards
    for (const g of data.games) {
      const epStatus = g.endpoints
        .map((e) => `${e.isOk ? "✅" : "❌"} ${e.type.toUpperCase()} (\`${e.responseTimeMs}ms\`)`)
        .join(" | ");

      const repoInfo = g.localRepo.isCloned
        ? `📂 Repo: \`v${g.localRepo.version || "1.0.0"}\` on branch \`${g.localRepo.branch || "main"}\` (${g.localRepo.packageDependenciesCount || 0} deps, ${g.localRepo.hasBuildArtifacts ? "Built" : "Source"})`
        : `☁️ Cloud/CI mode (not cloned locally)`;

      fields.push({
        name: `${g.isHealthy ? "🟢" : "🔴"} ${g.name} (${g.repoName})`,
        value: `${epStatus}\n${repoInfo}\nLatency: **${g.averageLatencyMs}ms** avg`,
        inline: false,
      });
    }

    // If any endpoints failed, list them prominently
    if (hasFailures) {
      const failedList = data.games
        .flatMap((g) => g.endpoints.filter((e) => !e.isOk))
        .map((e) => `• [\`${e.httpStatus || "ERR"}\`] ${e.url}${e.errorMessage ? ` (${e.errorMessage})` : ""}`)
        .join("\n");

      fields.push({
        name: "🚨 Failing Endpoints Detected",
        value: failedList,
        inline: false,
      });
    }

    const embed: DiscordEmbed = {
      title: `${statusEmoji} Ambiakshi Mobile Games Ecosystem Maintenance`,
      description: `Automated maintenance and health verification across **PromptCraft Mobile**, **Digitle Game**, and **Vectoshift** on \`mobile.ambiakshi.com\`.`,
      color,
      fields,
      footer: { text: "Ambiakshi Mobile Games Maintenance • Dedicated Batch Run" },
      timestamp: new Date().toISOString(),
    };

    return this.sendNotification(
      {
        username: "Ambiakshi Mobile Games Bot",
        embeds: [embed],
      },
      config.discordMobileWebhookUrl
    );
  }

  /**
   * Send comprehensive backup & cold-storage notification to Discord
   */
  static async sendBackupSummary(data: {
    supabaseSummary?: {
      totalRowsDumped: number;
      totalBytesWritten: number;
      allSuccessful: boolean;
      projects: {
        projectId: string;
        projectName: string;
        totalRows: number;
        fileSizeBytes: number;
        success: boolean;
      }[];
    };
    repoSummary?: {
      totalReposConfigured: number;
      reposBundledCount: number;
      totalBytesWritten: number;
      allSuccessful: boolean;
      results: {
        id: string;
        name: string;
        branch?: string;
        fileSizeBytes: number;
        success: boolean;
      }[];
    };
    secretSummary?: {
      filesCapturedCount: number;
      fileSizeBytes: number;
      success: boolean;
    };
    driveSummary?: {
      filesUploadedCount: number;
      totalBytesUploaded: number;
      folderUrl: string;
      allSuccessful: boolean;
    };
    durationSeconds: number;
  }): Promise<{ success: boolean; message: string }> {
    const isSuccess =
      (data.supabaseSummary ? data.supabaseSummary.allSuccessful : true) &&
      (data.repoSummary ? data.repoSummary.allSuccessful : true) &&
      (data.secretSummary ? data.secretSummary.success : true);

    const color = isSuccess ? 0x10b981 : 0xef4444; // Green or Red
    const statusEmoji = isSuccess ? "💾" : "🚨";

    const fields: DiscordEmbedField[] = [];

    // 1. Supabase logical backup field
    if (data.supabaseSummary) {
      const projDetails = data.supabaseSummary.projects
        .map(
          (p) =>
            `${p.success ? "🟢" : "🔴"} **${p.projectName}**: ${p.totalRows} rows (\`${(p.fileSizeBytes / 1024).toFixed(1)} KB\`)`
        )
        .join("\n");

      fields.push({
        name: "🗄️ Supabase Logical Backups",
        value: `Total Rows: **${data.supabaseSummary.totalRowsDumped}** | Archive Size: **${(data.supabaseSummary.totalBytesWritten / 1024).toFixed(1)} KB**\n${projDetails || "No projects configured"}`,
        inline: false,
      });
    }

    // 2. Git Bundles cold storage field
    if (data.repoSummary) {
      const mb = (data.repoSummary.totalBytesWritten / (1024 * 1024)).toFixed(2);
      const topRepos = data.repoSummary.results
        .filter((r) => r.success)
        .slice(0, 6)
        .map((r) => `• \`${r.id}\` (\`${(r.fileSizeBytes / 1024).toFixed(0)} KB\`)`)
        .join(", ");

      fields.push({
        name: "📦 Git Bundles (Code Escrow)",
        value: `**${data.repoSummary.reposBundledCount} / ${data.repoSummary.totalReposConfigured}** Repositories Bundled (\`${mb} MB\` total)\n${topRepos}${data.repoSummary.results.length > 6 ? ` + ${data.repoSummary.results.length - 6} more` : ""}`,
        inline: false,
      });
    }

    // 3. Encrypted Secrets Escrow field
    if (data.secretSummary) {
      fields.push({
        name: "🔒 Encrypted Secrets Escrow",
        value: data.secretSummary.success
          ? `Captured **${data.secretSummary.filesCapturedCount}** secret/env files (AES-256-GCM encrypted, \`${(data.secretSummary.fileSizeBytes / 1024).toFixed(1)} KB\`)`
          : "❌ Secret backup failed",
        inline: false,
      });
    }

    // 4. Google Drive Cloud Backup field
    if (data.driveSummary) {
      const mb = (data.driveSummary.totalBytesUploaded / (1024 * 1024)).toFixed(2);
      fields.push({
        name: "☁️ Google Drive Cloud Storage",
        value: data.driveSummary.allSuccessful
          ? `Synced **${data.driveSummary.filesUploadedCount}** backup files to Google Drive (\`${mb} MB\` total)\n📁 [Open Google Drive Backup Folder](${data.driveSummary.folderUrl})`
          : `⚠️ Google Drive sync partially failed.\n📁 [Open Folder](${data.driveSummary.folderUrl})`,
        inline: false,
      });
    }

    const embed: DiscordEmbed = {
      title: `${statusEmoji} Ambiakshi Ecosystem Cold Backup & Escrow`,
      description: `Automated database logical snapshots, Git repository bundles, and encrypted secret archive completed in **${data.durationSeconds.toFixed(1)}s**.`,
      color,
      fields,
      footer: { text: "Ambiakshi Housekeeping • Disaster Recovery Suite" },
      timestamp: new Date().toISOString(),
    };

    return this.sendNotification({
      username: "Ambiakshi Backup Bot",
      embeds: [embed],
    });
  }
}

export const DiscordNotifier = DiscordNotifierService;
