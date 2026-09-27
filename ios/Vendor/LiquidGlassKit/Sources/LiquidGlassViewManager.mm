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
- (void)setTouchPoint:(CGPoint)point;
- (void)clearTouchPoint;
@end

// 自研 LiquidLensView 的主题染色 / frames / 眩光入口；iOS 26 原生透镜不接受
// 自定义（走系统观感），宿主按 respondsToSelector 分流
@protocol LGLensCustomizations <NSObject>
@optional
- (void)setLensTintColor:(UIColor *)color;
- (void)setLensFrames:(NSArray<NSValue *> *)rects;
- (void)setLensCornerRadius:(CGFloat)radius;
- (void)setLensTouchPoint:(CGPoint)point;
- (void)clearLensTouchPoint;
@end

// Host view: an RCTView so all standard RN view props (borderRadius, overflow, pointerEvents,
// opacity, shadow*) keep working; the glass backing (vendored Metal LiquidGlassEffectView on
// all OS versions — the iOS 26 native UIGlassEffect branch was removed: system glass renders
// black at unrendered regions under per-frame frame changes and its snapshot is black too)
// sits inside a rounded clipping container. LGGlassViewFactory selects the backing.
// Squircle（kit cornerRoundnessExponent=4）：宿主与玻璃层统一用 continuous 圆角曲线。
// 注：不做按压玻璃形变——玻璃材质自带高对比边缘光，在裁剪容器内任何内缩都会让
// 材质自身的边缘线在胶囊内露出（方角/底边/内缘线均源于此），已验证两次故整体移除。
@interface LGLiquidGlassHostView : RCTView
/** 实际玻璃材质视图（自研 Metal LiquidGlassEffectView），tint/fps/active/触摸眩光作用于此 */
@property (nonatomic, readonly) UIView *glassBacking;
@end

@implementation LGLiquidGlassHostView {
  // _glassView = 圆角裁剪容器（圆角作用层）；_glassBacking = 内部玻璃材质视图
  // （自研 Metal LiquidGlassEffectView）。分两层：UIKit 官方推荐的圆角毛玻璃做法，
  // 圆角裁剪容器让玻璃形状与宿主完全一致。
  UIView *_glassView;
  UIView *_glassBacking;
}

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    [self installGlassBacking:[LGGlassViewFactory createGlassBacking]];
    self.clipsToBounds = YES;
    // 常量名在旧 SDK(UIViewCornerCurveContinuous)与新 SDK(Xcode 26 起的 UICornerCurve 系列)间不一致,
    // 直接用底层字符串值,两端 SDK 均可编译且运行时行为相同。
    self.layer.cornerCurve = @"continuous";
  }
  return self;
}

- (void)installGlassBacking:(UIView *)backing {
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
  _glassBacking = backing;
  _glassView = container;
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

// touchPoint 眩光（kit 能力）：手指在栏体空白区域按下/移动时，玻璃高光跟随手指。
// 触摸落在 tab 项/按钮上时由对应视图接管，此宿主收不到——效果为部分区域生效，可接受。
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
  id<LGGlassMetalBacking> glass = (id<LGGlassMetalBacking>)_glassBacking;
  if (![glass respondsToSelector:@selector(setTouchPoint:)]) return;
  [glass setTouchPoint:[touch locationInView:_glassBacking]];
}

