@echo off
setlocal enabledelayedexpansion

:: Navigate to script directory parent (project root)
cd /d "%~dp0\.."

if not exist logs mkdir logs

echo ===================================================================== >> logs\mobile_games_run.log
echo Running Ambiakshi Mobile Games Maintenance at %date% %time% >> logs\mobile_games_run.log
echo ===================================================================== >> logs\mobile_games_run.log

:: Run the mobile games maintenance suite
call npx tsx src/jobs/mobile-games-maintenance.ts >> logs\mobile_games_run.log 2>&1

set EXIT_CODE=%ERRORLEVEL%
echo Finished with exit code %EXIT_CODE% at %date% %time% >> logs\mobile_games_run.log

exit /b %EXIT_CODE%
