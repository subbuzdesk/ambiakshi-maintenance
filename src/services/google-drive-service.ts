import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { google, drive_v3 } from "googleapis";
import { config } from "../config.js";

export interface DriveUploadItem {
  name: string;
  fileId: string;
  webViewLink?: string;
  sizeBytes: number;
  subfolder: string;
  success: boolean;
  errorMessage?: string;
}

export interface DriveSyncSummary {
  timestamp: string;
  durationSeconds: number;
  folderId: string;
  folderUrl: string;
  authType: "oauth2" | "service_account" | "none";
  filesUploadedCount: number;
  totalBytesUploaded: number;
  files: DriveUploadItem[];
  allSuccessful: boolean;
  errorMessage?: string;
}

interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
}

function loadOAuthCredentials(): OAuthCredentials | null {
  // 1. Direct environment variables
  if (config.googleOAuthClientId && config.googleOAuthClientSecret) {
    return {
      clientId: config.googleOAuthClientId,
      clientSecret: config.googleOAuthClientSecret,
      redirectUri: "http://localhost:8585/oauth2callback",
    };
  }

  // 2. Credentials JSON file (e.g. downloaded from Google Cloud Console)
  if (config.googleOAuthCredentialsPath && fs.existsSync(config.googleOAuthCredentialsPath)) {
    try {
      const raw = fs.readFileSync(config.googleOAuthCredentialsPath, "utf-8");
      const data = JSON.parse(raw);
      const creds = data.installed || data.web || data;
      if (creds.client_id && creds.client_secret) {
        return {
          clientId: creds.client_id,
          clientSecret: creds.client_secret,
          redirectUri:
            (creds.redirect_uris && creds.redirect_uris[0]) ||
            "http://localhost:8585/oauth2callback",
        };
      }
    } catch (err: any) {
      console.warn(`[GoogleDrive] Error reading OAuth credentials JSON: ${err?.message || err}`);
    }
  }

  return null;
}

function loadOAuthTokens(): { refreshToken?: string; accessToken?: string } | null {
  // 1. Environment variable
  if (config.googleOAuthRefreshToken) {
    return { refreshToken: config.googleOAuthRefreshToken };
  }

  // 2. Token cache file
  if (config.googleOAuthTokenPath && fs.existsSync(config.googleOAuthTokenPath)) {
    try {
      const raw = fs.readFileSync(config.googleOAuthTokenPath, "utf-8");
      const data = JSON.parse(raw);
      if (data.refresh_token) {
        return {
          refreshToken: data.refresh_token,
          accessToken: data.access_token,
        };
      }
    } catch (err: any) {
      console.warn(`[GoogleDrive] Error reading OAuth token file: ${err?.message || err}`);
    }
  }

  return null;
}

function getMimeType(fileName: string): string {
  if (fileName.endsWith(".json.gz") || fileName.endsWith(".gz")) return "application/gzip";
  if (fileName.endsWith(".bundle") || fileName.endsWith(".enc")) return "application/octet-stream";
  if (fileName.endsWith(".json")) return "application/json";
  if (fileName.endsWith(".txt") || fileName.endsWith(".log") || fileName.endsWith(".md"))
    return "text/plain";
  return "application/octet-stream";
}

export class GoogleDriveService {
  private static subfolderCache: Map<string, string> = new Map();

