<#
.SYNOPSIS
  Executes the Ambiakshi Full Ecosystem Disaster Recovery & Cold Backup Suite.
.DESCRIPTION
  Runs:
  1. Supabase logical database backup (dump tables, gzip compression, sha256 checksums)
  2. Git repository bundles for all ecosystem repos (cold code escrow without node_modules)
  3. AES-256-GCM encrypted secret backup (.env.local, .env, service accounts)
  4. Housekeeping pruning (log rotation >5MB, reports >30 days)
  5. Unified Discord alert dispatch
#>

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path "$ScriptDir\.."

Set-Location $ProjectRoot

$LogsDir = Join-Path $ProjectRoot "logs"
$BackupsDir = Join-Path $ProjectRoot "backups"
if (-not (Test-Path $LogsDir)) { New-Item -ItemType Directory -Path $LogsDir | Out-Null }
if (-not (Test-Path $BackupsDir)) { New-Item -ItemType Directory -Path $BackupsDir | Out-Null }

$LogFile = Join-Path $LogsDir "backup_run.log"
$Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

"=====================================================================" | Out-File -FilePath $LogFile -Append
"Running Ambiakshi Full Disaster Recovery Backup at $Timestamp" | Out-File -FilePath $LogFile -Append
"=====================================================================" | Out-File -FilePath $LogFile -Append

npx tsx src/jobs/backup-all.ts *>> $LogFile
$ExitCode = $LASTEXITCODE

"Disaster recovery run finished with exit code $ExitCode at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Out-File -FilePath $LogFile -Append
exit $ExitCode
