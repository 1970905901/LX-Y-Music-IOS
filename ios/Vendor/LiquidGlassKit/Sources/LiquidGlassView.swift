//
//  LiquidGlassView.swift
//  LiquidGlass (vendored from DnV1eX/LiquidGlassKit)
//
//  Created by Alexey Demin on 2025-12-05.
//  Vendored modifications for LX Music CocoaPods static-lib build (CI: Xcode 15.4 / Swift 5.10):
//  1. `internal import` (Swift 6.0+ syntax) replaced with plain `import`.
//  2. Shader loading switched from SwiftPM-precompiled default.metallib to on-device
//     runtime compilation via MTLDevice.makeLibrary(source:) using embedded MSL sources
//     (see LiquidGlassShaderSource.swift) — CI needs no Metal compile step, and a static
//     library pod has no resource bundle to hold a metallib.
//  3. Root-view capture (iOS 26.2+) rewritten: the capture hides the whole glass widget
//     root (MTK output AND the foreground content above the glass) with
//     `afterScreenUpdates: true`, plus a static-capture throttle. The previous scheme
//     (MTK-only hiding + `afterScreenUpdates: false`) leaked foreground icons and the
//     glass's own previous frame into the background texture — refracted into growing
//     dark smears on real devices (iOS 26.2+/27): in-stack isHidden is only reflected
//     by drawHierarchy after a commit, because `false` captures the last COMMITTED
//     composite. See captureRootView and LICENSE-NOTES.md #7.
//  Upstream: Copyright © 2025 DnV1eX, https://github.com/DnV1eX/LiquidGlassKit
//

import UIKit
import simd
import MetalKit
import MetalPerformanceShaders

struct LiquidGlass {

    /// Maximum number of rectangles supported in the shader.
    static let maxRectangles = 16

    /// Mirror the Metal 'ShaderUniforms' exactly for buffer binding.
    struct ShaderUniforms {
        var resolution: SIMD2<Float> = .zero        // Frame size in pixels.
        var contentsScale: Float = .zero            // Scale factor. 2 for Retina; 3 for Super Retina.
        var touchPoint: SIMD2<Float> = .zero        // Touch position in points (upper-left origin).
        var shapeMergeSmoothness: Float = .zero     // Specifies the distance between elements at which they begin to merge (spacing).
        var cornerRadius: Float = .zero             // Base rounding (e.g., 24 for subtle chamfer). Circle if half the side.
        var cornerRoundnessExponent: Float = 2      // 1 = diamond; 2 = circle; 4 = squircle.
        var materialTint: SIMD4<Float> = .zero      // RGBA; e.g., subtle cyan (0.2, 0.8, 1.0, 1.0)
        var glassThickness: Float                   // Fake parallax depth (e.g., 8-16 px)
        var refractiveIndex: Float                  // 1.45-1.52 for borosilicate glass feel
        var dispersionStrength: Float               // 0.0-0.02; prismatic color split on edges
        var fresnelDistanceRange: Float             // px falloff from silhouette (e.g., 32)
        var fresnelIntensity: Float                 // 0.0-1.0; rim lighting boost
        var fresnelEdgeSharpness: Float             // Power 1.0=linear, 8.0=crisp
        var glareDistanceRange: Float               // Similar to fresnel, but for specular streaks
        var glareAngleConvergence: Float            // 0.0-π; focuses rays toward light dir
        var glareOppositeSideBias: Float            // >1.0 amplifies back-side highlights
        var glareIntensity: Float                   // 1.0-4.0; bloom-like edge fire
        var glareEdgeSharpness: Float               // Matches fresnel for consistency
        var glareDirectionOffset: Float             // Radians; tilts streak asymmetry
        var rectangleCount: Int32 = .zero           // Number of active rectangles
        var rectangles: (                           // Array of rectangles (x, y, width, height) in points, upper-left origin.
            SIMD4<Float>, SIMD4<Float>, SIMD4<Float>, SIMD4<Float>,
            SIMD4<Float>, SIMD4<Float>, SIMD4<Float>, SIMD4<Float>,
            SIMD4<Float>, SIMD4<Float>, SIMD4<Float>, SIMD4<Float>,
            SIMD4<Float>, SIMD4<Float>, SIMD4<Float>, SIMD4<Float>
        ) = (.zero, .zero, .zero, .zero, .zero, .zero, .zero, .zero,
             .zero, .zero, .zero, .zero, .zero, .zero, .zero, .zero)
    }

