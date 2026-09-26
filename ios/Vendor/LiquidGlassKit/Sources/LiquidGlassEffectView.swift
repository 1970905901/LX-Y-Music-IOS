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
//  2. Added `@objc convenience init()` and `setPreferredFramesPerSecond(_:)` for the
//     React Native view manager (LiquidGlassViewManager.mm).
//  Upstream: Copyright © 2025 DnV1eX, https://github.com/DnV1eX/LiquidGlassKit
//

import UIKit

public class LiquidGlassEffectView: UIView, AnyVisualEffectView, UIGestureRecognizerDelegate {

    public let contentView = UIView()
    public var effect: UIVisualEffect?

    // MARK: - Demand rendering (battery)
    // 玻璃静止时（背后内容不变）渲染是纯浪费：三个活跃源任一为真才跑渲染时钟，
    // 否则 MTKView 暂停、屏幕保留最后一帧。任何会改变玻璃背后内容的行为都必须
    // 通过其一恢复渲染，否则玻璃会停留在过期画面（冻结穿帮）。

    /// JS 脉冲（切 Tab、换主题、换歌封面、无触摸的内容变化），由 RN 的 active prop 驱动
    private var jsActive = false
    /// 窗口级拖拽手势观察（列表滚动、翻页、抽屉），惯性期按甩动速度延长
    private var gestureActive = false
    /// 挂载活跃窗：新视图创建后先连续渲染约 1s，覆盖 RNN 转场/首帧布局，JS prop 到达前也有正确画面
    private var mountActive = true
    private var mountDecayTimer: Timer?
    private var gestureDecayTimer: Timer?
    private weak var windowPanObserver: UIPanGestureRecognizer?

    var liquidGlassView: LiquidGlassView? {
        didSet {
            oldValue?.removeFromSuperview()
            if let liquidGlassView {
                insertSubview(liquidGlassView, belowSubview: contentView)
            }
        }
    }

    /// RN bridge entry: creates the view with the `.clear` glass preset（纯透明折射）.
    @objc public convenience init() {
        self.init(effect: LiquidGlassEffect(style: .clear, isNative: false))
    }

    public required init(effect: LiquidGlassEffect) {
        self.effect = effect

        super.init(frame: .zero)

        let liquidGlassView = LiquidGlassView(effect.style.liquidGlass)
        addSubview(liquidGlassView)
        self.liquidGlassView = liquidGlassView

        setupContentView()
        beginMountActivity()
    }

    public required init(effect: LiquidGlassContainerEffect) {
        self.effect = effect

        super.init(frame: .zero)

        setupContentView()
        beginMountActivity()
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

    /// RN bridge entry: throttle continuous MTKView rendering (JS passes `fps`).
    @objc public func setPreferredFramesPerSecond(_ fps: Int) {
        liquidGlassView?.preferredFramesPerSecond = max(1, fps)
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

    // MARK: - Demand rendering internals

    /// Fresh views render continuously for a short window: covers RNN push/pop transitions and
    /// first layout before any JS prop arrives, then hands over to pulse/gesture-driven activity.
    private func beginMountActivity() {
        applyRenderActive()
        mountDecayTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: false) { [weak self] _ in
            guard let self else { return }
            self.mountActive = false
            self.applyRenderActive()
        }
    }

    /// RN bridge entry: JS pulse activity on/off (the JS side owns pulse timing).
    @objc public func setJsActive(_ active: Bool) {
        jsActive = active
        applyRenderActive()
    }

    public override func didMoveToWindow() {
        super.didMoveToWindow()

        if let old = windowPanObserver {
            old.view?.removeGestureRecognizer(old)
            windowPanObserver = nil
        }
        guard let window else { return }

        // 窗口级拖拽观察：一份识别器覆盖全 App 的列表滚动/翻页/抽屉，无需 JS 逐个接入。
        // 只观察不消费（cancelsTouchesInView = false + 允许并行识别），绝不影响内容手势。
        let pan = UIPanGestureRecognizer(target: self, action: #selector(handleWindowPan(_:)))
        pan.cancelsTouchesInView = false
        pan.delegate = self
        window.addGestureRecognizer(pan)
        windowPanObserver = pan
    }

    @objc private func handleWindowPan(_ gesture: UIPanGestureRecognizer) {
        switch gesture.state {
        case .began, .changed:
            gestureActive = true
            gestureDecayTimer?.invalidate()
            gestureDecayTimer = nil
            applyRenderActive()
        case .ended:
            // 惯性滚动越快，玻璃保持渲染的时间越长，避免长滑行中途冻结
            let velocity = gesture.velocity(in: nil)
            let speed = max(abs(velocity.x), abs(velocity.y))
            scheduleGestureDecay(speed > 1200 ? 2.2 : (speed > 300 ? 1.2 : 0.6))
        case .cancelled, .failed:
            scheduleGestureDecay(0.3)
        default:
            break
        }
    }

    private func scheduleGestureDecay(_ delay: TimeInterval) {
        gestureDecayTimer?.invalidate()
        gestureDecayTimer = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { [weak self] _ in
            guard let self else { return }
            self.gestureActive = false
            self.applyRenderActive()
        }
    }

    private func applyRenderActive() {
        liquidGlassView?.setRenderActive(jsActive || gestureActive || mountActive)
    }

    public func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
        true
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
