//
//  LGGlassViewFactory.swift
//  LiquidGlassKit (vendored from DnV1eX/LiquidGlassKit)
//
//  ObjC-visible factory that picks the glass backing for the host view.
//
//  双形态（2026-09-28 定案，用户指定）：玻璃效果「全面照抄」DnV1eX/LiquidGlassKit
//  本体 —— 由设置开关（theme.liquidGlass）控制，**全 iOS 版本生效**（上游定位即
//  「liquid glass 的 iOS 13~18 backport」，Metal 引擎本就为旧版本设计）：
//    - 液态（liquid = true）：LiquidGlassEffectView（MTKView + 折射 shader + 边缘光
//      + 主题染色），即该项目的核心效果。背景捕获由 kit 按系统分派：26.2+ 走根视图
//      捕获（上游 2eb41c5：CABackdropLayer 私有机制在 26.2 失效）；26.0/26.1 与
//      14~18 走 CABackdropLayer（vendored 版带 isBackdropAvailable 守卫，缺失时
//      玻璃退化为透明、不崩溃）。
//    - 磨砂（liquid = false，默认）：UIBlurEffect(.systemMaterial) 经典磨砂（全版本
//      统一，26+ 不用 UIGlassEffect——那是系统液态玻璃观感）+ 有上限的主题染色覆层。
//      系统合成，无逐帧捕获成本。
//
//  液态形态的性能与省电由 vendored kit 内建机制保障（当年 Metal 实测沉淀的修复，
//  随 vendored 源码一并生效）：按需渲染（静止暂停 MTKView，JS 脉冲/挂载窗/手势三源
//  驱动）、滚动冻结、多实例错峰捕获、玻璃互捕黑影排除、CABackdropLayer 缺失降级。
//
//  历史（改本文件前必读）：自研 Metal 路径曾在 5ef29a8 整体下线（「逐帧整窗捕获
//  对主线程的压力与实时性无法兼得」），随后经历纯染色覆层（73c2e9c）与系统磨砂
//  （c6e86b2）两阶段。本次按用户要求在 iOS 26+ 恢复 Metal 液态玻璃并加开关；
//  当年已修复的原生缺陷（黑弧/黑影/黑带）的修复代码都在 vendored 源码里，随恢复
//  一并生效。磨砂形态仍遵守「什么版本用什么版本的系统自己的材质」。
//

import UIKit

/// 玻璃材质：按运行时 OS 解析「该系统自己的材质」（磨砂形态用）。
@MainActor
enum LGGlassMaterial {

    /// iOS 26 原生 UIGlassEffect 开关。2026-09-29 用户定案改 false：UIGlassEffect
    /// (.regular) 是 iOS 26 的系统原生「液态玻璃」观感——与「关闭开关 = 磨砂」的预期
    /// 相悖（真机截图实锤：磨砂档看起来就是液态玻璃）。磨砂档全版本统一
    /// UIBlurEffect(.systemMaterial) 经典磨砂；液态观感只属于液态开关（自研 Metal）。
    ///
    /// 风险与本开关的用途：提交 bce5e95 曾因三重缺陷移除过这段分支 —— 逐帧 frame 变化
    /// （Tab 栏收起/展开转场）下系统玻璃渲染器跟不上会输出黑弧，且 UIVisualEffectView 的
    /// 离屏快照为黑块、冻结方案不可行。当时的上下文是「自研 Metal 宿主 + 逐帧 frame 驱动」；
    /// 现在是纯系统合成、宿主跟着 RN 布局走，是否复现必须真机确认（已知同类坑：转场中途
    /// 切换 backdrop layer 的 isHidden 会出现一帧闪烁）。
    /// 真机上一旦看到胶囊端部黑弧 / 转场黑块：把这里改成 false 即整体回落到 UIBlurEffect
    /// 路径，无需改动其它任何代码、也无需改设置项。
    static let preferNativeGlassOnIOS26 = false

    /// 系统材质：全版本一律 UIBlurEffect(.systemMaterial)（26+ 不再走原生液态玻璃）。
    static func systemEffect() -> UIVisualEffect {
        if preferNativeGlassOnIOS26, let glass = nativeGlassEffect() { return glass }
        return UIBlurEffect(style: .systemMaterial)
    }