  /**
   * Diagnostic check on current Google Drive authentication state
   */
  static getAuthStatus(): {
    configured: boolean;
    authType: "oauth2" | "service_account" | "none";
    targetFolderId?: string;
    targetFolderUrl?: string;
    hasOAuthToken: boolean;
    hasServiceAccount: boolean;
    details: string;
  } {
    const folderId = config.googleDriveFolderId;
    const oauthCreds = loadOAuthCredentials();
    const tokens = loadOAuthTokens();
    const hasOAuth = Boolean(oauthCreds && tokens?.refreshToken);

    const hasServiceAccount = Boolean(
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
        (config.googleServiceAccountPath && fs.existsSync(config.googleServiceAccountPath))
    );

    if (hasOAuth) {
      return {
        configured: Boolean(folderId),
        authType: "oauth2",
        targetFolderId: folderId,
        targetFolderUrl: folderId ? `https://drive.google.com/drive/folders/${folderId}` : undefined,
        hasOAuthToken: true,
        hasServiceAccount,
        details: "Authenticated via Personal OAuth 2.0 (Personal Drive storage quota).",
      };
    }

    if (hasServiceAccount) {
      return {
        configured: Boolean(folderId),
        authType: "service_account",
        targetFolderId: folderId,
        targetFolderUrl: folderId ? `https://drive.google.com/drive/folders/${folderId}` : undefined,
        hasOAuthToken: false,
        hasServiceAccount: true,
        details:
          "Using Service Account (Warning: Personal Google Drive folders block file creation due to 0MB service account quota).",
      };
    }

    return {
      configured: false,
      authType: "none",
      targetFolderId: folderId,
      targetFolderUrl: folderId ? `https://drive.google.com/drive/folders/${folderId}` : undefined,
      hasOAuthToken: false,
      hasServiceAccount: false,
      details: "No Google Drive credentials configured.",
    };
  }

