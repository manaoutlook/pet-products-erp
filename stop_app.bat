@echo off
REM Batch script to stop the Smart ERP application

echo Stopping the application...
REM Kill any existing Node.js processes
taskkill /IM node.exe /F 2>nul

echo.
echo ========================================================
echo   Application fully stopped.
echo ========================================================
echo.
pause
