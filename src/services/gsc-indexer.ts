import fs from "node:fs";
import { google } from "googleapis";
import { config } from "../config.js";

export interface UrlInspectionResult {
  url: string;
  httpStatus: number;
  isOk: boolean;
  responseTimeMs: number;
  hasNoIndex: boolean;
  canonicalUrl?: string;
  errorMessage?: string;
  gscNotificationStatus: "SUCCESS" | "FAILED" | "SKIPPED";
  gscMessage?: string;
}

export class GscIndexerService {
  private indexingClient: any = null;
  private hasCheckedCredentials = false;

  /**
   * Lazy load Google Cloud Indexing Client if service account credentials exist
   */
  private async getGoogleClient(): Promise<any> {
    if (this.hasCheckedCredentials) return this.indexingClient;
    this.hasCheckedCredentials = true;

    if (!config.googleServiceAccountPath || !fs.existsSync(config.googleServiceAccountPath)) {
      return null;
    }

    try {
      const auth = new google.auth.GoogleAuth({
        keyFile: config.googleServiceAccountPath,
        scopes: ["https://www.googleapis.com/auth/indexing"],
      });
      const authClient = await auth.getClient();
      this.indexingClient = google.indexing({
        version: "v3",
        auth: authClient as any,
      });
      return this.indexingClient;
    } catch (err: any) {
      console.warn(`[GSC-Indexer] Could not initialize Google Indexing Client: ${err.message}`);
      return null;
    }
  }

  /**
   * Inspect live HTTP status, latency, noindex, and canonical tags
   */
  async inspectLiveUrl(targetUrl: string): Promise<{
    httpStatus: number;
    responseTimeMs: number;
    hasNoIndex: boolean;
    canonicalUrl?: string;
    errorMessage?: string;
  }> {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      const res = await fetch(targetUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      clearTimeout(timeoutId);

      const responseTimeMs = Date.now() - start;
      const html = await res.text();

      // Check for <meta name="robots" content="...noindex...">
      const noIndexMatch = /<meta[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex[^"']*["']/i.test(
        html
      );

      // Check for <link rel="canonical" href="...">
      const canonicalMatch = /<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i.exec(
        html
      );

      return {
        httpStatus: res.status,
        responseTimeMs,
        hasNoIndex: noIndexMatch,
        canonicalUrl: canonicalMatch ? canonicalMatch[1] : undefined,
      };
    } catch (err: any) {
      return {
        httpStatus: 0,
        responseTimeMs: Date.now() - start,
        hasNoIndex: false,
        errorMessage: err?.message || String(err),
      };
    }
  }

  /**
   * Publish URL_UPDATED notification to Google Indexing API
   */
  async publishUrlToGoogle(targetUrl: string): Promise<{
    status: "SUCCESS" | "FAILED" | "SKIPPED";
    message?: string;
  }> {
    const client = await this.getGoogleClient();
    if (!client) {
      return {
        status: "SKIPPED",
        message: "No Google Service Account configured. Verified live HTTP response.",
      };
    }

    try {
      const res = await client.urlNotifications.publish({
        requestBody: {
          url: targetUrl,
          type: "URL_UPDATED",
        },
      });

      return {
        status: "SUCCESS",
        message: `Notified GSC Indexing: HTTP ${res.status}`,
      };
    } catch (err: any) {
      return {
        status: "FAILED",
        message: `Google API Error: ${err.message || String(err)}`,
      };
    }
  }

  /**
   * Process a single URL: Inspect live HTTP + Submit to Google Indexing
   */
  async processUrl(targetUrl: string): Promise<UrlInspectionResult> {
    const inspection = await this.inspectLiveUrl(targetUrl);
    const isOk = inspection.httpStatus >= 200 && inspection.httpStatus < 300 && !inspection.hasNoIndex;

    let gscResult: { status: "SUCCESS" | "FAILED" | "SKIPPED"; message?: string } = {
      status: "SKIPPED",
    };

    // If page is healthy 200 OK, trigger Google Indexing notification
    if (isOk) {
      gscResult = await this.publishUrlToGoogle(targetUrl);
    } else {
      gscResult = {
        status: "SKIPPED",
        message: inspection.hasNoIndex
          ? "Skipped GSC submission: page has noindex directive"
          : `Skipped GSC submission: HTTP status ${inspection.httpStatus}`,
      };
    }

    return {
      url: targetUrl,
      httpStatus: inspection.httpStatus,
      isOk,
      responseTimeMs: inspection.responseTimeMs,
      hasNoIndex: inspection.hasNoIndex,
      canonicalUrl: inspection.canonicalUrl,
      errorMessage: inspection.errorMessage,
      gscNotificationStatus: gscResult.status,
      gscMessage: gscResult.message,
    };
  }
}
