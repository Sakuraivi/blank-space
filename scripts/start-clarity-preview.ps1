param([int]$Port = 4192, [string]$ProjectRoot = (Split-Path $PSScriptRoot -Parent))
$ErrorActionPreference = 'Stop'
$previewRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$previewScript = Join-Path $previewRoot 'scripts/clarity-preview.mjs'
if (!(Test-Path -LiteralPath $previewScript) -or $Port -lt 1024 -or $Port -gt 65535) { throw 'Invalid preview project or port.' }
$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listener) { throw "Port $Port is already in use. Existing process was left running." }
$previewWork = Join-Path $previewRoot 'work'
New-Item -ItemType Directory -Path $previewWork -Force | Out-Null
$previewStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$env:LIUBAI_PREVIEW_PORT = "$Port"
$previewProcess = Start-Process -FilePath (Get-Command node).Source -ArgumentList @('scripts/clarity-preview.mjs') -WorkingDirectory $previewRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $previewWork "preview-$Port-$previewStamp.out.log") -RedirectStandardError (Join-Path $previewWork "preview-$Port-$previewStamp.err.log") -PassThru
@{pid=$previewProcess.Id;port=$Port;root=$previewRoot} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $previewWork "preview-$Port.json")
$healthy = $false
for ($previewTry=0; $previewTry -lt 20; $previewTry++) {
  try { $healthy = (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/api/ai/status" -TimeoutSec 2).StatusCode -eq 200; if ($healthy) { break } } catch {}
  Start-Sleep -Milliseconds 200
}
if (!$healthy) { throw "Preview process $($previewProcess.Id) started but is not healthy. See local work logs." }
Write-Output "Preview ready: http://localhost:$Port/ (background process $($previewProcess.Id))"
