// import { createStyle } from '@/utils/tools'
import { useImperativeHandle, forwardRef, useState, useMemo, useEffect } from 'react'
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
    ref,
  ) => {
    const [visible, setVisible] = useState(false)
    // ✅ 关键规避：iOS 上 transparent + overFullScreen 的 Modal 关闭时存在竞态，
    // 偶发宿主视图（RCTModalHostView）不被移除，残留的不可见 Modal 会吞掉整页触摸——
    // 页面看着正常、后台音乐照放，但点击/滚动全部无效，直到杀掉重进
    // （上游 issue facebook/react-native#12872 等，长期未根治）。
    // 规避方式：隐藏后不再保留 visible=false 的 Modal 常驻挂载——先等淡出动画走完
    // （fade ≈ 250ms，取 300ms 冗余），再把 Modal 从组件树卸载；重新打开时立即恢复挂载，
    // 淡入动画不受影响。这也是社区对该问题的标准 workaround。
    const [mounted, setMounted] = useState(false)
    useEffect(() => {
      if (visible) {
        setMounted(true)
        return
      }
      // visible=false：延迟卸载，让淡出动画播完（提前重开则取消定时器、保持挂载）
      const timer = setTimeout(() => { setMounted(false) }, 300)
      return () => { clearTimeout(timer) }
    }, [visible])
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

    // 已卸载（含淡出结束）时不渲染任何原生宿主——这是本修复的核心，
    // 杜绝"看不见但还挂着"的 Modal 截胡整页触摸。
    if (!mounted) return null

    return (
      <Modal
        animationType="fade"
        transparent={true}
        // presentationStyle 仅在 iPad/Plus 等大屏设备上生效（iPhone 上被系统忽略，
        // 始终全屏覆盖）。必须显式钉死 overFullScreen：iOS 13+ 未显式声明时，
        // iPad 上透明 Modal 存在 pageSheet/formSheet 回退呈现路径，叠加本项目
        // UIRequiresFullScreen=true，会导致呈现异常——表现为 iPad 上菜单/弹层
        // 「点击没反应」（iPhone 正常）。
        presentationStyle="overFullScreen"
        // 允许 iPad 竖屏/横屏双方向呈现；iPhone 系统锁定竖屏，不受影响。
        supportedOrientations={['portrait', 'landscape']}
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
  },
)
