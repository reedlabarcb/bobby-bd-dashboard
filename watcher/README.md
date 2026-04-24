# Bobby BD Box Watcher

Background script that watches one or more local Box Drive folders for new files and pushes them to the Bobby BD Dashboard (on Railway). Reuses the filesystem-sync pattern from Golf BD — no Box API, no OAuth, no IT approval needed.

## How it works

1. Bobby shares folders with you (Reed) in Box as a **read-only collaborator**.
2. Box Drive mirrors those folders to your laptop at `C:\Users\RLabar\Box\<folder name>\`.
3. This watcher runs on your laptop, recursively scanning those paths.
4. For each new file it uploads to the Railway dashboard:
   - `.pdf` → `/api/process-document` — Claude parses OMs into tenants, leases, property details
   - `.xlsx` / `.xls` → `/api/auto-import-contacts` — auto-mapped column import, upsert by email
5. Dashboard updates within ~60 seconds of Bobby dropping a file in his Box folder.

## Setup (one-time)

### Prerequisites

- **Node.js 18+** (`node --version` to check; install from [nodejs.org](https://nodejs.org/) if missing)
- **Box Drive** installed and logged into your CBRE Box account
- Bobby has shared one or more folders with you; they appear under `C:\Users\<you>\Box\`

### Configure

1. Open `start-watcher.bat` in Notepad.
2. Edit the three `SET` lines:
   - `WATCH_DIRS` — comma-separated absolute paths (no spaces around commas). Each should be a folder Bobby shared that's synced locally. Example:
     `C:\Users\RLabar\Box\Bobby-OMs,C:\Users\RLabar\Box\Bobby-Contacts`
   - `UPLOAD_BASE` — the Railway URL, e.g. `https://bobby-bd-dashboard-production.up.railway.app`. **No trailing slash, no `/api`.**
   - `UPLOAD_SECRET` — must match the `UPLOAD_SECRET` env var set on the Railway service.
3. Save and close.

### First run

Double-click `start-watcher.bat`. A terminal window opens with live logs:

```
Bobby BD Box Watcher
Watching 2 folder(s):
  - C:\Users\RLabar\Box\Bobby-OMs
  - C:\Users\RLabar\Box\Bobby-Contacts
Upload base: https://bobby-bd-dashboard-production.up.railway.app
Manifest: ...\.watcher-manifest.json
Poll: 30000ms

[upload] Sunset Harbor OM.pdf
[upload] Q1 contacts.xlsx
[done]   2 new file(s)
```

Drop a test file in one of the watched folders. Within ~30 seconds you should see `[upload] <filename>`, then confirm it on the dashboard (`/library` for PDFs, `/contacts` for Excel imports).

### Auto-start on login

1. `Win + R` → `shell:startup` → Enter (folder opens)
2. Right-click → New → Shortcut → browse to `start-watcher.bat`
3. Reboot or log in fresh — watcher launches automatically.

## What gets uploaded

| File type | Endpoint | Behavior |
|-----------|----------|----------|
| `.pdf` | `/api/process-document` | Document record created, Claude extracts tenants + leases + property. Appears on `/library`, `/leases`, `/map`. |
| `.xlsx` / `.xls` | `/api/auto-import-contacts` | Auto-detects Name, Email, Phone, Company, Title, City, State, Notes columns. Upserts by email (falls back to name + company). Appears on `/contacts`. |
| Anything else | skipped | Word docs, images, etc. are ignored until we add a handler. |

Hidden files, Office temp lock files (`~$...`), `desktop.ini`, and `thumbs.db` are always ignored.

## Operation notes

- **Already-uploaded tracking** — files are hashed with SHA-256; the hash goes in `.watcher-manifest.json` alongside the script. Delete the manifest to force re-upload of everything.
- **Content-based dedup** — if Bobby renames a file, same content = same hash = not re-uploaded. If he edits + saves, new content = new hash = fresh upload.
- **Recursive** — subfolders are walked automatically. He can organize OMs however he wants.
- **Offline / asleep** — if your laptop is off, Box queues updates in the cloud. When you're back online, Box syncs down and the watcher processes the backlog on the next poll.
- **Retry** — failed uploads are re-attempted on the next 30-second poll until they succeed.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Missing config. Set WATCH_DIRS and UPLOAD_BASE` | The `.bat` wasn't edited. Open it in Notepad and set the three values. |
| `401 Invalid upload secret` | `UPLOAD_SECRET` mismatch. Check the Railway service variable matches what's in `start-watcher.bat`. |
| `400 Could not find a Name column` | The Excel file has unusual headers the auto-mapper didn't recognize. Rename the column to "Name" or add a "Full Name" column. |
| `ENOENT` / folder not found | Box Drive hasn't synced the folder to your laptop yet, or the path is wrong. Open the path in File Explorer to verify. |
| Files in folder but nothing uploads | Confirm they're `.pdf`/`.xlsx`/`.xls` — other types are skipped. Check the manifest to see if they were previously uploaded (same hash = skipped). |
| `Application failed to respond` | Railway service is down. Check deploy status on railway.app. |