- (void)clearGlassTouchPoint {
  id<LGGlassMetalBacking> glass = (id<LGGlassMetalBacking>)_glassBacking;
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

RCT_CUSTOM_VIEW_PROPERTY(fps, NSNumber, LGLiquidGlassHostView) {
  // 仅自研 Metal 路径支持（原生 UIGlassEffect 由系统合成，无需该控制）；
  // prop 被移除/重置时 json 为 nil，回到 30 的默认值
  id<LGGlassMetalBacking> glass = (id<LGGlassMetalBacking>)view.glassBacking;
  if (![glass respondsToSelector:@selector(setPreferredFramesPerSecond:)]) return;
  [glass setPreferredFramesPerSecond:(json != nil ? [json integerValue] : 30)];
}

// 主题染色：玻璃材质色跟随 App 主题（JS 传入主题氛围色 rgba 字符串）。
// 仅自研 Metal 路径生效（原生路径的染色在 Swift 工厂内处理或走系统默认）。
RCT_CUSTOM_VIEW_PROPERTY(tint, NSString, LGLiquidGlassHostView) {
  if (json == nil) return;
  [LGGlassViewFactory applyGlassTint:view.glassBacking tint:[RCTConvert UIColor:json]];
}

// JS 脉冲活跃开关（省电核心）：玻璃背后内容在无触摸交互下发生变化（切 Tab、换主题、
// 换歌封面）时 JS 置 true 让玻璃恢复渲染，静止时置 false —— 渲染时钟完全停止，仅保留
// 最后一帧。滚动/拖拽由原生窗口级手势观察自动覆盖，无需 JS 参与。
// 仅自研 Metal 路径支持；json 为 nil（prop 未传）时不动作。
RCT_CUSTOM_VIEW_PROPERTY(active, NSNumber, LGLiquidGlassHostView) {
  if (json == nil) return;
  id<LGGlassMetalBacking> glass = (id<LGGlassMetalBacking>)view.glassBacking;
  if (![glass respondsToSelector:@selector(setJsActive:)]) return;
  [glass setJsActive:[json boolValue]];
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
// - 长按/滑动拖动切换（原生手势挂在父容器/tab 栏上，共用一套状态机）：
//   长按 0.35s 抬起透镜并立即选中按住的 tab；或按住 tab 直接横向滑动（无需
//   停顿）抬起透镜跟手（挤压/拉伸），越过 tab 边界即切换页面；松手时落点
//   tab 通过 onDragSelect 事件通知 JS 切页；快速点击不受影响；
// - `tabCount` prop：tab 数量，用于把松手位置换算成 tab 序号；
// - `pillColor` prop：静止药丸底色（rgba 字符串，按主题明暗传不同值）。

@interface LGLiquidLensHostView : RCTView <UIGestureRecognizerDelegate>
@property (nonatomic, copy) RCTDirectEventBlock onDragSelect;
@property (nonatomic, readonly) BOOL dragging;
@end

// 把横条内的 X 坐标换算成 tab 序号（越界收敛到两端）
static NSInteger LXTabZoneForX(CGFloat x, CGFloat width, NSInteger count) {
  if (count <= 0 || width <= 0) return -1;
  NSInteger zone = (NSInteger)floor(x / (width / count));
  return MIN(MAX(zone, 0), count - 1);
}

@implementation LGLiquidLensHostView {
  // iOS 26+ 为系统原生 _UILiquidLensView，旧系统为自研 LiquidLensView，
  // 两者共同遵循 AnyLiquidLensView 方法面（自研类/原生类经运行时挂协议）
  UIView<AnyLiquidLensView> *_lens;
  CGFloat _x;
  BOOL _hasX;
  CGFloat _pillWidth;
  NSInteger _tabCount;
  UILongPressGestureRecognizer *_dragRecognizer;
  BOOL _dragging;
  NSInteger _dragZone; // 拖拽过程中透镜当前所在的 tab（-1 = 尚未采样）
  CGFloat _dragStartCenterX; // 拖拽起点（frames 合并 span 的基准）
  BOOL _spanActive; // frames 合并进行中（透镜本体检已拉伸为跨 tab 的 span）
  UIPanGestureRecognizer *_panRecognizer; // 按住直接滑动（无需先停顿）的切页入口
}

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    _lens = [LGLensFactory createLens];
    // 透镜本体不参与命中测试：触摸穿透到上层的 tab Pressable（长按拖拽由
    // 宿主挂在父容器上的手势识别器接管）
    _lens.userInteractionEnabled = NO;
    // 静止时整体隐藏：透镜只在运动过程（点击切换/长按拖拽）中可见，静止态
    // 不显示圆形药丸（常显的半透明胶囊在真实界面上观感如"磨砂残留"）
    _lens.alpha = 0;
    _lens.autoresizingMask = UIViewAutoresizingFlexibleHeight;
    [self addSubview:_lens];
    _pillWidth = 56.0;
    _tabCount = 5;
    self.clipsToBounds = NO; // 挤压/拉伸变形时允许略微越界，整体仍由 tab 栏容器裁剪

    _dragRecognizer = [[UILongPressGestureRecognizer alloc] initWithTarget:self
                                                                    action:@selector(handleDrag:)];
    _dragRecognizer.minimumPressDuration = 0.35;
    // 滑动切换：按住 tab 按钮直接横向滑动（不停顿）也能进入拖拽切页。位移超过
    // ~10pt 时长按识别器会失败，单靠它做不了"边滑边切"，故补一个水平优势的
    // Pan 入口（是否该开始见 gestureRecognizerShouldBegin:），两条路径共用
    // 同一套拖拽状态机（updateDragWithState:...）
    _panRecognizer = [[UIPanGestureRecognizer alloc] initWithTarget:self
                                                             action:@selector(handlePan:)];
    _panRecognizer.delegate = self;
  }
  return self;
}

