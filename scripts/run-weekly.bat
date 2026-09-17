@echo off
setlocal enabledelayedexpansion

:: Navigate to script directory parent (project root)
cd /d "%~dp0\.."

if not exist logs mkdir logs

echo ===================================================================== >> logs\weekly_run.log
echo Running Ambiakshi Weekly Comprehensive Health Audit at %date% %time% >> logs\weekly_run.log
echo ===================================================================== >> logs\weekly_run.log

:: Run the weekly audit suite
call npx tsx src/jobs/weekly-audit.ts >> logs\weekly_run.log 2>&1

set EXIT_CODE=%ERRORLEVEL%
echo Weekly audit finished with exit code %EXIT_CODE% at %date% %time% >> logs\weekly_run.log

exit /b %EXIT_CODE%
