@echo off
setlocal enabledelayedexpansion

:: Navigate to script directory parent (project root)
cd /d "%~dp0\.."

if not exist logs mkdir logs
if not exist backups mkdir backups

echo ===================================================================== >> logs\backup_run.log
echo Running Ambiakshi Full Disaster Recovery Backup at %date% %time% >> logs\backup_run.log
echo ===================================================================== >> logs\backup_run.log

:: Run the full backup suite (Supabase + Git bundles + Secret escrow + Pruning)
call npx tsx src/jobs/backup-all.ts >> logs\backup_run.log 2>&1

set EXIT_CODE=%ERRORLEVEL%
echo Backup suite finished with exit code %EXIT_CODE% at %date% %time% >> logs\backup_run.log

exit /b %EXIT_CODE%
