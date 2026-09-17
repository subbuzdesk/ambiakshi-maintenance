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
    [string]$TaskType = "all" # Options: all, daily, weekly
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path "$ScriptDir\.."
$DailyBatPath = Join-Path $ProjectRoot "scripts\run-daily-4am.bat"
$WeeklyBatPath = Join-Path $ProjectRoot "scripts\run-weekly.bat"

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

Write-Host "`nAll scheduled tasks configured."
Write-Host "To test run weekly audit: Start-ScheduledTask -TaskName 'Ambiakshi_Weekly_Audit'"
Write-Host "To test run daily maintenance: Start-ScheduledTask -TaskName 'Ambiakshi_Daily_Maintenance'"

