---
description: React Native (iOS) 开发与 Agent 防自我死循环规范
alwaysApply: true
enabled: true
---

# React Native (iOS) 项目专属开发与 Agent 行为规范

## 1. Agent 交互防护（防自我死循环）
* **单次响应原则**：每次收到用户指令后，只需且只能提供【一轮】完整答复或代码修改。
* **禁用自我唤起**：完成当前回复或代码编辑后，必须立即停止生成，严禁自我追问、模拟用户提问或连续触发思考循环。
* **交付控制权**：输出答复后必须明确停下来，等待真实用户的下一个指令。

## 2. 项目范围与技术栈限定
* **仅限 React Native (iOS)**：所有代码修改、组件编写、样式适配和原生逻辑必须严格限定在 RN 及 iOS 端框架内。
* **修改确认**：涉及 iOS 原生 Bridge、CocoaPods 依赖（Podfile）、Xcode 配置或纯 TS/JS 组件修改时，须保持现有代码风格。
* **依赖提醒**：若涉及 Pod 依赖更新或 Xcode 工程配置变更，须主动提醒提示用户运行 `pod install` 或重启 Xcode 编译。
description: RN iOS Bug 排查流程（JS 红屏 + Xcode 日志 + Crash 交叉定位）、Windows 环境约束与替代方案、交付规范。排查 Bug、分析崩溃栈、讨论构建与验证时参考
alwaysApply: false
enabled: true
---

# RN iOS 排查与交付规范

## 1. 双端交叉定位（禁止只看单侧）
分析错误日志时必须同时兼顾：
- **JS 侧**：Red Screen 红屏错误、Yellow Box 黄色警告
- **原生侧**：Xcode 控制台日志、Crash Report 崩溃堆栈

仅排查单一维度会遗漏根因，必须两端交叉比对。

### Release 包 JS 崩溃的还原方法
- Release 的 `main.jsbundle` 行号未符号化，必须配合 `main.jsbundle.map`
  （或 Hermes sourcemap）还原到具体源文件
- 栈帧出现 `renderWithHooks` / `updateMemo` / `updateForwardRef`，说明崩溃发生在
  组件 render 阶段；若栈顶出现 `_callTimer`，触发源通常是定时器回调里的 `setState`

## 2. Windows 环境约束（必须主动提示）
用户在 Windows 下进行 iOS 开发 / 调试时，**必须主动说明**以下天然限制：
- 无法在 Windows 上编译 iOS 安装包
- 无法运行 iOS 模拟器（含 iPad 模拟器）

并给出**完整可行的替代方案**：
- Mac + Xcode 本地运行（`npx react-native run-ios --simulator="..."`）
- 云远程编译 / CI 构建（如 GitHub Actions + macOS runner）产出 ipa 后真机安装
- Expo Go 本地调试（仅适用于 Expo 项目）

## 3. CI 构建成功 ≠ 功能正确（关键认知）
- CI 只验证**代码能否编译**，完全不验证 UI 布局与交互
- 本项目曾出现构建 `success`、但真机上面板错位跑到屏幕顶部的情况
- 因此**布局类改动必须真机 / 模拟器目视确认**，不得以 CI 绿灯作为验收依据
- Metro 使用 Babel 打包、忽略 TS 类型，类型错误不会导致构建失败；
  真正会让 CI 失败的是**原生代码编译错误**

## 4. 交付规范
所有代码修改方案必须明确标注：
1. 完整的**修改文件路径**
2. 具体的**代码修改点**
3. 修改后的**分步验证步骤**
4. 布局类改动须列出 **iPhone 竖屏 / iPad 竖屏 / iPad 横屏** 三种形态的验收预期
   （iPhone 仅竖屏，iPad 竖横均支持，均不支持分屏）

确保用户可按指引逐步操作并确认问题修复。

## 5. 本项目要点
- 导航使用 **react-native-navigation（Wix RNN 7.x）**，不是 React Navigation
- iOS 原生 `UtilsModule` 实现集中在 `ios/LxMusicMobile/AppDelegate.mm`
- 顶部状态栏高度走 `commonState.statusbarHeight`（`SizeView` 通过
  `StatusBarManager.getHeight` 同步）；底部安全区走 `commonState.safeAreaBottom`
- 项目未引入 `react-native-safe-area-context`；需要系统能力时优先扩展
  `UtilsModule`，而非新增第三方依赖（避免 CI 的 pod install 风险）

