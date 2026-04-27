# One-shot sync of every today's-data import + broker cleanup against Railway prod.
#
# Run this from a PowerShell prompt:
#
#   $env:UPLOAD_SECRET = "paste-the-secret-here"
#   .\scripts\sync-railway.ps1
#
# Idempotent - re-running is safe (each endpoint dedups). Step 1 (Centerpoint)
# is intentionally skipped: it was imported into prod earlier this week.
#
# Order:
#   2) LXD spreadsheet                     POST /api/import-prospecting-sheet
#   4) Master Office Lease Comps           POST /api/import-master-comps
#   5) Per-city CSVs (6 files in one POST) POST /api/import-percity-comps
#   7) Bob.zip client-folder manifest      POST /api/import-client-folders
#   X) Delete contacts where type='broker' DELETE /api/admin/delete-brokers

param(
  [string]$BaseUrl = 'https://bobby-bd-dashboard-production.up.railway.app',
  [string]$DownloadsDir = 'C:\Users\RLabar\Downloads',
  [string]$ManifestPath = 'C:\Users\RLabar\bobby-bd-dashboard\data\_bob-manifest.json'
)

if (-not $env:UPLOAD_SECRET) {
  Write-Output 'ERROR: $env:UPLOAD_SECRET is not set. Set it first:'
  Write-Output '  $env:UPLOAD_SECRET = "the-secret-from-Railway-Variables"'
  exit 1
}

$lxd        = "C:\Users\RLabar\bobby-bd-dashboard\tmp\Bobby Cowan LXD's.xlsx"
$master     = Join-Path $DownloadsDir 'Master_Office_Lease_Comps_All_Tenants_Decision_Makers.xlsx'
$percityDir = Join-Path $DownloadsDir 'bob-percity-comps'

# Sanity check every input before firing any request.
$inputs = @($lxd, $master, $ManifestPath)
foreach ($p in $inputs) {
  if (-not (Test-Path -LiteralPath $p)) {
    Write-Output "ERROR: missing input file: $p"
    exit 1
  }
}
if (-not (Test-Path -LiteralPath $percityDir)) {
  Write-Output "ERROR: missing per-city dir: $percityDir"
  exit 1
}
$percityFiles = Get-ChildItem -LiteralPath $percityDir -Filter '*.csv' | Sort-Object Name
if ($percityFiles.Count -eq 0) {
  Write-Output "ERROR: no .csv files in $percityDir"
  exit 1
}

function Run-Step {
  param([string]$Label, [scriptblock]$Body)
  Write-Output ''
  Write-Output ("=== {0} ===" -f $Label)
  $t0 = Get-Date
  & $Body
  if ($LASTEXITCODE -ne 0) {
    Write-Output ("FAILED ({0}) - exit code {1}. Stopping." -f $Label, $LASTEXITCODE)
    exit $LASTEXITCODE
  }
  $dt = (Get-Date) - $t0
  Write-Output ("done in {0:n1}s" -f $dt.TotalSeconds)
}

# Step 2: LXD
Run-Step -Label 'Step 2 - LXD spreadsheet' -Body {
  curl.exe -fsS -X POST `
    -H "X-Upload-Secret: $env:UPLOAD_SECRET" `
    -F "file=@$lxd" `
    "$BaseUrl/api/import-prospecting-sheet"
  Write-Output ''
}

# Step 4: Master Office Lease Comps
Run-Step -Label 'Step 4 - Master Office Lease Comps' -Body {
  curl.exe -fsS -X POST `
    -H "X-Upload-Secret: $env:UPLOAD_SECRET" `
    -F "file=@$master" `
    "$BaseUrl/api/import-master-comps"
  Write-Output ''
}

# Step 5: Per-city CSVs (one POST, multiple files)
Run-Step -Label "Step 5 - Per-city CSVs ($($percityFiles.Count) files)" -Body {
  $curlArgs = @('-fsS', '-X', 'POST', '-H', "X-Upload-Secret: $env:UPLOAD_SECRET")
  foreach ($f in $percityFiles) {
    $curlArgs += @('-F', "file=@$($f.FullName)")
  }
  $curlArgs += "$BaseUrl/api/import-percity-comps"
  & curl.exe @curlArgs
  Write-Output ''
}

# Step 7: Client folders manifest (JSON body)
Run-Step -Label 'Step 7 - Bob.zip client-folder manifest' -Body {
  curl.exe -fsS -X POST `
    -H "X-Upload-Secret: $env:UPLOAD_SECRET" `
    -H 'Content-Type: application/json' `
    --data-binary "@$ManifestPath" `
    "$BaseUrl/api/import-client-folders"
  Write-Output ''
}

# Cleanup: delete contacts WHERE type='broker'
Run-Step -Label 'Cleanup - delete contacts where type=broker' -Body {
  curl.exe -fsS -X DELETE `
    -H "X-Upload-Secret: $env:UPLOAD_SECRET" `
    "$BaseUrl/api/admin/delete-brokers"
  Write-Output ''
}

Write-Output ''
Write-Output 'All done. Refresh the Railway URL to see the synced data.'
