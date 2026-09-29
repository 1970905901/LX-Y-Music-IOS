//
//  LiquidLensView.swift
//  LiquidGlass (vendored from DnV1eX/LiquidGlassKit)
//
//  Created by Alexey Demin on 2025-12-19.
//  Vendored modifications for LX Music CocoaPods static-lib build:
//  1. `internal import` (Swift 6.0+ syntax) replaced with plain `import`.
//  2. `restingBackgroundColor` / `setLifted(...)` / `setLensCornerRadius(...)` marked
//     `@objc` and a small `LGLensFactory` added — the React Native view manager
//     (LiquidGlassViewManager.mm) drives the lens from ObjC, and Swift members are
//     not ObjC-visible without explicit @objc.
//  3. Resting pill follows upstream: a semi-transparent white pill (white 0.3 alpha)
//     rests under the selected tab and crossfades with the lifted glass. (It was
//     removed once to keep the lens motion-only — it leaked through the crossfade as
//     a square base; restored when the app decided to fully align with upstream.)
//  4. Lens body aligned to upstream 2eb41c5: lifting morphs into the real
//     `LiquidGlassView(.lens)` (Metal refraction + rim light, same engine as the bar
//     glass). The frosted-blur stand-in from the era when the Metal path was disabled
//     lived here and was reverted in the same pass that brought the Metal path back.
//  5. 2026-09-29: the drag/long-press gesture layer lives entirely in the RN host
//     (LiquidGlassViewManager.mm) and upstream has no such layer — removed by user
//     decision ("上游没有的也不要"). The frames-merge / touch-point glare bridge
//     methods that only the gesture machine consumed went with it; LiquidGlassView's
//     own frames/touchPoint capabilities (kit core) remain untouched.
//  Upstream: Copyright © 2025 DnV1eX, https://github.com/DnV1eX/LiquidGlassKit
//

import UIKit
import MetalKit

/// A custom implementation of the private _UILiquidLensView used in UITabBar.
/// Provides a resting state with a semi-transparent white pill that morphs
/// into a LiquidGlassView when lifted.
public final class LiquidLensView: UIView, AnyLiquidLensView {

    // MARK: - Acceleration Constants

    /// Time window for calculating average acceleration (in seconds).
    private let accelerationWindowDuration: TimeInterval = 0.3

    /// Coefficient to convert acceleration to scale transform.
    private let accelerationScaleCoefficient: CGFloat = 0.00005

    /// Maximum scale deviation from 1.0 (clamped for visual stability).
    private let maxScaleDeviation: CGFloat = 0.3

    // MARK: - Position Tracking

    private var positionHistory: [(position: CGPoint, timestamp: TimeInterval)] = []
    private var displayLink: CADisplayLink?

    // MARK: - Private Stored Views (weak references)

    private weak var liftedContainerView: UIView?
    private weak var liftedContentView: UIView?
    private weak var overridePunchoutView: UIView?

    // MARK: - Private Properties

    /// Whether the view is currently in lifted state.
    private var isLifted = false

    /// The liquid glass content mode.
    private var liftedContentMode: Int = 0

    /// The liquid glass style.
    private var style: Int = 0

    /// Whether the view warps content below it.
    private var warpsContentBelow: Bool = false

    // MARK: - Private Views

    /// The resting background view - semi-transparent white pill shown in resting state.
    private let restingPillView = UIView()

    /// 抬起态的液态玻璃（对齐上游：LiquidGlassView(.lens) —— Metal 折射 + 边缘光 +
    /// frames 多矩形合并，与底部栏玻璃同源同引擎）。历史上的磨砂代餐已随 Metal 路径
    /// 恢复一并退场。
    private let liquidGlassView = LiquidGlassView(.lens)

    // MARK: - Protocol Properties

    /// 静止药丸底色（上游 restingBackgroundColor，默认白 30%；宿主可经 pillColor
    /// prop 覆盖——JS 当前不传，走默认）。
    @objc public var restingBackgroundColor: UIColor? {
        get { restingPillView.backgroundColor }
        set { restingPillView.backgroundColor = newValue }
    }

    /// Vendored addition: 玻璃染色（LiquidGlassView.tintColor → shader materialTint）。
    /// nil（默认）= 用 .lens 预设的玻璃动态色 —— 对齐本项目「纯玻璃不随主题色」定案，
    /// 不要传主题色。
    @objc public func setLensTintColor(_ color: UIColor?) {
        liquidGlassView.liquidGlass.tintColor = color
    }

