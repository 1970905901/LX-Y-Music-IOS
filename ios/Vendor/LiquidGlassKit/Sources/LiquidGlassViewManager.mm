//
//  LiquidGlassViewManager.mm
//  LiquidGlassKit (vendored from DnV1eX/LiquidGlassKit)
//
//  React Native (Paper) view manager exposing the liquid-glass view to JS as `LiquidGlassView`.
//  Lives inside the pod (mixed ObjC/Swift target) so the app target never needs to import the
//  Swift module: the manager self-registers via RCT_EXPORT_MODULE, like every RN pod's native
//  component. JS side: src/components/common/LiquidGlass.tsx (requireNativeComponent).
//
//  Usage contract (JS):
//  - Render as a leaf element (<LiquidGlass />) absolutely positioned to fill its parent.
//    **排除根契约**：捕获排除根 = 本宿主的 superview（= 玻璃 + 前景内容所在的内容
//    容器，didMoveToSuperview 自动维护）——因此 <LiquidGlass> 必须是内容容器的
//    **直接子元素**；若中间再包一层只装玻璃的 wrapper，前景会漏进捕获纹理（重影）。
//    双形态背衬 × 版本分档（liquid prop 切换，见 LGGlassViewFactory.swift）：
//      - liquid = false（默认）：系统磨砂 —— **全版本统一** UIBlurEffect(.systemMaterial)
//        外加有上限的主题染色覆层。26 的原生玻璃材质不走这条（那是系统液态观感，与
//        「关 = 磨砂」的预期相悖；LGGlassMaterial.preferNativeGlassOnIOS26 = false）。
//      - liquid = true（全 iOS 版本生效，按版本分两档）：
//          · iOS 26.2 及以上：系统原生 UIGlassEffect(.regular)（同为 LGFrostedGlassView、
//            useNativeGlass:true）—— 该档位的「专属磨砂」：系统合成零捕获成本，规避
//            自研 Metal 在 26.2+/27 的跳动/闪烁/前景碎片问题链；
//          · iOS 14～26.1：vendored Metal 液态玻璃（LiquidGlassEffectView，DnV1eX/
//            LiquidGlassKit 核心效果：折射 + 边缘光 + 主题染色，连续渲染、逐帧捕获，
//            与上游行为一致）。
//        触摸眩光（touchPoint）只在 Metal 档生效：26.2+ 档的背衬是磨砂视图、不实现
//        对应 selector，respondsToSelector 分流自然跳过。
//  - The parent container should have `borderRadius` + `overflow: 'hidden'` (rounds the bar).
//  - `tint` prop：染色基色（不透明主题色，明暗自适应）。两种背衬都吃：磨砂档与 26.2+
//    的液态档 → 覆层基色；14～26.1 的液态档 → shader materialTint。本应用不传（纯玻璃，
//    不跟随主题色）：磨砂型走中性覆层色（浅色白/深色黑），Metal 档走 kit 预设动态色。
//  - `glassOpacity` prop：染色覆层的**用户值** 0~1（对应设置 theme.glassOpacity 0~100）。
//    实际 alpha 由 LGGlassViewFactory 内的 maxTintAlpha(0.6) 封顶。磨砂档与 26.2+ 的
//    液态档生效（后者同为磨砂视图）；14～26.1 的液态档不实现 setGlassOpacity:，
//    且设置 UI 在开关打开时隐藏该行。
//  - 主题属性（tint/glassOpacity/dark）由宿主缓存：liquid 切换会重建背衬，
//    RN 不会重推未变化的 prop，重建后由宿主重放（reapplyCachedPropsToBacking）。
//

#import <React/RCTConvert.h>
#import <React/RCTView.h>
#import <React/RCTViewManager.h>

