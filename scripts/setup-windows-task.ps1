<#
.SYNOPSIS
  Registers Ambiakshi Scheduled Tasks in Windows Task Scheduler.
.DESCRIPTION
  Schedules:
  1. Ambiakshi_Daily_Maintenance: Every day at 04:00 AM EST (scripts/run-daily-4am.bat)
  2. Ambiakshi_Weekly_Audit: Every Sunday at 03:00 AM EST (scripts/run-weekly.bat)
#>

param(
    [string]$DailyTime = "04:00",
    [string]$WeeklyTime = "03:00",
    [string]$MobileTime = "05:00",
    [string]$BackupTime = "02:00",
    [string]$TaskType = "all" # Options: all, daily, weekly, mobile, backup
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path "$ScriptDir\.."
$DailyBatPath = Join-Path $ProjectRoot "scripts\run-daily-4am.bat"
$WeeklyBatPath = Join-Path $ProjectRoot "scripts\run-weekly.bat"
$MobileBatPath = Join-Path $ProjectRoot "scripts\run-mobile-games.bat"
$BackupBatPath = Join-Path $ProjectRoot "scripts\run-backup-all.bat"

function Register-AmbiakshiTask {
    param(
        [string]$Name,
        [string]$BatFilePath,
        $Trigger,
        [string]$Description
    )

    if (-not (Test-Path $BatFilePath)) {
        Write-Error "Batch file not found: $BatFilePath"
        return
    }

    Write-Host "`nRegistering Windows Scheduled Task: $Name"
    Write-Host "Script: $BatFilePath"

    $Action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$BatFilePath`""
    $Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

    try {
        Unregister-ScheduledTask -TaskName $Name -Confirm:$false -ErrorAction SilentlyContinue
        Register-ScheduledTask -TaskName $Name -Action $Action -Trigger $Trigger -Settings $Settings -Description $Description
        Write-Host "✅ Task '$Name' registered successfully!" -ForegroundColor Green
    } catch {
        Write-Warning "Could not register using Register-ScheduledTask: $_"
    }
}

Write-Host "================================================================="
Write-Host "  Ambiakshi Windows Task Scheduler Setup"
Write-Host "================================================================="

if ($TaskType -eq "all" -or $TaskType -eq "daily") {
    $DailyTrigger = New-ScheduledTaskTrigger -Daily -At $DailyTime
    Register-AmbiakshiTask -Name "Ambiakshi_Daily_Maintenance" -BatFilePath $DailyBatPath -Trigger $DailyTrigger -Description "Ambiakshi daily ecosystem maintenance: 200 URL indexing batch and Supabase keepalive."
}

if ($TaskType -eq "all" -or $TaskType -eq "weekly") {
    $WeeklyTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At $WeeklyTime
    Register-AmbiakshiTask -Name "Ambiakshi_Weekly_Audit" -BatFilePath $WeeklyBatPath -Trigger $WeeklyTrigger -Description "Ambiakshi weekly ecosystem audit: 100% catalog health, Supabase schema probe, and SSL audit."
}

if ($TaskType -eq "all" -or $TaskType -eq "mobile") {
    $MobileTrigger = New-ScheduledTaskTrigger -Daily -At $MobileTime
    Register-AmbiakshiTask -Name "Ambiakshi_Mobile_Games_Maintenance" -BatFilePath $MobileBatPath -Trigger $MobileTrigger -Description "Ambiakshi mobile games maintenance: PromptCraft, Digitle, Vectoshift health & repo audit."
}

if ($TaskType -eq "all" -or $TaskType -eq "backup") {
    $BackupTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At $BackupTime
    Register-AmbiakshiTask -Name "Ambiakshi_Disaster_Recovery_Backup" -BatFilePath $BackupBatPath -Trigger $BackupTrigger -Description "Ambiakshi cold backup: Supabase database dump, Git repository bundles, and encrypted secret archive."
}

Write-Host "`nAll scheduled tasks configured."
Write-Host "To test run weekly audit: Start-ScheduledTask -TaskName 'Ambiakshi_Weekly_Audit'"
Write-Host "To test run daily maintenance: Start-ScheduledTask -TaskName 'Ambiakshi_Daily_Maintenance'"
Write-Host "To test run mobile games maintenance: Start-ScheduledTask -TaskName 'Ambiakshi_Mobile_Games_Maintenance'"
Write-Host "To test run disaster recovery backup: Start-ScheduledTask -TaskName 'Ambiakshi_Disaster_Recovery_Backup'"

