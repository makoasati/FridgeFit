@echo off
rem FridgeFit: double-click to start the app on Windows.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org and then double-click this file again.
  pause
  exit /b
)
if not exist node_modules (
  echo Installing what the app needs, one time only...
  call npm install
)
if not exist .env copy .env.example .env >nul
start "" http://localhost:3000
node server.js
pause
