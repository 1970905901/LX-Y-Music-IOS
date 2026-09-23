#import <RCTAppDelegate.h>
#import <UIKit/UIKit.h>

@interface AppDelegate : RCTAppDelegate

// 保存 launchOptions 供标准 App 启动链路创建 bridge 使用
@property (nonatomic, copy) NSDictionary *launchOptions;

@end
