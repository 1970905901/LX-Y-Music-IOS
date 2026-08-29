// import { createStyle } from '@/utils/tools'
import { useImperativeHandle, forwardRef, useState, useMemo } from 'react'
import { Modal, TouchableWithoutFeedback, View, type ModalProps as _ModalProps } from 'react-native'
import { useStatusbarHeight } from '@/store/common/hook'
// import { useWindowSize } from '@/utils/hooks'

// const styles = createStyle({
//   container: {
//     flex: 1,
//   },
//   // mask: {
//   //   position: 'absolute',
//   //   top: 0,
//   //   left: 0,
//   //   bottom: 0,
//   //   right: 0,
//   //   // width: '100%',
//   //   // height: '100%',
//   // },
// })

export interface ModalProps extends Omit<_ModalProps, 'visible'> {
  onHide?: () => void
  /**
   * 按返回键是否隐藏
   */
  keyHide?: boolean
  /**
   * 点击背景是否隐藏
   */
  bgHide?: boolean
  /**
   * 背景颜色
   */
  bgColor?: string
  /**
   * 是否填充状态栏
   */
  statusBarPadding?: boolean
  /**
   * 内容区最大宽度（pt）。iPad 横屏/分屏下限制内容宽度并水平居中，
   * 不传则铺满窗口（下拉面板等全宽交互组件保持原行为）
   */
  maxBodyWidth?: number
}

export interface ModalType {
  setVisible: (visible: boolean) => void
}

export default forwardRef<ModalType, ModalProps>(
  (
    {
      onHide = () => {},
      keyHide = true,
      bgHide = true,
      bgColor = 'rgba(0,0,0,0)',
      statusBarPadding = true,
      maxBodyWidth,
      children,
      ...props
    }: ModalProps,
    ref
  ) => {
    const [visible, setVisible] = useState(false)
    // const { window: windowSize } = useWindowSize()
    const statusBarHeight = useStatusbarHeight()
    const handleRequestClose = () => {
      if (keyHide) {
        setVisible(false)
        onHide()
      }
    }
    const handleBgClose = () => {
      if (bgHide) {
        setVisible(false)
        onHide()
      }
    }

    useImperativeHandle(ref, () => ({
      setVisible(_visible) {
        if (visible == _visible) return
        setVisible(_visible)
        if (!_visible) onHide()
      },
    }))

    const memoChildren = useMemo(() => children, [children])

    return (
      <Modal
        animationType="fade"
        transparent={true}
        hardwareAccelerated={true}
        statusBarTranslucent={true}
        visible={visible}
        onRequestClose={handleRequestClose}
        {...props}
      >
        <View style={{ flex: 1, paddingTop: statusBarPadding ? statusBarHeight : 0, backgroundColor: bgColor }}>
          <TouchableWithoutFeedback onPress={handleBgClose} style={{ flex: 1 }}>
            <View style={{ flex: 1 }} />
          </TouchableWithoutFeedback>
          <View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              // 可选内容限宽（iPad 横屏）：不传时保持铺满，行为零回归
              width: maxBodyWidth != null ? '100%' : undefined,
              maxWidth: maxBodyWidth,
              alignSelf: maxBodyWidth != null ? 'center' : undefined,
            }}
            pointerEvents="box-none"
          >
             {memoChildren}
           </View>
        </View>
      </Modal>
    )
  }
)
