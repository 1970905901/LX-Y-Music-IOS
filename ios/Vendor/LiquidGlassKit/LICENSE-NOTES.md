# LiquidGlassKit (vendored)

Upstream: https://github.com/DnV1eX/LiquidGlassKit — Copyright (c) 2025 DnV1eX

The upstream repository ships no standalone LICENSE file (README states
"Copyright (c) 2025 DnV1eX" and the project is publicly published on GitHub
for use). This vendored copy keeps upstream attribution in every modified
file header and in this notice. If you redistribute this application,
preserve this file.

## Why vendored instead of SPM

Upstream only supports Swift Package Manager (swift-tools-version 6.2, needs
Xcode 26 / Swift 6.2). This project's CI builds on `macos-14` (Xcode 15.4,
Swift 5.10) with CocoaPods and no `use_frameworks!`. The package is therefore
integrated as a local CocoaPods pod (`ios/Vendor/LiquidGlassKit`) with these
changes:

| # | Change | Reason |
|---|--------|--------|
| 1 | `internal import X` → `import X` (LiquidGlassView.swift) | `internal import` is Swift 6.0+ syntax; Swift 5.10 cannot parse it |
| 2 | iOS 26 `UIGlassEffect` support behind `#if compiler(>=6.2)` + runtime availability (LGGlassViewFactory.swift) | Upstream references iOS 26-only types unguarded, which cannot compile on older SDKs. The factory picks native `UIGlassEffect` (and native `_UILiquidLensView` for the lens, private API — app is sideloaded, not App Store distributed) on iOS 26+ when built with Xcode 26, falling back to the custom Metal implementation on older OSes/toolchains |
| 3 | Shader loading → `MTLDevice.makeLibrary(source:)` with embedded MSL (`LiquidGlassShaderSource.swift`) | Upstream loads a SwiftPM-precompiled `default.metallib`; a CocoaPods static lib has no resource bundle and CI must not run a Metal compile step. Runtime compilation happens on-device |
| 4 | Added `@objc convenience init()`, `setPreferredFramesPerSecond(_:)`, `setGlassTintColor(_:)`, `setJsActive(_:)` (LiquidGlassEffectView.swift) | React Native view-manager bridge needs ObjC-visible entry points |
| 5 | Added `LiquidGlassViewManager.mm` | Registers the `LiquidGlassView` native component for RN Paper |
| 6 | LiquidLensView included with changes; Slider / Switch sources not included | The lens pill drives the tab-switch liquid-glass morph (RN component `LiquidGlassLens`): `internal import` fixed, `restingBackgroundColor`/`setLifted` marked `@objc`, `LGLensFactory` added for ObjC construction (tries native `_UILiquidLensView` on iOS 26+), and the lens's internal LiquidGlassView is wired to the demand-rendering clock (renders only while lifted) |
| 7 | Demand rendering: MTKView paused when inactive, active on mount window / JS pulses / window-level pan gestures (LiquidGlassView.swift, LiquidGlassEffectView.swift) | Upstream renders continuously (`isPaused = false`), which burns GPU/CPU 24/7. Pausing when nothing moves behind the glass removes the idle cost |

## Runtime notes

- Shaders compile once per launch on first glass view creation (~tens of ms).
- The kit renders continuously (`MTKView`, `isPaused = false`); JS throttles
  to 30 fps via the `fps` prop to limit battery impact.
- `MPSImageGaussianBlur` is unavailable on the iOS simulator — run on a real
  device.
- Uses the private `CABackdropLayer` (via `NSClassFromString`) on iOS < 26.2,
  same as upstream. Relevant only for App Store review; this build is
  distributed as a CI-built unsigned IPA.
- Re-introducing the native iOS 26 `UIGlassEffect` path requires Xcode 26 in
  CI; guard it with `#if compiler(>=6.2)` when that happens.

## Regenerating the embedded shaders

After updating the vendored sources from upstream, re-run:

```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/embed-liquid-glass-shaders.ps1
```

(source checkout expected at `D:\lgtk-tmp` — adjust `$src` inside the script)
