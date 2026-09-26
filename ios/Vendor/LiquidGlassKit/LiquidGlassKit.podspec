# Vendored from https://github.com/DnV1eX/LiquidGlassKit (Copyright (c) 2025 DnV1eX)
# Modified for the LX Music CocoaPods static-lib build — see Sources/*.swift file headers
# and doc/liquid-glass-vendoring.md for the full list of changes:
#   - Swift 6.x `internal import` syntax replaced (CI builds with Swift 5.10)
#   - iOS 26-only UIGlassEffect types removed (absent from the CI SDK)
#   - Metal shaders compiled on-device at runtime from embedded sources (no metallib)
Pod::Spec.new do |s|
  s.name         = 'LiquidGlassKit'
  s.version      = '1.0.0'
  s.summary      = 'Liquid Glass effect backport (UIKit + Metal), vendored for LX Music iOS'
  s.description  = 'Vendored copy of DnV1eX/LiquidGlassKit providing the LiquidGlassEffectView' \
                   ' (MTKView + CABackdropLayer backdrop capture) used as the live liquid-glass' \
                   ' background of the mini player and the bottom tab bar. Includes a React Native' \
                   ' view manager (LiquidGlassView).'
  s.homepage     = 'https://github.com/DnV1eX/LiquidGlassKit'
  s.license      = { :type => 'Custom', :file => 'LICENSE-NOTES.md' }
  s.authors      = { 'DnV1eX (upstream)' => 'https://github.com/DnV1eX' }
  s.source       = { :git => 'https://github.com/DnV1eX/LiquidGlassKit.git', :tag => s.version }

  s.platform     = :ios, '13.0'
  s.swift_version = '5.0'

  s.source_files = 'Sources/*.{swift,mm,h}'

  s.dependency 'React-Core'

  # 混合 ObjC/Swift 静态库 pod：LiquidGlassViewManager.mm 需要 import 生成的
  # LiquidGlassKit-Swift.h，显式把可能的产出目录加进头搜索路径（Xcode 15/26 产出位置不同）
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'HEADER_SEARCH_PATHS' => '"$(inherited)" "$(PODS_CONFIGURATION_BUILD_DIR)/LiquidGlassKit" "$(BUILT_PRODUCTS_DIR)"'
  }
end
