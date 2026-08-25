import { useRef, useImperativeHandle, forwardRef, useState, useCallback } from 'react'
import Text from '@/components/common/Text'
import { View, TouchableOpacity } from 'react-native'
import { createStyle, openUrl } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import Dialog, { type DialogType } from '@/components/common/Dialog'
import Button from '@/components/common/Button'
import List from './List'
import ImportBtn from './ImportBtn'
import ScriptImportExport, { type ScriptImportExportType } from './ScriptImportExport'

// interface UrlInputType {
//   setText: (text: string) => void
//   getText: () => string
//   focus: () => void
// }
// const UrlInput = forwardRef<UrlInputType, {}>((props, ref) => {
//   const theme = useTheme()
//   const t = useI18n()
//   const [text, setText] = useState('')
//   const inputRef = useRef<InputType>(null)
//   const [height, setHeight] = useState(100)

//   useImperativeHandle(ref, () => ({
//     getText() {
//       return text.trim()
//     },
//     setText(text) {
//       setText(text)
//     },
//     focus() {
//       inputRef.current?.focus()
//     },
//   }))

//   const handleLayout = useCallback(({ nativeEvent }: LayoutChangeEvent) => {
//     setHeight(nativeEvent.layout.height)
//   }, [])

//   return (
//     <View style={styles.inputContent} onLayout={handleLayout}>
//       <Input
//         ref={inputRef}
//         value={text}
//         onChangeText={setText}
//         textAlignVertical="top"
//         placeholder={t('setting_dislike_list_input_tip')}
//         size={12}
//         style={{ ...styles.input, height, backgroundColor: theme['c-primary-input-background'] }}
//       />
//     </View>
//   )
// })

// export interface UserApiEditModalProps {
//   onSave: (rules: string) => void
//   // onSourceChange: SourceSelectorProps['onSourceChange']
// }
export interface UserApiEditModalType {
  show: () => void
}

export default forwardRef<UserApiEditModalType, {}>((props, ref) => {
  const dialogRef = useRef<DialogType>(null)
  const scriptImportExportRef = useRef<ScriptImportExportType>(null)
  const [visible, setVisible] = useState(false)
  // 待执行的原生面板调用（在 Dialog 完全卸载后才会真正执行）
  const pendingProceedRef = useRef<(() => void) | null>(null)
  const theme = useTheme()
  const t = useI18n()

  const handleShow = () => {
    dialogRef.current?.setVisible(true)
  }
  useImperativeHandle(ref, () => ({
    show() {
      if (visible) handleShow()
      else {
        setVisible(true)
        requestAnimationFrame(() => {
          handleShow()
        })
      }
    },
  }))

  const handleCancel = () => {
    dialogRef.current?.setVisible(false)
  }

  const openFAQPage = () => {
    void openUrl('https://lyswhut.github.io/lx-music-doc/mobile/custom-source')
  }

  const handleExport = useCallback((apiId: string) => {
    scriptImportExportRef.current?.export(apiId)
  }, [])

  // iOS：原生选择器/分享面板（UIDocumentPicker / UIActivityViewController）若覆盖在仍存在的
  // RN Modal 上，dismiss 后会令底层 Modal 的触摸响应链断裂、整页卡死（只能重启）。
  // 因此这里先把整个 Dialog 完全卸载（外层 visible=false，RN Modal 走 fade 淡出约 250ms 后移除），
  // 等其彻底从视图层级移除后再调起原生面板——这样原生面板的 presenting VC 是底层真实页面，
  // 不会出现“picker 呈现到隐藏 Modal 上、肉眼看不到”的问题。
  const hideDialogForNativePicker = useCallback((proceed: () => void) => {
    pendingProceedRef.current = proceed
    // 完全卸载底部 RN Modal（而非仅隐藏），确保原生面板从底层 VC 呈现
    setVisible(false)
    // 关键：延迟到 Modal 完全淡出并移除后再执行原生面板调用。
    // requestAnimationFrame（~16ms）过早——此时原生视图尚未移除，故用 400ms 保险值。
    setTimeout(() => {
      const p = pendingProceedRef.current
      pendingProceedRef.current = null
      if (p) p()
    }, 400)
  }, [])
  const showDialogAfterNativePicker = useCallback(() => {
    // 原生面板已 dismiss 完成，重新挂载并显示 Dialog
    setVisible(true)
    requestAnimationFrame(() => {
      dialogRef.current?.setVisible(true)
    })
  }, [])

  return visible ? (
    <Dialog ref={dialogRef} bgHide={false}>
      <View style={styles.content}>
        <Text size={16} style={styles.title}>
          {t('user_api_title')}
        </Text>
        <List onExport={handleExport} />
        <View style={styles.tips}>
          <Text style={styles.tipsText} size={12}>
            {t('user_api_readme')}
          </Text>
          <TouchableOpacity onPress={openFAQPage}>
            <Text
              style={{ ...styles.tipsText, textDecorationLine: 'underline' }}
              size={12}
              color={theme['c-primary-font']}
            >
              FAQ
            </Text>
          </TouchableOpacity>
          <View>
            <Text style={styles.tipsText} size={12}>
              {t('user_api_note')}
            </Text>
          </View>
        </View>
      </View>
      <View style={styles.btns}>
        <Button
          style={{ ...styles.btn, backgroundColor: theme['c-button-background'] }}
          onPress={handleCancel}
        >
          <Text size={14} color={theme['c-button-font']}>
            {t('close')}
          </Text>
        </Button>
        <ImportBtn
          btnStyle={{ ...styles.btn, backgroundColor: theme['c-button-background'] }}
          onBeforeNativePicker={hideDialogForNativePicker}
          onAfterNativePicker={showDialogAfterNativePicker}
        />
        <ScriptImportExport
          ref={scriptImportExportRef}
          onBeforeNativePicker={hideDialogForNativePicker}
          onAfterNativePicker={showDialogAfterNativePicker}
        />
      </View>
    </Dialog>
  ) : null
})

const styles = createStyle({
  content: {
    // flexGrow: 1,
    flexShrink: 1,
    paddingHorizontal: 8,
    paddingTop: 15,
    paddingBottom: 10,
    flexDirection: 'column',
  },
  title: {
    marginBottom: 15,
    textAlign: 'center',
    // backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },
  tips: {
    paddingHorizontal: 7,
    marginTop: 15,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  tipsText: {
    marginTop: 8,
    textAlignVertical: 'bottom',
    // lineHeight: 18,
    // backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },
  btns: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingBottom: 15,
    paddingLeft: 15,
    // paddingRight: 15,
  },
  btn: {
    flex: 1,
    padding: 10,
    alignItems: 'center',
    borderRadius: 4,
    marginRight: 15,
  },
})
