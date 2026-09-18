@echo off
setlocal enabledelayedexpansion

:: Navigate to script directory parent (project root)
cd /d "%~dp0\.."

if not exist logs mkdir logs

:: Run the repository synchronization script with live console output
call npx tsx scripts/sync-repos.ts %*

set EXIT_CODE=%ERRORLEVEL%
echo.
echo Sync finished with exit code %EXIT_CODE% at %date% %time% >> logs\repo_sync.log

:: If launched by double-clicking in Explorer, keep window open so results are readable
echo %cmdcmdline% | find /i "%~f0" >nul
if %errorlevel%==0 (
    echo.
    echo Press any key to exit...
    pause >nul
)

exit /b %EXIT_CODE%
