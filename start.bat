@echo off
setlocal
title Habits - dev server
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install it from https://nodejs.org and run this file again.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing dependencies...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

if not exist ".env" (
  echo No .env found - running in local-only mode. Copy .env.example to .env to enable Supabase and Google Calendar.
)

echo Starting dev server at http://localhost:5173 ...
start "" "http://localhost:5173"
call npm run dev

endlocal
