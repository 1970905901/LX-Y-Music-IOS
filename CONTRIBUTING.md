# 开发规范

> 配套文件：[AGENTS.md](./AGENTS.md)（给 AI agent 的行为约束与项目要点）。
> 本文记录**目录结构、代码规范、提交前检查、验收要求**，以及若干已定案的取舍。
> 内容以仓库实际代码为准；如与代码不符，先改代码或先改本文，不要让两者长期分叉。

---

## 1. 提交前检查（必须）

本地能跑 Node 时，按顺序执行：

```bash
npm run lint      # ESLint（.eslintignore 已排除构建产物 / ipa 解包目录）
npm run lint:i18n # 文案 key 存在性（缺失 key 时 UI 直接空白，tsc / eslint 都抓不到）
npm run typecheck # tsc --noEmit —— 见第 6 节「类型检查基线」
npm run sim       # 契约脚本（结构不变量 + 行为模型 + 反例自检）
```

ESLint 覆盖：`eslint . --ext .js,.jsx,.ts,.tsx`。**只改文档不需要跑这些**。

其余按需：

| 命令 | 用途 |
|---|---|
| `npm run lint:fix` | 自动修复（格式化以它为准，见第 6 节） |
| `npm run lint:sound-effect-dsp` | 音效 DSP 补丁与原生实现一致性 |
| `npm run check:ipa-symbols` | 从 CI 产出的 ipa 校验玻璃材质原生符号（`UIGlassEffect` 是否编入、是否为弱引用） |
| `npm run build-test` | Metro 打包，验证能编出 bundle |
| `npm run sim` | 等价于顺序执行 `scripts/sim-*.js` |

---

## 2. 目录结构约定

```
src/
├─ app.ts              # 应用启动入口（index.js → shim → app）
├─ config/             # 常量、默认设置、迁移
├─ core/               # 业务编排（init / player / music / search / sync / webdavMusic）
├─ components/         # 可复用 UI
│  ├─ common/          # 通用基础组件（Button / Text / Modal / PageContent / SizeView …）
│  ├─ layout/          # 横竖屏骨架（ModernTabBar / LandscapeCentered / LandscapeDetailLayout）
│  ├─ login/           # 各平台 WebView 登录（Modal + Manager 成对）
│  ├─ player/          # 播放条 / 进度条 / 音效
│  ├─ selector/        # 选择类弹层（ArtistSelector / SimilarSongs / SourceSelector）
│  └─ <其他功能族>/
├─ event/              # 全局事件（app_event / state_event / list_event …）
├─ lang/               # i18n（zh-cn.json 为唯一文案源）
├─ navigation/         # react-native-navigation（RNN 7.x）
├─ plugins/            # 播放引擎 / 同步客户端等可替换实现
├─ screens/            # 页面
├─ store/              # 状态（自研 store + hook，非 Redux）
├─ theme/              # 主题色板 + 设计 token
├─ types/              # 全局类型（*.d.ts）
└─ utils/              # 工具（含 utils/musicSdk/<平台>/）
```

### 命名规则

- **`screens/<页面名>/`**：PascalCase（`PlayDetail`、`SonglistDetail`…），每个页面目录**必须有 `index.tsx`** 作为入口。当前 59 个页面入口命名 100% 一致，新增页面照此办理。
- **`components/<域>/`**：**域目录用小写**（`common` / `home` / `layout` / `login` / `player` / `selector`）；当整个目录就是「一个组件族」且族名本身是专有名词时，允许 PascalCase（`DownloadBall` / `MetadataEditModal` / `MusicAddModal` / `MusicMultiAddModal` / `OnlineList`）。
- **组件文件名**：PascalCase（`PlayerBar/index.tsx`、`Text.tsx`）；模块入口用 `index.ts(x)`。
- **其余顶层目录**：全小写（`core` / `store` / `utils` / `plugins` / `config` / `event` / `lang` / `navigation` / `theme` / `types`）。
- ⚠️ **不为了「统一风格」重命名既有目录**：会放大与上游 `lyswhut/lx-music-mobile` 的合并 diff；且纯大小写重命名（`common` → `Common`）在大小写不敏感的文件系统（macOS APFS 默认）上有静默失效风险，需两步改名。新增目录按上述规则即可。

---

## 3. 导入路径约定

