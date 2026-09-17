<#
.SYNOPSIS
  Executes the weekly comprehensive Ambiakshi ecosystem health audit.
.DESCRIPTION
  Performs 100% full-catalog URL verification, multi-repo Supabase schema inspection,
  SSL certificate expiry checks, sitemap drift tracking, and dispatches a Discord executive digest.
#>

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path "$ScriptDir\.."

Set-Location $ProjectRoot

$LogsDir = Join-Path $ProjectRoot "logs"
if (-not (Test-Path $LogsDir)) {
    New-Item -ItemType Directory -Path $LogsDir -Force | Out-Null
}

$LogFile = Join-Path $LogsDir "weekly_run.log"
$Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

Add-Content -Path $LogFile -Value "`n====================================================================="
Add-Content -Path $LogFile -Value "Ambiakshi Weekly Ecosystem Health Audit Started at $Timestamp"
Add-Content -Path $LogFile -Value "====================================================================="

try {
    # Execute weekly audit using tsx
    npx tsx src/jobs/weekly-audit.ts *>> $LogFile
    $ExitCode = $LASTEXITCODE
    $EndTimestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $LogFile -Value "Weekly audit completed at $EndTimestamp (Exit code: $ExitCode)"
    exit $ExitCode
} catch {
    $ErrorMsg = $_.Exception.Message
    Add-Content -Path $LogFile -Value "[ERROR] Weekly audit failed with exception: $ErrorMsg"
    exit 1
}
