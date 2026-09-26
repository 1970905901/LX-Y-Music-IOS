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
//  - Render as a leaf element (<LiquidGlass />) absolutely positioned to fill its parent;
//    it renders the live liquid-glass background of whatever is behind the parent container.
//  - The parent container should have `borderRadius` + `overflow: 'hidden'` (rounds the bar);
//    the corner radius set on this view itself is also forwarded to the glass shader.
//  - `fps` throttles continuous rendering while active (default 30).
//  - `active` (battery): the glass pauses its render clock when inactive and keeps the last
//    frame. Raise it via JS pulses whenever content changes without touch (tab switch, theme,
//    cover change); scrolling is covered natively by a window-level pan observer. Fresh views
//    render continuously for ~1s to cover mount/transition animations.
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

// 自研 Metal 路径（LiquidGlassEffectView）独有的按需渲染控制；原生 UIGlassEffect
// backing 不实现这些方法（系统合成，无需控制），宿主按 respondsToSelector 分流。
@protocol LGGlassMetalBacking <NSObject>
@optional
- (void)setPreferredFramesPerSecond:(NSInteger)fps;
- (void)setJsActive:(BOOL)active;
@end

// Host view: an RCTView so all standard RN view props (borderRadius, overflow, pointerEvents,
// opacity, shadow*) keep working; the glass backing (native UIGlassEffect on iOS 26+ built with
// Xcode 26, vendored Metal implementation otherwise) is pinned as its only subview.
// LGGlassViewFactory selects the backing; dark-theme changes rebuild it
// (UIVisualEffectView does not support changing overrideUserInterfaceStyle after creation).
@interface LGLiquidGlassHostView : RCTView
@property (nonatomic, readonly) UIView *glassView;
@end

@implementation LGLiquidGlassHostView {
  UIView *_glassView;
  BOOL _isDark;
}

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    _isDark = NO;
    [self installGlassBacking:[LGGlassViewFactory createGlassBackingWithDark:NO]];
    self.clipsToBounds = YES;
  }
  return self;
}

- (void)installGlassBacking:(UIView *)glassView {
  // 背景层不参与命中测试：触摸一律穿透到上层的 RN 内容视图（Tab 项、播放条按钮、宿主手势）
  glassView.userInteractionEnabled = NO;
  glassView.backgroundColor = [UIColor clearColor];
  glassView.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
  [self addSubview:glassView];
  glassView.layer.cornerRadius = self.layer.cornerRadius;
  _glassView = glassView;
}

- (void)rebuildGlassBackingForDark:(BOOL)dark {
  if (_isDark == dark) return;
  _isDark = dark;
  [_glassView removeFromSuperview];
  [self installGlassBacking:[LGGlassViewFactory createGlassBackingWithDark:dark]];
}

