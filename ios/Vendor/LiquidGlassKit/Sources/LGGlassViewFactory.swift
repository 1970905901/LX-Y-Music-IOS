//
//  LGGlassViewFactory.swift
//  LiquidGlassKit (vendored from DnV1eX/LiquidGlassKit)
//
//  ObjC-visible factory that picks the glass backing for the current OS.
//
//  设计原则（2026-09-28 定案）：**不使用任何自研材质，每个系统版本都用该系统自己的材质。**
//    - iOS 26+（且用 Xcode 26 编译）：系统 UIGlassEffect(.regular)，即 Liquid Glass；
//    - 其余系统：系统 UIBlurEffect(.systemMaterial)。
//  两者都由系统合成，无逐帧整窗捕获、无 CPU 逐帧成本（这正是自研 Metal 路径下线的
//  根因）。同一个系统材质在 iOS 14~18 与 iOS 26 上本就长得不一样，这是设计意图而非
//  缺陷：系统控件什么样，我们就什么样（HIG「一致性即信任」），不再试图让两代系统看起来
//  相同 —— 也正因如此，不要再承诺「全 iOS 版本行为一致」。
//
//  材质档位取 regular 而非最薄的 ultraThin：HIG 对 regular 的描述是「模糊并调整背景
//  亮度，保文字可读」，正是浮在专辑图（富媒体）之上的导航层需要的；ultraThin 是四档里
//  对比度最差的，HIG 明确不推荐在其上放低对比内容。量化对比见
//  scripts/sim-glass-contrast.js。
//
//  宿主（LiquidGlassViewManager.mm 的 LGLiquidGlassHostView）只持有 UIView，
//  宿主侧圆角裁剪容器 + 0.5pt 内缘线提供轮廓。
//
//  历史（改本文件前必读）：自研 Metal 液态玻璃（LiquidGlassEffectView，逐帧整窗
//  CABackdropLayer 捕获）在长列表场景对主线程的压力与实时性无法兼得，见提交 5ef29a8
//  整体下线；随后提交 73c2e9c 连系统模糊层一并去掉、只留一层染色覆层，玻璃实际已
//  名存实亡 —— 覆层 alpha=0 时对可读性零贡献（scripts/sim-glass-contrast.js 断言1），
//  即 Tab 栏文字直接压在滚动内容上、没有任何底衬。本次恢复为「系统材质 + 有上限的
//  染色覆层」。
//

import UIKit

/// 玻璃材质：按运行时 OS 解析「该系统自己的材质」。
@MainActor
enum LGGlassMaterial {

    /// iOS 26 原生 UIGlassEffect 开关（默认开：该版本就用该版本的系统玻璃）。
    ///
    /// 风险与本开关的用途：提交 bce5e95 曾因三重缺陷移除过这段分支 —— 逐帧 frame 变化
    /// （Tab 栏收起/展开转场）下系统玻璃渲染器跟不上会输出黑弧，且 UIVisualEffectView 的
    /// 离屏快照为黑块、冻结方案不可行。当时的上下文是「自研 Metal 宿主 + 逐帧 frame 驱动」；
    /// 现在是纯系统合成、宿主跟着 RN 布局走，是否复现必须真机确认（已知同类坑：转场中途
    /// 切换 backdrop layer 的 isHidden 会出现一帧闪烁）。
    /// 真机上一旦看到胶囊端部黑弧 / 转场黑块：把这里改成 false 即整体回落到 UIBlurEffect
    /// 路径，无需改动其它任何代码、也无需改设置项。
    static let preferNativeGlassOnIOS26 = true

    /// 系统材质：iOS 26+ 优先原生玻璃，其余一律 UIBlurEffect(.systemMaterial)。
    static func systemEffect() -> UIVisualEffect {
        if preferNativeGlassOnIOS26, let glass = nativeGlassEffect() { return glass }
        return UIBlurEffect(style: .systemMaterial)
    }

    /// iOS 26 原生玻璃。两层守卫都必须在：
    ///   - `#if compiler(>=6.2)`：编译期。CI 若从 macos-26 回退到旧 Xcode，那个 SDK 里
    ///     没有 UIGlassEffect 与 iOS 26 的 `#available`，只有 `#if` 能挡住；
    ///   - `#available(iOS 26.0, *)`：运行期。低版本系统上不能走到这里。
    private static func nativeGlassEffect() -> UIVisualEffect? {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            // .regular 即 HIG 的 regular 变体（模糊并调整背景亮度、保文字可读）；
            // .clear 是给富媒体之上的浮控件用的高透变体、另需 35% 暗化层，此处不用。
            // 不用 UIGlassEffect.tintColor 而沿用主题染色覆层：让全 iOS 版本共用同一套
            // 染色模型（见下方 tintOverlay），避免两代系统的染色语义分叉。
            return UIGlassEffect(style: .regular)
        }
        #endif
        return nil
    }
}

/// 系统材质玻璃底衬：系统材质打底 + 主题染色覆层。
/// 不透明度（覆层 alpha）由用户设置驱动，且**有上限**（见 maxTintAlpha）。
@objc public final class LGFrostedGlassView: UIView {