    let shaderUniforms: ShaderUniforms
    let backgroundTextureSizeCoefficient: Double
    let backgroundTextureScaleCoefficient: Double
    let backgroundTextureBlurRadius: Double
    var tintColor: UIColor?
    var shadowOverlay: Bool = false

    static func thumb(magnification: Double = 1) -> Self {
        .init(
            shaderUniforms: .init(
                materialTint: .init(x: 0.9, y: 0.95, z: 1.0, w: 0.15), // Near-clear with cool bias.
                glassThickness: 10,
                refractiveIndex: 1.11,
                dispersionStrength: 5,
                fresnelDistanceRange: 70,
                fresnelIntensity: 0,
                fresnelEdgeSharpness: 0,
                glareDistanceRange: 30,
                glareAngleConvergence: 0,
                glareOppositeSideBias: 0,
                glareIntensity: 0.01,
                glareEdgeSharpness: -0.2,
                glareDirectionOffset: .pi * 0.9
            ),
            backgroundTextureSizeCoefficient: 1 / magnification,
            backgroundTextureScaleCoefficient: magnification,
            backgroundTextureBlurRadius: 0,
            shadowOverlay: true
        )
    }

    static let lens = Self.init(
        shaderUniforms: .init(
            glassThickness: 6,
            refractiveIndex: 1.1,
            dispersionStrength: 15,
            fresnelDistanceRange: 70,
            fresnelIntensity: 0,
            fresnelEdgeSharpness: 0,
            glareDistanceRange: 30,
            glareAngleConvergence: 0.1,
            glareOppositeSideBias: 1,
            glareIntensity: 0.1,
            glareEdgeSharpness: -0.1,
            glareDirectionOffset: -.pi / 4
        ),
        backgroundTextureSizeCoefficient: 1.1,
        backgroundTextureScaleCoefficient: 0.8,
        backgroundTextureBlurRadius: 0,
        shadowOverlay: true
    )

    static let regular = Self.init(
        shaderUniforms: .init(
            glassThickness: 10,
            refractiveIndex: 1.5,
            dispersionStrength: 5,
            fresnelDistanceRange: 70,
            fresnelIntensity: 0,
            fresnelEdgeSharpness: 0,
            glareDistanceRange: 30,
            glareAngleConvergence: 0.1,
            glareOppositeSideBias: 1,
            glareIntensity: 0.1,
            glareEdgeSharpness: -0.15,
            glareDirectionOffset: -.pi / 4
        ),
        backgroundTextureSizeCoefficient: 1,
        backgroundTextureScaleCoefficient: 0.2,
        backgroundTextureBlurRadius: 0.3,
        tintColor: UIColor { $0.userInterfaceStyle == .dark ? #colorLiteral(red: 0, green: 0.04958364581, blue: 0.09951775161, alpha: 0.7981493615) : #colorLiteral(red: 0.9023525731, green: 0.9509486998, blue: 1, alpha: 0.8002892298) }//.systemBackground.withAlphaComponent(0.8),
    )

    /// Vendored addition: 纯透明玻璃 —— 不随主题明暗变化、几乎无染色、不做模糊，
    /// 只保留折射与边缘光，背景直接透过（对齐 iOS 26 原生 .clear 变体的观感）。
    /// tintColor 为 nil：materialTint 直接用上面的极淡值，updateUniforms 不再覆盖。
    static let clear = Self.init(
        shaderUniforms: .init(
            materialTint: .init(x: 1, y: 1, z: 1, w: 0.08),
            glassThickness: 8,
            refractiveIndex: 1.45,
            dispersionStrength: 8,
            fresnelDistanceRange: 70,
            fresnelIntensity: 0.3,
            fresnelEdgeSharpness: 2,
            glareDistanceRange: 30,
            glareAngleConvergence: 0.1,
            glareOppositeSideBias: 1,
            glareIntensity: 0.12,
            glareEdgeSharpness: -0.15,
            glareDirectionOffset: -.pi / 4
        ),
        backgroundTextureSizeCoefficient: 1,
        backgroundTextureScaleCoefficient: 0.5,
        backgroundTextureBlurRadius: 0,
        shadowOverlay: true
    )
}

final class BackdropView: UIView {

