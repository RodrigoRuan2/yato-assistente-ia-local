param([int]$RootId,[int]$Seconds=15,[string]$Label='sample')
$rows=@()
$lastCpu=$null
$lastTime=$null
for($i=0;$i -le $Seconds;$i++){
  $all=Get-CimInstance Win32_Process
  $ids=@($RootId)
  do{
    $new=@($all | Where-Object {$_.ParentProcessId -in $ids -and $_.ProcessId -notin $ids} | ForEach-Object {[int]$_.ProcessId})
    $ids+=$new
  }while($new.Count -gt 0)
  $yato=@(Get-Process -Id $ids -ErrorAction SilentlyContinue | Where-Object {$_.ProcessName -notmatch '^ollama'})
  $engine=@(Get-Process -Name 'ollama*' -ErrorAction SilentlyContinue)
  $processes=@($yato)+@($engine)
  $cpu=($processes | Measure-Object CPU -Sum).Sum
  $now=Get-Date
  if($null -ne $lastCpu){
    $percent=[Math]::Max(0.0,[double](100*($cpu-$lastCpu)/($now-$lastTime).TotalSeconds/[Environment]::ProcessorCount))
    $rows += [PSCustomObject]@{ramMB=[Math]::Round(($processes | Measure-Object WorkingSet64 -Sum).Sum/1MB,1);yatoRamMB=[Math]::Round(($yato | Measure-Object WorkingSet64 -Sum).Sum/1MB,1);ollamaRamMB=[Math]::Round(($engine | Measure-Object WorkingSet64 -Sum).Sum/1MB,1);privateMB=[Math]::Round(($processes | Measure-Object PrivateMemorySize64 -Sum).Sum/1MB,1);cpuPercent=[Math]::Round($percent,2);processes=$processes.Count}
  }
  $lastCpu=$cpu;$lastTime=$now
  if($i -lt $Seconds){Start-Sleep -Seconds 1}
}
$models=@()
try{$models=@((Invoke-RestMethod 'http://127.0.0.1:11434/api/ps' -TimeoutSec 2).models | Select-Object name,size,size_vram)}catch{}
$gpu=& nvidia-smi --query-gpu=memory.used,utilization.gpu --format=csv,noheader,nounits 2>$null
[PSCustomObject]@{label=$Label;sampleCount=$rows.Count;ramMB=[Math]::Round(($rows | Measure-Object ramMB -Average).Average,1);yatoRamMB=[Math]::Round(($rows | Measure-Object yatoRamMB -Average).Average,1);ollamaRamMB=[Math]::Round(($rows | Measure-Object ollamaRamMB -Average).Average,1);privateMB=[Math]::Round(($rows | Measure-Object privateMB -Average).Average,1);cpuPercent=[Math]::Round(($rows | Measure-Object cpuPercent -Average).Average,2);models=$models;gpuSystemMBAndPercent=$gpu;rows=$rows} | ConvertTo-Json -Depth 5
