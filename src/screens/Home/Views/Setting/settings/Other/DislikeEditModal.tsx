import { useRef, useImperativeHandle, forwardRef, useState, useCallback } from 'react'
import Text from '@/components/common/Text'
import { type LayoutChangeEvent, View } from 'react-native'
import Input, { type InputType } from '@/components/common/Input'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import Dialog, { type DialogType } from '@/components/common/Dialog'
import Button from '@/components/common/Button'
import { designRadius, designSpacing, designTypography } from '@/theme/DesignTokens'

interface RuleInputType {
  setText: (text: string) => void
  getText: () => string
  focus: () => void
}
const RuleInput = forwardRef<RuleInputType, {}>((props, ref) => {
  const theme = useTheme()
  const t = useI18n()
  const [text, setText] = useState('')
  const inputRef = useRef<InputType>(null)
  const [height, setHeight] = useState(100)

  useImperativeHandle(ref, () => ({
    getText() {
      return text.trim()
    },
    setText(text) {
      setText(text)
    },
    focus() {
      inputRef.current?.focus()
    },
  }))

  const handleLayout = useCallback(({ nativeEvent }: LayoutChangeEvent) => {
    setHeight(nativeEvent.layout.height)
  }, [])

  return (
    <View style={styles.inputContent} onLayout={handleLayout}>
      <Input
        ref={inputRef}
        value={text}
        onChangeText={setText}
        multiline
        placeholder={t('setting_dislike_list_input_tip')}
        size={designTypography.caption}
        style={{ ...styles.input, height, backgroundColor: theme['c-primary-input-background'] }}
      />
    </View>
  )
})

export interface DislikeEditModalProps {
  onSave: (rules: string) => void
  // onSourceChange: SourceSelectorProps['onSourceChange']
}
export interface DislikeEditModalType {
  show: (rules: string) => void
}

export default forwardRef<DislikeEditModalType, DislikeEditModalProps>(({ onSave }, ref) => {
  const dialogRef = useRef<DialogType>(null)
  // const sourceSelectorRef = useRef<SourceSelectorType>(null)
  const inputRef = useRef<RuleInputType>(null)
  const [visible, setVisible] = useState(false)
  const theme = useTheme()
  const t = useI18n()

  const handleShow = (rules: string) => {
    dialogRef.current?.setVisible(true)
    requestAnimationFrame(() => {
      inputRef.current?.setText(rules.length ? rules + '\n' : rules)
      // sourceSelectorRef.current?.setSource(source)
      // setTimeout(() => {
      //   inputRef.current?.focus()
      // }, 300)
    })
  }
  useImperativeHandle(ref, () => ({
    show(rules) {
      if (visible) handleShow(rules)
      else {
        setVisible(true)
        requestAnimationFrame(() => {
          handleShow(rules)
        })
      }
    },
  }))

  const handleCancel = () => {
    dialogRef.current?.setVisible(false)
  }
  const handleConfirm = () => {
    let rules = inputRef.current?.getText() ?? ''
    handleCancel()
    onSave(rules)
  }

  return visible ? (
    <Dialog height="80%" ref={dialogRef} bgHide={false}>
      <View style={styles.content}>
        <RuleInput ref={inputRef} />
        <Text style={styles.inputTipText} size={designTypography.caption} color={theme['c-600']}>
          {t('setting_dislike_list_tips')}
        </Text>
      </View>
      <View style={styles.btns}>
        <Button
          style={{ ...styles.btn, backgroundColor: theme['c-button-background'] }}
          onPress={handleCancel}
        >
          <Text size={designTypography.body} color={theme['c-button-font']}>
            {t('cancel')}
          </Text>
        </Button>
        <Button
          style={{ ...styles.btn, backgroundColor: theme['c-primary'] }}
          onPress={handleConfirm}
        >
          <Text size={designTypography.body} color={theme['c-000']}>
            {t('confirm')}
          </Text>
        </Button>
      </View>
    </Dialog>
  ) : null
})

const styles = createStyle({
  content: {
    flexGrow: 1,
    flexShrink: 1,
    paddingHorizontal: designSpacing.sm,
    paddingTop: designSpacing.md,
    paddingBottom: designSpacing.xs,
    flexDirection: 'column',
  },
  col: {
    flexDirection: 'row',
    height: 38,
  },
  // selector: {
  //   borderTopLeftRadius: 4,
  //   borderBottomLeftRadius: 4,
  // },
  inputContent: {
    flexGrow: 1,
    flexShrink: 1,
    // backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },
  input: {
    minWidth: 280,
    // borderRadius: 4,
    // borderTopRightRadius: 4,
    // borderBottomRightRadius: 4,
    paddingTop: designSpacing.xs,
    paddingBottom: designSpacing.xs,
  },
  inputTipText: {
    marginTop: designSpacing.xs,
    // lineHeight: 18,
    // backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },

  btns: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingBottom: designSpacing.sm,
    paddingLeft: designSpacing.sm,
    // paddingRight: 15,
  },
  btn: {
    flex: 1,
    height: 36,
    paddingHorizontal: designSpacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: designRadius.pill,
    marginRight: designSpacing.sm,
  },
})
