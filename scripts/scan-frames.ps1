# Scan extracted frames and print average brightness to locate black flash frames.
# ASCII-only (PowerShell 5.1 + BOM-less UTF-8 Chinese comments break parsing).
Add-Type -AssemblyName System.Drawing

$files = Get-ChildItem 'D:\lgtk-tmp\frames2\*.jpg' | Sort-Object Name
foreach ($f in $files) {
  $img = [System.Drawing.Image]::FromFile($f.FullName)
  $bmp = New-Object System.Drawing.Bitmap($img, [int]($img.Width / 6), [int]($img.Height / 6))
  $sum = 0.0
  $n = 0
  for ($y = 0; $y -lt $bmp.Height; $y += 4) {
    for ($x = 0; $x -lt $bmp.Width; $x += 4) {
      $p = $bmp.GetPixel($x, $y)
      $sum += ($p.R + $p.G + $p.B) / 3.0
      $n++
    }
  }
  $avg = [math]::Round($sum / $n, 1)
  Write-Host ($f.Name + ' avg=' + $avg)
  $bmp.Dispose()
  $img.Dispose()
}
