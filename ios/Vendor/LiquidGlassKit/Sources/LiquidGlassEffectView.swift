//
//  LiquidGlassEffectView.swift
//  LiquidGlass (vendored from DnV1eX/LiquidGlassKit)
//
//  Created by Alexey Demin on 2025-12-23.
//  Vendored modifications for LX Music CocoaPods static-lib build (CI: Xcode 15.4 / iOS 17.5 SDK):
//  1. iOS 26-only `UIGlassEffect` / `UIGlassContainerEffect` types removed — they do not exist
//     in the CI SDK, and type references fail to compile regardless of runtime availability
//     checks. The custom Metal implementation covers iOS 26+ as well (capture switches to the
//     public-API root-view scheme automatically on iOS 26.2+). Native UIGlassEffect can be
//     reintroduced behind `#if compiler(>=6.2)` once CI moves to Xcode 26.
//  2. Added `@objc convenience init()` plus tint/opacity/dark/touch bridging methods for
//     the React Native view manager (LiquidGlassViewManager.mm). Rendering behavior is
//     upstream-identical: continuous MTKView rendering with per-frame background capture —
//     no on-demand/power-saving layer (an earlier local one was removed to stay faithful
//     to upstream, per user decision 2026-09-28).
//  Upstream: Copyright © 2025 DnV1eX, https://github.com/DnV1eX/LiquidGlassKit
//

import UIKit

public class LiquidGlassEffectView: UIView, AnyVisualEffectView {

    public let contentView = UIView()
    public var effect: UIVisualEffect?

    var liquidGlassView: LiquidGlassView? {
        didSet {
            oldValue?.removeFromSuperview()
            if let liquidGlassView {
                insertSubview(liquidGlassView, belowSubview: contentView)
            }
        }
    }

    /// RN bridge entry: creates the view with the `.regular` glass preset（磨砂液态玻璃）.
    @objc public convenience init() {
        self.init(effect: LiquidGlassEffect(style: .regular, isNative: false))
    }

    public required init(effect: LiquidGlassEffect) {
        self.effect = effect

        super.init(frame: .zero)

        let liquidGlassView = LiquidGlassView(effect.style.liquidGlass)
        addSubview(liquidGlassView)
        self.liquidGlassView = liquidGlassView

        setupContentView()
    }

    public required init(effect: LiquidGlassContainerEffect) {
        self.effect = effect

        super.init(frame: .zero)

        setupContentView()
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func setupContentView() {
        addSubview(contentView)
        contentView.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            contentView.topAnchor.constraint(equalTo: topAnchor),
            contentView.bottomAnchor.constraint(equalTo: bottomAnchor),
            contentView.leadingAnchor.constraint(equalTo: leadingAnchor),
            contentView.trailingAnchor.constraint(equalTo: trailingAnchor)
        ])
    }

    public override func layoutSubviews() {
        super.layoutSubviews()

        liquidGlassView?.frame = contentView.frame
        liquidGlassView?.layer.cornerRadius = layer.cornerRadius
        liquidGlassView?.layer.cornerCurve = layer.cornerCurve
    }

    /// RN bridge entry: forward tint changes into the immutable glass preset.
    @objc public func setGlassTintColor(_ color: UIColor?) {
        // 不能写成 liquidGlassView?.liquidGlass.tintColor = color：
        // Swift 不允许经可选链给「struct 成员」赋值（链式临时值不可写），
        // 须先解包引用，再改 let 持有的 struct 的 var 成员
        if let liquidGlassView {
            liquidGlassView.liquidGlass.tintColor = color
        }
    }

    /// RN bridge entry: 手指位置驱动的眩光（玻璃坐标系）；越界/停止时调 clearTouchPoint 清除
    @objc public func setTouchPoint(_ point: CGPoint) {
        liquidGlassView?.touchPoint = point
    }

    @objc public func clearTouchPoint() {
        liquidGlassView?.touchPoint = nil
    }
}

/// A visual effect that renders a glass material.
public class LiquidGlassEffect: UIVisualEffect {

    public enum Style {
        case regular, clear

        var liquidGlass: LiquidGlass {
            switch self {
            case .regular: .regular
            case .clear: .clear
            }
        }
    }
    let style: Style

    let isNative: Bool

    /// Enables interactive behavior for the glass effect.
    public var isInteractive = false

    /// A tint color applied to the glass.
    public var tintColor: UIColor?

    /// Creates a glass effect with the specified style.
    /// - Parameters:
    ///   - style: The glass effect style.
    ///   - isNative: No-op in the vendored build (native `UIGlassEffect` removed, see header).
    public init(style: Style, isNative: Bool = true) {
        self.style = style
        self.isNative = isNative
        super.init()
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
}

/// A `LiquidGlassContainerEffect` renders multiple glass elements into a combined effect.
///
/// When using `LiquidGlassContainerEffect` with a `VisualEffectView` you can
/// add individual glass elements to the visual effect view's contentView by nesting `VisualEffectView`'s
/// configured with `LiquidGlassEffect`. In that configuration, the glass container will render all glass elements
/// in one combined view, behind the visual effect view's `contentView`.
public class LiquidGlassContainerEffect: UIVisualEffect {

    let isNative: Bool

    /// The spacing specifies the distance between elements at which they begin to merge.
    public var spacing = 10.0

    /// Creates a combined glass effect.
    /// - Parameters:
    ///   - isNative: No-op in the vendored build (native `UIGlassContainerEffect` removed, see header).
    public init(isNative: Bool = true) {
        self.isNative = isNative
        super.init()
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
}

public protocol AnyVisualEffectView: UIView {
    var contentView: UIView { get }
    var effect: UIVisualEffect? { get set }
}

extension UIVisualEffectView: AnyVisualEffectView { }

public func VisualEffectView(effect: UIVisualEffect?) -> AnyVisualEffectView {
    if effect is LiquidGlassEffect {
        // Native `UIGlassEffect` path (iOS 26+) removed in the vendored build — see header.
        return LiquidGlassEffectView(effect: effect as! LiquidGlassEffect)
    } else if effect is LiquidGlassContainerEffect {
        // Native `UIGlassContainerEffect` path (iOS 26+) removed in the vendored build — see header.
        return LiquidGlassEffectView(effect: effect as! LiquidGlassContainerEffect)
    } else {
        return UIVisualEffectView(effect: effect)
    }
}
