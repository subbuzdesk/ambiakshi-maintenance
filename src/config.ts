import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

// Load .env from project root
dotenv.config({ path: path.join(rootDir, ".env") });

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
    url: string;
    serviceRoleKey: string;
    anonKey: string;
    heartbeatTable: string;
    deleteDummyAfterInsert: boolean;
    managementToken?: string;
  };
}

const defaultSitemaps = [
  "https://www.ambiakshi.tools/sitemap.xml",
  "https://mobile.ambiakshi.com/sitemap.xml",
  "https://ambiakshi.com/sitemap.xml",
  "https://slm.ambiakshi.com/sitemap.xml",
];

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
    url: process.env.SUPABASE_URL || "",
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    anonKey: process.env.SUPABASE_ANON_KEY || "",
    heartbeatTable: process.env.SUPABASE_HEARTBEAT_TABLE || "_ambiakshi_heartbeat",
    deleteDummyAfterInsert: process.env.SUPABASE_DELETE_DUMMY_ROW_AFTER_INSERT !== "false",
    managementToken: process.env.SUPABASE_MANAGEMENT_TOKEN,
  },
};
