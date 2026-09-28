# LiquidGlassKit (vendored)

Upstream: https://github.com/DnV1eX/LiquidGlassKit — Copyright (c) 2025 DnV1eX

The upstream repository ships no standalone LICENSE file (README states
"Copyright (c) 2025 DnV1eX" and the project is publicly published on GitHub
for use). This vendored copy keeps upstream attribution in every modified
file header and in this notice. If you redistribute this application,
preserve this file.

## Why vendored instead of SPM

Upstream only supports Swift Package Manager (swift-tools-version 6.2, needs
Xcode 26 / Swift 6.2). This project integrates the package as a local
CocoaPods pod (`ios/Vendor/LiquidGlassKit`) — CI builds on `macos-26`
(Xcode 26 / Swift 6.2) with CocoaPods and no `use_frameworks!` — with these
changes:

| # | Change | Reason |
|---|--------|--------|
| 1 | `internal import X` → `import X` (LiquidGlassView.swift) | `internal import` is Swift 6.0+ syntax; Swift 5.10 cannot parse it |
| 2 | iOS 26 `UIGlassEffect` support behind `#if compiler(>=6.2)` + runtime availability (LGGlassViewFactory.swift) | Upstream references iOS 26-only types unguarded. The factory picks native `UIGlassEffect` on iOS 26+ when available and falls back to `UIBlurEffect(.systemMaterial)` otherwise (both system materials, chosen by version band per app decision) |
| 3 | Shader loading → `MTLDevice.makeLibrary(source:)` with embedded MSL (`LiquidGlassShaderSource.swift`) | Upstream loads a SwiftPM-precompiled `default.metallib`; a CocoaPods static lib has no resource bundle and CI must not run a Metal compile step. Runtime compilation happens on-device |
| 4 | Added `@objc convenience init()`, `setGlassTintColor(_:)`, `setIsDarkMode(_:)` and backing-rebuild plumbing (LiquidGlassEffectView.swift) | React Native view-manager bridge needs ObjC-visible entry points |
| 5 | Added `LiquidGlassViewManager.mm` | Registers the `LiquidGlassView` native component for RN Paper |
| 6 | LiquidLensView included with changes; Slider / Switch sources not included | The lens pill drives the tab-switch liquid-glass morph (RN component `LiquidGlassLens`). Lens body stays aligned with upstream 2eb41c5 (`LiquidGlassView(.lens)` lift morph with resting-pill crossfade, multi-rect frames merging, touch-point glare): `internal import` fixed, lens entry points marked `@objc`, `LGLensFactory` added for ObjC construction — always the custom lens (matching upstream, which recreates `_UILiquidLensView` rather than calling it; an earlier experiment instantiating the private class on iOS 26+ was removed: it does not respond to this component's method surface, and an unguarded call crashes) |

## Runtime notes

- Shaders compile once per launch on first glass view creation (~tens of ms).
- The kit renders continuously (`MTKView`, `isPaused = false`), matching
  upstream. A demand-rendering layer existed in this fork for a while and
  was removed (commit a55e3b1) to stay aligned with upstream behavior.
- `MPSImageGaussianBlur` is unavailable on the iOS simulator — run on a real
  device.
- Uses the private `CABackdropLayer` (via `NSClassFromString`) on iOS < 26.2,
  same as upstream, with an availability guard that degrades to no backdrop.
  Relevant only for App Store review; this build is distributed as a
  CI-built unsigned IPA.

## Regenerating the embedded shaders

After updating the vendored sources from upstream, re-run:

```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/embed-liquid-glass-shaders.ps1
```

(source checkout expected at `D:\lgtk-tmp` — adjust `$src` inside the script)