description: React Native (iOS) 编码规范：TypeScript/Hook 范式、原生模块实现、iOS 样式、iPhone 与 iPad 双端适配及安全区避让
alwaysApply: true
enabled: true
---

# React Native (iOS) 编码规范

## 1. 语言与组件范式
- 跨端代码默认使用 **TypeScript / JavaScript**，严格遵循 **React Hook 最佳实践**
- **禁止**新写 Class Component（维护存量代码除外），统一使用 `function + Hook`
- 遵循 React Native 官方最新编码规范；Hook 依赖数组必须完整，避免闭包捕获陈旧值
- 列表容器样式等对象用 `useMemo` 缓存，避免每次渲染生成新对象触发重复布局

## 2. 原生模块（Native Modules / TurboModules）
- 优先提供**可直接编译运行**的 Objective-C 或 Swift 实现
- 必须配套 **JS 侧类型声明 + 调用示例**，兼容 RN 0.70 及以上主流版本
- OC 侧使用 `RCT_EXPORT_MODULE` / `RCT_REMAP_METHOD`；Promise 接口用
  `RCTPromiseResolveBlock` / `RCTPromiseRejectBlock`
- 扩展原生能力时，**优先修改工程内已存在的编译单元**（如 `AppDelegate.mm`），
  避免新增文件导致 `.xcodeproj` 需手动添加引用、进而让 CI 构建失败
- iOS 13+ API 用 `@available(iOS 13.0, *)` 守卫；多场景下
  `UIApplication.keyWindow` 可能为 `nil`，须经 `UIWindowScene` 遍历取 keyWindow

## 3. 样式：仅使用 iOS 平台属性
- **禁用 Android 特有属性**（如 `elevation`）
- 阴影统一使用 iOS 原生支持的 `shadow*` 系列：
  `shadowColor` / `shadowOffset` / `shadowOpacity` / `shadowRadius`

## 4. 安全区与避让（强制）
- 所有页面布局必须适配避让区：正确使用 `SafeAreaView`、`StatusBar`
  处理刘海屏、灵动岛以及底部 Home 指示器区域
- 底部弹层 / 列表必须为最后一行补 `paddingBottom`，否则会被 Home 指示器遮挡
  （iPhone 约 34pt；全面屏 iPad 约 20pt；带 Home 键的 iPad 为 0）
- 安全区高度在 iPad 旋转后会变化，必须在窗口尺寸变化时重新同步，**不能只取一次**
- 本项目已提供 `useSafeAreaBottom()`（`@/store/common/hook`），底部容器直接复用，
  不要另起炉灶引入新依赖

## 5. iPhone + iPad 双端适配（强制）
本项目同时支持 iPhone 与 iPad，两端方向能力不同，**禁止按同一套假设写布局**：

- **iPhone：仅竖屏**。`Info.plist` 的 `UISupportedInterfaceOrientations` 只声明了
  `UIInterfaceOrientationPortrait`，系统层面锁定，**无需处理 iPhone 横屏布局**
- **iPad：竖屏 + 左右横屏**。`UISupportedInterfaceOrientations~ipad` 声明了
  Portrait / LandscapeLeft / LandscapeRight，必须同时适配两种形态
- **不支持分屏**：`UIRequiresFullScreen = true`，不启用 Split View 与 Slide Over；
  但 iPad 旋转仍会改变窗口尺寸，布局必须能响应尺寸变化
- **方向由 Info.plist 裁决**：RNN 侧各页面虽声明 `orientation: ['portrait', 'landscape']`，
  实际可旋转范围由系统 `Info.plist` 决定。注意 RNN 只识别 `options.layout.orientation`，
  写在 `options` 顶层不生效
- **改方向配置会触发单测**：`LxMusicMobileTests` 用 `testIPhoneSupportsPortraitOnly`
  与 `testIPadSupportsPortraitAndLandscape` 守护，修改 `Info.plist` 方向声明时
  必须同步确认这两个用例
- **横屏判断复用项目工具**：`useHorizontalMode()`（`@/utils/hooks`），
  判定为 `width / height > 1.2`，不要另写一套
- **大屏空间利用**：iPad 横屏应利用更宽的屏幕（多列列表、左右分栏），
  优先复用项目已有的 `Horizontal` 系列布局组件
- **弹层宽度**：iPad 横屏下底部弹层需限宽并水平居中
  （本项目约定 `maxWidth: 760` + 父容器 `alignItems: 'center'`）
- **验收要求**：任何布局改动必须同时说明 **iPhone 竖屏 / iPad 竖屏 / iPad 横屏**
  三种形态的预期表现