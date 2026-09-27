//
//  LGGlassViewFactory.swift
//  LiquidGlassKit (vendored from DnV1eX/LiquidGlassKit)
//
//  ObjC-visible factory that picks the glass backing for the current OS:
//  统一高透磨砂玻璃（LGFrostedGlassView：系统 UIBlurEffect + 主题染色覆层）。
//  液态玻璃（Metal 逐帧整窗捕获）在长列表场景对主线程的压力与实时性无法兼得，
//  且材质无法满足「透明度可调」，整体下线；磨砂走 Core Animation backdrop 通道
//  在 GPU 合成——实时、零逐帧 CPU、全 iOS 版本行为一致。
//  宿主（LiquidGlassViewManager.mm 的 LGLiquidGlassHostView）只持有 UIView，
//  宿主侧圆角裁剪容器 + 0.5pt 内缘线。
//

import UIKit

/// 高透磨砂玻璃底衬：UIBlurEffect(.systemUltraThinMaterial) 打底 + 主题染色覆层。
/// 不透明度（覆层 alpha）由用户设置驱动；blurView 本体不设透明度（系统约束）。
@objc public final class LGFrostedGlassView: UIView {

    private let blurView = UIVisualEffectView(effect: UIBlurEffect(style: .systemUltraThinMaterial))
    private let tintOverlay = UIView()

    /// 染色基色（不透明主题色；透明度由 glassOpacity 独立控制）
    @objc public var glassTintColor: UIColor? {
        didSet { tintOverlay.backgroundColor = glassTintColor ?? UIColor.white }
    }

    /// 0~1：染色覆层不透明度（用户设置）。1 = 最实的磨砂，0 = 几乎全透明。
    @objc public var glassOpacity: CGFloat = 0.6 {
        didSet { tintOverlay.alpha = min(max(glassOpacity, 0), 1) }
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        blurView.isUserInteractionEnabled = false
        tintOverlay.isUserInteractionEnabled = false
        tintOverlay.backgroundColor = UIColor.white
        tintOverlay.alpha = min(max(glassOpacity, 0), 1)
        blurView.contentView.addSubview(tintOverlay)
        addSubview(blurView)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    public override func layoutSubviews() {
        super.layoutSubviews()
        blurView.frame = bounds
        tintOverlay.frame = blurView.contentView.bounds
    }
}

@objc public final class LGGlassViewFactory: NSObject {

    /// UIView 初始化是 MainActor 隔离的；RN 的 view 创建固定发生在主线程。
    @objc @MainActor public static func createGlassBacking() -> UIView {
        let glassView = LGFrostedGlassView(frame: .zero)
        glassView.isUserInteractionEnabled = false
        glassView.backgroundColor = .clear
        return glassView
    }

    /// 主题染色：覆层基色（不透明；透明度走 glassOpacity 设置）。
    @objc @MainActor public static func applyGlassTint(_ glassView: UIView, tint: UIColor?) {
        (glassView as? LGFrostedGlassView)?.glassTintColor = tint
    }
}

