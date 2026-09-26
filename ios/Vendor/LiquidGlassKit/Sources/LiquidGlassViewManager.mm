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

// Host view: an RCTView so all standard RN view props (borderRadius, overflow, pointerEvents,
// opacity, shadow*) keep working; the LiquidGlassEffectView is pinned as its only subview.
@interface LGLiquidGlassHostView : RCTView
@property (nonatomic, readonly) LiquidGlassEffectView *glassView;
@end

@implementation LGLiquidGlassHostView {
  LiquidGlassEffectView *_glassView;
}

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    _glassView = [[LiquidGlassEffectView alloc] init];
    // 背景层不参与命中测试：触摸一律穿透到上层的 RN 内容视图（Tab 项、播放条按钮、宿主手势）
    _glassView.userInteractionEnabled = NO;
    _glassView.backgroundColor = [UIColor clearColor];
    _glassView.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    [self addSubview:_glassView];
    // 圆角玻璃需要裁剪：shader 自身按 cornerRadius 折射成形，这里再兜底裁一次
    self.clipsToBounds = YES;
  }
  return self;
}

- (void)layoutSubviews {
  [super layoutSubviews];
  // RN 设置在宿主 RCTView 上的圆角转发给玻璃视图（shader uniforms.cornerRadius 驱动折射形状）
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
  // prop 被移除/重置时 json 为 nil，回到 30 的默认值
  [view.glassView setPreferredFramesPerSecond:(json != nil ? [json intValue] : 30)];
}

// JS 脉冲活跃开关（省电核心）：玻璃背后内容在无触摸交互下发生变化（切 Tab、换主题、
// 换歌封面）时 JS 置 true 让玻璃恢复渲染，静止时置 false —— 渲染时钟完全停止，仅保留
// 最后一帧。滚动/拖拽由原生窗口级手势观察自动覆盖，无需 JS 参与。
// json 为 nil（prop 未传）时不动作：原生挂载后自带 1s 活跃窗兜底，之后保持当前状态。
RCT_CUSTOM_VIEW_PROPERTY(active, NSNumber, LGLiquidGlassHostView) {
  if (json != nil) {
    [view.glassView setJsActive:[json boolValue]];
  }
}

@end
