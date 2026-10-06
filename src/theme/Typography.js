/**
 * 尺寸常量。
 *
 * ⚠️ 本文件只保留**实际在用**的 `BorderWidths` / `BorderRadius`（19 + 2 个文件经
 * `@/theme` 引用）。原来的 `FontWeights` / `FontSizes` 已删除：全仓零引用，且与
 * `@/theme/DesignTokens`（`designTypography`）职责重叠 —— 新增排版尺寸请用
 * DesignTokens，不要再往这里加。
 * `@/theme` 的 `Themes` / `AppColors` / `MaterialColors` 三个再导出同样零引用，已从
 * index.js 移除（`Colors.js` 随之删除）。
 */
export const BorderWidths = {
  normal: 0.4,
  normal1: 0.6,
  normal2: 1,
  normal3: 1.4,
  normal4: 2,
}

export const BorderRadius = {
  normal: 4,
}
