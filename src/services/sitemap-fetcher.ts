import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

export interface SitemapEntry {
  url: string;
  sitemapSource: string;
  domain: string;
  lastmod?: string;
  priority?: string;
}

export interface SitemapFetchResult {
  sourceUrl: string;
  domain: string;
  entries: SitemapEntry[];
  error?: string;
}

/**
 * Robust XML loc/lastmod/priority extractor
 */
function parseSitemapXml(xmlContent: string, sitemapSource: string): SitemapEntry[] {
  const entries: SitemapEntry[] = [];
  const urlRegex = /<url>([\s\S]*?)<\/url>/gi;
  let match: RegExpExecArray | null;

  while ((match = urlRegex.exec(xmlContent)) !== null) {
    const block = match[1];
    const locMatch = /<loc>\s*([^<\s]+)\s*<\/loc>/i.exec(block);
    if (!locMatch) continue;

    const loc = locMatch[1].trim();
    const lastmodMatch = /<lastmod>\s*([^<\s]+)\s*<\/lastmod>/i.exec(block);
    const priorityMatch = /<priority>\s*([^<\s]+)\s*<\/priority>/i.exec(block);

    let domain = "";
    try {
      domain = new URL(loc).hostname;
    } catch {
      domain = sitemapSource;
    }

    entries.push({
      url: loc,
      sitemapSource,
      domain,
      lastmod: lastmodMatch ? lastmodMatch[1] : undefined,
      priority: priorityMatch ? priorityMatch[1] : undefined,
    });
  }

  return entries;
}

/**
 * Fetch a single sitemap XML over HTTP with timeout
 */
export async function fetchSitemap(sitemapUrl: string): Promise<SitemapFetchResult> {
  let domain = "";
  try {
    domain = new URL(sitemapUrl).hostname;
  } catch {
    domain = sitemapUrl;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(sitemapUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Ambiakshi-Maintenance-Bot/1.0 (+https://ambiakshi.com)",
        Accept: "application/xml, text/xml, */*",
      },
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      return {
        sourceUrl: sitemapUrl,
        domain,
        entries: [],
        error: `HTTP ${res.status} ${res.statusText}`,
      };
    }

    const xml = await res.text();
    const entries = parseSitemapXml(xml, sitemapUrl);
    return {
      sourceUrl: sitemapUrl,
      domain,
      entries,
    };
  } catch (err: any) {
    return {
      sourceUrl: sitemapUrl,
      domain,
      entries: [],
      error: err?.message || String(err),
    };
  }
}

/**
 * Fetch all configured sitemaps, merge and cache the results
 */
export async function fetchAllSitemaps(): Promise<{
  allEntries: SitemapEntry[];
  summary: Record<string, number>;
  errors: Record<string, string>;
}> {
  const allEntries: SitemapEntry[] = [];
  const summary: Record<string, number> = {};
  const errors: Record<string, string> = {};
  const seenUrls = new Set<string>();

  for (const sitemapUrl of config.sitemaps) {
    const result = await fetchSitemap(sitemapUrl);
    if (result.error) {
      errors[sitemapUrl] = result.error;
      summary[result.domain] = 0;
      continue;
    }

    let domainCount = 0;
    for (const entry of result.entries) {
      if (!seenUrls.has(entry.url)) {
        seenUrls.add(entry.url);
        allEntries.push(entry);
        domainCount++;
      }
    }
    summary[result.domain] = domainCount;
  }

  // Ensure data directory exists and persist cache
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.writeFile(
    config.sitemapsCachePath,
    JSON.stringify(
      {
        cachedAt: new Date().toISOString(),
        totalUrls: allEntries.length,
        summary,
        errors,
        entries: allEntries,
      },
      null,
      2
    ),
    "utf8"
  );

  return { allEntries, summary, errors };
}