// Mixed ObjC/Swift static-library pod: import the Swift-generated interface header.
// The emission location differs between Xcode configurations, so try the known candidates.
#if __has_include(<LiquidGlassKit/LiquidGlassKit-Swift.h>)
#import <LiquidGlassKit/LiquidGlassKit-Swift.h>
#elif __has_include("LiquidGlassKit-Swift.h")
#import "LiquidGlassKit-Swift.h"
#else
#error "LiquidGlassKit-Swift.h not found: mixed ObjC/Swift static pod interface header import failed"
#endif

// 玻璃背衬的可选定制入口（selector 是否存在由具体形态决定，宿主一律按
// respondsToSelector 分流；经此 protocol 转型让 selector 对编译器可见——
// 直接在 UIView* 上调用会报 "no visible @interface"，CI 曾因此编译失败）：
//   - LGFrostedGlassView：setGlassOpacity: / setIsDarkMode:
//     （磨砂档，以及 **26.2+ 的液态档**——该档同为此视图、只是 useNativeGlass:true）
//   - LiquidGlassEffectView：setTouchPoint: / clearTouchPoint:（触摸眩光，14～26.1 的
//     液态档；该档的浓度/明暗由主题染色表达，不实现上面两个 selector）
@protocol LGGlassBackingCustomizations <NSObject>
@optional
- (void)setGlassOpacity:(CGFloat)opacity;
- (void)setIsDarkMode:(BOOL)dark;
- (void)setTouchPoint:(CGPoint)point;
- (void)clearTouchPoint;
// 截背景时要隐藏的「玻璃组件根」：仅 Metal 液态档实现（磨砂档与 26.2+ 的液态档
// 都走系统材质，无截背景机制）。
- (void)setCaptureExclusionView:(nullable UIView *)view;
@end

// 自研 LiquidLensView（液态透镜，LiquidGlassView(.lens) 引擎）的定制入口：
// 染色（nil=kit 预设动态色）/ 圆角 / 捕获排除根透传。宿主按 respondsToSelector
// 分流（部分入口为桥接面保留的空操作，见 LiquidLensView.swift）。
// 注：拖拽手势层已整体移除（2026-09-29 用户定案：上游无对应实现）——frames 合并
// 与透镜眩光的桥接入口（setLensFrames/setLensTouchPoint）随之删除，kit 本体的
// frames/touchPoint 能力不受影响。
@protocol LGLensCustomizations <NSObject>
@optional
- (void)setLensTintColor:(UIColor *)color;
- (void)setLensGlassOpacity:(CGFloat)opacity;
- (void)setLensCornerRadius:(CGFloat)radius;
- (void)setCaptureExclusionView:(nullable UIView *)view;
@end

// Host view: an RCTView so all standard RN view props (borderRadius, overflow, pointerEvents,
// opacity, shadow*) keep working; the glass backing（双形态 × 版本分档，见
// LGGlassViewFactory.swift：磨砂全版本 systemMaterial；开关打开的 26.2+ 走系统原生
// UIGlassEffect(.regular)、14～26.1 走 vendored Metal，liquid prop 切换）sits inside a
// rounded clipping container. LGGlassViewFactory selects the backing.
// 主题属性（tint/glassOpacity/dark）缓存在宿主：liquid 切换会重建背衬，
// RN 不会重推未变化的 prop，重建后由宿主重放（reapplyCachedPropsToBacking）。
// 圆角曲线统一 circular（2026-09-29 定案「玻璃圆角与透镜一致」）：透镜
// （LiquidLensView）强制 circular → shader cornerRoundnessExponent=2 正圆角；
// 宿主原用 continuous（squircle 指数 4）端头偏方、视觉圆角显小，与透镜不一致。
// 统一后底部 tab 栏 / 迷你播放器 / 收起圆钮的玻璃端头与透镜同为正圆角。
// 注：常量名在旧 SDK(UIViewCornerCurveContinuous)与新 SDK(Xcode 26 起的 UICornerCurve
// 系列)间不一致,直接用底层字符串值,两端 SDK 均可编译且运行时行为相同。
// 注：不做按压玻璃形变——玻璃材质自带高对比边缘光，在裁剪容器内任何内缩都会让
// 材质自身的边缘线在胶囊内露出（方角/底边/内缘线均源于此），已验证两次故整体移除。
@interface LGLiquidGlassHostView : RCTView
/** 实际玻璃材质视图（磨砂 / 26.2+ 系统原生玻璃 / vendored Metal 液态玻璃），
    tint 作用于此；触摸眩光仅 Metal 档（26.2+ 档为磨砂视图，无对应 selector） */