    /// Vendored addition: 捕获排除根透传（mm 宿主在挂载时指向 JS 父容器）。透镜叠在
    /// tab 图标/文字**上方**（JS 里 LiquidLens 先于 tab 项渲染），这些前景若不排除
    /// 会被画进透镜的背景捕获纹理、折射进药丸（与栏体玻璃同源的重影问题）。
    @objc public func setCaptureExclusionView(_ view: UIView?) {
        liquidGlassView.captureExclusionView = view
    }

    /// Vendored addition: 仅对磨砂覆层有意义（0~1）。液态形态无对应参数，
    /// 保留空操作维持 OC 桥接面（mm 按 respondsToSelector 分流继续传值）。
    @objc public func setLensGlassOpacity(_ opacity: CGFloat) {
    }

    // MARK: - Initialization

    convenience public init() {
        self.init(restingBackground: nil)
    }

    public init(restingBackground backgroundView: UIView?) {
        super.init(frame: .zero)
        commonInit()
        if let backgroundView {
            restingPillView.addSubview(backgroundView)
        }
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        commonInit()
    }

    private func commonInit() {
        clipsToBounds = false

        // Setup resting pill view - semi-transparent white
        restingPillView.backgroundColor = UIColor.white.withAlphaComponent(0.3)
        restingPillView.isUserInteractionEnabled = false
        addSubview(restingPillView)

        // Setup liquid glass view - initially hidden（上游行为：lift 时才 addSubview）
        liquidGlassView.isUserInteractionEnabled = false
        liquidGlassView.alpha = 0
        // Not added to view hierarchy initially - only shown when lifted
    }

    // MARK: - Layout

    /// 圆角覆盖（Vendored addition）：默认 -1 = 胶囊圆角（min(w,h)/2）；宿主 tab 栏
    /// 传入与其一致的圆角后，透镜呈与栏体圆角对齐的圆角矩形而非胶囊。
    private var cornerRadiusOverride: CGFloat = -1

    @objc public func setLensCornerRadius(_ radius: CGFloat) {
        guard cornerRadiusOverride != radius else { return }
        cornerRadiusOverride = radius
        setNeedsLayout()
    }

    public override func layoutSubviews() {
        super.layoutSubviews()

        // Update resting pill to fill bounds with pill shape
        restingPillView.frame = bounds
        restingPillView.layer.cornerRadius = cornerRadiusOverride >= 0
            ? cornerRadiusOverride
            : min(bounds.width, bounds.height) / 2
        // 静止药丸与抬起玻璃同为胶囊形态：不跟随系统默认曲线（iOS 26 起默认
        // continuous 会让贴边的圆角呈方形超椭圆观感）
        restingPillView.layer.cornerCurve = .circular

        // Vendored：抬起期间宿主任何一次重布局（圆角 override 更新、尺寸变化、
        // span 退出复位 frame）都同步重申玻璃的圆角与 circular 曲线，保证任何
        // 状态下透镜都是标准胶囊/圆角矩形，不会退化为方形。
        // layer.cornerRadius 由 LiquidGlassView.updateUniforms 同步进 shader
        // （折射形状跟随），无需单独传 uniforms。
        if isLifted {
            let halfShortSide = min(bounds.width, bounds.height) / 2
            liquidGlassView.layer.cornerRadius = cornerRadiusOverride >= 0
                ? min(cornerRadiusOverride, halfShortSide)
                : halfShortSide
            liquidGlassView.layer.cornerCurve = .circular
        }
    }

    // MARK: - Protocol Methods

    public func setLiftedContainerView(_ containerView: UIView?) {
        liftedContainerView = containerView
    }

    public func setLiftedContentView(_ contentView: UIView?) {
        liftedContentView = contentView
    }

    public func setOverridePunchoutView(_ punchoutView: UIView?) {
        overridePunchoutView = punchoutView
    }

    @objc public func setLifted(_ lifted: Bool, animated: Bool, alongsideAnimations: (() -> Void)?, completion: ((Bool) -> Void)?) {
        guard isLifted != lifted else {
            completion?(true)
            return
        }

        isLifted = lifted

        if lifted {
            liftUp(animated: animated, alongsideAnimations: alongsideAnimations, completion: completion)
        } else {
            liftDown(animated: animated, alongsideAnimations: alongsideAnimations, completion: completion)
        }
    }

    public func setLiftedContentMode(_ contentMode: Int) {
        self.liftedContentMode = contentMode
    }

    public func setStyle(_ style: Int) {
        self.style = style
    }

