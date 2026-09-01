#import <RCTAppDelegate.h>
#import <UIKit/UIKit.h>

@interface AppDelegate : RCTAppDelegate

// 保存 launchOptions 供 SceneDelegate 在 scene 连接后创建 bridge 使用
@property (nonatomic, copy) NSDictionary *launchOptions;

@end
