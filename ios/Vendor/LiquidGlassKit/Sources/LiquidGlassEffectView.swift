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
    // 玻璃静止时（背后内容不变）渲染是纯浪费：渲染时钟只在 JS 脉冲或挂载活跃窗为真时
    // 运行，否则 MTKView 暂停、屏幕保留最后一帧。
    // 滚动/拖拽：切系统磨砂实时回退（UIBlurEffect，GPU backdrop 合成，实时且零逐帧
    // CPU 成本），自研 Metal 液态玻璃冻结淡出——滚动中逐帧整窗捕获（drawHierarchy +
    // 同步 MPS 模糊 × 玻璃实例数）是列表滚动掉帧与玻璃边缘黑影的共同根源，已彻底
    // 绕开；滚动停止（含惯性收敛）后补一帧新鲜画面再交叉切回液态玻璃。

    /// JS 脉冲（切 Tab、换主题、换歌封面、无触摸的内容变化），由 RN 的 active prop 驱动
    private var jsActive = false
    /// 挂载活跃窗：新视图创建后先连续渲染约 1s，覆盖 RNN 转场/首帧布局，JS prop 到达前也有正确画面
    private var mountActive = true
    private var mountDecayTimer: Timer?
    private var gestureDecayTimer: Timer?
    /// 冻结看门狗：pan 的 .ended/.cancelled 万一丢失（手势系统异常、事件竞争），
    /// 冻结最多持续 freezeWatchdogInterval 秒即强制补帧，玻璃不会永久停留在一帧。
    private var freezeWatchdogTimer: Timer?
    /// 滚动实时回退材质（UIBlurEffect）：系统 backdrop 通道在 GPU 上合成，滚动期间
    /// 内容实时透过且零逐帧 CPU 成本，补齐自研 Metal 路径「实时折射必须逐帧整窗
    /// drawHierarchy」的死穴。静止态仍是液态玻璃（折射 + 边缘光），滚动期间切磨砂。
    private var fallbackBlurView: UIVisualEffectView?
    /// 主题染色覆层：跟随 setGlassTintColor，让磨砂回退态与液态玻璃的材质色一致
    private var fallbackTintOverlay: UIView?
    private var isFallbackActive = false
    private weak var windowPanObserver: UIPanGestureRecognizer?

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
        setupFallbackBlur(below: liquidGlassView)
        beginMountActivity()
    }

    public required init(effect: LiquidGlassContainerEffect) {
        self.effect = effect

        super.init(frame: .zero)

        setupContentView()
        setupFallbackBlur(below: contentView)
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

    /// 创建滚动回退磨砂层：置于液态玻璃之下（滚动中液态玻璃淡出、磨砂淡入），
    /// 不参与命中测试；染色覆层放进 contentView 随 blur 一起淡入淡出。
    private func setupFallbackBlur(below sibling: UIView) {
        // systemUltraThinMaterial：系统最轻磨砂档——液态玻璃本体只做 σ≈0.3 微模糊
        // （近透明折射），磨砂档位越轻与静止态的材质差越小；档位再往上（thin 及
        // 以上）雾感明显，滚动开始/结束的材质切换肉眼可辨。
        let blur = UIVisualEffectView(effect: UIBlurEffect(style: .systemUltraThinMaterial))
        blur.isUserInteractionEnabled = false
        blur.alpha = 0
        let overlay = UIView()
        overlay.isUserInteractionEnabled = false
        overlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        overlay.backgroundColor = LiquidGlass.regular.tintColor
        blur.contentView.addSubview(overlay)
        insertSubview(blur, belowSubview: sibling)
        fallbackBlurView = blur
        fallbackTintOverlay = overlay
    }

    public override func layoutSubviews() {
        super.layoutSubviews()

        liquidGlassView?.frame = contentView.frame
        liquidGlassView?.layer.cornerRadius = layer.cornerRadius
        liquidGlassView?.layer.cornerCurve = layer.cornerCurve
        fallbackBlurView?.frame = contentView.frame
        if let overlay = fallbackTintOverlay {
            overlay.frame = fallbackBlurView?.contentView.bounds ?? .zero
        }
    }

    /// RN bridge entry: throttle continuous MTKView rendering (JS passes `fps`).
    /// 高刷设备（ProMotion 120Hz）上限钳制到 60，避免满帧 Metal 渲染 + 整窗捕获掉帧。
    @objc public func setPreferredFramesPerSecond(_ fps: Int) {
        liquidGlassView?.preferredFramesPerSecond = min(max(1, fps), 60)
    }

    /// RN bridge entry: forward tint changes into the immutable glass preset.
    @objc public func setGlassTintColor(_ color: UIColor?) {
        // 不能写成 liquidGlassView?.liquidGlass.tintColor = color：
        // Swift 不允许经可选链给「struct 成员」赋值（链式临时值不可写），
        // 须先解包引用，再改 let 持有的 struct 的 var 成员
        if let liquidGlassView {
            liquidGlassView.liquidGlass.tintColor = color
        }
        // 磨砂回退态同步染色，两种材质观感一致
        fallbackTintOverlay?.backgroundColor = color ?? LiquidGlass.regular.tintColor
    }

    /// RN bridge entry: 手指位置驱动的眩光（玻璃坐标系）；越界/停止时调 clearTouchPoint 清除
    @objc public func setTouchPoint(_ point: CGPoint) {
        liquidGlassView?.touchPoint = point
    }

    @objc public func clearTouchPoint() {
        liquidGlassView?.touchPoint = nil
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
        // 脉冲 = 背后内容已变化：若正处于磨砂回退态，立即切回液态玻璃并补新鲜帧
        if active && isFallbackActive {
            exitScrollFallback()
        }
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
            // 滚动/翻页/抽屉开始：切系统磨砂实时回退 + 冻结 Metal 液态玻璃
            //（见 enterScrollFallback）。取消未触发的补帧定时器——新一轮滚动
            // 开始时画面保持上一轮的稳定帧。
            gestureDecayTimer?.invalidate()
            gestureDecayTimer = nil
            enterScrollFallback()
            if freezeWatchdogTimer == nil {
                freezeWatchdogTimer = Timer.scheduledTimer(withTimeInterval: 3.0, repeats: false) { [weak self] _ in
                    guard let self else { return }
                    self.freezeWatchdogTimer = nil
                    self.exitScrollFallback()
                }
            }
        case .ended:
            freezeWatchdogTimer?.invalidate()
            freezeWatchdogTimer = nil
            // 惯性滚动越快，磨砂回退保持得越久：等滑行收敛后再切回液态玻璃，
            // 避免滑行中途补帧又落入逐帧捕获的老路
            let velocity = gesture.velocity(in: nil)
            let speed = max(abs(velocity.x), abs(velocity.y))
            scheduleGestureDecay(speed > 1200 ? 2.2 : (speed > 300 ? 1.2 : 0.6))
        case .cancelled, .failed:
            freezeWatchdogTimer?.invalidate()
            freezeWatchdogTimer = nil
            scheduleGestureDecay(0.3)
        default:
            break
        }
    }

    private func scheduleGestureDecay(_ delay: TimeInterval) {
        gestureDecayTimer?.invalidate()
        gestureDecayTimer = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { [weak self] _ in
            guard let self else { return }
            self.exitScrollFallback()
        }
    }

    // MARK: - Scroll fallback（滚动实时磨砂 ↔ 静止液态玻璃）

    /// 滚动开始：液态玻璃淡出（Metal 时钟冻结、零捕获），系统磨砂实时接管——
    /// GPU backdrop 合成让背后内容实时透过，且滚动全程零逐帧 CPU 成本。
    private func enterScrollFallback() {
        liquidGlassView?.pauseForScroll()
        guard !isFallbackActive else { return }
        isFallbackActive = true
        UIView.animate(withDuration: 0.12) {
            self.liquidGlassView?.alpha = 0
            self.fallbackBlurView?.alpha = 1
        }
    }

    /// 滚动结束（含惯性收敛/看门狗/脉冲触发）：先让液态玻璃补一帧新鲜画面
    ///（refreshAfterScroll），再交叉切回——0.15s 足够 30fps 下渲染出 2 帧，
    /// 避免切回瞬间闪过旧帧。切回前若又开始了新一轮滚动，guard 会跳过恢复。
    private func exitScrollFallback() {
        liquidGlassView?.refreshAfterScroll()
        guard isFallbackActive else { return }
        isFallbackActive = false
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
            guard !self.isFallbackActive else { return }
            // 切回过渡稍长（0.22s）：材质变化被拉平，肉眼更难捕捉切换瞬间
            UIView.animate(withDuration: 0.22) {
                self.liquidGlassView?.alpha = 1
                self.fallbackBlurView?.alpha = 0
            }
        }
    }

    private func applyRenderActive() {
        liquidGlassView?.setRenderActive(jsActive || mountActive)
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
