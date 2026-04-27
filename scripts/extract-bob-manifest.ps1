# Walks Bob.zip and writes a manifest of <year>/<client>/<file> entries.
# This script does NOT extract any file bodies — it only reads the zip's central
# directory, which is fast and doesn't need the 6GB of disk space.
param(
  [string]$ZipPath = 'C:\Users\RLabar\Downloads\Bob.zip',
  [string]$Out = 'C:\Users\RLabar\bobby-bd-dashboard\data\_bob-manifest.json',
  [int[]]$Years = @(2024, 2025, 2026)
)

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
try {
  $manifest = @{}
  foreach ($entry in $zip.Entries) {
    if ($entry.FullName -match '/$') { continue }
    $parts = $entry.FullName -split '/'
    if ($parts.Count -lt 3) { continue }
    if ($parts[0] -ne 'Bob') { continue }
    $yearStr = $parts[1]
    if (-not ($yearStr -match '^\d{4}$')) { continue }
    $year = [int]$yearStr
    if ($Years -notcontains $year) { continue }
    $client = $parts[2]
    # Skip "loose" docx files at the year level (where parts[2] looks like a filename)
    if ($client -match '\.(docx|doc|pdf|xlsx|csv|jpg|png)$') { continue }

    $key = "$year/$client"
    if (-not $manifest.ContainsKey($key)) {
      $manifest[$key] = @{
        year = $year
        client = $client
        files = New-Object System.Collections.ArrayList
      }
    }
    # Keep the relative path INSIDE the client folder (parts[3..])
    $relPath = ($parts[3..($parts.Count - 1)] -join '/')
    $ext = [System.IO.Path]::GetExtension($entry.FullName).ToLower()
    [void]$manifest[$key].files.Add(@{
      path = $relPath
      fullPath = $entry.FullName
      ext = $ext
      size = $entry.Length
      lastWrite = $entry.LastWriteTime.ToString('s')
    })
  }
  $deals = $manifest.Values | Sort-Object year, client
  $payload = @{ generatedAt = (Get-Date).ToString('s'); zipPath = $ZipPath; deals = $deals }
  $outDir = [System.IO.Path]::GetDirectoryName($Out)
  if ($outDir -and -not (Test-Path -LiteralPath $outDir)) {
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
  }
  $payload | ConvertTo-Json -Depth 6 | Out-File -FilePath $Out -Encoding utf8
  Write-Output ("Wrote manifest with {0} client folders to {1}" -f $deals.Count, $Out)
} finally {
  $zip.Dispose()
}
