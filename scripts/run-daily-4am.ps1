<#
.SYNOPSIS
  Executes the daily 4:00 AM EST Ambiakshi maintenance routine.
.DESCRIPTION
  Fetches sitemaps, inspects 200 URLs with failure prioritization, publishes to Google Indexing API,
  and sends the Supabase keep-alive heartbeat.
#>

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path "$ScriptDir\.."

Set-Location $ProjectRoot

$LogsDir = Join-Path $ProjectRoot "logs"
if (-not (Test-Path $LogsDir)) {
    New-Item -ItemType Directory -Path $LogsDir -Force | Out-Null
}

$LogFile = Join-Path $LogsDir "daily_run.log"
$Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

Add-Content -Path $LogFile -Value "`n====================================================================="
Add-Content -Path $LogFile -Value "Ambiakshi Daily Maintenance Started at $Timestamp"
Add-Content -Path $LogFile -Value "====================================================================="

try {
    # Execute maintenance script using tsx
    npx tsx src/jobs/daily-maintenance.ts *>> $LogFile
    $ExitCode = $LASTEXITCODE
    $EndTimestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $LogFile -Value "Maintenance completed successfully at $EndTimestamp (Exit code: $ExitCode)"
    exit $ExitCode
} catch {
    $ErrorMsg = $_.Exception.Message
    Add-Content -Path $LogFile -Value "[ERROR] Maintenance failed with exception: $ErrorMsg"
    exit 1
}