    /// iOS 26 重构了 backdrop 私有机制，`CABackdropLayer` 可能被移除/改名。
    /// 该类不存在时 `layerClass` 退化成 `CALayer`，此时对普通 CALayer 设置私有
    /// KVC key 会抛 `NSUnknownKeyException` 导致启动崩溃。故仅在 layer 确为
    /// `CABackdropLayer` 时才写私有属性，否则标记为不可用、捕获时跳过。
    private static let backdropLayerClass: AnyClass? = NSClassFromString("CABackdropLayer")

    override class var layerClass: AnyClass {
        backdropLayerClass ?? CALayer.self
    }

    /// 真正的 CABackdropLayer 是否可用（决定 captureBackdrop 是否能工作）
    var isBackdropAvailable: Bool {
        guard let cls = BackdropView.backdropLayerClass else { return false }
        return layer.isKind(of: cls)
    }

    init() {
        super.init(frame: .zero)

        // Configure backdrop view
        isUserInteractionEnabled = false

        // 仅对真正的 CABackdropLayer 写私有属性；普通 CALayer 上写未知 key 会崩溃（iOS 26 常见）。
        guard isBackdropAvailable else { return }

        layer.setValue(false, forKey: "layerUsesCoreImageFilters")

        // Configure backdrop layer properties (private API)
        layer.setValue(true, forKey: "windowServerAware")
        layer.setValue(UUID().uuidString, forKey: "groupName")
//        layer.setValue(1.0, forKey: "scale")  // Full resolution for capture
//        layer.setValue(0.0, forKey: "bleedAmount")
//        layer.setValue(false, forKey: "allowsHitTesting")
//        layer.setValue(true, forKey: "captureOnly")
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
}

final class ShadowView: UIView {

    init() {
        super.init(frame: .zero)

        isUserInteractionEnabled = false
        // 注：曾用 compositingFilter = "multiplyBlendMode" 合成阴影。CA 合成滤镜在
        // 图层动画/变形期间会失效，失效时该图层直接以黑色原样绘制——表现为收起/
        // 展开转场与透镜拖动时，胶囊边缘出现粗黑弧。移除合成滤镜后阴影以普通
        // 图层渲染，动画期间稳定。
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func layoutSubviews() {
        super.layoutSubviews()

        let shadowRadius = 3.5
        let path = UIBezierPath(roundedRect: bounds.insetBy(dx: -1, dy: -shadowRadius / 2), cornerRadius: bounds.height / 2)
        let innerPill = UIBezierPath(roundedRect: bounds.insetBy(dx: 0, dy: shadowRadius / 2), cornerRadius: bounds.height / 2).reversing()
        path.append(innerPill)
        layer.shadowPath = path.cgPath
        layer.shadowRadius = shadowRadius
        layer.shadowOpacity = 0.2
        layer.shadowOffset = .init(width: 0, height: shadowRadius + 2)
    }
}

final class LiquidGlassRenderer {
    @MainActor static let shared = LiquidGlassRenderer()

    let device: MTLDevice
    /// nil 表示 shader 编译失败（如 iOS 26 Metal 运行时更严格）：此时玻璃退化为透明，
    /// 不致命崩溃，App 仍可正常使用。
    let pipelineState: MTLRenderPipelineState?

    private init() {
        guard let device = MTLCreateSystemDefaultDevice() else {
            fatalError("Metal not supported")
        }
        self.device = device
        self.pipelineState = LiquidGlassRenderer.buildPipeline(device: device)
    }