- 跨模块**一律用 `@/` 别名**（映射到 `src/`，见 `tsconfig.json` 与 `babel.config.js`）。当前 `@/` 3079 条 vs 相对导入 771 条。
- **相对路径只用于同目录 / 直接同级**（`./X`、`../X`）。全仓没有 `../../` 以上的相对导入，不要开这个头 —— 深层相对路径在目录调整时会集体失效（本轮 components 归组就实证了这一点）。
- import 顺序由 `import/order` 以 **warn** 级别检查：只约束分组顺序（外部包 → 内部模块 → 相对路径），**不强制字母序、不强制空行**。
- 副作用导入（`import 'x'`）不参与排序 —— `index.js` 的 `shim` 顺序有依赖，不要动。

---

## 4. 组件与 Hook 规范

- **禁止新写 Class Component**（当前全仓 0 个在用），统一 `function + Hook`。
- 列表项 / 纯展示组件用 `memo` 包装；统一写法 `export default memo(...)`。
- `useCallback` / `useMemo` 依赖数组必须完整。列表的 `renderItem` / `keyExtractor` / `onScroll` 必须是稳定引用 —— 否则 FlatList 每帧重建所有行。

  **具体做法（全仓已按此收口，2026-10-06）**：
  - `keyExtractor`、`columnWrapperStyle` 这类**不依赖 props/state 的**，提升为**模块级常量**：
    ```tsx
    const keyExtractor = (item: ItemT) => item.id
    const HORIZONTAL_COLUMN_WRAPPER = { paddingHorizontal: 8 }
    ```
  - `renderItem` 用 `useCallback`，依赖只放稳定引用或低频变化值：
    ```tsx
    const renderItem = useCallback(({ item }: { item: ItemT }) => (...), [isHorizontal, handlePress])
    ```
  - 类型不要靠猜：能从子组件 props 推出来就用 `ComponentProps<typeof ListItem>['item']`。
  - **连带项**：如果 `renderItem` 用到的处理器还是普通函数，必须一起改成 `useCallback`，否则
    `renderItem` 每次都换新引用，白做。
  - **`ListFooterComponent` / `ListHeaderComponent` 不要传「每次渲染新建的组件函数」**：
    React 会判定组件类型变了而卸载重建整棵子树。传 `useMemo` 出来的**元素**，或提到模块级。
  - `getItemLayout` **只在行高真正固定时才能加**。行高可变（`minHeight`、标题换行、`onLayout` 实测）
    时加了反而会让滚动定位错位。判断依据看样式是 `height` 还是 `minHeight`／是否逐项测量。
  - 列表容器样式对象用 `useMemo` 缓存。
- **禁止恒真的 `memo` 比较器**（`(_prev, _next) => true`）：会让 props 变化后组件永不更新。需要「只播一次」的动画用 `key` 触发重挂载，不要用恒真比较器。
- 新增原生能力优先扩展 `ios/LxMusicMobile/AppDelegate.mm` 里已有的 `UtilsModule`，不要新增文件（避免 `.xcodeproj` 手工加引用导致 CI 失败），也不要引入新的三方依赖。

---

## 5. 状态管理与样式

**状态**：自研 store（`src/store/<域>/{state,action,hook}.ts`）+ 全局事件总线（`src/event`）。

- 组件通过 `*_hook.ts` 里的专用 hook 订阅（如 `usePlayerMusicInfo`、`useSettingValue('theme.blur')`），**不要订阅整个 store**。
- action 里改完 `state` 后**必须 emit 对应事件**，并且**传副本而不是引用**（`{ ...state.progress }`），否则 hook 里的 `useState` 因引用相等而不更新。
- 事件名与载荷类型在 `src/types/app.d.ts` 声明；新增事件同步补类型，不要用 `as any` 绕。

**样式**：

- 尺寸/间距/圆角/字号**新代码一律用 `@/theme/DesignTokens`**（`designSpacing` / `designRadius` / `designTypography` / `designMotion`）。
- 需要随屏幕缩放的样式用 `createStyle`（`@/utils/tools`，内部走 `scaleSizeW/H`）。仓库里另有 39 个文件直接用 `StyleSheet.create`（跳过缩放），**两者混用会导致同一数值在不同屏上表现不一致**；统一属于布局改动，必须真机验收，暂不批量处理。
- `@/theme`（`theme/index.js`）**只保留 `BorderWidths` / `BorderRadius`**。`Themes` / `AppColors` / `MaterialColors` / `FontWeights` / `FontSizes` 已删除（全仓零引用；其中 `Themes` 还是个无效再导出 —— `theme/themes/index.ts` 没有 default export）。
- 主题色一律走 `useTheme()`，不要硬编码颜色。
- **只用 iOS 支持的样式属性**：禁 `elevation`；阴影用 `shadowColor` / `shadowOffset` / `shadowOpacity` / `shadowRadius`。

