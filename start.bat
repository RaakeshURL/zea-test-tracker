@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Install Node.js LTS and run this file again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
echo Starting ZEA CRM Test Tracker...
start "" cmd /c "node server.js"
timeout /t 2 /nobreak >nul
start "" http://localhost:3000
