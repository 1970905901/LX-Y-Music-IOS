# Embed LiquidGlassKit .metal shaders as Swift string constants (vendored pod).
# Shaders are compiled on-device at runtime via MTLDevice.makeLibrary(source:),
# so CI needs no Metal compile step. Run from repo scripts/ dir.
# NOTE: ASCII-only file; PowerShell 5.1 mis-parses BOM-less UTF-8 Chinese comments.
$ErrorActionPreference = 'Stop'

$src = 'D:\lgtk-tmp\Sources\LiquidGlassKit'
$dstDir = Join-Path $PSScriptRoot '..\ios\Vendor\LiquidGlassKit\Sources'

$vert = (Get-Content (Join-Path $src 'LiquidGlassVertex.metal') -Raw).Trim()
$frag = (Get-Content (Join-Path $src 'LiquidGlassFragment.metal') -Raw).Trim()

# Strip "#include <simd/simd.h>": that is the CPU-side header and is not guaranteed to
# resolve in the on-device runtime shader compiler. All shader types used (float2, half2,
# float4, texture2d, sampler) come from <metal_stdlib>, which the runtime compiler provides.
$vert = ($vert -split "`n" | Where-Object { $_ -notmatch '^\s*#\s*include\s*<simd/simd\.h>' }) -join "`n"
$frag = ($frag -split "`n" | Where-Object { $_ -notmatch '^\s*#\s*include\s*<simd/simd\.h>' }) -join "`n"

$nl = [Environment]::NewLine
$header = "//`n" +
"// LiquidGlassShaderSource.swift`n" +
"// Vendored from DnV1eX/LiquidGlassKit (LiquidGlassVertex.metal / LiquidGlassFragment.metal).`n" +
"// Embedded as source and compiled at runtime via MTLDevice.makeLibrary(source:) on device:`n" +
"// the CI Xcode toolchain needs no Metal compile step and no metallib resource bundle.`n" +
"// (Upstream loads a SwiftPM-precompiled default.metallib, unusable in a CocoaPods static lib.)`n" +
"//`n" +
"$nl" +
"enum LiquidGlassShaderSource {$nl" +
"$nl" +
"    static let vertex = #`"`"`"$nl" +
"$vert$nl" +
"`"`"`"#$nl" +
"$nl" +
"    static let fragment = #`"`"`"$nl" +
"$frag$nl" +
"`"`"`"#$nl" +
"}$nl"

New-Item -ItemType Directory -Force -Path $dstDir | Out-Null
$dst = [IO.Path]::GetFullPath((Join-Path $dstDir 'LiquidGlassShaderSource.swift'))
# UTF-8 without BOM (Swift sources must not start with a BOM)
[IO.File]::WriteAllText($dst, $header, [Text.UTF8Encoding]::new($false))
if (-not (Test-Path -LiteralPath $dst)) { throw "write failed: $dst" }
$len = (Get-Item -LiteralPath $dst).Length
Write-Host "Written: $dst ($len bytes)"