---

## 6. 已定案的取舍

| 议题 | 结论 | 理由 |
|---|---|---|
| **格式化工具** | **不引入 Prettier**，维持 ESLint 单轨，格式化以 `npm run lint:fix` 为准 | 引入 Prettier 需要与 `standard` 规则做对齐配置（分号、引号、printWidth），一次性重排全仓 800+ 文件，与规则打架的收益小于 diff 成本 |
| **类型检查** | `npm run typecheck` 已加入，CI 中以**非阻断**方式运行当前基线 | `tsc --noEmit` 此前从未被任何 npm script / workflow 执行，`tsconfig` 的 `strict: true` 形同虚设（Metro 用 Babel 剥离类型、不做检查）。存量错误未清零，先收集基线，清零后把 `.github/workflows/build-test.yml` 里的 `continue-on-error` 去掉即可升级为硬门禁 |
| **`eqeqeq`** | 保持 `off`（允许 `==`） | 与上游 `standard` 配置一致；改成 `error` 会产生无收益的巨量 diff |
| **`components/` 大小写** | 不重命名既有目录，只固化规则（见 2.1） | 上游合并成本 + 大小写不敏感文件系统的重命名风险 |
| **主题体系收敛** | 只做了「删除零引用导出」（`Themes` / `AppColors` / `MaterialColors` / `FontWeights` / `FontSizes` / `Colors.js`）。`createStyle` 与 `StyleSheet.create` 的混用**不动** | 后者会改变各屏实际尺寸，属布局改动，必须真机验收，不适合无验收环境下批量执行 |
| **注释掉的代码** | 一律删除，历史交给 git | 当前全仓仍有约 490 处注释代码块，清理按模块顺手进行即可 |

### Release 构建剥离调试日志（2026-10-06 落地）

`metro.config.js` 的 `transformer.minifierConfig` 增加：

```js
compress: {
  reduce_funcs: false,
  drop_debugger: true,
  pure_funcs: ['console.log', 'console.info', 'console.debug', 'console.trace'],
}
```

- 用 `pure_funcs` 而**不是** `drop_console`：后者会连 `console.error` / `console.warn` 一起删掉，而真机排查 crash 时这两个是唯一能直接在 Xcode 控制台看到的线索。
- 只在 minify（生产 / Release bundle）时生效；`npm run build-test` 带 `--dev true`，调试期日志照常输出。
- 安全性已核对：全仓 `console.*` 的参数没有副作用表达式（无 `await`、无 `++`/`--`、无赋值调用）。
- `src/utils/log.ts` 的日志落盘走 `appendFile`，与 console 回显无关，「导出日志」功能不受影响。
- `minifierConfig` 必须写全 metro-config 的默认值（`mangle` / `output` / `sourceMap` / `toplevel` / `compress.reduce_funcs`），避免被整体替换后丢失内置设置。

### 本轮已删除的死文件（供 review 对照）

均为「全仓零引用」经 grep + `scripts/` 契约核对后删除，无行为改动：

| 文件 | 判定依据 |
|---|---|
| `src/components/SearchTipList/List.tsx` | 全仓零引用；目录本身是旧「我的列表搜索浮层」残留，`sim-mylist-search-inplace.js` 已把 `index.tsx` 列为「不得复活」，本次把 `List.tsx` 一并加进该清单 |
| `src/components/login/KgVerifyModal.tsx` | 全仓零引用，且其职责已被 `KgWebLoginModal.tsx` 内部内联的滑块验证（`showVerify` + `generateVerifyHtml`）取代 |
| `src/screens/Home/Views/Download/index.js` | 只渲染一行「下载」的占位页，零引用；且是 `screens/` 下唯一的 `.js` 入口，破坏「每页 `.tsx`」的一致性 |
| `src/theme/Colors.js` | 只被 `theme/index.js` 用于导出 `AppColors` / `MaterialColors`，两者均零引用 |
| `src/store/index.ts` | 仅 1 行空壳 `export const useGetter = () => {}`（返回 `undefined`）；见下一行的连带清理 |
| `src/utils/hooks/useAssertApiSupport.js` | 唯一使用上面那个空壳 `useGetter` 的文件 → 调用即 `TypeError`（`undefined[source]`）；项目实际用的是 `@/store/common/hook` 里的同名实现（`Mylist/MusicList/ListItem.tsx`），故删除本文件并移除 `utils/hooks/index.js` 的失效导出 |
| `src/utils/hooks/usePlayTime.js` | 全文件注释，`utils/hooks/index.js` 的导出也已注释 |
| `src/store/Provider/Provider.tsx` | 全文件注释，`store/Provider/index.ts` 只导出 `ThemeProvider` |

