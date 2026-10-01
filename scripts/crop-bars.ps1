# Crop the bottom bar strip of transition frames for inspection.
Add-Type -AssemblyName System.Drawing

$targets = @('f020', 'f022', 'f024', 'f026', 'f028', 'f057', 'f058', 'f060', 'f063', 'f068', 'f073', 'f092', 'f094', 'f095', 'f100')
foreach ($t in $targets) {
  $src = "D:\lgtk-tmp\frames2\$t.jpg"
  if (-not (Test-Path $src)) { continue }
  $img = [System.Drawing.Image]::FromFile($src)
  # bottom 28% of the frame
  $cropY = [int]($img.Height * 0.72)
  $cropH = $img.Height - $cropY
  $bmp = New-Object System.Drawing.Bitmap($img.Width, $cropH)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.DrawImage($img, (New-Object System.Drawing.Rectangle(0, 0, $img.Width, $cropH)), (New-Object System.Drawing.Rectangle(0, $cropY, $img.Width, $cropH)), [System.Drawing.GraphicsUnit]::Pixel)
  $out = "D:\lgtk-tmp\frames2\bar-$t.png"
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
  $img.Dispose()
  Write-Host $out
}