    /// 运行时编译 shader 并构建渲染管线；任何一步失败返回 nil（降级透明，不崩溃）。
    private static func buildPipeline(device: MTLDevice) -> MTLRenderPipelineState? {
        do {
            // Runtime shader compilation happens on-device, so the CI toolchain never
            // needs a Metal compiler and no metallib resource bundle is required.
            // (Upstream loads a SwiftPM-precompiled default.metallib here instead.)
            // 两个 MSL 必须各自独立编译：两份源码都定义了 VertexOutput（上游是两个
            // .metal 编译单元进同一个 metallib），拼成一个 source 会报重定义错误。
            let vertexLibrary = try device.makeLibrary(source: LiquidGlassShaderSource.vertex, options: nil)
            let fragmentLibrary = try device.makeLibrary(source: LiquidGlassShaderSource.fragment, options: nil)

            guard let vertexFunction = vertexLibrary.makeFunction(name: "fullscreenQuad"),
                  let fragmentFunction = fragmentLibrary.makeFunction(name: "liquidGlassEffect") else {
                return nil
            }

            let pipelineDescriptor = MTLRenderPipelineDescriptor()
            pipelineDescriptor.vertexFunction = vertexFunction
            pipelineDescriptor.fragmentFunction = fragmentFunction
            pipelineDescriptor.colorAttachments[0].pixelFormat = .bgra8Unorm  // Match MTKView

            return try device.makeRenderPipelineState(descriptor: pipelineDescriptor)
        } catch {
            print("[LiquidGlass] shader/pipeline build failed, falling back to transparent glass: \(error)")
            return nil
        }
    }
}

/// 全部存活玻璃实例的 weak 注册表（非隔离存储，init/deinit 均可安全访问）。
/// 截背景时必须互相排除：若只隐藏 self，屏幕上其它玻璃（底部栏透镜、迷你播放器
/// 等都是 LiquidGlassView）的 Metal 暗色内容会被 drawHierarchy 画进背景纹理，
/// 经折射偏移后形成胶囊旁黑影（迷你播放器右侧 / 切 tab 时透镜周围）。
private final class GlassInstanceRegistry {
    static let shared = GlassInstanceRegistry()
    let instances = NSHashTable<AnyObject>.weakObjects()

    func add(_ view: LiquidGlassView) {
        instances.add(view)
    }

    /// 本窗口内需要从截屏排除的「玻璃组件根」（按身份去重 + 去掉互相包含的子根）：
    /// 每个实例解析为 captureExclusionView（nil → 所在 LiquidGlassEffectView → 实例
    /// 自身）。隐藏父级根即同时覆盖其下所有玻璃的 MTK 输出与玻璃上方的前景内容；
    /// 单独隐藏 MTK 不够——挂在玻璃上方的前景（RN 图标/按钮）也会被截进背景纹理。
    func exclusionRoots(in window: UIWindow?) -> [UIView] {
        var roots: [UIView] = []
        var seen = Set<ObjectIdentifier>()
        for instance in instances.allObjects {
            guard let glass = instance as? LiquidGlassView, glass.window === window else { continue }
            let root = glass.captureExclusionView ?? (glass.superview as? LiquidGlassEffectView) ?? glass
            if seen.insert(ObjectIdentifier(root)).inserted { roots.append(root) }
        }
        return roots.filter { view in !roots.contains { $0 !== view && view.isDescendant(of: $0) } }
    }
}

final class LiquidGlassView: MTKView {

    // var 而非 let：LiquidGlassEffectView.setGlassTintColor 会写入 tintColor 成员。
    // Swift 的可变性规则下，经 let 属性访问 struct 连成员赋值都被拒绝（需要写回整个属性）。
    var liquidGlass: LiquidGlass

    var commandQueue: MTLCommandQueue!
    var uniformsBuffer: MTLBuffer!
    var zeroCopyBridge: ZeroCopyBridge!

    // Background texture for the shader
    private var backgroundTexture: MTLTexture?

    /// Whether to automatically capture superview on each frame.
    /// Set to false for manual control via `captureBackground()`.
    var autoCapture: Bool = true

    /// 捕获背景时要隐藏的「玻璃组件根」。nil → 所在 LiquidGlassEffectView（覆盖其
    /// contentView 里的前景）→ 自身。RN 宿主通过 setCaptureExclusionView: 把它指向
    /// 宿主视图——RN 前景内容（tab 图标/播放条按钮）挂在宿主上而非 contentView，
    /// 不排除就会被打进背景纹理，经 0.2x 降采样折射放大成图标形状的黑影。
    weak var captureExclusionView: UIView?

    /// 静止节流：捕获矩形未变时背景重捕的最小间隔（秒）。drawHierarchy
    /// (afterScreenUpdates: true) 每次都强制整窗提交，静止玻璃逐帧捕获纯属浪费；
    /// 节流期间 shader 用上一帧纹理继续逐帧渲染（触摸眩光等动效不受影响）。
    /// 捕获矩形变化（变形/位移动画）时不节流，保持上游连续捕获。
    private let staticCaptureInterval: TimeInterval = 0.08
    private var lastCaptureAt: TimeInterval = 0
    private var lastCapturedRect: CGRect?