@property (nonatomic, readonly) UIView *glassBacking;
/// 切换磨砂 ↔ 液态背衬：按缓存的主题属性重建背衬（liquid 全版本生效，见工厂；
/// 26.2+ 的液态档同为磨砂视图、仅材质换成系统原生玻璃）
- (void)applyLiquidMode:(BOOL)liquid;
/// 以下为 RN prop 的宿主入口：更新缓存并应用到当前背衬（respondsToSelector 分流）
- (void)applyTint:(UIColor *)tint;
- (void)applyGlassOpacity:(CGFloat)opacity;
- (void)applyDark:(BOOL)dark;
@end

@implementation LGLiquidGlassHostView {
  // _glassView = 圆角裁剪容器（圆角作用层）；_glassBacking = 内部玻璃材质视图
  // （磨砂档与 26.2+ 的液态档 = LGFrostedGlassView；14～26.1 的液态档 =
  // vendored Metal LiquidGlassEffectView）。
  // 分两层：UIKit 官方推荐的圆角毛玻璃做法，圆角裁剪容器让玻璃形状与宿主完全一致。
  UIView *_glassView;
  UIView *_glassBacking;
  // 主题属性缓存：liquid 切换重建背衬后由 reapplyCachedPropsToBacking 重放
  // （RN 只推送变化的 prop，未变化的不会自动重发，必须由宿主重放）。
  BOOL _liquid;
  BOOL _dark;
  CGFloat _glassOpacity;
  UIColor *_tint;
}

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    _glassOpacity = 0.4;
    // 宿主 init 时主题尚未下发，先按浅色磨砂建；随后 dark/liquid prop 会按需切换
    // （dark 只重建磨砂材质层；liquid 重建整个背衬，缓存属性由宿主重放）。
    [self installGlassBacking:[LGGlassViewFactory createGlassBackingWithDark:NO liquid:NO]];
    self.clipsToBounds = YES;
    // 常量名在旧 SDK(UIViewCornerCurveContinuous)与新 SDK(Xcode 26 起的 UICornerCurve 系列)间不一致,
    // 直接用底层字符串值,两端 SDK 均可编译且运行时行为相同。
    self.layer.cornerCurve = @"circular";
  }
  return self;
}

