$ErrorActionPreference = 'Stop'
Set-Location 'C:\Users\gosdo\Desktop\AI\Pay'

# --- read admin creds from .env without printing them
$envText = [IO.File]::ReadAllText((Resolve-Path '.env'), [Text.Encoding]::UTF8)
function EnvVal($k) {
  $m = [regex]::Match($envText, "(?m)^$k\s*=\s*(.+)$")
  if (-not $m.Success) { return $null }
  return $m.Groups[1].Value.Trim().Trim('"').Trim("'")
}
$adminUser = EnvVal 'ADMIN_USERNAME'
$adminPass = EnvVal 'ADMIN_PASSWORD'

# --- push every cron far into the future so nothing hits the DB/spends SOL
$env:PORT = '3100'
$env:LOTTERY_CRON = '0 0 1 1 *'
$env:HOLDER_SYNC_CRON = '0 0 1 1 *'
$env:CLAIM_CRON = '0 0 1 1 *'

$log = Join-Path $PWD '__tmp_next.log'
$err = Join-Path $PWD '__tmp_next.err'
Remove-Item $log, $err -ErrorAction SilentlyContinue

$p = Start-Process -FilePath 'node' `
  -ArgumentList 'node_modules/next/dist/bin/next', 'start', '-p', '3100' `
  -RedirectStandardOutput $log -RedirectStandardError $err -PassThru -WindowStyle Hidden

$base = 'http://127.0.0.1:3100'
$up = $false
for ($i = 0; $i -lt 90; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $r = Invoke-WebRequest "$base/api/status" -TimeoutSec 3 -UseBasicParsing
    if ($r.StatusCode -eq 200) { $up = $true; break }
  } catch { }
}
"server up: $up (pid $($p.Id))"
if (-not $up) { Get-Content $err -ErrorAction SilentlyContinue; Get-Content $log -ErrorAction SilentlyContinue; exit 1 }

# --- login (cookie jar)
$jar = Join-Path $PWD '__tmp_cookie.txt'
Remove-Item $jar -ErrorAction SilentlyContinue
$body = @{ username = $adminUser; password = $adminPass } | ConvertTo-Json -Compress
$login = curl.exe -s -o NUL -w '%{http_code}' -c $jar -X POST "$base/api/admin/login" -H 'content-type: application/json' --data-binary $body
"login: $login"

function Time-Url($path, $runs = 3) {
  $times = @()
  foreach ($i in 1..$runs) {
    $out = curl.exe -s -o NUL -b $jar -w '%{http_code} %{time_total}' "$base$path"
    $parts = $out -split ' '
    $times += [pscustomobject]@{ code = $parts[0]; ms = [math]::Round([double]$parts[1] * 1000) }
  }
  $warm = ($times | Select-Object -Skip 1)
  $avg = if ($warm.Count) { [math]::Round(($warm | Measure-Object -Property ms -Average).Average) } else { 0 }
  "{0,-32} first={1,6}ms  warm_avg={2,6}ms  codes={3}" -f $path, $times[0].ms, $avg, (($times | ForEach-Object { $_.code }) -join ',')
}

'--- HTML routes'
Time-Url '/'
Time-Url '/draws'
Time-Url '/admin'
'--- public APIs'
Time-Url '/api/status'
Time-Url '/api/rounds'
Time-Url '/api/stats'
Time-Url '/api/eligibility'
'--- admin APIs'
Time-Url '/api/admin/info'
Time-Url '/api/admin/holders'
Time-Url '/api/admin/logs'
Time-Url '/api/admin/creator-fees'

'--- payload sizes (bytes)'
foreach ($u in '/api/rounds', '/api/eligibility', '/api/admin/holders', '/api/admin/info', '/api/admin/creator-fees') {
  $sz = curl.exe -s -o NUL -b $jar -w '%{size_download}' "$base$u"
  "{0,-32} {1} bytes" -f $u, $sz
}

'--- startup log'
Get-Content $log -ErrorAction SilentlyContinue | Select-String '\[net\]|\[cron\]|started server|Ready' | ForEach-Object { $_.Line }
if (Test-Path $err) { Get-Content $err | Select-Object -First 10 }

Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500
Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*node.exe' } | ForEach-Object { }
