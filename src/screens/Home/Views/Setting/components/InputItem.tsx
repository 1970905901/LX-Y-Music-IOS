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
    if (value != text) {
      const newValue = String(value)
      setText(newValue)
      textRef.current = newValue
    }
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
