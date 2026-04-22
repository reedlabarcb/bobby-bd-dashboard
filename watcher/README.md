# Bobby BD Box Watcher

Small background script that watches a local Box Drive folder for new PDFs and uploads them to the Bobby BD Dashboard (hosted on Railway) for AI processing. Works around needing a Box OAuth app — as long as the machine running this script has Box Drive installed, no API credentials are required.

## How it works

1. Box Drive syncs Bobby's OM folder from Box cloud to a local path (e.g. `C:\Users\bobby\Box\Offering Memos\`).
2. This watcher runs in the background on Bobby's laptop, scanning the folder on startup and whenever filesystem events fire.
3. New PDFs get uploaded via HTTPS to the dashboard's `/api/process-document` endpoint, authenticated with a shared secret.
4. The dashboard runs the Claude AI extraction pipeline and stores tenants, leases, property details in SQLite. Results appear on `/library`, `/leases`, and `/map` in the web UI.

## Setup (one-time)

### Prerequisites
- **Node.js 18 or newer** installed (`node --version` to check). If missing, install from [nodejs.org](https://nodejs.org/).
- **Box Drive** installed and logged into Bobby's CBRE Box account.
- The folder you want to watch is being synced locally (not a "cloud-only" folder).

### Configure

1. Open `start-watcher.bat` in Notepad.
2. Edit the three `SET` lines near the top:
   - `WATCH_DIR` — absolute path to the Box folder with OMs (e.g. `C:\Users\bobby.example\Box\Offering Memos`)
   - `UPLOAD_URL` — your Railway URL + `/api/process-document` (e.g. `https://bobby-bd-dashboard-production.up.railway.app/api/process-document`)
   - `UPLOAD_SECRET` — must match the `UPLOAD_SECRET` env var set on the Railway service. Generate a long random string (e.g. `openssl rand -hex 32` or use any password manager).
3. Save and close.

### Test run

Double-click `start-watcher.bat`. A terminal window opens and shows:

```
Bobby BD Box Watcher
Watch dir: C:\Users\...\Box\Offering Memos
Upload URL: https://.../api/process-document
...
[upload] Sunset Harbor OM.pdf
[done]   1 new file(s) uploaded
```

Drop a test PDF into the watched folder. Within ~30 seconds you should see `[upload] <filename>` and then confirm it appears on the dashboard's `/library` page.

### Auto-start on login

1. Press `Win + R`, type `shell:startup`, press Enter. A folder opens.
2. Right-click in the folder → New → Shortcut.
3. Point the shortcut at `start-watcher.bat`.
4. Next time Bobby logs in, the watcher starts automatically.

## Operation

- A terminal window stays open with live log output. Minimize it.
- Already-uploaded files are tracked by SHA-256 hash in `.watcher-manifest.json` alongside the script. Delete this file if you want to re-upload everything.
- If the dashboard is down or the laptop is offline, files queue locally. The watcher retries on the next 30-second poll tick and on the next filesystem event, so no data is lost.
- If you rename a file in Box, the watcher treats it as a new file and re-uploads it (hash is unchanged, so the manifest catches this — same content = not re-uploaded).

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Missing config. Set WATCH_DIR...` | The `.bat` wasn't edited. Open it in Notepad and set all three values. |
| `upload failed: 401` | `UPLOAD_SECRET` on the laptop doesn't match Railway. Check both. |
| `upload failed: 400 ANTHROPIC_API_KEY not configured` | Set `ANTHROPIC_API_KEY` on the Railway service. |
| `ENOENT` on the watch directory | The path doesn't exist or Box Drive hasn't synced it yet. Open the path in File Explorer to confirm. |
| Nothing uploads, no errors | Confirm the folder actually contains `.pdf` files, not Office files, images, or Box placeholders. |
