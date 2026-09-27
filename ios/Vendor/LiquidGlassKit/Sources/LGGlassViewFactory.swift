//
//  LGGlassViewFactory.swift
//  LiquidGlassKit (vendored from DnV1eX/LiquidGlassKit)
//
//  ObjC-visible factory that picks the glass backing for the current OS:
//  纯透明玻璃（LGFrostedGlassView：主题染色覆层，无模糊、无捕获，GPU 合成零成本）。
//  液态玻璃（Metal 逐帧整窗捕获）在长列表场景对主线程的压力与实时性无法兼得，
//  系统磨砂档位又不可调——最终形态：纯透明染色覆层，透明度由用户设置驱动，
//  全 iOS 版本行为一致。宿主（LiquidGlassViewManager.mm 的 LGLiquidGlassHostView）
//  侧圆角裁剪容器 + 0.5pt 内缘线提供轮廓。
//

import UIKit

/// 纯透明玻璃底衬：单一主题染色覆层，无模糊。不透明度（覆层 alpha）由用户
/// 设置驱动；随主题明暗切换染色基色。
@objc public final class LGFrostedGlassView: UIView {

    private let tintOverlay = UIView()

    /// 染色基色（不透明主题色；透明度由 glassOpacity 独立控制）
    @objc public var glassTintColor: UIColor? {
        didSet { tintOverlay.backgroundColor = glassTintColor ?? UIColor.white }
    }

    /// 0~1：覆层不透明度（用户设置）。1 = 全实色块，0 = 完全隐形。
    @objc public var glassOpacity: CGFloat = 0.4 {
        didSet { tintOverlay.alpha = min(max(glassOpacity, 0), 1) }
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        tintOverlay.isUserInteractionEnabled = false
        tintOverlay.backgroundColor = UIColor.white
        tintOverlay.alpha = min(max(glassOpacity, 0), 1)
        addSubview(tintOverlay)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    public override func layoutSubviews() {
        super.layoutSubviews()
        tintOverlay.frame = bounds
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

