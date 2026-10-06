const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config')

/**
 * Metro configuration
 * https://facebook.github.io/metro/docs/configuration
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = {
  resolver: {
    extraNodeModules: {
      // crypto: require.resolve('react-native-quick-crypto'),
      // stream: require.resolve('stream-browserify'),
      buffer: require.resolve('@craftzdog/react-native-buffer'),
    },
  },
  transformer: {
    // 生产（minify）构建剥离调试日志。
    //
    // 为什么：全仓 700+ 处 `console.*`，其中播放进度、下载、歌词、源测试等热路径上
    // 会按秒/按帧触发。iOS 上每次 `console.*` 都是一次 JS → RCTLog → 原生控制台
    // 的调用，Release 包里纯属确定性开销（没有 node 也能看出来：这些调用不为用户
    // 产生任何可见结果）。
    //
    // 为什么用 `pure_funcs` 而不是 `drop_console`：`drop_console` 会连
    // `console.error` / `console.warn` 一起删掉，而真机排查 crash 时这两个是唯一能
    // 直接在 Xcode 控制台看到的线索。这里只丢高频的 log/info/debug/trace，保留
    // error/warn（低频，开销可忽略）。
    //
    // 安全性已核对：全仓 `console.*` 的参数里**没有任何副作用表达式**
    // （无 `await`、无 `++`/`--`、无赋值调用），因此整条调用被删掉不会改变行为。
    // `src/utils/log.ts` 的日志落盘走的是 `appendFile`，与这里的 console 回显无关，
    // 剥离后「导出日志」功能不受影响。
    //
    // 注意：本配置只在 minify（生产/Release bundle）时生效；`npm run build-test`
    // 用的是 `--dev true`，日志照常输出，调试体验不变。
    // 下面的 mangle/output/sourceMap/toplevel/compress.reduce_funcs 必须写全 —— 它们
    // 是 metro-config 的默认值，显式保留以免 minifierConfig 被整体替换后丢失。
    minifierConfig: {
      mangle: {
        toplevel: false,
      },
      output: {
        ascii_only: true,
        quote_style: 3,
        wrap_iife: true,
      },
      sourceMap: {
        includeSources: false,
      },
      toplevel: false,
      compress: {
        reduce_funcs: false,
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.info', 'console.debug', 'console.trace'],
      },
    },
  },
}

module.exports = mergeConfig(getDefaultConfig(__dirname), config)
