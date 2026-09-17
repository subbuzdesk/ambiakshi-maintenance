@echo off
setlocal enabledelayedexpansion

:: Navigate to script directory parent (project root)
cd /d "%~dp0\.."

echo ===================================================================== >> logs\daily_run.log
echo Running Ambiakshi Daily Maintenance at %date% %time% >> logs\daily_run.log
echo ===================================================================== >> logs\daily_run.log

if not exist logs mkdir logs

:: Run the maintenance suite
call npx tsx src/jobs/daily-maintenance.ts >> logs\daily_run.log 2>&1

set EXIT_CODE=%ERRORLEVEL%
echo Finished with exit code %EXIT_CODE% at %date% %time% >> logs\daily_run.log

exit /b %EXIT_CODE%
