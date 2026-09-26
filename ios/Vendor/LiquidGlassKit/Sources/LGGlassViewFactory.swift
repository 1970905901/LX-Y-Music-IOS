//
//  LGGlassViewFactory.swift
//  LiquidGlassKit (vendored from DnV1eX/LiquidGlassKit)
//
//  ObjC-visible factory that picks the best glass backing for the current OS:
//  - iOS 26+（且用 Xcode 26/Swift 6.2 构建）：系统原生 UIGlassEffect —— 由 Core Animation
//    合成，折射/高光/明暗自适应全部系统级，且零逐帧开销（无需任何 pulse/手势驱动）；
//  - iOS 13-25：vendored 自研 Metal 实现（LiquidGlassEffectView，按需渲染省电）。
//  宿主（LiquidGlassViewManager.mm 的 LGLiquidGlassHostView）只持有 UIView，
//  两套实现对外行为一致：设 cornerRadius、设 overrideUserInterfaceStyle 即可。
//  注意 UIVisualEffectView 不支持事后修改 overrideUserInterfaceStyle，
//  所以明暗切换由宿主整体重建 backing（见管理器的 dark prop）。
//

import UIKit

@objc public final class LGGlassViewFactory: NSObject {

    /// UIView 初始化是 MainActor 隔离的；RN 的 view 创建固定发生在主线程。
    @objc @MainActor public static func createGlassBacking(dark: Bool) -> UIView {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            let glassEffect = UIGlassEffect(style: .regular)
            let effectView = UIVisualEffectView(effect: glassEffect)
            effectView.isUserInteractionEnabled = false
            effectView.backgroundColor = .clear
            effectView.overrideUserInterfaceStyle = dark ? .dark : .light
            return effectView
        }
        #endif
        let glassView = LiquidGlassEffectView(effect: LiquidGlassEffect(style: .regular, isNative: false))
        glassView.isUserInteractionEnabled = false
        glassView.backgroundColor = .clear
        // 玻璃染色的动态 UIColor 默认按系统明暗解析；App 主题可与系统不一致，
        // 这里用视图级覆盖把 App 主题明暗传下去
        glassView.overrideUserInterfaceStyle = dark ? .dark : .light
        return glassView
    }
}
