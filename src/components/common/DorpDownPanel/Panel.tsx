import { useMemo, useRef, useImperativeHandle, forwardRef, useState, useEffect } from 'react'
import { View, TouchableWithoutFeedback, type StyleProp, type ViewStyle } from 'react-native'
import { useWindowSize } from '@/utils/hooks'

import Modal, { type ModalType } from '@/components/common/Modal'
import { createStyle } from '@/utils/tools'
// import { useGetter } from '@/store'

// const menuItemHeight = 42
// const menuItemWidth = 100
interface Position {
  w: number
  h: number
  x: number
  y: number
}

const styles = createStyle({
  menu: {
    position: 'absolute',
    // borderWidth: StyleSheet.hairlineWidth,
    // borderColor: 'lightgray',
    // borderRadius: 2,
    backgroundColor: 'rgba(0,0,0,0)',
  },
  menuItem: {
    paddingLeft: 10,
    paddingRight: 10,
    // height: menuItemHeight,
    // width: menuItemWidth,
    // alignItems: 'center',
    justifyContent: 'center',
    // backgroundColor: '#ccc',
  },
  menuText: {
    // textAlign: 'center',
  },
})

const Panel = ({
  buttonPosition,
  // panelStyle = {},
  onHide,
  children,
}: {
  buttonPosition: Position
  onHide: () => void
  children: React.ReactNode | React.ReactNode[]
}) => {
  // const dimensions = useWindowSize()
  const windowSize = useWindowSize()
  // const theme = useGetter('common', 'theme')
  // const fadeAnim = useRef(new Animated.Value(0)).current
  // console.log(buttonPosition)

  // console.log(dimensions)
  const style = useMemo(() => {
    const isBottom = buttonPosition.y > windowSize.height / 2
    let top: number
    let height: number
    let justifyContent: 'flex-end' | 'flex-start'
    if (isBottom) {
      const buttonPositionY = Math.ceil(buttonPosition.y)
      height = buttonPositionY - windowSize.height * 0.3
      top = buttonPositionY - height
      justifyContent = 'flex-end'
    } else {
      top = Math.floor(buttonPosition.y) + Math.floor(buttonPosition.h)
      height = windowSize.height * 0.7 - top
      justifyContent = 'flex-start'
    }
    const frameStyle = {
      flex: 1,
      height,
      top,
      justifyContent,
      width: windowSize.width,
    }
    return frameStyle
  }, [windowSize, buttonPosition])

  // iPad 横屏下菜单内容限宽居中（对齐 Popup/Dialog 的 760 cap）；
  // 外层保持全宽以承接“点击空白处关闭”的手势
  const contentStyle = useMemo<StyleProp<ViewStyle>>(
    () =>
      windowSize.width / windowSize.height > 1.2
        ? { width: '100%', maxWidth: 760, alignSelf: 'center' }
        : undefined,
    [windowSize.width, windowSize.height],
  )

  return (
    <TouchableWithoutFeedback onPress={onHide}>
      <View style={{ ...styles.menu, ...style }}>
        <View onStartShouldSetResponder={() => true} style={contentStyle}>{children}</View>
      </View>
    </TouchableWithoutFeedback>
  )
}
export interface PanelProps {
  onHide?: () => void
  keyHide?: boolean
  bgHide?: boolean
  closeBtn?: boolean
  title?: string
  children: React.ReactNode | React.ReactNode[]
  // style:
}

export interface PanelType {
  show: (position: Position) => void
  hide: () => void
}

export default forwardRef<PanelType, PanelProps>(({ onHide, keyHide, bgHide, children }, ref) => {
  const modalRef = useRef<ModalType>(null)
  const [position, setPosition] = useState<Position>({ w: 0, h: 0, x: 0, y: 0 })

  useImperativeHandle(ref, () => ({
    show(newPosition) {
      setPosition(newPosition)
      modalRef.current?.setVisible(true)
    },
    hide() {
      modalRef.current?.setVisible(false)
    },
  }))

  const windowSize = useWindowSize()
  const prevWindowSizeRef = useRef(windowSize)
  useEffect(() => {
    // iPad 旋转/分屏后窗口尺寸变化，打开时快照的锚点坐标已失效：
    // 面板若继续展开会定位错乱。尺寸变化时直接关闭，避免错位。
    const prev = prevWindowSizeRef.current
    if (prev.width !== windowSize.width || prev.height !== windowSize.height) {
      prevWindowSizeRef.current = windowSize
      modalRef.current?.setVisible(false)
    }
  }, [windowSize])

  // console.log(visible)
  return (
    <Modal
      ref={modalRef}
      onHide={onHide}
      onStartShouldSetResponder={() => true}
      keyHide={keyHide}
      bgHide={bgHide}
    >
      <Panel buttonPosition={position} onHide={() => modalRef.current?.setVisible(false)}>
        {children}
      </Panel>
    </Modal>
  )
})