  /**
   * Get authenticated Google Drive client (Prioritizing OAuth 2.0, fallback to Service Account)
   */
  static getDriveClient(): { drive: drive_v3.Drive; authType: "oauth2" | "service_account" } | null {
    try {
      // 1. Priority: OAuth 2.0 User Token (Subramanian Hariharasubramanian / Personal Drive quota)
      const oauthCreds = loadOAuthCredentials();
      const tokens = loadOAuthTokens();

      if (oauthCreds && tokens?.refreshToken) {
        const oauth2Client = new google.auth.OAuth2(
          oauthCreds.clientId,
          oauthCreds.clientSecret,
          oauthCreds.redirectUri || "http://localhost:8585/oauth2callback"
        );

        oauth2Client.setCredentials({
          refresh_token: tokens.refreshToken,
          access_token: tokens.accessToken,
        });

        // Persist newly refreshed tokens automatically if refreshed by googleapis
        oauth2Client.on("tokens", (newTokens) => {
          try {
            if (config.googleOAuthTokenPath) {
              let existing: any = {};
              if (fs.existsSync(config.googleOAuthTokenPath)) {
                existing = JSON.parse(fs.readFileSync(config.googleOAuthTokenPath, "utf-8"));
              }
              const merged = { ...existing, ...newTokens };
              fs.writeFileSync(config.googleOAuthTokenPath, JSON.stringify(merged, null, 2), "utf-8");
            }
          } catch {}
        });

        return {
          drive: google.drive({ version: "v3", auth: oauth2Client }),
          authType: "oauth2",
        };
      }

      // 2. Fallback: Service Account
      const scopes = [
        "https://www.googleapis.com/auth/drive.file",
        "https://www.googleapis.com/auth/drive",
      ];

      if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
        const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
        const auth = new google.auth.GoogleAuth({
          credentials,
          scopes,
        });
        return {
          drive: google.drive({ version: "v3", auth }),
          authType: "service_account",
        };
      }

      if (config.googleServiceAccountPath && fs.existsSync(config.googleServiceAccountPath)) {
        const auth = new google.auth.GoogleAuth({
          keyFile: config.googleServiceAccountPath,
          scopes,
        });
        return {
          drive: google.drive({ version: "v3", auth }),
          authType: "service_account",
        };
      }

      return null;
    } catch (err: any) {
      console.warn("[GoogleDrive] Could not initialize Google Drive client:", err?.message || err);
      return null;
    }
  }

  /**
   * Resolve or create a subfolder inside the root Google Drive backup folder
   * Supports nested paths like "supabase/aglvpztrnfaaxtjdajoh"
   */
  static async getOrCreateSubfolder(
    drive: drive_v3.Drive,
    parentFolderId: string,
    subfolderPath: string
  ): Promise<string> {
    const normalized = subfolderPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    if (!normalized) return parentFolderId;

    if (this.subfolderCache.has(normalized)) {
      return this.subfolderCache.get(normalized)!;
    }

    const segments = normalized.split("/");
    let currentParentId = parentFolderId;
    let accumulatedPath = "";

    for (const segment of segments) {
      accumulatedPath = accumulatedPath ? `${accumulatedPath}/${segment}` : segment;
      if (this.subfolderCache.has(accumulatedPath)) {
        currentParentId = this.subfolderCache.get(accumulatedPath)!;
        continue;
      }

      try {
        const query = `'${currentParentId}' in parents and name = '${segment}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
        const res = await drive.files.list({
          q: query,
          fields: "files(id, name)",
          spaces: "drive",
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        });

        if (res.data.files && res.data.files.length > 0) {
          currentParentId = res.data.files[0].id!;
        } else {
          const createRes = await drive.files.create({
            requestBody: {
              name: segment,
              mimeType: "application/vnd.google-apps.folder",
              parents: [currentParentId],
            },
            fields: "id, name",
            supportsAllDrives: true,
          });
          currentParentId = createRes.data.id!;
        }
        this.subfolderCache.set(accumulatedPath, currentParentId);
      } catch (err: any) {
        console.warn(
          `[GoogleDrive] Could not resolve subfolder segment "${segment}": ${err?.message || err}`
        );
        return currentParentId;
      }
    }

    return currentParentId;
  }

  /**
   * Upload a single local file to Google Drive
   */
  static async uploadFile(
    localFilePath: string,
    targetSubfolderName = "general"
  ): Promise<DriveUploadItem> {
    const fileName = path.basename(localFilePath);
    const clientInfo = this.getDriveClient();
    const folderId = config.googleDriveFolderId;

    if (!clientInfo || !folderId) {
      const authStatus = this.getAuthStatus();
      return {
        name: fileName,
        fileId: "",
        sizeBytes: 0,
        subfolder: targetSubfolderName,
        success: false,
        errorMessage: !folderId
          ? "GOOGLE_DRIVE_BACKUP_FOLDER_ID not configured"
          : `Google Drive client could not be initialized: ${authStatus.details}`,
      };
    }

    const { drive } = clientInfo;

    try {
      const stat = await fsp.stat(localFilePath);
      const mimeType = getMimeType(fileName);
      const targetFolderId = await this.getOrCreateSubfolder(drive, folderId, targetSubfolderName);

      // Check if file already exists in target folder with exact same name to prevent duplicates
      const query = `'${targetFolderId}' in parents and name = '${fileName}' and trashed = false`;
      const existingRes = await drive.files.list({
        q: query,
        fields: "files(id, name)",
        spaces: "drive",
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });

      let res;
      if (existingRes.data.files && existingRes.data.files.length > 0) {
        // Update existing file content
        const existingFileId = existingRes.data.files[0].id!;
        res = await drive.files.update({
          fileId: existingFileId,
          requestBody: {
            mimeType,
          },
          media: {
            mimeType,
            body: fs.createReadStream(localFilePath),
          },
          fields: "id, name, webViewLink, size",
          supportsAllDrives: true,
        });
      } else {
        // Create new file
        res = await drive.files.create({
          requestBody: {
            name: fileName,
            mimeType,
            parents: [targetFolderId],
          },
          media: {
            mimeType,
            body: fs.createReadStream(localFilePath),
          },
          fields: "id, name, webViewLink, size",
          supportsAllDrives: true,
        });
      }

      return {
        name: fileName,
        fileId: res.data.id || "",
        webViewLink: res.data.webViewLink || undefined,
        sizeBytes: stat.size,
        subfolder: targetSubfolderName,
        success: true,
      };
    } catch (err: any) {
      return {
        name: fileName,
        fileId: "",
        sizeBytes: 0,
        subfolder: targetSubfolderName,
        success: false,
        errorMessage: err?.message || String(err),
      };
    }
  }

  /**
   * Sync all local backup directories (supabase, repos, secrets) directly into Google Drive
   */
  static async syncAllBackupsToDrive(): Promise<DriveSyncSummary> {
    const startTime = Date.now();
    const folderId = config.googleDriveFolderId;
    const clientInfo = this.getDriveClient();
    const authType = clientInfo?.authType || "none";

    if (!folderId) {
      return {
        timestamp: new Date().toISOString(),
        durationSeconds: 0,
        folderId: "",
        folderUrl: "",
        authType,
        filesUploadedCount: 0,
        totalBytesUploaded: 0,
        files: [],
        allSuccessful: false,
        errorMessage: "GOOGLE_DRIVE_BACKUP_FOLDER_ID is not configured",
      };
    }

    if (!clientInfo) {
      const authStatus = this.getAuthStatus();
      return {
        timestamp: new Date().toISOString(),
        durationSeconds: 0,
        folderId,
        folderUrl: `https://drive.google.com/drive/folders/${folderId}`,
        authType,
        filesUploadedCount: 0,
        totalBytesUploaded: 0,
        files: [],
        allSuccessful: false,
        errorMessage: `Google Drive not authenticated: ${authStatus.details}. Run 'npm run auth:google-drive' to link your Google account.`,
      };
    }

    const folderUrl = `https://drive.google.com/drive/folders/${folderId}`;
    const filesToUpload: { localPath: string; subfolder: string }[] = [];

    // 1. Gather Supabase files
    try {
      const spDir = config.backupSupabaseDir;
      if (fs.existsSync(spDir)) {
        const projects = await fsp.readdir(spDir);
        for (const p of projects) {
          const pPath = path.join(spDir, p);
          const pStat = await fsp.stat(pPath);
          if (pStat.isDirectory()) {
            const files = await fsp.readdir(pPath);
            for (const f of files) {
              if (f.endsWith(".json.gz") || f === "latest_manifest.json") {
                filesToUpload.push({ localPath: path.join(pPath, f), subfolder: `supabase/${p}` });
              }
            }
          }
        }
      }
    } catch {}

    // 2. Gather Repo Bundles
    try {
      const rpDir = config.backupReposDir;
      if (fs.existsSync(rpDir)) {
        const files = await fsp.readdir(rpDir);
        for (const f of files) {
          if (f.endsWith(".bundle")) {
            filesToUpload.push({ localPath: path.join(rpDir, f), subfolder: "repos" });
          }
        }
      }
    } catch {}

    // 3. Gather Secret Escrow archives
    try {
      const scDir = config.backupSecretsDir;
      if (fs.existsSync(scDir)) {
        const files = await fsp.readdir(scDir);
        for (const f of files) {
          if (f.endsWith(".enc")) {
            filesToUpload.push({ localPath: path.join(scDir, f), subfolder: "secrets" });
          }
        }
      }
    } catch {}

    const results: DriveUploadItem[] = [];
    for (const item of filesToUpload) {
      const res = await this.uploadFile(item.localPath, item.subfolder);
      results.push(res);
    }

    const durationSeconds = (Date.now() - startTime) / 1000;
    const filesUploadedCount = results.filter((r) => r.success).length;
    const totalBytesUploaded = results
      .filter((r) => r.success)
      .reduce((acc, r) => acc + r.sizeBytes, 0);

    return {
      timestamp: new Date().toISOString(),
      durationSeconds,
      folderId,
      folderUrl,
      authType,
      filesUploadedCount,
      totalBytesUploaded,
      files: results,
      allSuccessful: results.length > 0 && results.every((r) => r.success),
    };
  }
}