    var touchPoint: CGPoint? = nil

    var frames: [CGRect] = []

    // Backdrop capture view (stays in superview, contains only CABackdropLayer)
    private let backdropView = BackdropView()

    init(_ liquidGlass: LiquidGlass) {
        self.liquidGlass = liquidGlass

        super.init(frame: .zero, device: LiquidGlassRenderer.shared.device)

        GlassInstanceRegistry.shared.add(self)

        // shadowOverlay（黑色边缘阴影环）已移除：其黑色环影在转场/拖动中被感知为
        // "黑弧"，且 multiplyBlend 合成在动画期间会失效变黑块。玻璃边缘定义由
        // shader 自身的 fresnel/glare 提供，不再叠加阴影环。
        setupMetal()
//        layer.shouldRasterize = true
//        preferredFramesPerSecond = 30
//        clipsToBounds = true
//        autoResizeDrawable = false
//        contentMode = .center
    }

    required init(coder: NSCoder) {
        fatalError("init(coder:) not implemented")
    }

    deinit {
        GlassInstanceRegistry.shared.instances.remove(self)
    }

    func setupMetal() {
        guard let device else { return }

        commandQueue = device.makeCommandQueue()!

        // Uniforms buffer (update per frame)
        uniformsBuffer = device.makeBuffer(length: MemoryLayout<LiquidGlass.ShaderUniforms>.stride, options: [])!

        zeroCopyBridge = .init(device: device)

        // Make view transparent so we can see the effect
        isOpaque = false
        layer.isOpaque = false
        // 清屏色全透明：空帧（纹理未就绪等）不改变画面，避免闪黑
        clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)

        isPaused = false
    }

    // MARK: - Background Capture

    func captureBackground() {
        if #available(iOS 26.2, *) {
            captureRootView()
        } else {
            captureBackdrop()
        }
    }