- (void)installGlassBacking:(UIView *)backing {
  // liquid 切换会重复安装：先移除旧容器（背衬随容器一起移除）。
  [_glassView removeFromSuperview];
  // 玻璃材质视图包进圆角裁剪容器：容器圆角+裁剪让玻璃形状与宿主完全一致。
  // 容器与背景层都不参与命中测试：触摸一律穿透到上层的 RN 内容视图
  // （Tab 项、播放条按钮、宿主手势）
  UIView *container = [[UIView alloc] init];
  container.userInteractionEnabled = NO;
  container.backgroundColor = [UIColor clearColor];
  container.clipsToBounds = YES;
  container.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
  backing.userInteractionEnabled = NO;
  backing.backgroundColor = [UIColor clearColor];
  backing.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
  backing.frame = container.bounds;
  [container addSubview:backing];
  [self addSubview:container];
  container.layer.cornerRadius = self.layer.cornerRadius;
  container.layer.cornerCurve = self.layer.cornerCurve;
  backing.layer.cornerRadius = self.layer.cornerRadius;
  backing.layer.cornerCurve = self.layer.cornerCurve;
  // 边缘立体感（替代已移除的 ShadowView 阴影环）：0.5pt 半透明暗缘线。
  // 普通 layer border 无合成滤镜/混合模式，任何动画下稳定不产生黑边；
  // 外圈氛围阴影已移除（用户反馈胶囊下方有「底子」），立体感由玻璃自身
  // 边缘光 + 此内缘线提供。
  container.layer.borderWidth = 0.5;
  container.layer.borderColor = [UIColor colorWithWhite:0 alpha:0.12].CGColor;
  _glassBacking = backing;
  _glassView = container;
  // 截背景排除根 = JS 父容器（本宿主的 superview）：宿主是叶子（只装玻璃背衬），
  // 前景内容（tab 图标/播放条按钮/文字）是父容器的**其它子节点**——排除根若指宿主，
  // 捕获时前景仍会被画进玻璃的背景捕获纹理，经 shader 降采样折射成重影/黑影
  // （真机 iOS 26.2+ 截图实锤：LX/歌词/Tab 图标全部重影）。隐藏父容器整树 =
  // 同时排除玻璃输出与前景。挂载前 superview 为空先退回宿主自身，didMoveToSuperview
  // 挂载/重挂时自动改指父容器。磨砂档与 26.2+ 的液态档（同为磨砂视图）不实现该
  // selector（respondsToSelector 分流），二者都走系统材质、无捕获机制。
  id<LGGlassBackingCustomizations> backingForCapture = (id<LGGlassBackingCustomizations>)backing;
  if ([backingForCapture respondsToSelector:@selector(setCaptureExclusionView:)]) {
    [backingForCapture setCaptureExclusionView:self.superview ?: self];
  }
  // 新背衬不携带任何旧属性：重放缓存的主题属性（tint/glassOpacity/dark）
  [self reapplyCachedPropsToBacking];
}

// 把缓存的主题属性重放到当前背衬。各 apply* 方法内部按 respondsToSelector 分流：
// 磨砂档与 26.2+ 的液态档实现 setGlassOpacity:/setIsDarkMode:；14～26.1 的液态档
// 不实现（该档的明暗/浓度由主题染色表达、设置 UI 已隐藏对应行）。
- (void)reapplyCachedPropsToBacking {
  [self applyTint:_tint];
  [self applyGlassOpacity:_glassOpacity];
  [self applyDark:_dark];
}

// 切换磨砂 ↔ 液态背衬（liquid prop 驱动，全 iOS 版本实际切换；26.2+ 的液态档
// 换来的仍是磨砂视图——只是材质由 UIBlurEffect 变成系统原生玻璃，见工厂）
- (void)applyLiquidMode:(BOOL)liquid {
  if (liquid == _liquid) return;
  _liquid = liquid;
  [self installGlassBacking:[LGGlassViewFactory createGlassBackingWithDark:_dark liquid:_liquid]];
}

- (void)applyTint:(UIColor *)tint {
  _tint = tint;
  [LGGlassViewFactory applyGlassTint:_glassBacking tint:_tint];
}

- (void)applyGlassOpacity:(CGFloat)opacity {
  _glassOpacity = opacity;
  // 经 protocol 转型：UIView* 上直接调未声明 selector 编译不过（CI 曾因此失败）
  id<LGGlassBackingCustomizations> backing = (id<LGGlassBackingCustomizations>)_glassBacking;
  if ([backing respondsToSelector:@selector(setGlassOpacity:)]) {
    [backing setGlassOpacity:_glassOpacity];
  }
}

- (void)applyDark:(BOOL)dark {
  _dark = dark;
  id<LGGlassBackingCustomizations> backing = (id<LGGlassBackingCustomizations>)_glassBacking;
  if ([backing respondsToSelector:@selector(setIsDarkMode:)]) {
    [backing setIsDarkMode:_dark];
  }
}

- (void)layoutSubviews {
  [super layoutSubviews];
  // RN 设置在宿主 RCTView 上的圆角转发给玻璃容器与材质视图（自研路径的
  // shader uniforms.cornerRadius 驱动折射形状；原生路径由圆角容器裁剪）。
  // 玻璃严格填满宿主（autoresizing 维护 frame），不向裁剪区外预伸——超界部分在
  // 容器逐帧变形时会导致玻璃效果采样出错（黑边）。
  _glassView.layer.cornerRadius = self.layer.cornerRadius;
  _glassView.layer.cornerCurve = self.layer.cornerCurve;
  _glassBacking.layer.cornerRadius = self.layer.cornerRadius;
  _glassBacking.layer.cornerCurve = self.layer.cornerCurve;
}

