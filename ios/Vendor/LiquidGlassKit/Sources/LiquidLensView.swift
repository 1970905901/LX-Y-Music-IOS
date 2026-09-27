//
//  LiquidLensView.swift
//  LiquidGlass (vendored from DnV1eX/LiquidGlassKit)
//
//  Created by Alexey Demin on 2025-12-19.
//  Vendored modifications for LX Music CocoaPods static-lib build (CI: Xcode 15.4 / Swift 5.10):
//  1. `internal import` (Swift 6.0+ syntax) replaced with plain `import`.
//  2. `restingBackgroundColor` / `setLifted(...)` marked `@objc` and a small `LGLensFactory`
//     added — the React Native view manager (LiquidGlassViewManager.mm) drives the lens
//     from ObjC, and Swift members are not ObjC-visible without explicit @objc.
//  3. Render activity wired into the lift morph: the lens's own LiquidGlassView uses the
//     vendored demand-rendering clock (paused by default), so liftUp starts it and liftDown
//     stops it — the lens costs nothing while resting.
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

    /// The liquid glass view shown when lifted.
    private let liquidGlassView = LiquidGlassView(.lens)

    // MARK: - Protocol Properties

    @objc public var restingBackgroundColor: UIColor? {
        get { restingPillView.backgroundColor }
        set { restingPillView.backgroundColor = newValue }
    }

    /// Vendored addition: 主题染色转发到透镜内部的 LiquidGlassView（与底部栏玻璃同一
    /// 材质色）。不设置时 .lens 预设近乎透明，滑过深色内容会呈现黑团（闪黑）。
    @objc public func setLensTintColor(_ color: UIColor?) {
        liquidGlassView.liquidGlass.tintColor = color
        fallbackTintOverlay?.backgroundColor = color
    }

    // MARK: - 拖拽磨砂回退

    /// Vendored addition: 拖拽期间切系统磨砂实时回退（宿主拖拽状态机驱动）。
    /// YES = 停止 Metal 逐帧捕获、磨砂实时接管；NO = 恢复实时折射（补新鲜帧）。
    /// 仅在抬起态有效；非拖拽的抬起（点击滑动 morph）不受影响。
    @objc public func setBlurFallback(_ active: Bool) {
        guard isLifted else { return }
        if active {
            isBlurFallbackActive = true
            ensureBlurFallback()
            layoutFallbackBlur()
            liquidGlassView.setRenderActive(false)
            UIView.animate(withDuration: 0.1) {
                self.liquidGlassView.alpha = 0
                self.fallbackBlurView?.alpha = 1
            }
        } else {
            isBlurFallbackActive = false
            liquidGlassView.setRenderActive(true)
            UIView.animate(withDuration: 0.22) {
                self.liquidGlassView.alpha = 1
                self.fallbackBlurView?.alpha = 0
            }
        }
    }

    private func ensureBlurFallback() {
        guard fallbackBlurView == nil else { return }
        // systemUltraThinMaterial：最轻磨砂档，与液态玻璃近透明的静止观感差最小
        // （理由同 LiquidGlassEffectView.setupFallbackBlur）
        let blur = UIVisualEffectView(effect: UIBlurEffect(style: .systemUltraThinMaterial))
        blur.isUserInteractionEnabled = false
        blur.alpha = 0
        blur.layer.cornerCurve = .circular
        let overlay = UIView()
        overlay.isUserInteractionEnabled = false
        overlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        overlay.backgroundColor = liquidGlassView.liquidGlass.tintColor
        blur.contentView.addSubview(overlay)
        addSubview(blur)
        fallbackBlurView = blur
        fallbackTintOverlay = overlay
    }

    /// 磨砂层跟随玻璃几何：frame 抄 liquidGlassView（含挤压/拉伸后的瞬时 frame）、
    /// 圆角抄其 layer，两种材质形状完全一致。
    private func layoutFallbackBlur() {
        guard let blur = fallbackBlurView else { return }
        blur.frame = liquidGlassView.frame
        blur.layer.cornerRadius = liquidGlassView.layer.cornerRadius
        fallbackTintOverlay?.frame = blur.contentView.bounds
    }

    /// Vendored addition: 多矩形玻璃（kit frames 能力）——拖拽跨 tab 时传入「原 tab +
    /// 目标 tab」两个矩形，shader 将其合并为一块连续玻璃（胶囊拉伸变形）。
    /// 传空数组恢复单矩形（即自身 bounds）。
    @objc public func setLensFrames(_ rects: [NSValue]) {
        liquidGlassView.frames = rects.map { $0.cgRectValue }
        spanFramesActive = !rects.isEmpty
    }

    /// Vendored addition: 手指位置驱动的眩光（玻璃坐标系）
    @objc public func setLensTouchPoint(_ point: CGPoint) {
        liquidGlassView.touchPoint = point
    }

    @objc public func clearLensTouchPoint() {
        liquidGlassView.touchPoint = nil
    }

    /// Vendored addition: frames 合并进行中（宿主把透镜本体拉伸为跨 tab span），
    /// 此时跳过挤压/拉伸尺寸动画，避免与 span 尺寸互相打架
    private var spanFramesActive = false

    // MARK: - 拖拽实时磨砂回退（vendored，与 LiquidGlassEffectView 同思路）
    // 长按拖拽可持续数秒，Metal 实时折射必须逐帧整窗 drawHierarchy（iOS 26 无便宜
    // 背景路径），是透镜拖拽掉帧的根源；拖拽期间透镜高速移动，切系统磨砂（GPU
    // backdrop 合成，实时且零逐帧成本）观感无损。抬起 morph/点击滑动的时长有界
    //（≤0.5s），保留 Metal 实时折射展示「液态」质感。

    private var fallbackBlurView: UIVisualEffectView?
    private var fallbackTintOverlay: UIView?
    private var isBlurFallbackActive = false

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

        // Setup liquid glass view - initially hidden
        liquidGlassView.alpha = 0
        liquidGlassView.isUserInteractionEnabled = false
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

        // Update liquid glass view to same bounds
