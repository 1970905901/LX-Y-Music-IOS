//
//  LXGlassLayerRender.mm
//  LiquidGlassKit (vendored from DnV1eX/LiquidGlassKit)
//
//  Vendored addition: ObjC @try 沙盒化的 CALayer.render(in:)，见头文件注释。
//  Swift 调用方（LiquidGlassView.captureRootView）据此在 layer.render 与
//  drawHierarchy 之间自动降级。
//

#import "LXGlassLayerRender.h"

bool LXGlassTryRenderLayer(CALayer *layer, CGContextRef context) {
  @try {
    [layer renderInContext:context];
    return true;
  } @catch (NSException *exception) {
    return false;
  }
}
