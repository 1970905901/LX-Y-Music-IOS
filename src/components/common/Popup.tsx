import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react'
import { View, TouchableOpacity } from 'react-native'

import Modal, { type ModalType } from './Modal'
import { Icon } from '@/components/common/Icon'
import { useKeyboard, useHorizontalMode } from '@/utils/hooks'
import { createStyle } from '@/utils/tools'
import { shadow } from '@/utils/shadow'
import { useTheme } from '@/store/theme/hook'
import Text from './Text'
import { useStatusbarHeight, useSafeAreaBottom } from '@/store/common/hook'
import { designRadius, designSpacing, designTypography } from '@/theme/DesignTokens'

const styles = createStyle({
  centeredView: {
    flex: 1,
    // justifyContent: 'flex-end',
    // alignItems: 'center',
  },
  modalView: {
    // iOS 浮层阴影（仅 iPhone/iPad）
    ...shadow(6),
    flexGrow: 0,
    flexShrink: 1,
  },
  header: {
    flex: 0,
    flexDirection: 'row',
    borderTopLeftRadius: designRadius.lg,
    borderTopRightRadius: designRadius.lg,
  },
  title: {
    flex: 1,
    paddingLeft: designSpacing.md,
    paddingRight: designSpacing.xl,
    paddingTop: designSpacing.sm,
    paddingBottom: designSpacing.sm,
    fontWeight: '600',
  },
  closeBtn: {
    position: 'absolute',
    right: 0,
    // borderTopRightRadius: 8,
    flexGrow: 0,
    flexShrink: 0,
    height: 36,
    width: 36,
    justifyContent: 'center',
    alignItems: 'center',
    // backgroundColor: '#eee',
  },
})

export interface PopupProps {
  onHide?: () => void
  keyHide?: boolean
  bgHide?: boolean
  closeBtn?: boolean
  position?: 'top' | 'left' | 'right' | 'bottom'
  title?: string
  children: React.ReactNode
}

export interface PopupType {
  setVisible: (visible: boolean) => void
}

export default forwardRef<PopupType, PopupProps>(
  (
    {
      onHide = () => {},
      keyHide = true,
      bgHide = true,
      closeBtn = true,
      position = 'bottom',
      title = '',
      children,
    }: PopupProps,
    ref,
  ) => {
    const theme = useTheme()
    const { keyboardShown, keyboardHeight } = useKeyboard()
    const statusBarHeight = useStatusbarHeight()
    const isHorizontal = useHorizontalMode()
    const safeAreaBottom = useSafeAreaBottom()

    const modalRef = useRef<ModalType>(null)

    useImperativeHandle(ref, () => ({
      setVisible(visible: boolean) {
        modalRef.current?.setVisible(visible)
      },
    }))

    const closeBtnComponent = useMemo(
      () =>
        closeBtn ? (
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={() => modalRef.current?.setVisible(false)}
          >
            <Icon name="close" style={{ color: theme['c-font-label'] }} size={12} />
          </TouchableOpacity>
        ) : null,
      [closeBtn, theme],
    )

    const [centeredViewStyle, modalViewStyle] = useMemo(() => {
      switch (position) {
        case 'top':
          return [
            {
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              top: 0,
              justifyContent: 'flex-start',
            },
            {
              width: '100%',
              maxWidth: isHorizontal ? 760 : undefined,
              alignSelf: isHorizontal ? 'center' : undefined,
              maxHeight: '78%',
              minHeight: '20%',
              // backgroundColor: 'white',
            },
          ] as const
        case 'left':
          return [
            {
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              top: 0,
              flexDirection: 'row',
              justifyContent: 'flex-start',
            },
            {
              minWidth: isHorizontal ? undefined : '45%',
              width: isHorizontal ? 420 : undefined,
              maxWidth: isHorizontal ? undefined : '78%',
              height: '100%',
              paddingTop: statusBarHeight,
              // backgroundColor: 'white',
            },
          ] as const
        case 'right':
          return [
            {
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              top: 0,
              flexDirection: 'row',
              justifyContent: 'flex-end',
            },
            {
              minWidth: isHorizontal ? undefined : '45%',
              width: isHorizontal ? 420 : undefined,
              maxWidth: isHorizontal ? undefined : '78%',
              height: '100%',
              paddingTop: statusBarHeight,
              // backgroundColor: 'white',
            },
          ] as const
        case 'bottom':
        default:
          return [
            {
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              top: 0,
              justifyContent: 'flex-end',
            },
            {
              width: '100%',
              maxWidth: isHorizontal ? 760 : undefined,
              alignSelf: isHorizontal ? 'center' : undefined,
              maxHeight: '78%',
              minHeight: '20%',
              // backgroundColor: 'white',
              borderTopLeftRadius: designRadius.lg,
              borderTopRightRadius: designRadius.lg,
            },
          ] as const
      }
    }, [position, statusBarHeight, isHorizontal])

    return (
      <Modal
        onHide={onHide}
        keyHide={keyHide}
        bgHide={bgHide}
        bgColor="rgba(50,50,50,.2)"
        ref={modalRef}
      >
        <View
          style={{
            ...styles.centeredView,
            ...centeredViewStyle,
            paddingBottom: keyboardShown ? keyboardHeight : position === 'bottom' ? safeAreaBottom : 0,
          }}
          pointerEvents="box-none"
        >
          <View
            style={{
              ...styles.modalView,
              ...modalViewStyle,
              backgroundColor: theme['c-content-background'],
            }}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.header}>
              <Text size={designTypography.body} style={styles.title} numberOfLines={1}>
                {title}
              </Text>
              {closeBtnComponent}
            </View>
            {children}
            {/* 底部安全区补白（2026-09-30）。
                外层 centeredView 的 paddingBottom=safeAreaBottom 把面板整体抬到
                Home 指示条之上，面板自身仍止于安全区顶边——于是安全区那 34pt 露出的是
                遮罩 + 页面背景（实测是偏深的一横条，Home 指示条正好落在里面），
                观感像「面板下面多了一条黑边」，与 iOS 底部弹层（面板一直铺到屏幕底、
                内容再靠内边距避开指示条）不一致。
                这里不改成给面板加 paddingBottom：面板 maxHeight 是 78%，padding 计入
                面板高度后会把可滚内容区再削掉 34pt（播详设置/音效弹层都是滚到底的，
                会实打实少看一行）。故保持布局零变化，只把面板**背景色**延伸到屏幕底边：
                同色绝对定位子视图，宽高自动跟随面板（含 iPad 横屏 maxWidth 760 居中），
                且绘制在面板自身阴影之上，所以那条阴影渐变也不会再露出来。
                键盘弹起时不补（此时面板被键盘顶上去了，中间留白是刻意的）。 */}
            {position === 'bottom' && !keyboardShown && safeAreaBottom > 0 ? (
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: -safeAreaBottom,
                  height: safeAreaBottom,
                  backgroundColor: theme['c-content-background'],
                }}
              />
            ) : null}
          </View>
        </View>
      </Modal>
    )
  },
)
