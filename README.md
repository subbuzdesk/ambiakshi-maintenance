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

2. **Supabase Inactivity Prevention (Keep-Alive)**:
   - Prevents Supabase free tier projects from automatically pausing after 7 days of inactivity.
   - Executes an automated daily heartbeat that connects, inserts a dummy row, confirms active write activity, and deletes the dummy row immediately.
   - Includes full restoration documentation and API hooks to unpause a suspended database.

3. **Multi-Repository Table Inventory**:
   - Analyzes migration files and table schemas across `ambiakshi-home`, `ambiakshi-tools`, `ambiakshi-slm`, and `ambiakshi-mobile`.
   - Probes live Supabase connectivity and row counts across discovered tables.

4. **Automated Windows Task Scheduler**:
   - PowerShell setup script to register `Ambiakshi_Daily_Maintenance` at **4:00 AM EST** daily.

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
│   └── daily_run.log                  # Windows Task Scheduler execution logs
├── reports/
│   ├── indexing/                      # Daily markdown run logs (e.g. 2026-09-17-daily-run.md)
│   └── audits/                        # Weekly comprehensive audit reports
├── scripts/
│   ├── run-daily-4am.bat              # Batch runner for Task Scheduler
│   ├── run-daily-4am.ps1              # PowerShell runner
│   └── setup-windows-task.ps1         # Registers the 4:00 AM EST Windows Task
└── src/
    ├── config.ts                      # Configuration loader
    ├── index.ts                       # Unified CLI entry point
    ├── jobs/
    │   ├── daily-maintenance.ts       # Daily orchestrator (Indexing + Keepalive)
    │   └── weekly-audit.ts            # Weekly full ecosystem audit
    └── services/
        ├── sitemap-fetcher.ts         # Live XML sitemap parser
        ├── indexing-queue.ts          # State engine & failure-first prioritization
        ├── gsc-indexer.ts             # Live HTTP checks + Google Indexing API
        ├── supabase-keepalive.ts      # Dummy row insertion & deletion lifecycle
        └── schema-inventory.ts        # Table cataloger across repos
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

### How This Repo Prevents Future Inactivity
The daily 4:00 AM worker executes:
1. `supabase.from(TABLE).insert([{ name: "Heartbeat...", metadata: {...} }])`
2. Confirms active write response.
3. Immediately executes `.delete()` on the inserted dummy record.
4. Logs the database latency and timestamp.

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
| `npm run index:daily` | Runs the 200-URL indexing batch only. |
| `npm run index:all` | Runs a complete pass across all ~231 ecosystem URLs. |
| `npm run index:status` | Displays queue metrics, 200 OK counts, failing 40x URLs, and estimated full cycle days. |
| `npm run supabase:keepalive` | Runs a standalone Supabase heartbeat dummy insert/delete. |
| `npm run supabase:inventory` | Scans adjacent local Git repositories (`ambiakshi-home`, `ambiakshi-tools`, etc.) and probes table counts. |
| `npm run audit:weekly` | Generates a comprehensive weekly audit markdown report. |

---

## Automated Scheduling: Windows Task Scheduler

To configure the task to run automatically every day at **4:00 AM EST**:

1. Open PowerShell as Administrator.
2. Run:
   ```powershell
   cd C:\Users\subbu\OneDrive\Documents\git\ambiakshi-maintenance
   powershell -ExecutionPolicy Bypass -File scripts\setup-windows-task.ps1
   ```
3. To test run the task immediately:
   ```powershell
   Start-ScheduledTask -TaskName "Ambiakshi_Daily_Maintenance"
   ```
4. Check `logs\daily_run.log` or `reports\indexing\` to inspect output!
