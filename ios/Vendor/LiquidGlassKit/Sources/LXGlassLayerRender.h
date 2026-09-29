#import <QuartzCore/QuartzCore.h>
#import <CoreGraphics/CoreGraphics.h>

//! Vendored addition: 沙盒化的 CALayer.render(in:)。
//!
//! iOS 26 上对整窗（含状态栏/键盘/RNN 容器等私有图层）递归渲染有 NSException 崩溃
//! 前科（303dbdf 时代实测），而 Swift 无法捕获 ObjC 异常——在 ObjC 层 @try/@catch
//! 兜底：成功返回 true；异常返回 false（调用方降级 drawHierarchy——闪烁但不崩溃）。
//!
//! extern "C" 守卫：实现是 .mm（ObjC++），无守卫时定义按 C++ 规则修饰（_Z…），
//! 而 umbrella header 以纯 ObjC 编译给 Swift、期望未修饰的 C 符号——
//! 无守卫 = 链接期 Undefined symbols（CI 2046cb4 实锤）。
#ifdef __cplusplus
extern "C" {
#endif
bool LXGlassTryRenderLayer(CALayer *layer, CGContextRef context);
#ifdef __cplusplus
}
#endif