// 手势识别器挂在父容器（tab 栏 RCTView）上：观察整条栏的触摸；
// 快速点击（< 0.35s）照常走 Pressable，长按后系统取消 Pressable 触摸
// 并进入拖拽模式（cancelsTouchesInView 默认开启）
- (void)didMoveToWindow {
  [super didMoveToWindow];
  if (_dragRecognizer != nil && _dragRecognizer.view != nil) {
    [_dragRecognizer.view removeGestureRecognizer:_dragRecognizer];
  }
  if (_panRecognizer != nil && _panRecognizer.view != nil) {
    [_panRecognizer.view removeGestureRecognizer:_panRecognizer];
  }
  UIView *container = self.superview;
  if (container != nil) {
    if (_dragRecognizer != nil) [container addGestureRecognizer:_dragRecognizer];
    if (_panRecognizer != nil) [container addGestureRecognizer:_panRecognizer];
  }
}

- (void)handleDrag:(UILongPressGestureRecognizer *)gesture {
  [self updateDragWithState:gesture.state location:[gesture locationInView:self] fromLongPress:YES];
}

// 滑动切换入口：按住 tab 按钮直接横向滑动（不停顿）即进入拖拽切页
- (void)handlePan:(UIPanGestureRecognizer *)gesture {
  [self updateDragWithState:gesture.state location:[gesture locationInView:self] fromLongPress:NO];
}

