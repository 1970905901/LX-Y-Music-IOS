import { createIconSetFromIcoMoon } from 'react-native-vector-icons'
import icoMoonConfig from '@/resources/fonts/selection.json'
import { scaleSizeW } from '@/utils/pixelRatio'
import { memo, type ComponentProps } from 'react'
import { useTextShadow, useTheme } from '@/store/theme/hook'
import { StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from 'react-native'
import { SvgIcon } from './SvgIcon'

const IcoMoon = createIconSetFromIcoMoon(icoMoonConfig)

// https://oblador.github.io/react-native-vector-icons/

type IconType = ReturnType<typeof createIconSetFromIcoMoon>

interface IconProps extends Omit<ComponentProps<IconType>, 'style'> {
  style?: StyleProp<TextStyle>
  rawSize?: number
}

// IcoMoon 字体中 love / love-filled 字形索引越界，iOS 上渲染成"红框问号"。
// 这里统一拦截这两个名字，改用手绘 SvgIcon 心形，根治坏字形问题。
const HEART_NAMES = new Set(['love', 'love-filled'])

export const Icon = memo(({ size = 15, rawSize, color, style, ...props }: IconProps) => {
  const theme = useTheme()
  if (HEART_NAMES.has(props.name as string)) {
    return (
      <SvgIcon
        name={props.name === 'love-filled' ? 'heart-filled' : 'heart'}
        size={size}
        rawSize={rawSize}
        color={(color ?? theme['c-font']) as string}
        style={style as StyleProp<ViewStyle>}
      />
    )
  }
  const textShadow = useTextShadow()
  const newStyle = textShadow
    ? StyleSheet.compose(
        {
          textShadowColor: theme['c-primary-dark-300-alpha-800'],
          textShadowOffset: { width: 0.2, height: 0.2 },
          textShadowRadius: 2,
        },
        style
      )
    : style
  return (
    <IcoMoon
      size={rawSize ?? scaleSizeW(size)}
      color={color ?? theme['c-font']}
      // @ts-expect-error
      style={newStyle}
      {...props}
    />
  )
})

export {}
