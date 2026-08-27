import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { View } from 'react-native'

import ConfirmAlert, { type ConfirmAlertType } from '@/components/common/ConfirmAlert'
import Input, { type InputType } from '@/components/common/Input'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { createStyle, toast } from '@/utils/tools'
import { useI18n } from '@/lang'

interface NameInputType {
  getText: () => string
  setText: (text: string) => void
  focus: () => void
}

const NameInput = forwardRef<NameInputType, {}>((props, ref) => {
  const theme = useTheme()
  const [text, setText] = useState('')
  const inputRef = useRef<InputType>(null)

  useImperativeHandle(ref, () => ({
    getText() {
      return text.trim()
    },
    setText(value) {
      setText(value)
    },
    focus() {
      inputRef.current?.focus()
    },
  }))

  return (
    <Input
      ref={inputRef}
      value={text}
      onChangeText={setText}
      style={{ ...styles.input, backgroundColor: theme['c-primary-input-background'] }}
      clearBtn
    />
  )
})

export interface SoundEffectPresetSaveModalType {
  show: (options: { title: string, onSave: (name: string) => Promise<void> | void, defaultName?: string }) => void
}

export default forwardRef<SoundEffectPresetSaveModalType, {}>((props, ref) => {
  const alertRef = useRef<ConfirmAlertType>(null)
  const inputRef = useRef<NameInputType>(null)
  const [visible, setVisible] = useState(false)
  const [title, setTitle] = useState('')
  const saveHandlerRef = useRef<((name: string) => Promise<void> | void) | null>(null)
  const t = useI18n() as (key: string, val?: Record<string, string | number | boolean>) => string

  useImperativeHandle(ref, () => ({
    show({ title, onSave, defaultName = '' }) {
      setTitle(title)
      saveHandlerRef.current = onSave
      if (visible) {
        alertRef.current?.setVisible(true)
        requestAnimationFrame(() => {
          inputRef.current?.setText(defaultName)
          inputRef.current?.focus()
        })
      } else {
        setVisible(true)
        requestAnimationFrame(() => {
          alertRef.current?.setVisible(true)
          requestAnimationFrame(() => {
            inputRef.current?.setText(defaultName)
            inputRef.current?.focus()
          })
        })
      }
    },
  }))

  const handleConfirm = async() => {
    const name = (inputRef.current?.getText() ?? '').slice(0, 20)
    if (!name) {
      toast(t('input_error'))
      return
    }
    await saveHandlerRef.current?.(name)
    alertRef.current?.setVisible(false)
  }

  return visible ? (
    <ConfirmAlert
      ref={alertRef}
      title={title}
      onConfirm={() => { void handleConfirm() }}
      onCancel={() => {
        inputRef.current?.setText('')
      }}>
      <View style={styles.content}>
        <Text style={styles.label}>{t('setting_play_sound_effect_preset_name')}</Text>
        <NameInput ref={inputRef} />
      </View>
    </ConfirmAlert>
  ) : null
})

const styles = createStyle({
  content: {
    gap: 8,
  },
  label: {
    marginBottom: 2,
  },
  input: {
    flexGrow: 1,
  },
})