// 长按与滑动两条手势路径共用的拖拽状态机
- (void)updateDragWithState:(UIGestureRecognizerState)state location:(CGPoint)location fromLongPress:(BOOL)fromLongPress {
  CGFloat fingerX = location.x;
  CGFloat half = _pillWidth / 2.0;
  CGFloat maxCenter = MAX(half, self.bounds.size.width - half);
  CGFloat clampedFingerX = MIN(MAX(fingerX, half), maxCenter);
  id<LGLensCustomizations> lensCustom = (id<LGLensCustomizations>)_lens;

  switch (state) {
    case UIGestureRecognizerStateBegan: {
      if (_dragging) break; // 另一条手势路径已进入拖拽（互斥）
      _dragging = YES;
      _dragStartCenterX = clampedFingerX;
      _spanActive = NO;
      [_lens setLifted:YES animated:YES alongsideAnimations:nil completion:nil];
      _lens.center = CGPointMake(clampedFingerX, self.bounds.size.height / 2.0);
      [UIView animateWithDuration:0.15 animations:^{
        self->_lens.alpha = 1;
      }];
      // 抬起触觉反馈（对齐 LiquidGlassSwitch 的抓取反馈）
      UIImpactFeedbackGenerator *haptic = [[UIImpactFeedbackGenerator alloc] initWithStyle:UIImpactFeedbackStyleMedium];
      [haptic impactOccurred];
      // 长按即切换：按住 0.35s 的 tab 立即选中（滑动路径手指在移动中，不在此刻
      // 选中，交给 Changed 的越界切换逻辑）。按住的就是当前 tab 时不重复切换。
      _dragZone = LXTabZoneForX(fingerX, self.bounds.size.width, _tabCount);
      if (fromLongPress && _dragZone >= 0 && _dragZone != LXTabZoneForX(_x, self.bounds.size.width, _tabCount) && _onDragSelect != nil) {
        _onDragSelect(@{ @"index": @(_dragZone) });
        UISelectionFeedbackGenerator *selection = [[UISelectionFeedbackGenerator alloc] init];
        [selection selectionChanged];
      }
      break;
    }
    case UIGestureRecognizerStateChanged: {
      // 1:1 跟手（不做弹簧）：透镜内部的 displayLink 追踪自身位置变化产生挤压/拉伸
      BOOL spanMode = fabs(fingerX - _dragStartCenterX) > _pillWidth;
      if (spanMode) {
        // frames 合并（kit 能力）：透镜本体拉伸为「起点 tab + 当前手指 tab」的
        // 跨区 span，shader 将两个胶囊矩形合并成一块连续玻璃（对齐参考视频的
        // 横跨变形）。squash/stretch 在 span 模式下由透镜内部跳过，避免打架。
        CGFloat spanLeft = MIN(_dragStartCenterX, clampedFingerX) - half;
        CGFloat spanWidth = MAX(_dragStartCenterX, clampedFingerX) + half - spanLeft;
        _lens.frame = CGRectMake(spanLeft, 0, spanWidth, self.bounds.size.height);
        _lens.center = CGPointMake(spanLeft + spanWidth / 2.0, self.bounds.size.height / 2.0);
        _spanActive = YES;
        if ([lensCustom respondsToSelector:@selector(setLensFrames:)]) {
          CGRect r1 = CGRectMake(_dragStartCenterX - half - spanLeft, 0, _pillWidth, self.bounds.size.height);
          CGRect r2 = CGRectMake(clampedFingerX - half - spanLeft, 0, _pillWidth, self.bounds.size.height);
          [lensCustom setLensFrames:@[[NSValue valueWithCGRect:r1], [NSValue valueWithCGRect:r2]]];
        }
      } else if (_spanActive) {
        // 拖回起点附近：退出 span 模式，恢复单胶囊
        _spanActive = NO;
        _lens.frame = CGRectMake(0, 0, _pillWidth, self.bounds.size.height);
        _lens.center = CGPointMake(clampedFingerX, self.bounds.size.height / 2.0);
        if ([lensCustom respondsToSelector:@selector(setLensFrames:)]) {
          [lensCustom setLensFrames:@[]];
        }
      } else {
        _lens.center = CGPointMake(clampedFingerX, self.bounds.size.height / 2.0);
      }
      if ([lensCustom respondsToSelector:@selector(setLensTouchPoint:)]) {
        [lensCustom setLensTouchPoint:CGPointMake(location.x - (_lens.center.x - _pillWidth / 2.0), location.y)];
      }
      // 基于边缘的切换（对齐 LiquidGlassSwitch）：拖拽越过 tab 边界即刻
      // 切换页面并伴随轻触觉反馈，无需等松手
      NSInteger zone = LXTabZoneForX(fingerX, self.bounds.size.width, _tabCount);
      if (zone >= 0) {
        if (_dragZone == -1) {
          _dragZone = zone;
        } else if (zone != _dragZone) {
          _dragZone = zone;
          if (_onDragSelect != nil) {
            _onDragSelect(@{ @"index": @(zone) });
          }
          UIImpactFeedbackGenerator *haptic = [[UIImpactFeedbackGenerator alloc] initWithStyle:UIImpactFeedbackStyleLight];
          [haptic impactOccurred];
        }
      }
      break;
    }
    case UIGestureRecognizerStateEnded: {
      _dragging = NO;
      // 松手触觉确认；落点若与已切换的 tab 不一致（边界采样间隙）则补一次切换
      UISelectionFeedbackGenerator *selection = [[UISelectionFeedbackGenerator alloc] init];
      [selection selectionChanged];
      NSInteger fingerZone = LXTabZoneForX(fingerX, self.bounds.size.width, _tabCount);
      NSInteger currentZone = LXTabZoneForX(_x, self.bounds.size.width, _tabCount);
      // 退出 span 模式：frames 清空、透镜本体恢复药丸尺寸（以松手位置为基准）
      if (_spanActive) {
        _spanActive = NO;
        if ([lensCustom respondsToSelector:@selector(setLensFrames:)]) {
          [lensCustom setLensFrames:@[]];
        }
        _lens.frame = CGRectMake(0, 0, _pillWidth, self.bounds.size.height);
        _lens.center = CGPointMake(clampedFingerX, self.bounds.size.height / 2.0);
      }
      if ([lensCustom respondsToSelector:@selector(clearLensTouchPoint)]) {
        [lensCustom clearLensTouchPoint];
      }
      if (fingerZone >= 0 && fingerZone != currentZone && _onDragSelect != nil) {
        // 切到落点 tab：保持抬起形态，JS 更新 x prop 后弹簧归位并回落淡出
        _dragZone = fingerZone;
        _onDragSelect(@{ @"index": @(fingerZone) });
      } else {
        // 落点即当前 tab：原地回落药丸并快速淡出（静止无遮罩）
        [UIView animateWithDuration:0.35
                              delay:0
             usingSpringWithDamping:0.8
              initialSpringVelocity:0
                            options:UIViewAnimationOptionBeginFromCurrentState
                         animations:^{
          self->_lens.center = CGPointMake(self->_x, self.bounds.size.height / 2.0);
        } completion:nil];
        [_lens setLifted:NO animated:NO alongsideAnimations:nil completion:nil];
        [UIView animateWithDuration:0.15 animations:^{
          self->_lens.alpha = 0;
        }];
      }
      break;
    }
    case UIGestureRecognizerStateCancelled:
    case UIGestureRecognizerStateFailed: {
      _dragging = NO;
      [_lens setLifted:NO animated:NO alongsideAnimations:nil completion:nil];
      if (_spanActive) {
        _spanActive = NO;
        if ([lensCustom respondsToSelector:@selector(setLensFrames:)]) {
          [lensCustom setLensFrames:@[]];
        }
        _lens.frame = CGRectMake(0, 0, _pillWidth, self.bounds.size.height);
      }
      if ([lensCustom respondsToSelector:@selector(clearLensTouchPoint)]) {
        [lensCustom clearLensTouchPoint];
      }
      // 中断时弹回当前选中 tab 的位置并快速淡出
      [UIView animateWithDuration:0.3
                            delay:0
           usingSpringWithDamping:0.8
            initialSpringVelocity:0
                          options:UIViewAnimationOptionBeginFromCurrentState
                       animations:^{
        self->_lens.center = CGPointMake(self->_x, self.bounds.size.height / 2.0);
      } completion:nil];
      [UIView animateWithDuration:0.15 animations:^{
        self->_lens.alpha = 0;
      }];
      break;
    }
    default:
      break;
  }
}

