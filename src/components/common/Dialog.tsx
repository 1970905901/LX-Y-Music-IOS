import { useImperativeHandle, forwardRef, useMemo, useRef } from 'react'
import { View, TouchableHighlight } from 'react-native'

import Modal, { type ModalType } from './Modal'
import { Icon } from '@/components/common/Icon'
import { useKeyboard, useHorizontalMode } from '@/utils/hooks'
import { createStyle } from '@/utils/tools'
import { shadow } from '@/utils/shadow'
import { useTheme } from '@/store/theme/hook'
import Text from './Text'
import { scaleSizeH } from '@/utils/pixelRatio'

const HEADER_HEIGHT = 20
const styles = createStyle({
  centeredView: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalView: {
    maxWidth: '90%',
    minWidth: '60%',
    maxHeight: '78%',
    // backgroundColor: 'white',
    borderRadius: 4,
    // iOS 浮层阴影（仅 iPhone/iPad；原 shadow 属性曾被注释导致 iOS 无投影）
    ...shadow(3),
  },
  header: {
    flexGrow: 0,
    flexShrink: 0,
    flexDirection: 'row',
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    height: HEADER_HEIGHT,
  },
  title: {
    paddingLeft: 5,
    paddingRight: 25,
    lineHeight: HEADER_HEIGHT,
  },
  closeBtn: {
    position: 'absolute',
    right: 0,
    borderTopRightRadius: 4,
    flexGrow: 0,
    flexShrink: 0,
    height: HEADER_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
})

export interface DialogProps {
  onHide?: () => void
  keyHide?: boolean
  bgHide?: boolean
  closeBtn?: boolean
  title?: string
  children: React.ReactNode | React.ReactNode[]
  height?: number | `${number}%`
}

export interface DialogType {
  setVisible: (visible: boolean) => void
}

export default forwardRef<DialogType, DialogProps>(
  (
    {
      onHide,
      keyHide = true,
      bgHide = true,
      closeBtn = true,
      title = '',
      children,
      height,
    }: DialogProps,
    ref
  ) => {
    const theme = useTheme()
    const { keyboardShown, keyboardHeight } = useKeyboard()
    const isHorizontal = useHorizontalMode()
    const modalRef = useRef<ModalType>(null)

    useImperativeHandle(ref, () => ({
      setVisible(visible: boolean) {
        modalRef.current?.setVisible(visible)
      },
    }))

    const closeBtnComponent = useMemo(() => {
      return closeBtn ? (
        <TouchableHighlight
          style={{ ...styles.closeBtn, width: scaleSizeH(HEADER_HEIGHT) }}
          underlayColor={theme['c-primary-dark-200-alpha-600']}
          onPress={() => modalRef.current?.setVisible(false)}
        >
          <Icon name="close" color={theme['c-primary-dark-500-alpha-500']} size={10} />
        </TouchableHighlight>
      ) : null
    }, [closeBtn, theme])

    return (
      <Modal
        onHide={onHide}
        keyHide={keyHide}
        bgHide={bgHide}
        bgColor="rgba(50,50,50,.3)"
        ref={modalRef}
      >
        <View style={{ ...styles.centeredView, paddingBottom: keyboardShown ? keyboardHeight : 0 }} pointerEvents="box-none">
          <View
            style={{ ...styles.modalView, height, maxWidth: isHorizontal ? 760 : '90%', minWidth: isHorizontal ? undefined : '60%', backgroundColor: theme['c-content-background'] }}
          >
            <View
              style={{ ...styles.header, backgroundColor: theme['c-primary-light-100-alpha-100'] }}
            >
              <Text
                style={styles.title}
                size={13}
                color={theme['c-primary-light-1000']}
                numberOfLines={1}
              >
                {title}
              </Text>
              {closeBtnComponent}
            </View>
            {children}
          </View>
        </View>
      </Modal>
    )
  }
)