    public func setWarpsContentBelow(_ warpsContentBelow: Bool) {
        self.warpsContentBelow = warpsContentBelow
    }

    // MARK: - Private Lift Animation

    /// Morphs to the liquid glass view（上游 liftUp：0.4 spring / damping 0.7）。
    private func liftUp(animated: Bool, alongsideAnimations: (() -> Void)?, completion: ((Bool) -> Void)?) {
        // Prepare liquid glass view at same position
        liquidGlassView.frame = bounds
        // 抬起玻璃的圆角按 override 与短边一半现算并强制 circular 曲线：透镜恒为
        // 圆角胶囊，不跟随系统默认（continuous 指数 4 会呈方形超椭圆观感）。
        let halfShortSide = min(bounds.width, bounds.height) / 2
        liquidGlassView.layer.cornerRadius = cornerRadiusOverride >= 0
            ? min(cornerRadiusOverride, halfShortSide)
            : halfShortSide
        liquidGlassView.layer.cornerCurve = .circular
        liquidGlassView.alpha = 0
        addSubview(liquidGlassView)

        // Start position tracking for acceleration-based squash/stretch
        startPositionTracking()

        let animations = {
            // Fade out resting pill
            self.restingPillView.alpha = 0

            // Fade in liquid glass
            self.liquidGlassView.alpha = 1

            alongsideAnimations?()
        }

        let animationCompletion: (Bool) -> Void = { finished in
            completion?(finished)
        }

        if animated {
            UIView.animate(
                withDuration: 0.4,
                delay: 0,
                usingSpringWithDamping: 0.7,
                initialSpringVelocity: 0,
                options: [.beginFromCurrentState, .allowUserInteraction],
                animations: animations,
                completion: animationCompletion
            )
        } else {
            animations()
            animationCompletion(true)
        }
    }

    /// Morphs back to resting (hidden, aligned upstream liftDown: 0.5 spring / damping 0.8).
    private func liftDown(animated: Bool, alongsideAnimations: (() -> Void)?, completion: ((Bool) -> Void)?) {
        // Stop position tracking
        stopPositionTracking()

        // Prepare resting pill for fade in
        restingPillView.alpha = 0

        let animations = {
            // Fade in resting pill
            self.restingPillView.alpha = 1

            // Fade out liquid glass（回落为静止药丸常显）
            self.liquidGlassView.alpha = 0

            alongsideAnimations?()
        }

        let animationCompletion: (Bool) -> Void = { finished in
            guard finished else {
                completion?(finished)
                return
            }
            // Clean up liquid glass view
            self.liquidGlassView.removeFromSuperview()
            self.liquidGlassView.alpha = 1
            completion?(finished)
        }

        if animated {
            UIView.animate(
                withDuration: 0.5,
                delay: 0,
                usingSpringWithDamping: 0.8,
                initialSpringVelocity: 0,
                options: [.beginFromCurrentState, .allowUserInteraction],
                animations: animations,
                completion: animationCompletion
            )
        } else {
            animations()
            animationCompletion(true)
        }
    }

    // MARK: - Position Tracking & Acceleration