    /// Captures the background content via root View using drawHierarchy.
    ///
    /// iOS 26.2+ 无 CABackdropLayer 可用（系统重构 backdrop 私有机制），退化为公开 API
    /// 整树截图。捕获必须排除两类污染，否则真机（iOS 26.2+/27）出现黑影涂抹：
    /// ① 玻璃组件的**前景内容**（tab 图标/播放条按钮，挂在玻璃上方）被打进背景纹理，
    ///    再被 shader 以 0.2x 降采样折射放大 → 图标形状的软黑影；
    /// ② 玻璃自身/其它玻璃的**上一帧输出**：drawHierarchy(afterScreenUpdates: false)
    ///    截的是「最后一次提交」的合成帧，同栈 isHidden 不生效，玻璃输出每帧被再捕获
    ///    再折射，反馈迭代成大团模糊黑块（迷你播放器右端黑团即此）。
    /// 两者都由「捕获时临时隐藏全部玻璃组件根（含前景）+ afterScreenUpdates: true
    /// （先提交让隐藏进入合成帧）」解决；true 的整窗提交代价对静止玻璃用节流摊薄。
    func captureRootView() {
        guard let rootView = findRootView() else { return }

        let sizeCoefficient = liquidGlass.backgroundTextureSizeCoefficient
        let scaleCoefficient = layer.contentsScale * liquidGlass.backgroundTextureScaleCoefficient

        // Determine our on-screen rect in the root view coordinate space.
        // IMPORTANT: During `UIView.animate`, the view's *model* layer jumps to the final frame
        // immediately; the in-flight position lives in the *presentation* layer. Using the
        // presentation layer makes the captured background track the view while it animates.
        let currentLayer = layer.presentation() ?? layer
        let frameInRoot = currentLayer.convert(currentLayer.bounds, to: rootView.layer)

        // Expand capture area around the MTKView center (in root view coordinates).
        // 【尺寸】必须与背景像素缓冲同源（model bounds，见 layoutSubviews 的
        // setupBuffer），【中心】跟随 presentation 保持动画位置跟踪：逐帧变形动画
        // （迷你播放器收窄/放出、透镜 span 拉伸）期间 presentation 尺寸比 model
        // 慢一拍，若用 presentation 尺寸，变宽瞬间缓冲右/下侧会留下一条
        // drawHierarchy 没画到的黑带，被 shader 折射进胶囊边缘——迷你播放器
        // 放出/收起时右侧黑弧、切 tab 时透镜周围黑影（静止时两者一致故干净）。
        // 再外扩 1 缓冲像素盖住 Int 取整缝隙，保证缓冲无未绘制纹理，
        // clamp_to_edge 边缘采样不会读到黑边。
        let devicePixel = 1.0 / scaleCoefficient
        let captureSize = CGSize(width: bounds.width * sizeCoefficient + devicePixel * 2,
                                 height: bounds.height * sizeCoefficient + devicePixel * 2)
        let captureRectInRoot = CGRect(x: frameInRoot.midX - captureSize.width / 2,
                                       y: frameInRoot.midY - captureSize.height / 2,
                                       width: captureSize.width,
                                       height: captureSize.height)

        // 静止节流：捕获矩形与上次一致（无位移/变形动画）且距上次捕获不足
        // staticCaptureInterval 时直接复用上一帧纹理；纹理未就绪（首帧/缓冲重建）不节流。
        let rectChanged = lastCapturedRect == nil ||
            abs(lastCapturedRect!.midX - captureRectInRoot.midX) > 0.5 ||
            abs(lastCapturedRect!.midY - captureRectInRoot.midY) > 0.5 ||
            abs(lastCapturedRect!.width - captureRectInRoot.width) > 0.5 ||
            abs(lastCapturedRect!.height - captureRectInRoot.height) > 0.5
        let now = CACurrentMediaTime()
        if backgroundTexture != nil, !rectChanged, now - lastCaptureAt < staticCaptureInterval { return }
        lastCaptureAt = now
        lastCapturedRect = captureRectInRoot

        backgroundTexture = zeroCopyBridge.render { context in
            // Hide every glass widget root in this window (self included)：覆盖各玻璃的
            // MTK 输出与其上方前景内容，截到纯净背景。隐藏/恢复在同一调用栈内完成，
            // afterScreenUpdates: true 先提交让隐藏真正进入合成帧——false 时同栈隐藏
            // 不生效，玻璃上一帧输出会被再捕获再折射形成反馈黑影。
            let hiddenRoots = GlassInstanceRegistry.shared.exclusionRoots(in: window).filter { !$0.isHidden }
            for root in hiddenRoots { root.isHidden = true }
            defer { for root in hiddenRoots { root.isHidden = false } }

            // Transform to render the portion of root view under our capture rect:
            context.scaleBy(x: scaleCoefficient, y: scaleCoefficient)
            context.translateBy(x: -captureRectInRoot.origin.x, y: -captureRectInRoot.origin.y)

            // 用官方 drawHierarchy 代替 layer.render(in:) —— 后者在 iOS 26 递归整窗
            // 私有图层（状态栏/键盘/RNN 容器）时极易抛异常崩溃。drawHierarchy 走
            // 标准 UIView 渲染路径，对私有 layer 兼容性更好。
            // 注意：drawHierarchy 需在当前 UIKit 图形上下文内绘制，必须 push/pop context。
            UIGraphicsPushContext(context)
            rootView.drawHierarchy(in: rootView.bounds, afterScreenUpdates: true)
            UIGraphicsPopContext()
        }

        blurTexture()
    }

