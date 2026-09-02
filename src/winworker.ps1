# Worker persistente do SideNotch (Windows PowerShell 5.1)
# Emite uma linha JSON a cada ~2 s com: mídia em reprodução (SMTC), rede (bytes/s) e discos (a cada 30 s).
# Lê comandos de um arquivo (arg 1): play | pause | toggle | next | prev  (stdin redirecionado bloqueia no Peek)
param([string]$CmdFile = "$env:TEMP\sidenotch-media.cmd")
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
$asStreamForRead = ([System.IO.WindowsRuntimeStreamExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsStreamForRead' -and $_.GetParameters().Count -eq 1 })[0]
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, $type) {
  $m = $asTaskGeneric.MakeGenericMethod($type)
  $t = $m.Invoke($null, @($op)); $t.Wait(3000) | Out-Null; return $t.Result
}

$mgr = $null
function Get-Manager {
  if ($script:mgr) { return $script:mgr }
  try { $script:mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]) } catch {}
  return $script:mgr
}

$lastTrack = ''
function Get-Thumb($p) {
  # capa do álbum (IRandomAccessStreamReference) → base64; só é chamada quando a faixa muda
  try {
    if (-not $p.Thumbnail) { return $null }
    $ras = Await ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    if (-not $ras) { return $null }
    # o objeto vem como __ComObject: chama AsStreamForRead(IInputStream) por reflexão
    $stream = $asStreamForRead.Invoke($null, [object[]]@($ras))
    $ms = New-Object System.IO.MemoryStream; $stream.CopyTo($ms)
    $bytes = $ms.ToArray(); $stream.Dispose(); $ms.Dispose()
    if ($bytes.Length -lt 100 -or $bytes.Length -gt 900000) { return $null }
    $ct = 'image/jpeg'; if ($bytes[0] -eq 137 -and $bytes[1] -eq 80) { $ct = 'image/png' } elseif ($bytes[0] -eq 71 -and $bytes[1] -eq 73) { $ct = 'image/gif' } elseif ($bytes[0] -eq 82 -and $bytes[1] -eq 73) { $ct = 'image/webp' }
    return "data:$ct;base64," + [Convert]::ToBase64String($bytes)
  } catch { return $null }
}
function Get-Media {
  $m = Get-Manager; if (-not $m) { return $null }
  $s = $m.GetCurrentSession(); if (-not $s) { return $null }
  try {
    $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
    $pb = $s.GetPlaybackInfo(); $tl = $s.GetTimelineProperties()
    $key = "$($p.Title)|$($p.Artist)|$($p.AlbumTitle)"
    $thumb = $null
    if ($key -ne $script:lastTrack) { $script:lastTrack = $key; $thumb = Get-Thumb $p; if (-not $thumb) { $thumb = '' } }
    $o = @{ app = $s.SourceAppUserModelId; title = $p.Title; artist = $p.Artist; album = $p.AlbumTitle;
            status = [string]$pb.PlaybackStatus; position = [int]$tl.Position.TotalSeconds; duration = [int]$tl.EndTime.TotalSeconds;
            canNext = $pb.Controls.IsNextEnabled; canPrev = $pb.Controls.IsPreviousEnabled }
    if ($thumb -ne $null) { $o.thumb = $thumb }
    return $o
  } catch { return $null }
}

function Do-Media($cmd) {
  $m = Get-Manager; if (-not $m) { return }
  $s = $m.GetCurrentSession(); if (-not $s) { return }
  switch ($cmd) {
    'play'   { $null = $s.TryPlayAsync() }
    'pause'  { $null = $s.TryPauseAsync() }
    'toggle' { $null = $s.TryTogglePlayPauseAsync() }
    'next'   { $null = $s.TrySkipNextAsync() }
    'prev'   { $null = $s.TrySkipPreviousAsync() }
  }
}

$prevNet = $null; $prevT = Get-Date; $tick = 0; $disks = @()
while ($true) {
  # comandos pendentes
  if (Test-Path $CmdFile) { $cmds = Get-Content $CmdFile; Remove-Item $CmdFile -Force; foreach ($c in $cmds) { if ($c) { Do-Media $c.Trim() } } }

  $now = Get-Date
  $net = Get-NetAdapterStatistics | Measure-Object -Property ReceivedBytes, SentBytes -Sum
  $rx = ($net | Where-Object Property -eq 'ReceivedBytes').Sum; $tx = ($net | Where-Object Property -eq 'SentBytes').Sum
  $dt = ($now - $prevT).TotalSeconds; if ($dt -le 0) { $dt = 2 }
  $down = 0; $up = 0
  if ($prevNet) { $down = [math]::Max(0, ($rx - $prevNet[0]) / $dt); $up = [math]::Max(0, ($tx - $prevNet[1]) / $dt) }
  $prevNet = @($rx, $tx); $prevT = $now

  if ($tick % 15 -eq 0) {
    $disks = @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object { @{ name = $_.DeviceID; total = [long]$_.Size; free = [long]$_.FreeSpace } })
  }
  $tick++

  $out = @{ media = (Get-Media); net = @{ down = [long]$down; up = [long]$up }; disks = $disks; t = [long]([double]::Parse((Get-Date -UFormat %s))) }
  [Console]::Out.WriteLine(($out | ConvertTo-Json -Compress -Depth 4))
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 2000
}
