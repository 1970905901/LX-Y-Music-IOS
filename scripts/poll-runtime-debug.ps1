# Poll the iOS Runtime Debug workflow until the newest run (after a known run id) completes.
# ASCII-only file (PowerShell 5.1 mis-parses BOM-less UTF-8 Chinese comments).
# Usage: poll-runtime-debug.ps1 -Repo <owner/name> -KnownRunId <id> [-TimeoutMin 40]
param(
  [string]$Repo = '1970905901/LX-Y-Music-IOS',
  [string]$KnownRunId = '36250400220',
  [int]$TimeoutMin = 40
)
$ErrorActionPreference = 'Continue'

$gitExe = 'D:\git\PortableGit\bin\git.exe'
$ghExe = 'C:\Program Files\GitHub CLI\gh.exe'
$url = & $gitExe remote get-url origin
$token = ($url -replace 'https://', '' -replace '@github.com.*', '')
$env:GH_TOKEN = $token

$deadline = (Get-Date).AddMinutes($TimeoutMin)
$runId = ''
while ((Get-Date) -lt $deadline) {
  $out = & $ghExe run list --repo $Repo --workflow 'iOS Runtime Debug' --limit 1 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $out) { Start-Sleep -Seconds 20; continue }
  $parts = $out -split "`t"
  if ($parts[6] -ne $KnownRunId) {
    $runId = $parts[6]
    Write-Host ("RUN " + $runId + " " + $parts[0] + " " + $parts[1])
    if ($parts[0] -eq 'completed') { break }
  }
  Start-Sleep -Seconds 20
}
if ($runId -eq '') { Write-Host 'NO_NEW_RUN'; exit 1 }
Write-Host ("FINAL " + $runId)