    /// iOS 26 原生玻璃。两层守卫都必须在：
    ///   - `#if compiler(>=6.2)`：编译期。CI 若从 macos-26 回退到旧 Xcode，那个 SDK 里
    ///     没有 UIGlassEffect 与 iOS 26 的 `#available`，只有 `#if` 能挡住；
    ///   - `#available(iOS 26.0, *)`：运行期。低版本系统上不能走到这里。
    static func nativeGlassEffect() -> UIVisualEffect? {
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

/// 系统材质玻璃底衬（磨砂形态）：系统材质打底 + 主题染色覆层。
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
    private var effectView: UIVisualEffectView\1    private let useNativeGlass: Bool\1    private let tintOverlay = UIView()

    /// 染色基色（不透明主题色；透明度由 glassOpacity 独立控制）。
    /// **本应用已不再传 tint**（2026-09-28 定案：玻璃不跟随主题色）→ 覆层走中性玻璃色。
    @objc public var glassTintColor: UIColor? {
        didSet { tintOverlay.backgroundColor = glassTintColor ?? neutralOverlayColor }
    }

    /// 纯玻璃中性覆层色：浅色主题白（透亮）、深色主题黑（深邃），随 **App 明暗**切换，
    /// 不随主题色。浓度仍由 glassOpacity 滑杆驱动。
    private var neutralOverlayColor: UIColor { isDarkMode ? .black : .white }

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

    private static func resolveEffect(useNativeGlass: Bool) -> UIVisualEffect {
        if useNativeGlass, let glass = LGGlassMaterial.nativeGlassEffect() { return glass }
        return UIBlurEffect(style: .systemMaterial)
    }

    private static func tintAlpha(for userValue: CGFloat) -> CGFloat {
        min(max(userValue, 0), 1) * maxTintAlpha
    }

    /// useNativeGlass：iOS 26.2+ 的「专属磨砂」质感（2026-09-30 用户定案）——液态开关
    /// 在 26.2+ 呈现系统原生 UIGlassEffect(.regular)（26 独有 API = 专属；系统合成
    /// 零捕获成本，无自研 Metal 在 26.2+/27 的跳动/闪烁/前景碎片问题），明暗/染色/
    /// glassOpacity 链路与磨砂形态完全共用。缺失原生玻璃（旧 SDK）回落 systemMaterial。
    @objc public init(frame: CGRect, useNativeGlass: Bool = false) {
        self.useNativeGlass = useNativeGlass
        effectView = UIVisualEffectView(effect: Self.resolveEffect(useNativeGlass: useNativeGlass))
        super.init(frame: frame)
        effectView.isUserInteractionEnabled = false
        effectView.overrideUserInterfaceStyle = isDarkMode ? .dark : .light
        // 材质层与覆层都不参与命中测试：触摸一律穿透到上层 RN 内容视图
        // （Tab 项、播放条按钮、宿主手势）
        tintOverlay.isUserInteractionEnabled = false
        tintOverlay.backgroundColor = neutralOverlayColor
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
        effectView = UIVisualEffectView(effect: Self.resolveEffect(useNativeGlass: useNativeGlass))
        effectView.isUserInteractionEnabled = false
        effectView.overrideUserInterfaceStyle = isDarkMode ? .dark : .light
        effectView.contentView.addSubview(tintOverlay)
        // 中性覆层色跟随明暗（无主题 tint 时）：UIKit 只会把覆层**移**到新 contentView，
        // 颜色不会自己变，必须显式重设
        tintOverlay.backgroundColor = glassTintColor ?? neutralOverlayColor
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

    /// 玻璃背衬工厂（双形态）。
    ///
    /// `dark` 是 **App 主题**的明暗：只作用于磨砂形态（系统动态材质按 trait 解析，
    /// 而 App 主题可与系统不一致，必须显式下发，否则深色主题会拿到亮色材质）；
    /// 液态形态的明暗由主题染色（tint prop → setGlassTintColor → shader materialTint）
    /// 表达，无需 trait。
    ///
    /// `liquid` 全版本生效（2026-09-28 二次定案：iOS 14~18 与 26+ 同一开关同一效果，
    /// 对齐上游「backport」定位；关闭一律回磨砂）。
    /// JS 侧由设置 theme.liquidGlass 驱动；宿主在切换时重建背衬并重放缓存属性
    /// （见 LiquidGlassViewManager.mm 的 applyLiquidMode:）。
    @objc @MainActor public static func createGlassBacking(dark: Bool, liquid: Bool) -> UIView {
        if liquid {
            // 【2026-09-30 用户定案】26.2+：液态开关呈现「26.2+ 专属磨砂」——系统原生
            // UIGlassEffect(.regular)（26 独有 API，系统合成稳定，规避自研 Metal 在
            // 26.2+/27 的跳动/闪烁/前景碎片问题链）；染色/明暗/浓度链路复用磨砂形态。
            // 14~18 / 26.0 / 26.1 维持自研 Metal 折射（已修好的冷启动黑闪等随 vendored 源码生效）。
            #if compiler(>=6.2)
            if #available(iOS 26.2, *) {
                let glassView = LGFrostedGlassView(frame: .zero, useNativeGlass: true)
                glassView.isDarkMode = dark
                glassView.isUserInteractionEnabled = false
                glassView.backgroundColor = .clear
                return glassView
            }
            #endif
            // vendored Metal 液态玻璃（DnV1eX/LiquidGlassKit 核心效果）：
            // .regular 预设 = 染色 + 背景微模糊 + 折射 + 边缘光。isNative:false ——
            // vendored 版已移除上游的原生 UIGlassEffect 分支（原生玻璃由磨砂形态提供），
            // 该参数仅作文档语义。首块玻璃创建时会在设备上编译 shader（约几十 ms）。
            let glassView = LiquidGlassEffectView(effect: LiquidGlassEffect(style: .regular, isNative: false))
            glassView.isUserInteractionEnabled = false
            glassView.backgroundColor = .clear
            return glassView
        }
        let glassView = LGFrostedGlassView(frame: .zero)
        glassView.isDarkMode = dark
        glassView.isUserInteractionEnabled = false
        glassView.backgroundColor = .clear
        return glassView
    }

    /// 主题染色：磨砂形态 → 染色覆层基色（透明度走 glassOpacity 设置，带上限）；
    /// 液态形态 → shader materialTint（LiquidGlassEffectView.setGlassTintColor）。
    /// tint 为 nil（本应用常态：纯玻璃不跟随主题色）时——磨砂回中性覆层色
    /// （浅色白 / 深色黑），液态回玻璃预设的动态色（浅色蓝白 / 深色近黑）。
    @objc @MainActor public static func applyGlassTint(_ glassView: UIView, tint: UIColor?) {
        (glassView as? LGFrostedGlassView)?.glassTintColor = tint
        (glassView as? LiquidGlassEffectView)?.setGlassTintColor(tint)
    }
}
