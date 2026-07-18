@echo off
echo ==============================================
echo   JobFlow — First Time Setup
echo ==============================================
echo.
echo [INFO] Installing dependencies...
call npm install

echo [INFO] Initializing PostgreSQL database...
call node db/init.js

echo.
echo ==============================================
echo   Setup Complete!
echo   You can now run start-jobflow.bat
echo ==============================================
pause