// 挂载/重挂/脱离层级时同步排除根：排除根 = JS 父容器（见 installGlassBacking 注释——
// 前景内容是父容器的其它子节点，只排除宿主会漏掉前景）。脱离层级（superview = nil）
// 时置空回退 kit 默认解析；液态开关重建背衬后由 installGlassBacking 以当时 superview 重设。
- (void)didMoveToSuperview {
  [super didMoveToSuperview];
  id<LGGlassBackingCustomizations> backing = (id<LGGlassBackingCustomizations>)_glassBacking;
  if (![backing respondsToSelector:@selector(setCaptureExclusionView:)]) return;
  [backing setCaptureExclusionView:self.superview];
}

// touchPoint 眩光（kit 能力）：手指在栏体空白区域按下/移动时，玻璃高光跟随手指。
// 触摸落在 tab 项/按钮上时由对应视图接管，此宿主收不到——效果为部分区域生效，可接受。
// 仅 14～26.1 的液态档（Metal）有效：26.2+ 与磨砂档的背衬是磨砂视图、没有该 selector，
// updateGlassTouchPoint 的 respondsToSelector 守卫直接返回。
- (void)touchesBegan:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event {
  [super touchesBegan:touches withEvent:event];
  [self updateGlassTouchPoint:touches.anyObject];
}

- (void)touchesMoved:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event {
  [super touchesMoved:touches withEvent:event];
  [self updateGlassTouchPoint:touches.anyObject];
}

- (void)touchesEnded:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event {
  [super touchesEnded:touches withEvent:event];
  [self clearGlassTouchPoint];
}

- (void)touchesCancelled:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event {
  [super touchesCancelled:touches withEvent:event];
  [self clearGlassTouchPoint];
}

- (void)updateGlassTouchPoint:(UITouch *)touch {
  if (touch == nil) return;
  id<LGGlassBackingCustomizations> glass = (id<LGGlassBackingCustomizations>)_glassBacking;
  if (![glass respondsToSelector:@selector(setTouchPoint:)]) return;
  [glass setTouchPoint:[touch locationInView:_glassBacking]];
}

- (void)clearGlassTouchPoint {
  id<LGGlassBackingCustomizations> glass = (id<LGGlassBackingCustomizations>)_glassBacking;
  if (![glass respondsToSelector:@selector(clearTouchPoint)]) return;
  [glass clearTouchPoint];
}

@end

@interface LiquidGlassViewManager : RCTViewManager
@end

@implementation LiquidGlassViewManager

RCT_EXPORT_MODULE(LiquidGlassView)

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

- (UIView *)view {
  return [[LGLiquidGlassHostView alloc] init];
}

// 主题染色：玻璃材质色跟随 App 主题（JS 传入主题氛围色 rgba 字符串）。
// 磨砂档与 26.2+ 的液态档 → 染色覆层基色；14～26.1 的液态档 → shader materialTint
// （工厂内按背衬类型分派）。
RCT_CUSTOM_VIEW_PROPERTY(tint, NSString, LGLiquidGlassHostView) {
  if (json == nil) return;
  [view applyTint:[RCTConvert UIColor:json]];
}

// 染色覆层的**用户值**（0~1，对应设置 theme.glassOpacity 0~100）。
// json 为 nil（prop 未传/重置）时回默认 0.4。磨砂档与 26.2+ 的液态档生效（前者的
// 覆层、后者同为 LGFrostedGlassView）；14～26.1 的液态档不实现该 selector，且设置 UI
// 在开关打开时隐藏该行。原生侧会再乘 maxTintAlpha(0.6) 封顶，见 LGGlassViewFactory.swift。
RCT_CUSTOM_VIEW_PROPERTY(glassOpacity, NSNumber, LGLiquidGlassHostView) {
  [view applyGlassOpacity:(json != nil ? [json floatValue] : 0.4)];
}