同时清理了这些文件被删后残留的**悬空引用**：指向 `@/store`（`useGetter` / `getStore` / `RootState`）与 `@/theme` 已删导出的注释代码行，以及 `.vscode/javascript.code-snippets` 里两个失效片段（`useGetter(...)`、`@/plugins/i18n` 的 `useTranslation`——实际 API 是 `@/lang` 的 `useI18n`）。

### 已知功能缺口（非缺陷，属未完成）

- **YouTube 登录不可达**。`utils/musicSdk/yt` 与 `common.yt_cookie` 设置都在，`types/app.d.ts` 也声明了 `showYouTubeLogin` / `yt-cookie-set`，但缺少 4 个环节：①`event/appEvent.ts` 没有 `showYouTubeLogin()` 发射方法；②`components/login/YouTubeLoginManager.tsx` 从未挂载（`screens/Home/index.tsx` 里是一行注释）；③没有触发按钮（对比 `WebLoginBtn.tsx` 的网易 / QQ / 酷狗）；④`YouTubeLoginModal` 发出的 `yt-cookie-set` 事件**没有任何监听者**，cookie 不会写回设置。补齐等于新增功能，需产品侧定入口位置并真机验证 WebView 登录流程。

---

## 7. 验收要求

### 环境限制（Windows 开发时必读）

Windows 上**不能**编译 iOS 安装包、**不能**运行 iOS 模拟器。替代方案：

- Mac + Xcode：`npx react-native run-ios --simulator="..."`（iPhone / iPad 模拟器）
- CI 构建：GitHub Actions（`macos-26` runner）产出 ipa 后真机安装
- 本机只做静态校验：`npm run lint` / `lint:i18n` / `typecheck` / `sim`

### 关键认知

- **CI 绿灯 ≠ 功能正确**。Metro 用 Babel 打包、**忽略 TS 类型**，类型错误不会让构建失败；真正会让 CI 失败的是**原生代码编译错误**。CI 也完全不验证 UI 布局与交互。
- 本项目出现过「构建 success 但真机面板错位跑到屏幕顶部」，因此**布局类改动必须真机 / 模拟器目视确认**。

### 布局改动验收清单（三种形态都要过）

| 形态 | 说明 |
|---|---|
| **iPhone 竖屏** | 仅竖屏（系统层锁定），无需考虑横屏 |
| **iPad 竖屏** | 必须验证 |
| **iPad 横屏** | 必须验证；应利用宽屏（多列 / 左右分栏），弹层需限宽（约定 `maxWidth: 760` + 父容器居中） |

- 安全区：顶部走 `commonState.statusbarHeight` / `useStatusbarHeight()`；底部走 `useSafeAreaBottom()`。底部弹层与列表最后一行必须补 `paddingBottom`，否则被 Home 指示器遮挡（iPhone ≈ 34pt，全面屏 iPad ≈ 20pt，带 Home 键 iPad = 0）。iPad 旋转后安全区会变，必须响应窗口尺寸变化重新同步。
- 方向由 `Info.plist` 裁决（`UIRequiresFullScreen = true`，不支持分屏）。RNN 只识别 `options.layout.orientation`。
- 改 `Info.plist` 方向声明会触发 `LxMusicMobileTests` 的 `testIPhoneSupportsPortraitOnly` / `testIPadSupportsPortraitAndLandscape`，必须同步确认。
- 涉及 Pod 依赖或 Xcode 工程配置变更时，需运行 `pod install` 或重启 Xcode 编译（同步提醒协作者）。