    private func startPositionTracking() {
        positionHistory.removeAll()
        displayLink = CADisplayLink(target: self, selector: #selector(updatePositionTracking))
        displayLink?.add(to: .main, forMode: .common)
    }

    private func stopPositionTracking() {
        displayLink?.invalidate()
        displayLink = nil
        positionHistory.removeAll()
        // Reset liquid glass view to original bounds
        liquidGlassView.frame = bounds
    }

    @objc private func updatePositionTracking() {
        let currentTime = CACurrentMediaTime()
        let currentPosition = layer.position

        // Add current position to history
        positionHistory.append((position: currentPosition, timestamp: currentTime))

        // Remove old entries outside the time window
        let cutoffTime = currentTime - accelerationWindowDuration
        positionHistory.removeAll { $0.timestamp < cutoffTime }

        // Calculate average acceleration and apply size change
        let acceleration = calculateAverageAcceleration()
//        print(acceleration)
        applyAccelerationSize(acceleration)
    }

    /// Calculates the average acceleration over the position history.
    /// Returns a combined value where positive = accelerating right/up, negative = accelerating left/down.
    private func calculateAverageAcceleration() -> CGFloat {
        guard positionHistory.count >= 3 else { return 0 }

        // Calculate velocities between consecutive position samples
        var velocities: [(velocity: CGPoint, timestamp: TimeInterval)] = []
        for i in 1..<positionHistory.count {
            let prev = positionHistory[i - 1]
            let curr = positionHistory[i]
            let dt = curr.timestamp - prev.timestamp
            guard dt > 0 else { continue }
            let velocity = CGPoint(
                x: (curr.position.x - prev.position.x) / dt,
                y: (curr.position.y - prev.position.y) / dt
            )
            let midTime = (prev.timestamp + curr.timestamp) / 2
            velocities.append((velocity: velocity, timestamp: midTime))
        }

        guard velocities.count >= 2 else { return 0 }

        // Calculate accelerations between consecutive velocity samples
        var totalAccelerationX: CGFloat = 0
        var totalAccelerationY: CGFloat = 0
        var count: CGFloat = 0

        for i in 1..<velocities.count {
            let prev = velocities[i - 1]
            let curr = velocities[i]
            let dt = curr.timestamp - prev.timestamp
            guard dt > 0 else { continue }
            totalAccelerationX += (curr.velocity.x - prev.velocity.x) / dt
            totalAccelerationY += (curr.velocity.y - prev.velocity.y) / dt
            count += 1
        }

        guard count > 0 else { return 0 }

        // Calculate average acceleration and apply size change
        // Combine accelerations:
        // - Positive X acceleration (right) or negative Y acceleration (up in UIKit coords) → stretch X
        // - Negative X acceleration (left) or positive Y acceleration (down) → squash X
        // In UIKit, Y increases downward, so upward movement = negative Y velocity,
        // and accelerating upward = negative Y acceleration.
        // We want upward acceleration to have the same effect as rightward acceleration,
        // so we subtract Y acceleration from X acceleration.
        let avgAccelerationX = totalAccelerationX / count
        let avgAccelerationY = totalAccelerationY / count
        return avgAccelerationX - avgAccelerationY
    }

    /// Applies squash/stretch size change to liquidGlassView based on acceleration.
    private func applyAccelerationSize(_ acceleration: CGFloat) {
        let scaleFactor = acceleration * accelerationScaleCoefficient

        // Clamp to reasonable range for visual stability
        let clampedScale = max(-maxScaleDeviation, min(maxScaleDeviation, scaleFactor))

        // Apply opposite scale to width and height to create squash/stretch effect
        // Positive acceleration → stretch width, squash height
        // Negative acceleration → squash width, stretch height
        let scaleX = 1 + clampedScale
        let scaleY = 1 - clampedScale

        let newWidth = bounds.width * scaleX
        let newHeight = bounds.height * scaleY

        // Center the new frame within bounds
        liquidGlassView.frame = CGRect(
            x: (bounds.width - newWidth) / 2,
            y: (bounds.height - newHeight) / 2,
            width: newWidth,
            height: newHeight
        )
    }
}

@MainActor @objc public protocol AnyLiquidLensView {
    init()
    init(restingBackground backgroundView: UIView?)
    var restingBackgroundColor: UIColor? { get set }
    func setLiftedContainerView(_ containerView: UIView?)
    func setLiftedContentView(_ contentView: UIView?)
    func setOverridePunchoutView(_ punchoutView: UIView?)
    func setLifted(_ lifted: Bool, animated: Bool, alongsideAnimations: (() -> Void)?, completion: ((Bool) -> Void)?)
    func setLiftedContentMode(_ contentMode: Int)
    func setStyle(_ style: Int)
    func setWarpsContentBelow(_ warpsContentBelow: Bool)
}

public typealias UILiquidLensView = UIView & AnyLiquidLensView

/// Vendored addition: ObjC-visible construction entry. Swift initializers on UIView
/// subclasses are not exposed to ObjC without @objc, and `init()` mapping is unreliable
/// across toolchains — the RN view manager creates the lens through this factory.
@objc public final class LGLensFactory: NSObject {

    /// UIView 初始化是 MainActor 隔离的；RN 的 view 创建固定发生在主线程。
    /// 恒返回自研液态透镜（LiquidGlassView(.lens) 引擎）——与上游一致：上游
    /// LiquidLensView 本身就是对系统私有 _UILiquidLensView 的自研复刻，从不调用
    /// 该私有类。曾试验过 iOS 26+ 直接实例化系统私有类，已废弃：私有类不响应
    /// 我们的方法面（setTargetX/setLifted 等是上游自研 API 的名字，非系统
    /// selector——class_addProtocol 只挂声明不给实现），宿主直调必然
    /// unrecognized selector 闪退；且其圆角/形状由系统内部决定，无法与宿主
    /// tab 栏圆角对齐。
    @objc @MainActor public static func createLens() -> UIView {
        return LiquidLensView()
    }
}
