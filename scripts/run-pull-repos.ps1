<#
.SYNOPSIS
  Executes the Ambiakshi Ecosystem Git Pull & Synchronization Suite.
.DESCRIPTION
  Fetches and pulls origin across all 12 ecosystem repositories.
  Parameters:
    -Force: Stashes uncommitted edits before pulling
    -Align: Aligns diverged repositories with origin/main (creates safety backup branch)
    -Repo: Target specific repository ID (e.g. -Repo ambiakshi-coach)
#>

param(
    [switch]$Force,
    [switch]$Align,
    [string]$Repo
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path "$ScriptDir\.."

Set-Location $ProjectRoot

$LogsDir = Join-Path $ProjectRoot "logs"
if (-not (Test-Path $LogsDir)) { New-Item -ItemType Directory -Path $LogsDir | Out-Null }

$LogFile = Join-Path $LogsDir "repo_sync.log"
$Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

"=====================================================================" | Out-File -FilePath $LogFile -Append
"Running Ambiakshi Ecosystem Git Sync at $Timestamp" | Out-File -FilePath $LogFile -Append
"=====================================================================" | Out-File -FilePath $LogFile -Append

$ArgsList = @("scripts/sync-repos.ts")
if ($Force) { $ArgsList += "--force" }
if ($Align) { $ArgsList += "--align" }
if ($Repo) { $ArgsList += @("--repo", $Repo) }

npx tsx $ArgsList

$ExitCode = $LASTEXITCODE
"Sync finished with exit code $ExitCode at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Out-File -FilePath $LogFile -Append
exit $ExitCode
