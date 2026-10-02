import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, TouchableOpacity } from 'react-native'
import CheckBox from './Checkbox'

import { createStyle, tipDialog } from '@/utils/tools'
import { scaleSizeH, scaleSizeW } from '@/utils/pixelRatio'
import { useTheme } from '@/store/theme/hook'
import Text from '../Text'
import { Icon } from '../Icon'
import { designRadius, designSpacing } from '@/theme/DesignTokens'

export interface CheckBoxProps {
  check: boolean
  label?: string
  children?: React.ReactNode
  onChange: (check: boolean) => void
  disabled?: boolean
  need?: boolean
  size?: number
  marginRight?: number
  marginBottom?: number

  helpTitle?: string
  helpDesc?: string
  /**
   * 容器外观：
   * - 'card'（默认）：软件统一行样式——圆角 + 1px 边框 + 半透明主题色底，
   *   与推荐页「排行榜」按钮同一套视觉语言（设置页所有开关/单选行都走这套）；
   * - 'plain'：无底纹的旧样式，供弹窗、菜单等自带底色的场景沿用。
   */
  variant?: 'card' | 'plain'
  /**
   * 独占整行：卡片铺满可用宽度，并去掉用于并排项之间留缝的右外边距。
   */
  block?: boolean
  /**
   * 标签文字的 numberOfLines（默认不限行，保持各处历史行为）。
   * 并排的短选项（如「原名 / 别名」「显示警告 / 显示降级」）传 1：
   * 空间紧张时宁可整行换行，也不要让标签折成两行（用户反馈「文字横着排更好看」）。
   */
  labelNumberOfLines?: number
}

export default ({
  check,
  label,
  children,
  onChange,
  helpTitle,
  helpDesc,
  disabled = false,
  need = false,
  marginRight = 0,
  marginBottom = 0,
  size = 1,
  variant = 'card',
  block = false,
  labelNumberOfLines,
}: CheckBoxProps) => {
  const theme = useTheme()
  const [isDisabled, setDisabled] = useState(false)
  const tintColors = {
    true: theme['c-primary'],
    false: theme['c-600'],
  }
  const disabledTintColors = {
    true: theme['c-primary-alpha-600'],
    false: theme['c-400'],
  }

  useEffect(() => {
    if (need) {
      if (check) {
        if (!isDisabled) setDisabled(true)
      } else {
        if (isDisabled) setDisabled(false)
      }
    } else {
      isDisabled && setDisabled(false)
    }
  }, [check, need, isDisabled])

  const handleLabelPress = useCallback(() => {
    if (isDisabled) return
    onChange?.(!check)
  }, [isDisabled, onChange, check])

  const helpComponent = useMemo(() => {
    const handleShowHelp = () => {
      void tipDialog({
        title: helpTitle ?? '',
        message: helpDesc,
        btnText: global.i18n.t('understand'),
      })
    }
    return (helpTitle ?? helpDesc) ? (
      <TouchableOpacity style={styles.helpBtn} onPress={handleShowHelp}>
        <Icon size={15 * size} name="help" />
      </TouchableOpacity>
    ) : null
  }, [helpTitle, helpDesc, size])

  // 统一行样式（对齐推荐页「排行榜」按钮）：圆角 designRadius.md + 1px 边框 +
  // 半透明主题色底。整行（block）时卡片铺满可用宽度、不预留右外边距；
  // 并排的小选项（非 block）保留右外边距，充当相邻选项之间的间隙。
  const contentStyle = useMemo(() => {
    const base = { ...styles.content, marginBottom: scaleSizeH(marginBottom) }
    if (variant !== 'card') return base
    return {
      ...base,
      borderRadius: designRadius.md,
      borderWidth: 1,
      borderColor: theme['c-border-background'],
      backgroundColor: theme['c-primary-light-900-alpha-200'],
      paddingHorizontal: designSpacing.sm,
      minHeight: block ? 52 : 40,
      marginRight: block ? 0 : designSpacing.sm,
      // 卡片之间保证至少 8pt 行距（调用方传了更大的 marginBottom 时以调用方为准）
      marginBottom: Math.max(scaleSizeH(marginBottom), designSpacing.xs),
    }
  }, [theme, marginBottom, variant, block])

  const labelStyle = useMemo(() => ({
    ...styles.label,
    marginRight: scaleSizeW(marginRight),
    // 整行卡片：标签撑满剩余宽度，帮助按钮被顶到卡片右端
    ...(variant === 'card' && block ? { flexGrow: 1 } : null),
  }), [marginRight, variant, block])

  const nameStyle = useMemo(
    () => (variant === 'card' ? { ...styles.name, fontWeight: '600' as const } : styles.name),
    [variant],
  )

  return disabled ? (
    <View style={contentStyle}>
      <CheckBox
        status={check ? 'checked' : 'unchecked'}
        disabled={true}
        tintColors={disabledTintColors}
        size={size}
      />
      <View style={labelStyle}>
        {label ? (
          <Text style={nameStyle} color={theme['c-500']} size={15 * size} numberOfLines={labelNumberOfLines}>
            {label}
          </Text>
        ) : (
          children
        )}
      </View>
      {helpComponent}
    </View>
  ) : (
    <View style={contentStyle}>
      <CheckBox
        status={check ? 'checked' : 'unchecked'}
        disabled={isDisabled}
        onPress={handleLabelPress}
        tintColors={tintColors}
        size={size}
      />
      <TouchableOpacity style={labelStyle} activeOpacity={0.3} onPress={handleLabelPress}>
        {label ? (
          <Text style={nameStyle} size={15 * size} numberOfLines={labelNumberOfLines}>
            {label}
          </Text>
        ) : (
          children
        )}
      </TouchableOpacity>
      {helpComponent}
    </View>
  )
}

const styles = createStyle({
  content: {
    flexGrow: 0,
    flexShrink: 1,
    minHeight: 40,
    marginRight: designSpacing.sm,
    alignItems: 'center',
    flexDirection: 'row',
    // backgroundColor: 'rgba(0,0,0,0.2)',
  },
  checkbox: {
    flex: 0,
    // backgroundColor: 'rgba(0,0,0,0.2)',
  },
  label: {
    flexGrow: 0,
    flexShrink: 1,
    // marginRight: 15,
    // alignItems: 'center',
    // backgroundColor: 'rgba(0,0,0,0.2)',
    paddingRight: designSpacing.xs,
  },
  name: {
    fontWeight: '500',
  },
  helpBtn: {
    height: 32,
    width: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
})
