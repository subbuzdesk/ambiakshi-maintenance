import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

// Load .env.local first (local overrides), then fall back to .env
dotenv.config({ path: path.join(rootDir, ".env.local") });
dotenv.config({ path: path.join(rootDir, ".env") });

export interface SupabaseProject {
  id: string;
  name: string;
  url: string;
  serviceRoleKey: string;
  anonKey: string;
  heartbeatTable: string;
  deleteDummyAfterInsert: boolean;
  managementToken?: string;
}

export interface MobileGameConfig {
  id: string;
  name: string;
  repoName: string;
  repoUrl: string;
  localPath: string;
  liveUrls: {
    play: string;
    item: string;
    extra?: string[];
  };
  monitoredAssets?: string[];
}

export interface EcosystemRepo {
  id: string;
  name: string;
  path: string;
  description: string;
}

export interface AppConfig {
  rootDir: string;
  dataDir: string;
  reportsDir: string;
  stateFilePath: string;
  sitemapsCachePath: string;
  googleServiceAccountPath?: string;
  dailyQuota: number;
  sitemaps: string[];
  supabase: {
    projects: SupabaseProject[];
    // Single project backward compatibility
    url: string;
    serviceRoleKey: string;
    anonKey: string;
    heartbeatTable: string;
    deleteDummyAfterInsert: boolean;
    managementToken?: string;
  };
  discordWebhookUrl?: string;
  discordMobileWebhookUrl?: string;
  sslExpiryWarningDays: number;
  monitoredDomains: string[];
  mobileGames: MobileGameConfig[];
  backupDir: string;
  backupSupabaseDir: string;
  backupReposDir: string;
  backupSecretsDir: string;
  backupRetentionDays: number;
  secretBackupPassphrase?: string;
  ecosystemRepos: EcosystemRepo[];
}

const defaultSitemaps = [
  "https://www.ambiakshi.tools/sitemap.xml",
  "https://mobile.ambiakshi.com/sitemap.xml",
  "https://ambiakshi.com/sitemap.xml",
  "https://slm.ambiakshi.com/sitemap.xml",
];

const defaultMonitoredDomains = [
  "www.ambiakshi.tools",
  "ambiakshi.com",
  "mobile.ambiakshi.com",
  "slm.ambiakshi.com",
  "radhamahalingam360.com",
  "rkaits.com",
];

const defaultMobileGames: MobileGameConfig[] = [
  {
    id: "promptcraft-mobile",
    name: "PromptCraft Mobile",
    repoName: "promptcraft-mobile",
    repoUrl: "https://github.com/subbuzdesk/promptcraft-mobile",
    localPath: path.resolve(rootDir, "..", "promptcraft-mobile"),
    liveUrls: {
      play: "https://mobile.ambiakshi.com/play/promptcraft-mobile",
      item: "https://mobile.ambiakshi.com/items/promptcraft-mobile",
    },
    monitoredAssets: [
      "https://mobile.ambiakshi.com/favicon.ico",
      "https://mobile.ambiakshi.com/manifest.json",
    ],
  },
  {
    id: "digitle-game",
    name: "Digitle Game",
    repoName: "digitle-game",
    repoUrl: "https://github.com/subbuzdesk/digitle-game",
    localPath: path.resolve(rootDir, "..", "digitle-game"),
    liveUrls: {
      play: "https://mobile.ambiakshi.com/play/digitle",
      item: "https://mobile.ambiakshi.com/items/digitle",
      extra: [
        "https://mobile.ambiakshi.com/games/digitle/rules",
        "https://mobile.ambiakshi.com/games/digitle/archive/today",
      ],
    },
    monitoredAssets: [
      "https://mobile.ambiakshi.com/favicon.ico",
    ],
  },
  {
    id: "vectoshift",
    name: "Vectoshift",
    repoName: "vectoshift",
    repoUrl: "https://github.com/subbuzdesk/vectoshift",
    localPath: path.resolve(rootDir, "..", "vectoshift"),
    liveUrls: {
      play: "https://mobile.ambiakshi.com/play/vectoshift",
      item: "https://mobile.ambiakshi.com/items/vectoshift",
    },
    monitoredAssets: [
      "https://mobile.ambiakshi.com/favicon.ico",
    ],
  },
];

