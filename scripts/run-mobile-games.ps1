<#
.SYNOPSIS
  Executes the dedicated Ambiakshi Mobile Games maintenance routine.
.DESCRIPTION
  Probes live endpoints, response latency, assets, and audits local cloned repositories
  for PromptCraft Mobile, Digitle Game, and Vectoshift on mobile.ambiakshi.com.
  Dispatches structured summary to Discord.
#>

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path "$ScriptDir\.."

Set-Location $ProjectRoot

$LogsDir = Join-Path $ProjectRoot "logs"
if (-not (Test-Path $LogsDir)) {
    New-Item -ItemType Directory -Path $LogsDir -Force | Out-Null
}

$LogFile = Join-Path $LogsDir "mobile_games_run.log"
$Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

Add-Content -Path $LogFile -Value "`n====================================================================="
Add-Content -Path $LogFile -Value "Ambiakshi Mobile Games Maintenance Started at $Timestamp"
Add-Content -Path $LogFile -Value "====================================================================="

try {
    # Execute mobile games maintenance using tsx
    npx tsx src/jobs/mobile-games-maintenance.ts *>> $LogFile
    $ExitCode = $LASTEXITCODE
    $EndTimestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $LogFile -Value "Mobile games maintenance completed at $EndTimestamp (Exit code: $ExitCode)"
    exit $ExitCode
} catch {
    $ErrorMsg = $_.Exception.Message
    Add-Content -Path $LogFile -Value "[ERROR] Mobile games maintenance failed with exception: $ErrorMsg"
    exit 1
}
