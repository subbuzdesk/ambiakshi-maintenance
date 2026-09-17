<#
.SYNOPSIS
  Registers the Ambiakshi Daily Maintenance Scheduled Task in Windows.
.DESCRIPTION
  Schedules scripts/run-daily-4am.bat to run every day at 04:00 AM EST.
#>

param(
    [string]$Time = "04:00",
    [string]$TaskName = "Ambiakshi_Daily_Maintenance"
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path "$ScriptDir\.."
$BatPath = Join-Path $ProjectRoot "scripts\run-daily-4am.bat"

if (-not (Test-Path $BatPath)) {
    Write-Error "Batch file not found at: $BatPath"
    exit 1
}

Write-Host "================================================================="
Write-Host "Registering Windows Scheduled Task: $TaskName"
Write-Host "Schedule: Daily at $Time EST"
Write-Host "Script:   $BatPath"
Write-Host "================================================================="

# Create Action
$Action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$BatPath`""

# Create Trigger (Daily at specified time)
$Trigger = New-ScheduledTaskTrigger -Daily -At $Time

# Create Settings
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

# Register or update task
try {
    # Unregister existing if present
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

    Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Description "Ambiakshi daily ecosystem maintenance: GSC page indexing batch and Supabase keep-alive."
    Write-Host "`nTask '$TaskName' registered successfully!" -ForegroundColor Green
    Write-Host "To test run immediately: Start-ScheduledTask -TaskName `"$TaskName`""
    Write-Host "To view task details:     Get-ScheduledTask -TaskName `"$TaskName`""
} catch {
    Write-Warning "Could not register using Register-ScheduledTask. Falling back to schtasks.exe..."
    $SchCmd = "schtasks /create /tn `"$TaskName`" /tr `"cmd.exe /c \`"$BatPath\`"`" /sc daily /st $Time /f"
    Invoke-Expression $SchCmd
}
