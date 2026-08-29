#import <UIKit/UIKit.h>
#import <XCTest/XCTest.h>

// 配置级单测：无需启动 RN App（旧模板用例等待 "Welcome to React" 标签，
// 在 RNN bootstrap 的 App 中必然超时失败），直接校验 Info.plist 的
// iPad 适配关键配置与原生模块注册情况。
@interface LxMusicMobileTests : XCTestCase

@end

@implementation LxMusicMobileTests

- (NSDictionary<NSString *, id> *)infoPlist {
  return [NSBundle mainBundle].infoDictionary;
}

// Universal 包：iPhone + iPad
- (void)testTargetedDeviceFamilySupportsIPad {
  NSArray<NSNumber *> *deviceFamily = self.infoPlist[@"UIDeviceFamily"];
  XCTAssertTrue([deviceFamily containsObject:@1], @"UIDeviceFamily 缺少 iPhone (1)");
  XCTAssertTrue([deviceFamily containsObject:@2], @"UIDeviceFamily 缺少 iPad (2)");
}

// 退出多任务：参与 multitasking 的 App 必须支持全部四个方向，
// 本项目选择 UIRequiresFullScreen=YES 退出多任务，规避该校验
- (void)testRequiresFullScreenToOptOutOfMultitasking {
  NSNumber *requiresFullScreen = self.infoPlist[@"UIRequiresFullScreen"];
  XCTAssertNotNil(requiresFullScreen, @"缺少 UIRequiresFullScreen（iPad 多任务方向校验需要）");
  XCTAssertTrue(requiresFullScreen.boolValue, @"UIRequiresFullScreen 应为 YES");
}

// iPhone 仅竖屏
- (void)testIPhoneSupportsOnlyPortrait {
  NSArray<NSString *> *orientations = self.infoPlist[@"UISupportedInterfaceOrientations"];
  XCTAssertEqual(orientations.count, 1, @"iPhone 应仅支持一个方向");
  XCTAssertEqualObjects(orientations.firstObject, @"UIInterfaceOrientationPortrait");
}

// iPad 支持竖屏 + 左右横屏
- (void)testIPadSupportsPortraitAndLandscape {
  NSArray<NSString *> *orientations = self.infoPlist[@"UISupportedInterfaceOrientations~ipad"];
  XCTAssertTrue([orientations containsObject:@"UIInterfaceOrientationPortrait"]);
  XCTAssertTrue([orientations containsObject:@"UIInterfaceOrientationLandscapeLeft"]);
  XCTAssertTrue([orientations containsObject:@"UIInterfaceOrientationLandscapeRight"]);
}

// 后台播放
- (void)testBackgroundAudioMode {
  NSArray<NSString *> *modes = self.infoPlist[@"UIBackgroundModes"];
  XCTAssertTrue([modes containsObject:@"audio"], @"缺少 audio 后台模式");
}

// UtilsModule（AppDelegate 内联）应随 bridge 注册，含窗口尺寸等导出方法
- (void)testUtilsModuleIsRegistered {
  Class cls = NSClassFromString(@"UtilsModule");
  XCTAssertNotNil(cls, @"UtilsModule 类不存在（AppDelegate 内联模块未注册）");
  XCTAssertTrue([cls instancesRespondToSelector:NSSelectorFromString(@"getWindowSize")],
                @"UtilsModule 缺少 getWindowSize");
}

@end