    /// Captures the background content via CABackdropLayer using drawHierarchy.
    /// Noticeable rendering delay.
    func captureBackdrop() {
        // iOS 26 上 CABackdropLayer 可能不可用（见 BackdropView），不可用则跳过捕获，
        // 玻璃退化为透明（不崩溃，仅失去背后折射内容）。
        guard backdropView.isBackdropAvailable else { return }
        guard let superview else { return }

        let sizeCoefficient = liquidGlass.backgroundTextureSizeCoefficient
        let scaleCoefficient = layer.contentsScale * liquidGlass.backgroundTextureScaleCoefficient

        // Calculate frame using presentation layer for smooth animation tracking.
        // 尺寸与缓冲同源（model bounds）+ 1 缓冲像素外扩，理由同 captureRootView：
        // 逐帧变形动画期间 presentation 尺寸滞后一拍，会在缓冲边缘留下黑带。
        let currentLayer = layer.presentation() ?? layer
        let frameInSuperview = currentLayer.convert(currentLayer.bounds, to: superview.layer)
        let devicePixel = 1.0 / scaleCoefficient
        let captureSize = CGSize(width: bounds.width * sizeCoefficient + devicePixel * 2,
                                 height: bounds.height * sizeCoefficient + devicePixel * 2)
        let captureOrigin = CGPoint(x: frameInSuperview.midX - captureSize.width / 2,
                                    y: frameInSuperview.midY - captureSize.height / 2)

        // Position backdrop view and layer
        backdropView.frame = CGRect(origin: captureOrigin, size: captureSize)

        // Ensure backdrop view is in superview (below us)
        if backdropView.superview !== superview {
            superview.insertSubview(backdropView, belowSubview: self)
        }

        // Capture using drawHierarchy (gets windowserver-composited content)
        backgroundTexture = zeroCopyBridge.render { context in
            context.scaleBy(x: scaleCoefficient, y: scaleCoefficient)

            UIGraphicsPushContext(context)
            backdropView.drawHierarchy(in: backdropView.bounds, afterScreenUpdates: false)
            UIGraphicsPopContext()
        }

        blurTexture()
    }

    func blurTexture() {
        #if targetEnvironment(simulator)
        // 模拟器上 MetalPerformanceShaders 内核不可用（初始化即断言崩溃）。
        // 跳过高斯模糊只损失一点背景柔化，保住模拟器可用性；真机路径不受影响。
        return
        #else
        // σ < 1 的模糊半径不足一像素级，视觉上完全不可辨（.regular 预设 0.3 即走
        // 此路径直接跳过）；MPS pass + 同步 waitUntilCompleted 的每帧 GPU 往返
        // 纯属浪费——这是捕获路径上除 drawHierarchy 外唯一的同步阻塞点，砍掉它
        // 是玻璃与列表性能隔离的第二刀。
        guard liquidGlass.backgroundTextureBlurRadius >= 1.0,
              let device,
              let commandBuffer = commandQueue.makeCommandBuffer(),
              var backgroundTexture else { return }

        // Apply GPU-accelerated Gaussian blur via MPS
        // Scale blur radius to pixels
        let sigma = Float(liquidGlass.backgroundTextureBlurRadius * layer.contentsScale)
        let blur = MPSImageGaussianBlur(device: device, sigma: sigma)
        blur.edgeMode = .clamp

        blur.encode(commandBuffer: commandBuffer, inPlaceTexture: &backgroundTexture, fallbackCopyAllocator: nil)
        commandBuffer.commit()
        commandBuffer.waitUntilCompleted()
        #endif
    }

    func updateUniforms() {
        var uniforms = liquidGlass.shaderUniforms
        let scaleFactor = layer.contentsScale

        uniforms.resolution = .init(x: Float(bounds.width * scaleFactor),
                                    y: Float(bounds.height * scaleFactor))
        uniforms.contentsScale = Float(scaleFactor)

        uniforms.shapeMergeSmoothness = 0.2

        // Assign rectangles from frames array, or use bounds if empty
        let effectiveFrames = frames.isEmpty ? [bounds] : frames
        uniforms.rectangleCount = Int32(min(effectiveFrames.count, LiquidGlass.maxRectangles))

        // Convert CGRect frames to SIMD4<Float> (x, y, width, height)
        var rects: [SIMD4<Float>] = []
        for i in 0..<LiquidGlass.maxRectangles {
            if i < effectiveFrames.count {
                let frame = effectiveFrames[i]
                rects.append(SIMD4<Float>(
                    Float(frame.origin.x),
                    Float(frame.origin.y),
                    Float(frame.width),
                    Float(frame.height)
                ))
            } else {
                rects.append(.zero)
            }
        }
        uniforms.rectangles = (
            rects[0], rects[1], rects[2], rects[3],
            rects[4], rects[5], rects[6], rects[7],
            rects[8], rects[9], rects[10], rects[11],
            rects[12], rects[13], rects[14], rects[15]
        )

        if let touchPoint {
            uniforms.touchPoint = .init(x: Float(touchPoint.x), y: Float(touchPoint.y))
        }

//        uniforms.cornerRoundnessExponent = (layer.cornerCurve == .continuous) ? 4 : 2
        // 圆角钳制到短边一半：传入的 borderRadius 可能超过玻璃短边一半
        // （designRadius.xl=32，而迷你播放器胶囊高约 54、半高仅 27；tab 栏高 56、
        // 半高 28；透镜被挤压拉伸时 frame 变窄使其短边更小）。UIKit 会自动收敛为
        // 圆角胶囊，但 shader 的 roundedRectangleSDF 不收敛，圆角退化会让形状 SDF
        // 在边缘算错、把黑色背景折射进胶囊边缘，表现为胶囊右侧/透镜周围的黑影。
        // 对齐 LGLiquidLensHostView.setLensCornerRadius 的钳制处理（min(宽,高)/2）。
        let maxGlassRadius = min(bounds.width, bounds.height) / 2.0
        uniforms.cornerRadius = Float(min(layer.cornerRadius, CGFloat(maxGlassRadius)))
        // squircle 圆角（对齐 kit）：宿主 layer 用 continuous 曲线时按 squircle 折射
        uniforms.cornerRoundnessExponent = (layer.cornerCurve == .continuous) ? 4 : 2

        if let tintColor = liquidGlass.tintColor {
            uniforms.materialTint = tintColor.toSimdFloat4()
        }

        uniformsBuffer.contents().assumingMemoryBound(to: LiquidGlass.ShaderUniforms.self).pointee = uniforms

//        setNeedsDisplay()
//        draw(bounds)
    }