//        liquidGlassView.frame = bounds
//        liquidGlassView.layer.cornerRadius = min(bounds.width, bounds.height) / 2

        // Vendored（修「透镜偶发变矩形」）：抬起期间宿主任何一次重布局（圆角
        // override 更新、尺寸变化、span 退出复位 frame）都同步重申玻璃的圆角与
        // circular 曲线——玻璃的形状此前只在 liftUp 赋值一次，抬起期间发生的一切
        // 变化（含曲线被系统/宿主改动为 continuous → 指数 4 → 近矩形）都无人纠正。
        if isLifted {
            let halfShortSide = min(bounds.width, bounds.height) / 2
            liquidGlassView.layer.cornerRadius = cornerRadiusOverride >= 0
                ? min(cornerRadiusOverride, halfShortSide)
                : halfShortSide
            liquidGlassView.layer.cornerCurve = .circular
            if isBlurFallbackActive {
                layoutFallbackBlur()
            }
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

    /// Morphs from resting pill to liquid glass view.
    private func liftUp(animated: Bool, alongsideAnimations: (() -> Void)?, completion: ((Bool) -> Void)?) {
        // Prepare liquid glass view at same position
        liquidGlassView.frame = bounds
        // Vendored（修「透镜偶发变矩形」）：圆角不取 restingPill 当前值——它依赖
        // layoutSubviews 时序，宿主几何短暂无效（首帧/样式未应用）时曾被推成 0，
        // shader 的圆角 SDF 以 0 渲染即矩形，且玻璃只在 liftUp 赋值一次、抬起期间
        // 无处纠正。直接按 override 与短边一半现算，保证抬起的玻璃必为胶囊形态。
        let halfShortSide = min(bounds.width, bounds.height) / 2
        liquidGlassView.layer.cornerRadius = cornerRadiusOverride >= 0
            ? min(cornerRadiusOverride, halfShortSide)
            : halfShortSide
        // 显式强制 circular 曲线（shader 超椭圆指数 = 2 = 圆）：透镜玻璃的圆角恒等于
        // 胶囊短边一半，若系统默认曲线为 continuous（指数 4 = 方形超椭圆），整个形状
        // 会退化为近似矩形。透镜必须是圆角胶囊，故不跟随系统默认。
        liquidGlassView.layer.cornerCurve = .circular
        liquidGlassView.alpha = 0
        addSubview(liquidGlassView)

        // 上一次拖拽若以异常路径结束，磨砂层可能残留可见：重新抬起时强制隐藏，
        // 液态玻璃（morph 动画）始终是抬起的初始材质
        fallbackBlurView?.alpha = 0
        isBlurFallbackActive = false

        // Vendored: the glass view runs the demand-rendering clock (paused by default) —
        // start it while lifted, stop it when resting again.
        liquidGlassView.setRenderActive(true)
        // Vendored（透镜拖拽掉帧缓解）：活跃期逐帧捕获走整窗 drawHierarchy（iOS 26 无
        // CABackdropLayer 便宜路径），且拖拽中玻璃处于变形动画、每次捕获还带
        // afterScreenUpdates 强制同步提交，60fps 下代价极高。透镜本体小且始终处于
        // 运动中，压到 30fps 减半捕获开销，视觉差异不可感知。
        liquidGlassView.preferredFramesPerSecond = 30

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
            // Clean up resting pill state
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

    /// Morphs from liquid glass view back to resting pill.
    private func liftDown(animated: Bool, alongsideAnimations: (() -> Void)?, completion: ((Bool) -> Void)?) {
        // Stop position tracking
        stopPositionTracking()

        // Prepare resting pill for fade in
        restingPillView.alpha = 0

        let animations = {
            // Fade in resting pill
            self.restingPillView.alpha = 1

            // Fade out liquid glass
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
            // Vendored: back to resting — pause the glass render clock (battery)
            self.liquidGlassView.setRenderActive(false)
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
        // Reset liquidGlassView to original bounds
        liquidGlassView.frame = bounds
        if isBlurFallbackActive {
            layoutFallbackBlur()
        }
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
        // frames 合并（span）模式下玻璃尺寸由宿主决定，跳过挤压/拉伸
        if spanFramesActive { return }
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
        // 磨砂回退层跟随挤压/拉伸的瞬时 frame，两种材质形变一致
        if isBlurFallbackActive {
            layoutFallbackBlur()
        }
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
    /// 统一返回自研 Metal 透镜：iOS 26 系统私有 _UILiquidLensView 的圆角/形状由
    /// 系统内部决定（恒为胶囊，setLensCornerRadius 不可达），无法与宿主 tab 栏的
    /// 圆角对齐；自研类形状完全受控（setLensCornerRadius / frames / tint）。
    @objc @MainActor public static func createLens() -> UIView {
        return LiquidLensView()
    }
}
