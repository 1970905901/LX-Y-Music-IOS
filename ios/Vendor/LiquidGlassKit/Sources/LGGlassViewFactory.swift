//
//  LGGlassViewFactory.swift
//  LiquidGlassKit (vendored from DnV1eX/LiquidGlassKit)
//
//  ObjC-visible factory that picks the best glass backing for the current OS:
//  - iOS 26+（且用 Xcode 26/Swift 6.2 构建）：系统原生 UIGlassEffect(.clear) —— 由
//    Core Animation 合成，零逐帧开销（无需任何 pulse/手势驱动）；
//  - iOS 13-25：vendored 自研 Metal 实现（LiquidGlassEffectView，按需渲染省电）。
//  两条路径均为纯透明玻璃（.clear 变体 / .clear 预设）：透背景、边缘折射光、
//  不随主题明暗变化、不做模糊。
//  宿主（LiquidGlassViewManager.mm 的 LGLiquidGlassHostView）只持有 UIView，
//  两套实现对外行为一致（设 cornerRadius 即可）。
//

import UIKit

@objc public final class LGGlassViewFactory: NSObject {

    /// UIView 初始化是 MainActor 隔离的；RN 的 view 创建固定发生在主线程。
    @objc @MainActor public static func createGlassBacking() -> UIView {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            let glassEffect = UIGlassEffect(style: .clear)
            let effectView = UIVisualEffectView(effect: glassEffect)
            effectView.isUserInteractionEnabled = false
            effectView.backgroundColor = .clear
            return effectView
        }
        #endif
        let glassView = LiquidGlassEffectView(effect: LiquidGlassEffect(style: .clear, isNative: false))
        glassView.isUserInteractionEnabled = false
        glassView.backgroundColor = .clear
        return glassView
    }
}