    override func layoutSubviews() {
        super.layoutSubviews()

        updateUniforms()

        let scale = layer.contentsScale * liquidGlass.backgroundTextureSizeCoefficient * liquidGlass.backgroundTextureScaleCoefficient
        let width = Int(bounds.width * scale)
        let height = Int(bounds.height * scale)
        zeroCopyBridge.setupBuffer(width: width, height: height)
    }

    override func draw(_ rect: CGRect) {
        // Auto-capture background from superview if enabled（上游一致：连续渲染 +
        // 每帧捕获，实时折射；多玻璃实例互拍的黑影排除见 captureRootView）
        if autoCapture {
            captureBackground()
        }

        // 背景纹理未就绪（刚挂载/缓冲尺寸未定，setupBuffer 尚未跑出有效像素缓冲）
        // 时跳过本帧：视图保持透明，等下一帧再画，避免闪黑
        guard backgroundTexture != nil else { return }

        // shader/pipeline 构建失败时玻璃降级为透明（iOS 26 兼容兜底），不崩溃
        guard let pipeline = LiquidGlassRenderer.shared.pipelineState else { return }

        guard let drawable = currentDrawable,
              let renderPassDesc = currentRenderPassDescriptor,
              let commandBuffer = commandQueue.makeCommandBuffer(),
              let encoder = commandBuffer.makeRenderCommandEncoder(descriptor: renderPassDesc) else { return }

        encoder.setRenderPipelineState(pipeline)
        encoder.setFragmentBuffer(uniformsBuffer, offset: 0, index: 0)

        if let texture = backgroundTexture {
            encoder.setFragmentTexture(texture, index: 0)
        }

        // Draw fullscreen quad (vertices generated in vertex shader)
        encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)
        encoder.endEncoding()

        commandBuffer.present(drawable)
        commandBuffer.commit()
    }
}

extension UIColor {
    func toSimdFloat4() -> SIMD4<Float> {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        getRed(&r, green: &g, blue: &b, alpha: &a)
        return .init(x: Float(r), y: Float(g), z: Float(b), w: Float(a))
    }
}

// Helpers: Lerp for damping, UIColor to Half4
//private func lerp(_ a: SIMD2<Float>, _ b: SIMD2<Float>, _ t: Float) -> SIMD2<Float> {
//    return a * (1 - t) + b * t
//}

extension UIView {
    /// Finds the topmost content view owning our window.
    /// 直接对 `UIWindow.layer` 调 render/drawHierarchy 在 iOS 26 上易因私有状态栏/
    /// 键盘/RNN 容器图层抛异常崩溃；优先返回 window.rootViewController.view。
    func findRootView() -> UIView? {
        if let rootVCView = window?.rootViewController?.view {
            return rootVCView
        }
        var current: UIView? = superview
        while let parent = current?.superview {
            current = parent
        }
        return current
    }
}