#pragma mark - UIGestureRecognizerDelegate（滑动切页入口）

// 仅在"横向位移明显占优且尚未进入长按拖拽"时开始滑动切页：
// 纵向滑动（误触）不触发；已由长按路径接管时不重复进入
- (BOOL)gestureRecognizerShouldBegin:(UIPanGestureRecognizer *)gesture {
  if (_dragging) return NO;
  CGPoint translation = [gesture translationInView:self];
  CGFloat x = fabs(translation.x);
  CGFloat y = fabs(translation.y);
  return x > 8 && x > y * 1.2;
}

// 允许与玻璃按压观察器（挂在同一容器上、按下即识别）并行：
// 否则滑动入口会被先识别的按压观察器挤掉失效
- (BOOL)gestureRecognizer:(UIGestureRecognizer *)gestureRecognizer shouldRecognizeSimultaneouslyWithOtherGestureRecognizer:(UIGestureRecognizer *)otherGestureRecognizer {
  return YES;
}

- (void)layoutSubviews {
  [super layoutSubviews];
  if (_dragging) return; // 拖拽中透镜 frame/位置由手势逻辑接管
  _lens.frame = CGRectMake(0, 0, _pillWidth, self.bounds.size.height);
  _lens.center = CGPointMake(_x, self.bounds.size.height / 2.0);
  // 圆角对齐宿主（JS 在条带样式上设置 borderRadius = tab 栏圆角），但必须钳制到
  // 不超过胶囊几何极限（min(宽,高)/2）：圆角大于短边一半时自研 shader 的圆角
  // SDF 不做钳制，会把透镜画成近矩形。钳制后高 56 的透镜取 28 = 标准圆角胶囊，
  // 且与栏体圆角在视觉上一致（UIKit 对 layer.cornerRadius 同样按短边一半收敛）。
  id<LGLensCustomizations> lensCustom = (id<LGLensCustomizations>)_lens;
  if ([lensCustom respondsToSelector:@selector(setLensCornerRadius:)]) {
    CGFloat radius = MIN(MIN(self.layer.cornerRadius, _pillWidth / 2.0), self.bounds.size.height / 2.0);
    [lensCustom setLensCornerRadius:radius];
  }
}

