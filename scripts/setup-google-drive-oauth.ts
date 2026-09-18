import fs from "node:fs";
import http from "node:http";
import readline from "node:readline";
import { exec } from "node:child_process";
import { google } from "googleapis";
import { config } from "../src/config.js";
import { GoogleDriveService } from "../src/services/google-drive-service.js";

const PORT = 8585;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

function promptUser(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function openBrowser(url: string) {
  const startCmd =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
      ? `open "${url}"`
      : `xdg-open "${url}"`;
  exec(startCmd, (err) => {
    if (err) {
      console.log(`\nCould not automatically launch browser. Please open this URL manually:\n${url}\n`);
    }
  });
}

async function getCredentials(): Promise<{ clientId: string; clientSecret: string }> {
  // 1. Direct env config
  if (config.googleOAuthClientId && config.googleOAuthClientSecret) {
    return {
      clientId: config.googleOAuthClientId,
      clientSecret: config.googleOAuthClientSecret,
    };
  }

  // 2. Auto-detect credentials JSON file (downloaded from GCP Console)
  const candidatePaths = [
    config.googleOAuthCredentialsPath,
    "config/credentials.json",
    "credentials.json",
  ];

  // Also check any file matching client_secret*.json in config/ or root
  try {
    const configFiles = fs.readdirSync("config");
    for (const f of configFiles) {
      if (f.startsWith("client_secret") && f.endsWith(".json")) {
        candidatePaths.unshift(`config/${f}`);
      }
    }
  } catch {}

  for (const credPath of candidatePaths) {
    if (fs.existsSync(credPath)) {
      try {
        const raw = fs.readFileSync(credPath, "utf-8");
        const data = JSON.parse(raw);
        const creds = data.installed || data.web || data;
        if (creds.client_id && creds.client_secret) {
          console.log(`Auto-detected OAuth credentials from ${credPath}`);
          return {
            clientId: creds.client_id,
            clientSecret: creds.client_secret,
          };
        }
      } catch {}
    }
  }

  // 3. User instructions and interactive prompt
  console.log("\n=====================================================================");
  console.log("  Google Drive Personal OAuth 2.0 Setup (subbuzdesk@gmail.com)");
  console.log("=====================================================================");
  console.log(`\nTo allow disaster recovery cold backups to be stored in your personal Google Drive`);
  console.log(`without hitting the 0MB Service Account quota limit, we link your Google Account.\n`);
  console.log(`Follow these 3 quick steps in Google Cloud Console:`);
  console.log(`1. Open Credentials: https://console.cloud.google.com/apis/credentials?project=ambistk0`);
  console.log(`2. Click '+ CREATE CREDENTIALS' -> 'OAuth client ID'`);
  console.log(`   - Application type: 'Desktop app' (or 'Web application' with redirect: ${REDIRECT_URI})`);
  console.log(`   - Name: 'Ambiakshi Drive Backup'`);
  console.log(`3. Copy the Client ID and Client Secret, OR save the downloaded JSON as:`);
  console.log(`   ${config.googleOAuthCredentialsPath}\n`);

  const clientId = await promptUser("Enter your Google OAuth Client ID: ");
  const clientSecret = await promptUser("Enter your Google OAuth Client Secret: ");

  if (!clientId || !clientSecret) {
    throw new Error("Client ID and Client Secret are required.");
  }

  // Save to credentials file for subsequent runs
  const credsPayload = {
    installed: {
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uris: [REDIRECT_URI],
    },
  };
  fs.writeFileSync(config.googleOAuthCredentialsPath, JSON.stringify(credsPayload, null, 2), "utf-8");
  console.log(`Saved credentials to ${config.googleOAuthCredentialsPath}`);

  return { clientId, clientSecret };
}

async function main() {
  console.log("Initializing Google Drive Personal OAuth flow...");
  const { clientId, clientSecret } = await getCredentials();

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // Force consent so Google sends refresh_token
    scope: [
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/drive",
    ],
  });

  console.log("\nStarting local authentication listener on port", PORT, "...");

  const server = http.createServer();

  const authPromise = new Promise<{ code: string }>((resolve, reject) => {
    server.on("request", async (req, res) => {
      try {
        if (!req.url?.startsWith("/oauth2callback")) {
          res.writeHead(404);
          res.end();
          return;
        }

        const urlObj = new URL(req.url, `http://localhost:${PORT}`);
        const code = urlObj.searchParams.get("code");
        const error = urlObj.searchParams.get("error");

        if (error) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(`<h2>Authentication Cancelled or Failed</h2><p>${error}</p>`);
          reject(new Error(`OAuth Error from Google: ${error}`));
          return;
        }

        if (code) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`
            <html>
              <body style="font-family: sans-serif; text-align: center; padding-top: 60px; background: #0f172a; color: #f8fafc;">
                <h1 style="color: #22c55e;">Authentication Successful!</h1>
                <p>Google Drive has been authorized for Ambiakshi Disaster Recovery Backups.</p>
                <p>You can close this window now and return to your terminal.</p>
              </body>
            </html>
          `);
          resolve({ code });
        }
      } catch (e) {
        reject(e);
      }
    });

    server.listen(PORT, () => {
      console.log(`Listening at ${REDIRECT_URI}`);
      console.log(`Opening browser to authenticate as subbuzdesk@gmail.com...`);
      console.log(`URL: ${authUrl}\n`);
      openBrowser(authUrl);
    });
  });

  const { code } = await authPromise;
  server.close();

  console.log("Received authorization code from Google. Exchanging for tokens...");
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.refresh_token) {
    console.warn("\nNotice: Google did not return a refresh_token (likely already granted previously).");
    // If existing token file has refresh_token, preserve it
    if (fs.existsSync(config.googleOAuthTokenPath)) {
      const prev = JSON.parse(fs.readFileSync(config.googleOAuthTokenPath, "utf-8"));
      tokens.refresh_token = prev.refresh_token;
    }
  }

  // Save tokens to token file
  fs.writeFileSync(config.googleOAuthTokenPath, JSON.stringify(tokens, null, 2), "utf-8");
  console.log(`Saved OAuth tokens to ${config.googleOAuthTokenPath}`);

  // Test live connectivity with Google Drive
  console.log("\nTesting live Google Drive write permissions...");
  const driveInfo = GoogleDriveService.getDriveClient();

  if (!driveInfo || driveInfo.authType !== "oauth2") {
    throw new Error("Could not initialize Google Drive client with OAuth 2.0 token.");
  }

  const { drive } = driveInfo;
  const folderId = config.googleDriveFolderId;
  console.log(`Target Folder ID: ${folderId}`);
  console.log(`Target Folder Link: https://drive.google.com/drive/folders/${folderId}`);

  // Create a probe file in folder
  const testFileName = `_probe_oauth_verify_${Date.now()}.txt`;
  const createRes = await drive.files.create({
    requestBody: {
      name: testFileName,
      parents: folderId ? [folderId] : undefined,
    },
    media: {
      mimeType: "text/plain",
      body: `Ambiakshi Disaster Recovery OAuth write verification successful at ${new Date().toISOString()}`,
    },
    fields: "id, name",
    supportsAllDrives: true,
  });

  console.log(`Successfully created test verification file: ${createRes.data.name} (ID: ${createRes.data.id})`);

  // Clean up probe file
  if (createRes.data.id) {
    await drive.files.delete({
      fileId: createRes.data.id,
      supportsAllDrives: true,
    });
    console.log("Cleaned up verification test file from Google Drive.");
  }

  console.log("\n=====================================================================");
  console.log("  Google Drive Personal OAuth Setup Succeeded!");
  console.log("=====================================================================");
  console.log("All future disaster recovery backups will upload directly to your Google Drive");
  console.log(`Folder: https://drive.google.com/drive/folders/${folderId}`);
  console.log("Storage Quota: Used against your personal account (subbuzdesk@gmail.com)\n");
}

main().catch((err) => {
  console.error("\nOAuth Setup Failed:", err?.message || err);
  process.exit(1);
});
