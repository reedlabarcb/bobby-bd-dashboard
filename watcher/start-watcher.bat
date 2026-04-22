@echo off
REM Bobby BD Box Watcher launcher
REM Edit the three SET lines below with your values, then double-click this file.
REM See README.md for details.

cd /d "%~dp0"

REM ----- Edit these three values -----
set WATCH_DIR=C:\Users\YOUR_USERNAME\Box\YOUR_OM_FOLDER
set UPLOAD_URL=https://bobby-bd-dashboard-production.up.railway.app/api/process-document
set UPLOAD_SECRET=PASTE_SHARED_SECRET_FROM_RAILWAY_HERE
REM -----------------------------------

REM Optional: change the poll interval (default 30000ms / 30s)
REM set POLL_MS=30000

node box-watcher.mjs

REM Keep window open if it crashes so errors are visible
pause