- (void)setTargetX:(CGFloat)x animated:(BOOL)animated {
  _x = x;
  if (!_hasX) {
    // 首次落位不动画也不显示（静止无遮罩）：透镜已在正确位置待命（alpha 0）
    _hasX = YES;
    [self setNeedsLayout];
    return;
  }
  if (animated) {
    // 点击切换：与长按拖拽一致的液态动画——淡入 + 抬起 morph + 弹簧滑动（加速度
    // 挤压/拉伸由透镜内部 displayLink 跟踪位置产生），落定后回落药丸并快速淡出
    // （静止无遮罩，见 completion）
    [UIView animateWithDuration:0.15 animations:^{
      self->_lens.alpha = 1;
    }];
    [_lens setLifted:YES animated:YES alongsideAnimations:nil completion:nil];
    [UIView animateWithDuration:0.4
                          delay:0
         usingSpringWithDamping:0.78
          initialSpringVelocity:0
                        options:UIViewAnimationOptionBeginFromCurrentState |
                                UIViewAnimationOptionAllowUserInteraction
                     animations:^{
      self->_lens.center = CGPointMake(x, self.bounds.size.height / 2.0);
    } completion:^(BOOL finished) {
      if (!finished) return; // 连续点击时被新动画接管，由最后一次动画负责收尾
      // 落定立即快速消失：跳过回落 morph 动画（animated:NO）+ 0.15s 快速淡出，
      // 避免"切换完成后药丸还停留一段时间"的残留感
      [self->_lens setLifted:NO animated:NO alongsideAnimations:nil completion:nil];
      [UIView animateWithDuration:0.15 animations:^{
        self->_lens.alpha = 0;
      }];
    }];
  } else {
    _lens.center = CGPointMake(x, self.bounds.size.height / 2.0);
  }
}

- (void)setPillWidth:(CGFloat)width {
  _pillWidth = width;
  [self setNeedsLayout];
}

- (void)setTabCount:(NSInteger)tabCount {
  if (tabCount > 0) {
    _tabCount = tabCount;
  }
}

- (BOOL)dragging {
  return _dragging;
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

// 药丸目标中心 X（相对本组件）；除首次外均带原生弹簧动画。
// 拖拽过程中 JS 不会更新 x（选择在松手时才发生），保险起见拖拽中忽略。
RCT_CUSTOM_VIEW_PROPERTY(x, NSNumber, LGLiquidLensHostView) {
  if (json == nil || view.dragging) return;
  [view setTargetX:[json doubleValue] animated:YES];
}

// 拖拽松手事件：{ index: 落点所在 tab 序号 }，JS 收到后切换对应页面
RCT_EXPORT_VIEW_PROPERTY(onDragSelect, RCTDirectEventBlock)

// tab 数量：把松手位置换算成 tab 序号（默认 5）
RCT_CUSTOM_VIEW_PROPERTY(tabCount, NSNumber, LGLiquidLensHostView) {
  if (json != nil) {
    [view setTabCount:[json integerValue]];
  }
}

// 主题染色：透镜玻璃与底部栏玻璃同色（否则 .lens 预设近乎透明，
// 滑过深色内容时呈黑团——用户反馈的拖拽闪黑）
RCT_CUSTOM_VIEW_PROPERTY(tint, NSString, LGLiquidLensHostView) {
  if (json == nil) return;
  id<LGLensCustomizations> lens = (id<LGLensCustomizations>)view.lens;
  if (![lens respondsToSelector:@selector(setLensTintColor:)]) return;
  [lens setLensTintColor:[RCTConvert UIColor:json]];
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
