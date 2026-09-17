# Ambiakshi Housekeeping & Maintenance Suite

Automated housekeeping, Google Search Console (GSC) batch indexing, ecosystem health inspection, and Supabase inactivity prevention for the Ambiakshi digital ecosystem:
- **`https://www.ambiakshi.tools`** (~146 pages)
- **`https://ambiakshi.com`** (~59 pages)
- **`https://mobile.ambiakshi.com`** (~13 pages)
- **`https://slm.ambiakshi.com`** (~13 pages)

---

## Key Capabilities

1. **Daily 200-URL Indexing Batch at 4:00 AM EST**:
   - **Failure-First Prioritization**: Any pages that previously returned `40x` (e.g. 404, 410) or network errors are automatically placed at the front of tomorrow's queue.
   - **Round-Robin Cycling**: The remainder of the daily 200-URL quota is filled sequentially from the oldest/never-checked URLs.
   - **Coverage Guarantee**: With ~231 total URLs across the ecosystem and 200 processed daily, the entire site is checked every ~1.15 days, ensuring **every page is verified and submitted 5 to 6 times per week** (well exceeding the twice-a-week target).
   - **Live HTTP Diagnostic**: Checks HTTP 200 vs 40x, response latency, `<meta name="robots">` `noindex` directives, and canonical tags.
   - **Google Indexing API Integration**: Submits batch `URL_UPDATED` notifications directly to Google when Google Cloud service account credentials are provided.

2. **Weekly Comprehensive Health Audit (Sundays at 3:00 AM EST)**:
   - **100% Full-Catalog Health Crawl**: Bypasses the 200 daily quota and verifies every single URL in the catalog in one comprehensive sweep.
   - **Multi-Repository Schema & Storage Inventory**: Scans migration files across `ambiakshi-home`, `ambiakshi-tools`, `ambiakshi-slm`, and `ambiakshi-mobile`, probing row counts and accessibility of live database tables.
   - **SSL Certificate Expiration Matrix**: Inspects TLS certificates across all ecosystem domains (`ambiakshi.tools`, `ambiakshi.com`, `mobile.ambiakshi.com`, `slm.ambiakshi.com`), warning if any certificate expires in under 30 days.
   - **Sitemap Drift Reconciliation**: Tracks additions and deletions to maintain catalog integrity.
   - **Discord Executive Digest**: Dispatches rich status embed cards with health scores and priority action items.
   - **Comprehensive Weekly Markdown Report**: Generates `reports/audits/YYYY-MM-DD-weekly-audit.md`.

3. **Supabase Inactivity Prevention (Keep-Alive)**:
   - Prevents Supabase free tier projects from automatically pausing after 7 days of inactivity.
   - Executes an automated daily heartbeat that connects, inserts a dummy row, confirms active write activity, and deletes the dummy row immediately.
   - Includes full restoration documentation and API hooks to unpause a suspended database.

4. **Automated Windows Task Scheduler**:
   - PowerShell setup script to register `Ambiakshi_Daily_Maintenance` (Daily at **4:00 AM EST**) and `Ambiakshi_Weekly_Audit` (Sundays at **3:00 AM EST**).

---

## Directory Structure

```
ambiakshi-maintenance/
├── .env.example                       # Environment template
├── package.json                       # Scripts and dependencies
├── tsconfig.json                      # TypeScript configuration
├── README.md                          # Documentation & operational guide
├── config/
│   └── google-service-account.json    # (Optional) Google Cloud Service Account key
├── data/
│   ├── indexing_state.json            # Persistent queue and URL check histories
│   └── sitemaps_cache.json            # Cached XML sitemaps
├── logs/
│   ├── daily_run.log                  # Windows Task Scheduler daily execution logs
│   └── weekly_run.log                 # Windows Task Scheduler weekly audit logs
├── reports/
│   ├── indexing/                      # Daily markdown run logs (e.g. 2026-09-17-daily-run.md)
│   └── audits/                        # Weekly comprehensive audit reports
├── scripts/
│   ├── run-daily-4am.bat              # Batch runner for daily task
│   ├── run-daily-4am.ps1              # PowerShell runner for daily task
│   ├── run-weekly.bat                 # Batch runner for Sunday weekly audit
│   ├── run-weekly.ps1                 # PowerShell runner for Sunday weekly audit
│   └── setup-windows-task.ps1         # Registers both Daily & Weekly Windows Tasks
└── src/
    ├── config.ts                      # Configuration loader
    ├── index.ts                       # Unified CLI entry point
    ├── jobs/
    │   ├── daily-maintenance.ts       # Daily orchestrator (Indexing + Keepalive)
    │   └── weekly-audit.ts            # Weekly full ecosystem audit (100% crawl, SSL, DB probe)
    └── services/
        ├── sitemap-fetcher.ts         # Live XML sitemap parser
        ├── indexing-queue.ts          # State engine & failure-first prioritization
        ├── gsc-indexer.ts             # Live HTTP checks + Google Indexing API
        ├── supabase-keepalive.ts      # Dummy row insertion & deletion lifecycle
        ├── schema-inventory.ts        # Table cataloger across repos
        ├── ssl-checker.ts             # SSL certificate expiration & security monitor
        └── discord-notifier.ts        # Rich Discord webhook executive digests
```

