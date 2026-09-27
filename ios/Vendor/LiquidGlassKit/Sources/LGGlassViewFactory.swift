//
//  LGGlassViewFactory.swift
//  LiquidGlassKit (vendored from DnV1eX/LiquidGlassKit)
//
//  ObjC-visible factory that picks the glass backing for the current OS:
//  统一自研 Metal 玻璃（LiquidGlassEffectView，.regular 磨砂液态玻璃：染色 +
//  背景微模糊 + 折射 + 边缘光，按需渲染省电）。曾用 iOS 26+ 原生 UIGlassEffect
//  分支已移除：系统玻璃在逐帧 frame 变化（收起/展开转场）下渲染器跟不上会输出
//  黑弧，且 UIVisualEffectView 快照为黑块无法冻结规避。
//  宿主（LiquidGlassViewManager.mm 的 LGLiquidGlassHostView）只持有 UIView，
//  宿主侧圆角裁剪容器 + 玻璃层圆角双保险。
//

import UIKit

@objc public final class LGGlassViewFactory: NSObject {

    /// UIView 初始化是 MainActor 隔离的；RN 的 view 创建固定发生在主线程。
    /// 统一自研 Metal 玻璃（LiquidGlassEffectView，按需渲染省电）：iOS 26 原生
    /// UIGlassEffect 在逐帧 frame 变化（收起/展开转场）时系统玻璃渲染器跟不上，
    /// 未渲染区域输出黑色（胶囊端部黑弧），且 UIVisualEffectView 的快照本身渲染
    /// 为黑块、冻结方案不可行；自研 Metal 路径 resize 渲染可靠（透镜同源验证），
    /// 且 tint/形状完全受控。
    @objc @MainActor public static func createGlassBacking() -> UIView {
        let glassView = LiquidGlassEffectView(effect: LiquidGlassEffect(style: .regular, isNative: false))
        glassView.isUserInteractionEnabled = false
        glassView.backgroundColor = .clear
        return glassView
    }

    /// 主题染色：玻璃材质色跟随 App 主题（而非固定蓝白/黑）。
    /// 自研 Metal 路径：写入 shader 的 materialTint（ LiquidGlassEffectView.setGlassTintColor）；
    /// tint 为 nil 时回退玻璃默认材质色（.regular 预设的动态色）。
    @objc @MainActor public static func applyGlassTint(_ glassView: UIView, tint: UIColor?) {
        (glassView as? LiquidGlassEffectView)?.setGlassTintColor(tint)
    }
}