// App 主题明暗（JS 传 theme.isDark）。
// 系统材质（UIBlurEffect / UIGlassEffect）是**动态材质**，按 traitCollection.userInterfaceStyle
// 解析明暗；而本项目在 window 层没有统一 override，App 主题可与系统明暗不一致 ——
// 不下发就会在「App 深色 + 系统浅色」时渲染出一层亮色磨砂，与整体配色相反。
// UIVisualEffectView 不支持事后改 overrideUserInterfaceStyle，backing 内部会重建材质层；
// tint / glassOpacity 由 backing 自身持有，重建不丢，宿主无需重建 backing。
// json 为 nil（prop 未传/重置）时回默认浅色 NO。
RCT_CUSTOM_VIEW_PROPERTY(dark, NSNumber, LGLiquidGlassHostView) {
  [view applyDark:(json != nil ? [json boolValue] : NO)];
}

// 液态玻璃开关（设置 theme.liquidGlass，全 iOS 版本实际生效）：
// 切换时重建背衬（磨砂 ↔ 26.2+ 的系统原生玻璃 / 14～26.1 的 vendored Metal 液态玻璃），
// 缓存的主题属性由宿主重放。
// json 为 nil（prop 未传/重置）时回磨砂。
RCT_CUSTOM_VIEW_PROPERTY(liquid, NSNumber, LGLiquidGlassHostView) {
  [view applyLiquidMode:(json != nil ? [json boolValue] : NO)];
}

@end

// ============================================================================
// LiquidGlassLens —— Tab 切换的液态透镜药丸（上游 LiquidLensView）
// ============================================================================
// 用法（JS，见 src/components/common/LiquidLens.tsx + ModernTabBar）：
// - 组件本身是一条横向条带（RN 绝对定位放在 tab 图标带上），透镜药丸在其内部；
// - `x` prop：药丸目标中心 X（相对本组件）。首次设置直接落位，之后由原生
//   UIView 弹簧动画滑动过去（避免 RN 布局逐帧过桥的卡顿）；滑动期间透镜
//   抬起（LiquidGlassView(.lens) morph），内部的 CADisplayLink 跟踪自身位置
//   做加速度挤压/拉伸变形，落定回落静止药丸；
// - 切页交互只有快速点击（上层 tab Pressable → JS setNavActiveId → x 更新）。
//   长按/横滑拖拽切页已整体移除（2026-09-29 用户定案：上游 LiquidGlassKit 无
//   此手势层，凡上游没有的本地发明一律不要）；
// - 静止态药丸常显（上游 resting 状态：半透明白色药丸常驻选中 tab）；`pillColor`
//   prop 可覆盖药丸底色（JS 当前不传，走 Swift 默认白 30%）。

@interface LGLiquidLensHostView : RCTView
@end

@implementation LGLiquidLensHostView {
  // 恒为自研 LiquidLensView（LGLensFactory 统一创建）。上游亦为自研复刻，
  // 从不调用系统私有 _UILiquidLensView（其不响应本组件方法面，且形状不可控）；
  // 自研类编译期遵循 AnyLiquidLensView 方法面
  UIView<AnyLiquidLensView> *_lens;
  CGFloat _x;
  BOOL _hasX;
  CGFloat _pillWidth;
  CGFloat _lastWidth; // 上一次布局的宿主宽度（等比重映射的基准，0 = 尚未布局）
}

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    _lens = [LGLensFactory createLens];
    // 透镜本体不参与命中测试：触摸穿透到上层的 tab Pressable
    _lens.userInteractionEnabled = NO;
    // 首次落位前先隐藏；落位后静止态常显（对齐上游 LiquidLensView 的静止
    // 状态：半透明白色药丸常驻在选中 tab 上，未交互时持续可见）
    _lens.alpha = 0;
    _lens.autoresizingMask = UIViewAutoresizingFlexibleHeight;
    [self addSubview:_lens];
    _pillWidth = 56.0;
    self.clipsToBounds = NO; // 挤压/拉伸变形时允许略微越界，整体仍由 tab 栏容器裁剪
  }
  return self;
}