- (void)layoutSubviews {
  [super layoutSubviews];
  // RN 设置在宿主 RCTView 上的圆角转发给玻璃视图（自研路径的 shader uniforms.cornerRadius
  // 驱动折射形状；原生路径由系统按 layer.cornerRadius 裁剪）
  _glassView.layer.cornerRadius = self.layer.cornerRadius;
  _glassView.layer.cornerCurve = self.layer.cornerCurve;
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

RCT_CUSTOM_VIEW_PROPERTY(fps, NSNumber, LGLiquidGlassHostView) {
  // 仅自研 Metal 路径支持（原生 UIGlassEffect 由系统合成，无需该控制）；
  // prop 被移除/重置时 json 为 nil，回到 30 的默认值
  id<LGGlassMetalBacking> glass = (id<LGGlassMetalBacking>)view.glassView;
  if (![glass respondsToSelector:@selector(setPreferredFramesPerSecond:)]) return;
  [glass setPreferredFramesPerSecond:(json != nil ? [json integerValue] : 30)];
}

// JS 脉冲活跃开关（省电核心）：玻璃背后内容在无触摸交互下发生变化（切 Tab、换主题、
// 换歌封面）时 JS 置 true 让玻璃恢复渲染，静止时置 false —— 渲染时钟完全停止，仅保留
// 最后一帧。滚动/拖拽由原生窗口级手势观察自动覆盖，无需 JS 参与。
// 仅自研 Metal 路径支持；json 为 nil（prop 未传）时不动作。
RCT_CUSTOM_VIEW_PROPERTY(active, NSNumber, LGLiquidGlassHostView) {
  if (json == nil) return;
  id<LGGlassMetalBacking> glass = (id<LGGlassMetalBacking>)view.glassView;
  if (![glass respondsToSelector:@selector(setJsActive:)]) return;
  [glass setJsActive:[json boolValue]];
}

// App 主题明暗（区别于系统明暗）：玻璃染色按此自适应。
// UIVisualEffectView 不支持事后改 overrideUserInterfaceStyle，因此统一重建 backing
// （自研路径重建后按需渲染时钟状态由挂载活跃窗与后续脉冲自然恢复，无视觉断层）。
RCT_CUSTOM_VIEW_PROPERTY(dark, NSNumber, LGLiquidGlassHostView) {
  if (json != nil) {
    [view rebuildGlassBackingForDark:[json boolValue]];
  }
}

@end

// ============================================================================
// LiquidGlassLens —— Tab 切换的液态透镜药丸（上游 LiquidLensView）
// ============================================================================
// 用法（JS，见 src/components/common/LiquidLens.tsx + ModernTabBar）：
// - 组件本身是一条横向条带（RN 绝对定位放在 tab 图标带上），透镜药丸在其内部；
// - `x` prop：药丸目标中心 X（相对本组件）。首次设置直接落位，之后由原生
//   UIView 弹簧动画滑动过去（避免 RN 布局逐帧过桥的卡顿）；被抬起时药丸内部
//   的 CADisplayLink 会跟踪自身位置做加速度挤压/拉伸变形；
// - `lifted` prop：按下态（药丸 morph 成完整液态玻璃），松开回落为半透明药丸；
//   静止（未抬起）时透镜内部不跑任何 Metal 渲染，零功耗。
// - `pillColor` prop：静止药丸底色（rgba 字符串，按主题明暗传不同值）。

@interface LGLiquidLensHostView : RCTView
@end

@implementation LGLiquidLensHostView {
  // iOS 26+ 为系统原生 _UILiquidLensView，旧系统为自研 LiquidLensView，
  // 两者共同遵循 AnyLiquidLensView 方法面（自研类/原生类经运行时挂协议）
  UIView<AnyLiquidLensView> *_lens;
  CGFloat _x;
  BOOL _hasX;
  CGFloat _pillWidth;
}

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    _lens = [LGLensFactory createLens];
    // 透镜不参与命中测试：触摸一律穿透到上层的 tab Pressable
    _lens.userInteractionEnabled = NO;
    _lens.autoresizingMask = UIViewAutoresizingFlexibleHeight;
    [self addSubview:_lens];
    _pillWidth = 56.0;
    self.clipsToBounds = NO; // 挤压/拉伸变形时允许略微越界，整体仍由 tab 栏容器裁剪
  }
  return self;
}

- (void)layoutSubviews {
  [super layoutSubviews];
  _lens.frame = CGRectMake(0, 0, _pillWidth, self.bounds.size.height);
  _lens.center = CGPointMake(_x, self.bounds.size.height / 2.0);
}

- (void)setTargetX:(CGFloat)x animated:(BOOL)animated {
  _x = x;
  if (!_hasX) {
    // 首次落位不动画：避免应用启动时药丸从左边缘飞入
    _hasX = YES;
    [self setNeedsLayout];
    return;
  }
  if (animated) {
    [UIView animateWithDuration:0.4
                          delay:0
         usingSpringWithDamping:0.78
          initialSpringVelocity:0
                        options:UIViewAnimationOptionBeginFromCurrentState |
                                UIViewAnimationOptionAllowUserInteraction
                     animations:^{
      self->_lens.center = CGPointMake(x, self.bounds.size.height / 2.0);
    } completion:nil];
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
  if (json != nil) {
    [view setTargetX:[json doubleValue] animated:YES];
  }
}

// 按下态：药丸 morph 成完整液态玻璃（内部按需渲染时钟随 lift 启停，静止零开销）
RCT_CUSTOM_VIEW_PROPERTY(lifted, NSNumber, LGLiquidLensHostView) {
  if (json != nil) {
    [view.lens setLifted:[json boolValue]
                animated:YES
     alongsideAnimations:nil
              completion:nil];
  }
}

// 静止药丸底色（跟随应用主题明暗，由 JS 传入 rgba 字符串）
RCT_CUSTOM_VIEW_PROPERTY(pillColor, NSString, LGLiquidLensHostView) {
  if (json != nil) {
    view.lens.restingBackgroundColor = [RCTConvert UIColor:json];
  }
}

// 药丸宽度（默认 56）
RCT_CUSTOM_VIEW_PROPERTY(pillWidth, NSNumber, LGLiquidLensHostView) {
  if (json != nil) {
    [view setPillWidth:[json doubleValue]];
  }
}

@end