const defaultEcosystemRepos: EcosystemRepo[] = [
  {
    id: "ambiakshi-maintenance",
    name: "Ambiakshi Maintenance Suite",
    path: rootDir,
    description: "Central automated housekeeping, GSC indexing, backup, and health monitoring",
  },
  {
    id: "ambiakshi-home",
    name: "Ambiakshi Home Platform",
    path: path.resolve(rootDir, "..", "ambiakshi-home"),
    description: "Main corporate web portal (ambiakshi.com)",
  },
  {
    id: "ambiakshi-tools",
    name: "Ambiakshi Tools",
    path: path.resolve(rootDir, "..", "ambiakshi-tools"),
    description: "67 in-browser privacy utilities and calculators (ambiakshi.tools)",
  },
  {
    id: "ambiakshi-mobile",
    name: "Ambiakshi Mobile Hub",
    path: path.resolve(rootDir, "..", "ambiakshi-mobile"),
    description: "Mobile web applications and game hub (mobile.ambiakshi.com)",
  },
  {
    id: "ambiakshi-slm",
    name: "Ambiakshi Sovereign SLM",
    path: path.resolve(rootDir, "..", "ambiakshi-slm"),
    description: "Financial sentiment SLM foundry and web portal (slm.ambiakshi.com)",
  },
  {
    id: "promptcraft-mobile",
    name: "PromptCraft Mobile",
    path: path.resolve(rootDir, "..", "promptcraft-mobile"),
    description: "Universal React Native + Expo mobile application suite",
  },
  {
    id: "digitle-game",
    name: "Digitle Game",
    path: path.resolve(rootDir, "..", "digitle-game"),
    description: "Enterprise cyber-vault number deduction logic game",
  },
  {
    id: "vectoshift",
    name: "Vectoshift",
    path: path.resolve(rootDir, "..", "vectoshift"),
    description: "2D vector physics puzzle odyssey game",
  },
  {
    id: "cortexcatalystweb",
    name: "CortexCatalyst Web",
    path: path.resolve(rootDir, "..", "cortexcatalystweb"),
    description: "High-performance Astro SSG modern platform for CortexCatalyst",
  },
  {
    id: "radhamahalingam360",
    name: "Radha Mahalingam 360",
    path: path.resolve(rootDir, "..", "radhamahalingam360"),
    description: "Executive leadership, coaching, and board advisory portfolio (radhamahalingam360.com)",
  },
  {
    id: "rkaits",
    name: "RKAI Tech Solutions",
    path: path.resolve(rootDir, "..", "rkaits"),
    description: "Astro SSG corporate web presence for RKAI Tech Solutions Inc (rkaits.com)",
  },
  {
    id: "ambiakshi-coach",
    name: "Ambiakshi Ledger Coach",
    path: path.resolve(rootDir, "..", "ambiakshi-coach"),
    description: "Coach-first Career OS and fact ledger engine",
  },
];

// Helper to discover all configured Supabase projects
function getSupabaseProjects(): SupabaseProject[] {
  const projects: SupabaseProject[] = [];

  // 1. Ambiakshi Tools Database
  const toolsUrl = process.env.SUPABASE_TOOLS_URL || (process.env.SUPABASE_URL?.includes("aglvpztrnfaaxtjdajoh") ? process.env.SUPABASE_URL : undefined);
  if (toolsUrl) {
    projects.push({
      id: "tools",
      name: "Ambiakshi Tools Database (aglvpztrnfaaxtjdajoh)",
      url: toolsUrl,
      serviceRoleKey:
        process.env.SUPABASE_TOOLS_SECRET_KEY ||
        process.env.SUPABASE_TOOLS_SERVICE_ROLE_KEY ||
        process.env.SUPABASE_TOOLS_KEY ||
        process.env.SUPABASE_SECRET_KEY ||
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        "",
      anonKey:
        process.env.SUPABASE_TOOLS_PUBLISHABLE_KEY ||
        process.env.SUPABASE_TOOLS_ANON_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
        "",
      heartbeatTable:
        process.env.SUPABASE_TOOLS_HEARTBEAT_TABLE ||
        process.env.SUPABASE_HEARTBEAT_TABLE ||
        "_ambiakshi_heartbeat",
      deleteDummyAfterInsert:
        process.env.SUPABASE_DELETE_DUMMY_ROW_AFTER_INSERT !== "false",
      managementToken:
        process.env.SUPABASE_TOOLS_MANAGEMENT_TOKEN ||
        process.env.SUPABASE_MANAGEMENT_TOKEN,
    });
  }

  // 2. Ambiakshi Home Database
  const homeUrl = process.env.SUPABASE_HOME_URL || (process.env.SUPABASE_URL?.includes("issffykfczwktwxitxxy") ? process.env.SUPABASE_URL : undefined);
  if (homeUrl) {
    projects.push({
      id: "home",
      name: "Ambiakshi Home Database (issffykfczwktwxitxxy)",
      url: homeUrl,
      serviceRoleKey:
        process.env.SUPABASE_HOME_SECRET_KEY ||
        process.env.SUPABASE_HOME_SERVICE_ROLE_KEY ||
        process.env.SUPABASE_HOME_KEY ||
        "",
      anonKey:
        process.env.SUPABASE_HOME_PUBLISHABLE_KEY ||
        process.env.SUPABASE_HOME_ANON_KEY ||
        "",
      heartbeatTable:
        process.env.SUPABASE_HOME_HEARTBEAT_TABLE ||
        process.env.SUPABASE_HEARTBEAT_TABLE ||
        "_ambiakshi_heartbeat",
      deleteDummyAfterInsert:
        process.env.SUPABASE_DELETE_DUMMY_ROW_AFTER_INSERT !== "false",
      managementToken:
        process.env.SUPABASE_HOME_MANAGEMENT_TOKEN ||
        process.env.SUPABASE_MANAGEMENT_TOKEN,
    });
  }

  // 3. Fallback generic single project
  const genericUrl = process.env.SUPABASE_URL;
  if (genericUrl && !projects.some((p) => p.url === genericUrl)) {
    projects.push({
      id: "primary",
      name: "Primary Supabase Database",
      url: genericUrl,
      serviceRoleKey:
        process.env.SUPABASE_SECRET_KEY ||
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        "",
      anonKey:
        process.env.SUPABASE_PUBLISHABLE_KEY ||
        process.env.SUPABASE_ANON_KEY ||
        "",
      heartbeatTable: process.env.SUPABASE_HEARTBEAT_TABLE || "_ambiakshi_heartbeat",
      deleteDummyAfterInsert: process.env.SUPABASE_DELETE_DUMMY_ROW_AFTER_INSERT !== "false",
      managementToken: process.env.SUPABASE_MANAGEMENT_TOKEN,
    });
  }

  return projects;
}

