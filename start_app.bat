@echo off
REM Batch script to start the pet products ERP application
REM This script kills any existing development server processes and then starts a new one

REM Kill any existing Node.js processes to avoid port conflicts
taskkill /IM node.exe /F 2>nul

REM Start the development server in background
start "" cmd /c "npm run dev"

REM Wait a few seconds for the server to spin up
timeout /t 5 /nobreak >nul

REM Display the application access URL prominently
echo.
echo ========================================================
echo   Application started. Access it at: http://localhost:5001
echo ========================================================
echo.
pause
