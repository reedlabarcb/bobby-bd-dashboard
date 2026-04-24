@echo off
REM Bobby BD Box Watcher launcher
REM Edit the three SET lines below with your values, then double-click this file.
REM See README.md for details.

cd /d "%~dp0"

REM ----- Edit these values -----

REM One or more absolute paths, comma-separated. No spaces around commas.
REM These should be folders inside C:\Users\<you>\Box\ that Bobby has shared
REM with you as a Box collaborator.
set WATCH_DIRS=C:\Users\RLabar\Box\SHARED_FOLDER_1,C:\Users\RLabar\Box\SHARED_FOLDER_2

REM Base URL of the Railway app. NO trailing slash, NO /api.
set UPLOAD_BASE=https://bobby-bd-dashboard-production.up.railway.app

REM Shared secret — must match UPLOAD_SECRET on Railway.
set UPLOAD_SECRET=PASTE_SHARED_SECRET_FROM_RAILWAY_HERE

REM -----------------------------

REM Optional: change the poll interval (default 30000ms / 30s)
REM set POLL_MS=30000

node box-watcher.mjs

REM Keep window open if it crashes so errors are visible
pause
