//
//  LGGlassViewFactory.swift
//  LiquidGlassKit (vendored from DnV1eX/LiquidGlassKit)
//
//  ObjC-visible factory that picks the best glass backing for the current OS:
//  - iOS 26+（且用 Xcode 26/Swift 6.2 构建）：系统原生 UIGlassEffect(.regular) —— 由
//    Core Animation 合成，零逐帧开销（无需任何 pulse/手势驱动）；
//  - iOS 13-25：vendored 自研 Metal 实现（LiquidGlassEffectView，按需渲染省电）。
//  两条路径均为 .regular 磨砂液态玻璃（上游默认观感：染色 + 背景微模糊 + 折射 + 边缘光）。
//  宿主（LiquidGlassViewManager.mm 的 LGLiquidGlassHostView）只持有 UIView，
//  两套实现对外行为一致（设 cornerRadius 即可）。
//

import UIKit

@objc public final class LGGlassViewFactory: NSObject {

    /// UIView 初始化是 MainActor 隔离的；RN 的 view 创建固定发生在主线程。
    @objc @MainActor public static func createGlassBacking() -> UIView {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            let glassEffect = UIGlassEffect(style: .regular)
            let effectView = UIVisualEffectView(effect: glassEffect)
            effectView.isUserInteractionEnabled = false
            effectView.backgroundColor = .clear
            return effectView
        }
        #endif
        let glassView = LiquidGlassEffectView(effect: LiquidGlassEffect(style: .regular, isNative: false))
        glassView.isUserInteractionEnabled = false
        glassView.backgroundColor = .clear
        return glassView
    }

    /// 主题染色：玻璃材质色跟随 App 主题（而非固定蓝白/黑）。
    /// - 自研 Metal 路径：写入 shader 的 materialTint（ LiquidGlassEffectView.setGlassTintColor）；
    /// - iOS 26 原生路径：UIGlassEffect 支持 tintColor，但 effect 不可变，需整体重新赋值；
    /// - tint 为 nil 时回退玻璃默认材质色（.regular 预设的动态色）。
    @objc @MainActor public static func applyGlassTint(_ glassView: UIView, tint: UIColor?) {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *), let effectView = glassView as? UIVisualEffectView,
           effectView.effect is UIGlassEffect {
            let effect = UIGlassEffect(style: .regular)
            effect.tintColor = tint
            effectView.effect = effect
            return
        }
        #endif
        (glassView as? LiquidGlassEffectView)?.setGlassTintColor(tint)
    }
}

