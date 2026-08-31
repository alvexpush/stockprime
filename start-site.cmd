@echo off
title Vanguard Prime Launcher
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js was not found. Install Node.js 24 or newer, then run this file again.
  echo.
  pause
  exit /b 1
)

echo Starting Vanguard Prime at http://localhost:3000
start "Vanguard Prime Server" cmd /k "cd /d ""%~dp0"" && node server.js"
timeout /t 2 /nobreak >nul
start "" "http://localhost:3000"
exit /b 0
