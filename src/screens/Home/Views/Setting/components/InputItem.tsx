import { memo, useState, useEffect, useRef, useCallback } from 'react'

import { StyleSheet, View, Keyboard } from 'react-native'
import type { InputType, InputProps } from '@/components/common/Input'
import Input from '@/components/common/Input'
import { designRadius, designSpacing, designTypography } from '@/theme/DesignTokens'
import { useTheme } from '@/store/theme/hook'
import Text from '@/components/common/Text'

export interface InputItemProps extends InputProps {
  value: string
  label: string
  onChanged: (text: string, callback: (vlaue: string) => void) => void
}

export default memo(({ value, label, onChanged, ...props }: InputItemProps) => {
  const [text, setText] = useState(value)
  const textRef = useRef(value)
  const isMountRef = useRef(false)
  const inputRef = useRef<InputType>(null)
  const theme = useTheme()

  const stableOnChanged = useCallback((text: string, callback: (vlaue: string) => void) => {
    onChanged?.(text, callback)
  }, [onChanged])

  const saveValue = useCallback(() => {
    stableOnChanged(text, (value: string) => {
      if (!isMountRef.current) return
      const newValue = String(value)
      setText(newValue)
      textRef.current = newValue
    })
  }, [text, stableOnChanged])

  useEffect(() => {
    isMountRef.current = true
    return () => {
      isMountRef.current = false
    }
  }, [])

  useEffect(() => {
    const handleKeyboardDidHide = () => {
      if (!inputRef.current?.isFocused()) return
      stableOnChanged(textRef.current, (value) => {
        if (!isMountRef.current) return
        const newValue = String(value)
        setText(newValue)
        textRef.current = newValue
      })
    }
    const keyboardDidHide = Keyboard.addListener('keyboardDidHide', handleKeyboardDidHide)

    return () => {
      keyboardDidHide.remove()
    }
  }, [stableOnChanged])

  useEffect(() => {
    // 只跟随「外部值」变化同步输入框（如网页登录弹窗拿到 Cookie 后写回设置项）。
    // ⚠️ 依赖里【绝不能】放 text（也不能直接读 text，否则 lint 会要求把它放进依赖）：
    // 输入时本地 text 每敲一个字都变，而外部 value 要等 onBlur / keyboardDidHide 保存后才更新，
    // 这期间 value 仍是旧值 —— effect 一旦被 text 触发，就会把刚输入的内容和 textRef 一起回滚成
    // 旧值。表现就是「Cookie 输入框填了内容立刻被自动删除」，并且紧接着的失焦还会把旧值
    //（通常是空串）写回设置，把已保存的 Cookie 也一起清掉。
    // 这里改读 textRef（与 text 同步维护），既满足 exhaustive-deps，又不会在输入过程中回滚。
    const newValue = String(value)
    if (newValue === textRef.current) return
    setText(newValue)
    textRef.current = newValue
  }, [value])

  const handleSetSelectMode = useCallback((text: string) => {
    setText(text)
    textRef.current = text
  }, [])

  return (
    <View style={styles.container}>
      <Text style={styles.label} size={designTypography.body}>
        {label}
      </Text>
      <Input
        value={text}
        ref={inputRef}
        onChangeText={handleSetSelectMode}
        {...props}
        style={StyleSheet.compose({ ...styles.input, backgroundColor: theme['c-primary-input-background'] }, props.style)}
        onBlur={saveValue}
      />
    </View>
  )
})

const styles = StyleSheet.create({
  container: {
    marginBottom: designSpacing.sm,
  },
  label: {
    marginBottom: designSpacing.xs,
  },
  input: {
    backgroundColor: 'rgba(0,0,0,0.18)',
    flexGrow: 1,
    flexShrink: 1,
    height: 36,
    paddingLeft: designSpacing.sm,
    borderRadius: designRadius.sm,
    maxWidth: '100%',
  },
})
