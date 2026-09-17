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
  static async sendNotification(payload: DiscordPayload): Promise<{ success: boolean; message: string }> {
    const webhookUrl = config.discordWebhookUrl;
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
}