    /// 染色覆层 alpha 的上限。材质才是可读性的来源，染色只是氛围色：覆层一旦到 1 就把
    /// 材质整个盖住，合成结果与背景无关（材质的跨背景自适应跨度归零，见
    /// scripts/sim-glass-contrast.js 断言4），等于退回「纯染色覆层」的旧形态。
    /// 用户设置 0~100 线性映射到 0~maxTintAlpha，因此调整上限**不需要**改设置项、
    /// 不需要数据迁移，也不会让滑块出现「拖到某一段没反应」的假区间。
    private static let maxTintAlpha: CGFloat = 0.6

    /// 材质视图。在 init 内构造而非属性默认值：UIGlassEffect 标了 @MainActor，
    /// 放在 init 里隔离性最明确（属性默认值在 Swift 5 语言模式下可能只报 warning）。
    /// 声明为 var 而非 let：明暗切换时需要整体重建（见 rebuildEffectView）。
    private var effectView: UIVisualEffectView
    private let tintOverlay = UIView()

    /// 染色基色（不透明主题色；透明度由 glassOpacity 独立控制）
    @objc public var glassTintColor: UIColor? {
        didSet { tintOverlay.backgroundColor = glassTintColor ?? UIColor.white }
    }

    /// App 主题明暗（**不是**系统明暗）。必须由 JS 显式下发：系统材质是动态材质，按
    /// `traitCollection.userInterfaceStyle` 解析，而本项目在 window 层**没有**统一 override
    /// （App 主题可与系统明暗不一致）→ 不下发就会在「App 深色 + 系统浅色」时渲染出一层
    /// 亮色磨砂，与整体配色相反。
    ///
    /// UIVisualEffectView 的材质在创建时就按当时 trait 解析完成、不支持事后改
    /// `overrideUserInterfaceStyle`（原实现的结论，见 73c2e9c 之前的 dark prop），
    /// 因此明暗变化时**重建材质视图**。只重建 effectView、不重建本视图，
    /// 这样已下发的 tint / glassOpacity 不会丢，宿主也不必重建 backing。
    @objc public var isDarkMode: Bool = false {
        didSet {
            guard isDarkMode != oldValue else { return }
            rebuildEffectView()
        }
    }

    /// 0~1：染色覆层不透明度的**用户值**（对应设置 theme.glassOpacity，0~100）。
    /// 实际 alpha = clamp(userValue) * maxTintAlpha，故 1 表示「染色拉满」，
    /// 而不是「把材质盖住」。
    @objc public var glassOpacity: CGFloat = 0.4 {
        didSet { tintOverlay.alpha = Self.tintAlpha(for: glassOpacity) }
    }

    private static func tintAlpha(for userValue: CGFloat) -> CGFloat {
        min(max(userValue, 0), 1) * maxTintAlpha
    }

    override init(frame: CGRect) {
        effectView = UIVisualEffectView(effect: LGGlassMaterial.systemEffect())
        super.init(frame: frame)
        effectView.isUserInteractionEnabled = false
        effectView.overrideUserInterfaceStyle = isDarkMode ? .dark : .light
        // 材质层与覆层都不参与命中测试：触摸一律穿透到上层 RN 内容视图
        // （Tab 项、播放条按钮、宿主手势）
        tintOverlay.isUserInteractionEnabled = false
        tintOverlay.backgroundColor = UIColor.white
        tintOverlay.alpha = Self.tintAlpha(for: glassOpacity)
        // 覆层放进 contentView：与系统材质同层合成，并随材质一起被宿主的圆角裁剪容器裁切
        effectView.contentView.addSubview(tintOverlay)
        addSubview(effectView)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    /// 明暗切换时重建材质视图。UIKit 会把 tintOverlay 自动从旧 contentView 摘除后
    /// 挂到新的上，故染色覆层与它的 alpha 全部保留，无需调用方重新下发任何属性。
    private func rebuildEffectView() {
        effectView.removeFromSuperview()
        effectView = UIVisualEffectView(effect: LGGlassMaterial.systemEffect())
        effectView.isUserInteractionEnabled = false
        effectView.overrideUserInterfaceStyle = isDarkMode ? .dark : .light
        effectView.contentView.addSubview(tintOverlay)
        addSubview(effectView)
        setNeedsLayout()
    }

    public override func layoutSubviews() {
        super.layoutSubviews()
        effectView.frame = bounds
        tintOverlay.frame = effectView.contentView.bounds
    }
}

@objc public final class LGGlassViewFactory: NSObject {

    /// UIView 初始化是 MainActor 隔离的；RN 的 view 创建固定发生在主线程。
    ///
    /// `dark` 是 **App 主题**的明暗（不是系统明暗）：系统材质按 traitCollection 解析，
    /// 而 App 主题可与系统不一致，必须显式下发，否则深色主题会拿到亮色材质。
    /// 宿主 init 时还不知道主题，先按浅色建、随后由 `dark` prop 覆盖
    /// （backing 内部只重建材质层，代价是一次 UIVisualEffectView 构造，可忽略）。
    @objc @MainActor public static func createGlassBacking(dark: Bool) -> UIView {
        let glassView = LGFrostedGlassView(frame: .zero)
        glassView.isDarkMode = dark
        glassView.isUserInteractionEnabled = false
        glassView.backgroundColor = .clear
        return glassView
    }

    /// 主题染色：覆层基色（不透明；透明度走 glassOpacity 设置，且带上限）。
    @objc @MainActor public static func applyGlassTint(_ glassView: UIView, tint: UIColor?) {
        (glassView as? LGFrostedGlassView)?.glassTintColor = tint
    }
}