- (void)layoutSubviews {
  [super layoutSubviews];
  CGFloat width = self.bounds.size.width;
  // 宿主宽度变化（iPad 旋转等）：目标位等比静默重映射（x 公式为
  // (index+0.5)*w/count，等比映射结果与 JS 按新宽度重算的值完全一致），
  // 随后 JS 经 onLayout 重推的 x 会被 setTargetX 的同位守卫拦截，
  // 不会在旋转瞬间凭空播一次「淡入滑动淡出」闪现。onLayout 链路必然
  // 晚于本布局轮，顺序有保证。
  if (_hasX && _lastWidth > 0 && width > 0 && fabs(width - _lastWidth) > 0.5) {
    _x = _x * (width / _lastWidth);
  }
  _lastWidth = width;
  _lens.frame = CGRectMake(0, 0, _pillWidth, self.bounds.size.height);
  _lens.center = CGPointMake(_x, self.bounds.size.height / 2.0);
  // 圆角对齐宿主（JS 条带样式当前未设 borderRadius → 宿主 cornerRadius = 0，
  // 不推送圆角，透镜走默认胶囊 = min(宽,高)/2 = 28，与栏体 designRadius.glass
  // 一致；若未来 JS 设了圆角，此处钳制后推送），但必须钳制到
  // 不超过胶囊几何极限（min(宽,高)/2）：圆角大于短边一半时自研 shader 的圆角
  // SDF 不做钳制，会把透镜画成近矩形。钳制后高 56 的透镜取 28 = 标准圆角胶囊，
  // 且与栏体圆角在视觉上一致（UIKit 对 layer.cornerRadius 同样按短边一半收敛）。
  id<LGLensCustomizations> lensCustom = (id<LGLensCustomizations>)_lens;
  if ([lensCustom respondsToSelector:@selector(setLensCornerRadius:)]) {
    // 几何无效（首帧未布局 / RN 样式尚未应用）时不推送圆角：此时短边一半 = 0，
    // 推送 0 会把透镜 override 毒化成 0，下一次抬起玻璃即被 shader 画成矩形
    // （「透镜偶发变矩形」）。跳过本次，等几何有效的下一轮 layout 再对齐。
    if (self.bounds.size.height > 0 && _pillWidth > 0 && self.layer.cornerRadius > 0) {
      CGFloat radius = MIN(MIN(self.layer.cornerRadius, _pillWidth / 2.0), self.bounds.size.height / 2.0);
      [lensCustom setLensCornerRadius:radius];
    }
  }
}

// 挂载/重挂/脱离层级时同步排除根（= JS 父容器，即栏体玻璃的同一排除根）：透镜
// 叠在 tab 图标/文字上方，前景不排除会被折射进药丸。脱离层级置空回退默认解析。
- (void)didMoveToSuperview {
  [super didMoveToSuperview];
  id<LGLensCustomizations> lens = (id<LGLensCustomizations>)_lens;
  if (![lens respondsToSelector:@selector(setCaptureExclusionView:)]) return;
  [lens setCaptureExclusionView:self.superview];
}

