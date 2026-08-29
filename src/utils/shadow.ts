import { type ViewStyle } from 'react-native'

/**
 * iOS 浮层阴影（仅 iPhone/iPad）。
 *
 * 本项目只做 iOS（iPhone/iPad），不兼容 Android，因此只输出 iOS 的
 * shadow 系列属性，不包含 Android 专属的 elevation。此前大量浮层组件
 * （Dialog/Popup/Menu/Toast 等）只写了 elevation，导致 iOS 上弹层无任何投影、
 * 层级感缺失（部分组件的 shadow 属性还被注释掉）。
 *
 * 用法：在样式对象中 `...shadow(3)` 展开（可在 createStyle 输入内直接使用，
 * shadow 系列属性不会被 createStyle 的尺寸转换改写）。
 *
 * @param level 阴影档位（1~8），按档位映射 iOS 阴影强度
 */
export const shadow = (level: number): ViewStyle => ({
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: Math.max(1, Math.round(level / 2)) },
  shadowOpacity: Math.min(0.28, 0.06 + level * 0.028),
  shadowRadius: level * 1.8 + 2,
})
