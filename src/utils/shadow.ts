import { type ViewStyle } from 'react-native'

/**
 * 跨平台浮层阴影。
 *
 * elevation 仅 Android 生效；iOS 必须使用 shadow 系列属性。此前大量浮层组件
 * （Dialog/Popup/Menu/Toast 等）只写了 elevation，导致 iOS 上弹层无任何投影、
 * 层级感缺失（部分组件的 shadow 属性还被注释掉）。
 *
 * 用法：在样式对象中 `...shadow(3)` 展开（可在 createStyle 输入内直接使用，
 * shadow 系列属性不会被 createStyle 的尺寸转换改写）。
 *
 * @param elevation 对齐 Android elevation 档位（1~8），按档位映射 iOS 阴影强度
 */
export const shadow = (elevation: number): ViewStyle => ({
  elevation,
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: Math.max(1, Math.round(elevation / 2)) },
  shadowOpacity: Math.min(0.28, 0.06 + elevation * 0.028),
  shadowRadius: elevation * 1.8 + 2,
})