const configuredProjects = getSupabaseProjects();
const primaryProject = configuredProjects[0];

export const config: AppConfig = {
  rootDir,
  dataDir: path.join(rootDir, "data"),
  reportsDir: path.join(rootDir, "reports"),
  stateFilePath: path.join(rootDir, "data", "indexing_state.json"),
  sitemapsCachePath: path.join(rootDir, "data", "sitemaps_cache.json"),
  googleServiceAccountPath: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH
    ? path.resolve(rootDir, process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH)
    : undefined,
  dailyQuota: parseInt(process.env.DAILY_INDEXING_QUOTA || "200", 10),
  sitemaps: process.env.MONITORED_SITEMAPS
    ? process.env.MONITORED_SITEMAPS.split(",").map((s) => s.trim())
    : defaultSitemaps,
  supabase: {
    projects: configuredProjects,
    url: primaryProject?.url || process.env.SUPABASE_URL || "",
    serviceRoleKey: primaryProject?.serviceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    anonKey: primaryProject?.anonKey || process.env.SUPABASE_ANON_KEY || "",
    heartbeatTable: primaryProject?.heartbeatTable || process.env.SUPABASE_HEARTBEAT_TABLE || "_ambiakshi_heartbeat",
    deleteDummyAfterInsert: process.env.SUPABASE_DELETE_DUMMY_ROW_AFTER_INSERT !== "false",
    managementToken: primaryProject?.managementToken || process.env.SUPABASE_MANAGEMENT_TOKEN,
  },
  discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL?.trim() || undefined,
  discordMobileWebhookUrl:
    process.env.DISCORD_MOBILE_WEBHOOK_URL?.trim() ||
    process.env.DISCORD_WEBHOOK_URL?.trim() ||
    undefined,
  sslExpiryWarningDays: parseInt(process.env.SSL_EXPIRY_WARNING_DAYS || "30", 10),
  monitoredDomains: process.env.MONITORED_DOMAINS
    ? process.env.MONITORED_DOMAINS.split(",").map((d) => d.trim())
    : defaultMonitoredDomains,
  mobileGames: defaultMobileGames,
  backupDir: path.join(rootDir, "backups"),
  backupSupabaseDir: path.join(rootDir, "backups", "supabase"),
  backupReposDir: path.join(rootDir, "backups", "repos"),
  backupSecretsDir: path.join(rootDir, "backups", "secrets"),
  backupRetentionDays: parseInt(process.env.BACKUP_RETENTION_DAYS || "14", 10),
  secretBackupPassphrase: process.env.SECRET_BACKUP_PASSPHRASE,
  ecosystemRepos: defaultEcosystemRepos,
};
