# Scan brightness of ONLY the bottom bar strip across frames to locate local dark flashes.
Add-Type -AssemblyName System.Drawing

$files = Get-ChildItem 'D:\lgtk-tmp\frames2\*.jpg' | Sort-Object Name
foreach ($f in $files) {
  $img = [System.Drawing.Image]::FromFile($f.FullName)
  $cropY = [int]($img.Height * 0.78)
  $cropH = $img.Height - $cropY
  $bmp = New-Object System.Drawing.Bitmap($img, [int]($img.Width / 4), [int]($cropH / 4))
  # bar strip occupies roughly y in [cropH*0.25, cropH*0.9] of the cropped area
  $sum = 0.0
  $n = 0
  $y0 = [int]($bmp.Height * 0.25)
  $y1 = [int]($bmp.Height * 0.9)
  for ($y = $y0; $y -lt $y1; $y += 2) {
    for ($x = 0; $x -lt $bmp.Width; $x += 2) {
      $p = $bmp.GetPixel($x, $y)
      $sum += ($p.R + $p.G + $p.B) / 3.0
      $n++
    }
  }
  $avg = [math]::Round($sum / $n, 1)
  Write-Host ($f.Name + ' bar=' + $avg)
  $bmp.Dispose()
  $img.Dispose()
}
