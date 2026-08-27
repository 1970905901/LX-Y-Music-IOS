/**
 * iOS 平台文件系统 API（iOS-only fork）。
 *
 * Metro 在 iOS 上优先解析 fs.ios.ts；本文件仅为让 TypeScript 类型检查
 * 与运行时行为一致（旧实现是安卓分支的 react-native-file-system 适配，
 * 缺少 iOS 侧已有的 read 等导出，导致 tsc 报错）。
 */
export * from './fs.ios'
