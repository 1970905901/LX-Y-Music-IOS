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
| 2 | iOS 26 `UIGlassEffect` behind `#if compiler(>=6.2)` + runtime availability, and the version-banded material decision (LGGlassViewFactory.swift) | Upstream references iOS 26-only types unguarded. App-level decision (2026-09-30): frosted (`liquid = false`) is `UIBlurEffect(.systemMaterial)` on **all** versions, 26+ included (`preferNativeGlassOnIOS26 = false` — native `UIGlassEffect` reads as the system's own liquid look, contradicting "off = frosted"); `liquid = true` is native `UIGlassEffect(.regular)` on **iOS 26.2+** (system-composited, zero capture cost — avoids the custom-Metal judder/flicker/foreground-shard chain observed on 26.2+/27) and vendored Metal on 14-26.1. Both guard layers are required: the runtime check keeps 14-18 off an iOS 26 symbol, the `#if` keeps a pre-6.2 SDK (CI Xcode rollback) compiling |
| 3 | Shader loading → `MTLDevice.makeLibrary(source:)` with embedded MSL (`LiquidGlassShaderSource.swift`) | Upstream loads a SwiftPM-precompiled `default.metallib`; a CocoaPods static lib has no resource bundle and CI must not run a Metal compile step. Runtime compilation happens on-device |
| 4 | Added `@objc convenience init()`, `setGlassTintColor(_:)`, `setIsDarkMode(_:)` and backing-rebuild plumbing (LiquidGlassEffectView.swift) | React Native view-manager bridge needs ObjC-visible entry points |
| 5 | Added `LiquidGlassViewManager.mm` | Registers the `LiquidGlassView` native component for RN Paper |
| 6 | LiquidLensView included with changes; Slider / Switch sources not included | The lens pill drives the tab-switch liquid-glass morph (RN component `LiquidGlassLens`). Lens body stays aligned with upstream 2eb41c5 (`LiquidGlassView(.lens)` lift morph with resting-pill crossfade, multi-rect frames merging, touch-point glare): `internal import` fixed, lens entry points marked `@objc`, `LGLensFactory` added for ObjC construction — always the custom lens (matching upstream, which recreates `_UILiquidLensView` rather than calling it; an earlier experiment instantiating the private class on iOS 26+ was removed: it does not respond to this component's method surface, and an unguarded call crashes) |
| 7 | Root-view capture (iOS 26.2+) hides the whole glass widget root — foreground content included — with `afterScreenUpdates: true`, plus a static-capture throttle (texture reuse ~12 Hz when the capture rect is unchanged); exclusion root overridable per widget (`setCaptureExclusionView:`, RN host passes itself) | The previous scheme (MTK-view-only hiding + `afterScreenUpdates: false`) leaked two contaminants into the background texture on real devices (iOS 26.2+/27): the foreground content above the glass (tab icons / player buttons — refracted into icon-shaped dark smears) and the glass's own previous frame (in-stack `isHidden` is NOT reflected by `drawHierarchy` with `false`, because it captures the last COMMITTED composite — the glass output was re-captured and re-refracted every frame, feedback-amplifying into large soft blobs). `true` commits the hiding into the composite; the throttle bounds the cost of the forced whole-window commit for static glass |
| 8 | Corrected the stale material contract in the `LiquidGlassViewManager.mm` header — comments only, no behaviour change | That header still documented the pre-2026-09-30 scheme (frosted = `UIGlassEffect` on 26+ and `systemMaterial` elsewhere; `liquid = true` = vendored Metal on every version), so the two files describing the same decision contradicted each other and the bridge header misinformed every reader. It now states the three bands (frosted = `systemMaterial` on all versions; `liquid = true` = native `UIGlassEffect(.regular)` on 26.2+, vendored Metal on 14-26.1) plus two follow-on differences that were never written down: touch-point glare and `setCaptureExclusionView:` exist on the Metal band only (the 26.2+ band is the same frosted view, so both are skipped by the existing `respondsToSelector` branches), while `glassOpacity` / `isDarkMode` also apply on the 26.2+ band but are unused there because the settings UI hides that slider while the switch is on. Guarded by `sim-glass-dark-contract.js` invariants 6-7 (the header must name the native `#available` split point and its preceding version, and the frosted clause must not mention `UIGlassEffect`) — locally run only, CI validates compilation rather than these contracts |

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

## Shader loading: swappable to a precompiled metallib

Current scheme: the two upstream `.metal` sources are embedded as MSL strings
(`LiquidGlassShaderSource.swift`, regenerated by
`scripts/embed-liquid-glass-shaders.ps1`) and compiled on-device at runtime
(`MTLDevice.makeLibrary(source:)`, `LiquidGlassView.swift` `buildPipeline`).
The pipeline is a shared singleton — the cost is one ~tens-of-ms compile per
cold start, on first glass view creation; all glass views reuse it afterwards.
GPU-side output is byte-identical to upstream's (same shader source).

Upstream instead loads a SwiftPM-precompiled `default.metallib` via
`makeDefaultLibrary(bundle: .module)` — the `.module` resource bundle is
SwiftPM-only and does not exist under our CocoaPods static-lib pod, which is
why the scheme differs.

If the startup compile ever becomes worth eliminating, the swap is:

1. Compile the two `.metal` files into a `metallib` (on a Mac or in a CI
   step: `xcrun metal -c LiquidGlassVertex.metal -o vertex.air`, same for the
   fragment, then `xcrun metallib vertex.air fragment.air -o
   LiquidGlassKit.metallib`). Note: the dev machine is Windows — this cannot
   be done locally; either add a CI build step or commit the binary.
2. Declare it as a pod resource (`s.resource_blobs`) in `LiquidGlassKit.podspec`.
3. Replace `buildPipeline` with `device.makeLibrary(URL:)` /
   `makeDefaultLibrary(bundle:)` and drop the embedded MSL strings.
4. Keep `LiquidGlassShaderSource.swift` in sync with upstream `.metal` files
   regardless (it is the fallback if the library fails to load).

Decision log: 2026-09-29 — user accepted the per-cold-start tens-of-ms
compile; runtime compilation kept (no podspec/CI changes, zero maintenance
of binary shader artifacts). Revisit only if startup profiling says
otherwise.

## Regenerating the embedded shaders

After updating the vendored sources from upstream, re-run:

```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/embed-liquid-glass-shaders.ps1
```

(source checkout expected at `D:\lgtk-tmp` — adjust `$src` inside the script)

## iOS 26.2+ root-view capture: layer.render + exclusion roots (vendored rework)

Upstream renders the capture with `rootView.layer.presentation()` +
`layer.render(in:)` (synchronous layer-tree read, no render-server commit) and
hides only the MTK view itself. Two vendored changes were required on top:

1. **Exclusion roots**: the app's RN foreground (tab icons / mini-player buttons)
   are SIBLINGS of the glass host (not inside its contentView), so hiding the glass
   alone leaks them into the capture -> refracted ghosts/dark smears. The RN view
   manager resolves the exclusion root to the HOST'S SUPERVIEW (the JS content
   container) on mount; `GlassInstanceRegistry.exclusionRoots` hides all of them
   during any capture (mutual exclusion).
2. **@try sandbox**: `layer.render(in:)` over the full window (status bar / keyboard
   / RNN private layers) has an NSException crash history on iOS 26 that Swift
   cannot catch — `LXGlassTryRenderLayer` (ObjC) wraps it; on exception the capture
   falls back to `drawHierarchy(afterScreenUpdates: true)` for that frame and the
   instance disables the layer.render path after 2 failures.

History: an intermediate scheme (drawHierarchy(afterScreenUpdates: true) with a
80ms static-capture throttle) fixed the leaks but its forced per-capture commit
presented the hidden state to the display — the glass widgets periodically
vanished on screen (user-visible jumping, recorded on video). The throttled
refraction also stepped at 12.5fps while scrolling. Both reverted by the
layer.render scheme above (upstream-identical, continuous per-frame capture).

Status (2026-09-30): this capture path lives inside the Metal backing only, and the
material split above (rows 2 and 8) now hands the 26.2+ band a system-material view
— so the root-view capture no longer runs on 26.2+, and on 14-26.1 the backdrop
source comes from the `CABackdropLayer` path instead. The code is kept on purpose:
giving the 26.2+ band `useNativeGlass: false` again (or a device where
`isBackdropAvailable` is false) makes it live. Do not treat it as dead code.

## iOS 14-18 cold-start black flash: uniform-backdrop capture rejection (vendored)

On iOS 14-18 the backdrop path (`captureBackdrop`, CABackdropLayer +
`drawHierarchy(afterScreenUpdates: false)`) captures a FULLY UNIFORM BLACK frame
for the first frames after the layer enters the hierarchy (render server has not
composited the backdrop source yet). The shader refracts that black texture ->
the whole glass bar flashes black on cold start (recorded on video).

Fix: after each backdrop capture, a sparse ~16x16 luminance sample rejects
UNIFORM frames (max-min <= 3) as "backdrop not ready" — the previous texture (or
transparency) is kept until a non-uniform capture arrives. Dark mode is
unaffected: a real background with content is non-uniform, and discarding a
uniform frame is visually a no-op (blur/refraction of a uniform field is
uniform).