- (void)setTargetX:(CGFloat)x animated:(BOOL)animated {
  // 同位守卫：目标与当前一致（JS 重渲染重推同一 x）时不重播动画——否则透镜
  // 会重新淡入再淡出，表现为"不消失/闪现"
  if (_hasX && fabs(x - _x) < 0.5) {
    _x = x;
    return;
  }
  _x = x;
  if (!_hasX) {
    // 首次落位不动画：直接停在选中 tab 上并进入静止常显态（上游 LiquidLensView
    // 的 resting 状态：半透明白色药丸常驻选中项）
    _hasX = YES;
    [self setNeedsLayout];
    _lens.alpha = 1.0;
    return;
  }
  if (animated) {
    // 点击切换：淡入 + 抬起 morph + 弹簧滑动（加速度挤压/拉伸由透镜内部
    // displayLink 跟踪位置产生），落定后先淡出再回落药丸（见 completion）
    [UIView animateWithDuration:0.1 animations:^{
      self->_lens.alpha = 1;
    }];
    [_lens setLifted:YES animated:YES alongsideAnimations:nil completion:nil];
    [UIView animateWithDuration:0.3
                          delay:0
         usingSpringWithDamping:0.8
          initialSpringVelocity:0
                        options:UIViewAnimationOptionBeginFromCurrentState |
                                UIViewAnimationOptionAllowUserInteraction
                     animations:^{
      self->_lens.center = CGPointMake(x, self.bounds.size.height / 2.0);
    } completion:^(BOOL finished) {
      if (!finished) return; // 连续点击时被新动画接管，由最后一次动画负责收尾
      // 落定回落药丸（跳过 morph 动画），保持静止常显（上游 resting 状态）
      [self->_lens setLifted:NO animated:NO alongsideAnimations:nil completion:nil];
    }];
  } else {
    _lens.center = CGPointMake(x, self.bounds.size.height / 2.0);
  }
}

- (void)setPillWidth:(CGFloat)width {
  _pillWidth = width;
  [self setNeedsLayout];
}

- (UIView<AnyLiquidLensView> *)lens {
  return _lens;
}

@end

@interface LiquidGlassLensManager : RCTViewManager
@end

@implementation LiquidGlassLensManager

RCT_EXPORT_MODULE(LiquidGlassLens)

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

- (UIView *)view {
  return [[LGLiquidLensHostView alloc] init];
}

// 药丸目标中心 X（相对本组件）；除首次外均带原生弹簧动画
RCT_CUSTOM_VIEW_PROPERTY(x, NSNumber, LGLiquidLensHostView) {
  if (json == nil) return;
  [view setTargetX:[json doubleValue] animated:YES];
}

// 主题染色：透镜覆层与底部栏玻璃同色（不透明基色，明暗自适应）
RCT_CUSTOM_VIEW_PROPERTY(tint, NSString, LGLiquidLensHostView) {
  if (json == nil) return;
  id<LGLensCustomizations> lens = (id<LGLensCustomizations>)view.lens;
  if (![lens respondsToSelector:@selector(setLensTintColor:)]) return;
  [lens setLensTintColor:[RCTConvert UIColor:json]];
}

// 染色覆层不透明度（0~1，用户设置 theme.glassOpacity 驱动）
RCT_CUSTOM_VIEW_PROPERTY(glassOpacity, NSNumber, LGLiquidLensHostView) {
  if (json == nil) return;
  id<LGLensCustomizations> lens = (id<LGLensCustomizations>)view.lens;
  if (![lens respondsToSelector:@selector(setLensGlassOpacity:)]) return;
  [lens setLensGlassOpacity:[json floatValue]];
}

// 按下态：药丸淡入纯透明染色药丸
RCT_CUSTOM_VIEW_PROPERTY(lifted, NSNumber, LGLiquidLensHostView) {
  if (json != nil) {
    [view.lens setLifted:[json boolValue]
                animated:YES
     alongsideAnimations:nil
              completion:nil];
  }
}

// 药丸宽度（默认 56）
// 静止药丸底色（跟随应用主题明暗，由 JS 传入 rgba 字符串；不传走 Swift 默认白 30%）
RCT_CUSTOM_VIEW_PROPERTY(pillColor, NSString, LGLiquidLensHostView) {
  if (json != nil) {
    view.lens.restingBackgroundColor = [RCTConvert UIColor:json];
  }
}

RCT_CUSTOM_VIEW_PROPERTY(pillWidth, NSNumber, LGLiquidLensHostView) {
  if (json != nil) {
    [view setPillWidth:[json doubleValue]];
  }
}

@end
