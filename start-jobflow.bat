@echo off
echo ==============================================
echo   JobFlow — AI Job Application Cockpit
echo ==============================================
echo.

REM Check if node_modules exists, if not run setup
if not exist "node_modules\" (
    echo [INFO] First time setup detected. Running setup...
    call setup.bat
)

echo [INFO] Starting JobFlow server...
echo [INFO] Waiting for server to start...
timeout /t 2 /nobreak >nul

echo [INFO] Opening JobFlow in your default browser...
start http://localhost:3000

echo.
echo JobFlow is running! Keep this window open.
echo To stop JobFlow, close this window or press Ctrl+C.
echo.

REM Keep window open to see logs
node server.js
