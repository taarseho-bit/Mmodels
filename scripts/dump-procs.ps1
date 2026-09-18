$out = "D:/mathmodel-desktop/.workbuddy/ui-audit/procs.txt"
$procs = Get-CimInstance Win32_Process -Filter "Name='mathmodel.exe' OR Name='MModels.exe'"
$lines = @()
foreach ($p in $procs) {
  $cl = $p.CommandLine
  if ($null -eq $cl) { $cl = "" }
  $lines += "$($p.ProcessId)`t$($cl.Substring(0, [Math]::Min(160, $cl.Length)))"
}
$ports = netstat -ano | Select-String -Pattern "9361|9349|9351"
$lines += "--- ports ---"
foreach ($l in $ports) { $lines += $l.ToString().Trim() }
Set-Content -Path $out -Value $lines -Encoding UTF8