---

## Setup & Configuration

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment (`.env`)
Copy `.env.example` to `.env`:
```bash
copy .env.example .env
```

Edit `.env` with your credentials:
```env
# 1. Google Indexing API (Optional for direct GSC indexing notifications)
GOOGLE_SERVICE_ACCOUNT_KEY_PATH=./config/google-service-account.json
DAILY_INDEXING_QUOTA=200

# 2. Supabase Keep-Alive
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
SUPABASE_HEARTBEAT_TABLE=_ambiakshi_heartbeat
SUPABASE_DELETE_DUMMY_ROW_AFTER_INSERT=true

# 3. Discord Weekly Digest & Alert Webhook (Optional)
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/your-id/your-token

# 4. SSL & Domain Monitoring
SSL_EXPIRY_WARNING_DAYS=30
```

---

## Supabase Inactivity: How to Restore and Keep Active

### Why Free Projects Become Inactive
Supabase pauses free projects after **7 days without database requests or API calls**. When paused, the compute cluster is stopped.

### How to Make Active (Unpause)
1. **Via Dashboard (Instant)**:
   - Log into [supabase.com/dashboard](https://supabase.com/dashboard).
   - Click on your project.
   - Click the green **"Restore project"** or **"Unpause project"** button.
   - Wait ~1-2 minutes for the database cluster to start.
2. **Via Management API**:
   - If you generate a Personal Access Token in Supabase Dashboard (Account > Access Tokens), you can unpause via API:
     ```bash
     curl -X POST https://api.supabase.com/v1/projects/<PROJECT_REF>/restore \
          -H "Authorization: Bearer <MANAGEMENT_TOKEN>" \
          -H "Content-Type: application/json"
     ```

### How This Suite Prevents Future Inactivity
- **Daily 4:00 AM Routine**: Performs a lightweight write/delete ping (`_ambiakshi_heartbeat`), registering active database compute.
- **Weekly 3:00 AM Audit**: Runs multi-table schema inspection across discovered repositories (`consultation_leads`, `subscribers`, `feedback_submissions`, etc.), monitoring row counts and database reachability.

---

## Google Indexing API Setup (Optional)

To enable direct indexing submissions to Google:
1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the **Web Search Indexing API**.
3. Go to **IAM & Admin > Service Accounts**, create a Service Account, and generate a **JSON key**.
4. Save the JSON file to `config/google-service-account.json`.
5. Open [Google Search Console](https://search.google.com/search-console).
6. Under **Settings > Users and permissions**, add the Service Account email as an **Owner** for each domain property.

*Note: If no service account is configured, the suite runs in **Live Technical Health Verification Mode**, verifying 200 OK responses, meta tags, and canonical integrity for every URL.*

---

## Available CLI Commands

| Command | Description |
| :--- | :--- |
| `npm run maintenance:daily` | Runs full daily routine: fetches sitemaps, inspects 200 URLs with failure prioritization, publishes to Google, and triggers Supabase keepalive. |
| `npm run maintenance:weekly` | Executes full weekly audit: 100% catalog health crawl, deep Supabase schema probe, SSL cert expiry sweep, and Discord digest. |
| `npm run audit:weekly` | Direct alias for the weekly comprehensive audit job. |
| `npm run audit:ssl` | Inspects SSL certificate expiration countdown across all ecosystem domains. |
| `npm run index:daily` | Runs the 200-URL indexing batch only. |
| `npm run index:all` | Runs a complete pass across all ~231 ecosystem URLs. |
| `npm run index:status` | Displays queue metrics, 200 OK counts, failing 40x URLs, and estimated full cycle days. |
| `npm run supabase:keepalive` | Runs a standalone Supabase heartbeat dummy insert/delete. |
| `npm run supabase:inventory` | Scans adjacent local Git repositories (`ambiakshi-home`, `ambiakshi-tools`, etc.) and probes table counts. |

---

## Automated Scheduling: Windows Task Scheduler

To configure the tasks to run automatically:
- **Daily Maintenance**: Every day at **4:00 AM EST**
- **Weekly Audit**: Every Sunday at **3:00 AM EST**

1. Open PowerShell as Administrator.
2. Run:
   ```powershell
   cd C:\Users\subbu\OneDrive\Documents\git\ambiakshi-maintenance
   powershell -ExecutionPolicy Bypass -File scripts\setup-windows-task.ps1
   ```
3. To test run either task immediately:
   ```powershell
   # Test Sunday weekly audit
   Start-ScheduledTask -TaskName "Ambiakshi_Weekly_Audit"

   # Test Daily maintenance
   Start-ScheduledTask -TaskName "Ambiakshi_Daily_Maintenance"
   ```
4. Output logs are written to:
   - Daily runs: `logs\daily_run.log` and `reports\indexing\YYYY-MM-DD-daily-run.md`
   - Weekly audits: `logs\weekly_run.log` and `reports\audits\YYYY-MM-DD-weekly-audit.md`

