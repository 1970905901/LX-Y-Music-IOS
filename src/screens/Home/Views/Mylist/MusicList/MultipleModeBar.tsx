import { useState, useRef, useCallback, useMemo, forwardRef, useImperativeHandle, useEffect } from 'react'
import { Animated, View, TouchableOpacity } from 'react-native'

import Text from '@/components/common/Text'
import Button from '@/components/common/Button'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'
import { BorderWidths } from '@/theme'

export type SelectMode = 'single' | 'range'

export interface MultipleModeBarProps {
  onSwitchMode: (mode: SelectMode) => void
  onSelectAll: (isAll: boolean) => void
  onExitSelectMode: () => void
}
export interface MultipleModeBarType {
  show: () => void
  setVisibleBar: (visible: boolean) => void
  setIsSelectAll: (isAll: boolean) => void
  setSwitchMode: (mode: SelectMode) => void
  exitSelectMode: () => void
}

export default forwardRef<MultipleModeBarType, MultipleModeBarProps>(
  ({ onSelectAll, onSwitchMode, onExitSelectMode }, ref) => {
    // const isGetDetailFailedRef = useRef(false)
    const [visible, setVisible] = useState(false)
    const [animatePlayed, setAnimatPlayed] = useState(true)
    const animFade = useRef(new Animated.Value(0)).current
    const animTranslateY = useRef(new Animated.Value(0)).current
    const [selectMode, setSelectMode] = useState<SelectMode>('single')
    const [isSelectAll, setIsSelectAll] = useState(false)
    const [visibleBar, setVisibleBar] = useState(true)
    const theme = useTheme()

    useImperativeHandle(ref, () => ({
      show() {
        handleShow()
      },
      setVisibleBar(visible) {
        setVisibleBar(visible)
      },
      setIsSelectAll(isAll) {
        setIsSelectAll(isAll)
      },
      setSwitchMode(mode: SelectMode) {
        setSelectMode(mode)
      },
      exitSelectMode() {
        handleHide()
      },
    }))

    // 退出动画的卸载定时器 + 待执行的入场 rAF：
    // 历史坑（2026-10 审计）：旧实现只在动画回调 finished=true 时才 setVisible(false)。
    // 用户在 200ms 退出动画期间再次进入多选 / 切页时动画被打断，回调收到 finished=false
    // 直接 return —— 组件永远停在 visible=true，而本组件是 absolute 全屏，
    // 于是留下一个**透明但拦截触摸**的整屏层（表现为「页头点不动」）。
    // 现在：卸载交给可取消定时器，动画值在隐藏态显式归零，隐藏期间 pointerEvents 关闭。
    const unmountTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const showRaf = useRef<number | null>(null)
    const clearUnmountTimer = useCallback(() => {
      if (unmountTimer.current == null) return
      clearTimeout(unmountTimer.current)
      unmountTimer.current = null
    }, [])
    const cancelShowRaf = useCallback(() => {
      if (showRaf.current == null) return
      cancelAnimationFrame(showRaf.current)
      showRaf.current = null
    }, [])

    const handleShow = useCallback(() => {
      clearUnmountTimer()
      setVisible(true)
      setAnimatPlayed(false)
      cancelShowRaf()
      showRaf.current = requestAnimationFrame(() => {
        showRaf.current = null
        animTranslateY.setValue(-20)

        Animated.parallel([
          Animated.timing(animFade, {
            toValue: 0.92,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.timing(animTranslateY, {
            toValue: 0,
            duration: 200,
            useNativeDriver: true,
          }),
        ]).start(({ finished }) => {
          // 被打断（又有新的显示/隐藏）时不提交状态，由最新那次操作负责收尾
          if (finished) setAnimatPlayed(true)
        })
      })
    }, [animFade, animTranslateY, clearUnmountTimer, cancelShowRaf])

    const handleHide = useCallback(() => {
      cancelShowRaf()
      setAnimatPlayed(false)
      Animated.parallel([
        Animated.timing(animFade, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(animTranslateY, {
          toValue: -20,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start()
      clearUnmountTimer()
      unmountTimer.current = setTimeout(() => {
        unmountTimer.current = null
        // 显式归零：避免下一次 show 从残值开始（也让隐藏态不残留可见像素）
        animFade.setValue(0)
        animTranslateY.setValue(-20)
        setVisible(false)
        setAnimatPlayed(true)
      }, 250)
    }, [animFade, animTranslateY, clearUnmountTimer, cancelShowRaf])

    // 卸载时清掉未触发的定时器 / rAF，避免对已卸载组件 setState
    useEffect(() => () => {
      clearUnmountTimer()
      cancelShowRaf()
    }, [clearUnmountTimer, cancelShowRaf])

    const animaStyle = useMemo(
      () => ({
        ...styles.container,
        // backgroundColor: theme['c-content-background'],
        borderBottomColor: theme['c-border-background'],
        opacity: visibleBar ? animFade : 0, // Bind opacity to animated value
        transform: [{ translateY: animTranslateY }],
      }),
      [animFade, animTranslateY, theme, visibleBar],
    )

    const handleSelectAll = useCallback(() => {
      const selectAll = !isSelectAll
      setIsSelectAll(selectAll)
      onSelectAll(selectAll)
    }, [isSelectAll, onSelectAll])

    const component = useMemo(() => {
      return (
        // 隐藏/退出动画期间必须停止接收触摸：本组件是全屏 absolute 层，
        // 只把 opacity 降到 0 仍会拦住下面的列表与页头（见 handleHide 的历史坑注释）
        <Animated.View
          style={animaStyle}
          pointerEvents={visible && visibleBar ? 'auto' : 'none'}
        >
          <View style={styles.switchBtn}>
            <Button
              onPress={() => {
                onSwitchMode('single')
              }}
              style={{
                ...styles.btn,
                backgroundColor:
                  selectMode == 'single' ? theme['c-button-background'] : 'rgba(0,0,0,0)',
              }}
            >
              <Text color={theme['c-button-font']}>{global.i18n.t('list_select_single')}</Text>
            </Button>
            <Button
              onPress={() => {
                onSwitchMode('range')
              }}
              style={{
                ...styles.btn,
                backgroundColor:
                  selectMode == 'range' ? theme['c-button-background'] : 'rgba(0,0,0,0)',
              }}
            >
              <Text color={theme['c-button-font']}>{global.i18n.t('list_select_range')}</Text>
            </Button>
          </View>
          <TouchableOpacity onPress={handleSelectAll} style={styles.btn}>
            <Text color={theme['c-button-font']}>
              {global.i18n.t(isSelectAll ? 'list_select_unall' : 'list_select_all')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onExitSelectMode} style={styles.btn}>
            <Text color={theme['c-button-font']}>{global.i18n.t('list_select_cancel')}</Text>
          </TouchableOpacity>
        </Animated.View>
      )
    }, [
      animaStyle,
      visible,
      visibleBar,
      selectMode,
      theme,
      handleSelectAll,
      isSelectAll,
      onExitSelectMode,
      onSwitchMode,
    ])

    return !visible && animatePlayed ? null : component
  },
)

const styles = createStyle({
  container: {
    flex: 1,
    position: 'absolute',
    left: 0,
    top: 0,
    width: '100%',
    height: '100%',
    flexDirection: 'row',
    borderBottomWidth: BorderWidths.normal,
  },
  switchBtn: {
    flexDirection: 'row',
    flex: 1,
  },
  btn: {
    // flex: 1,
    paddingLeft: 18,
    paddingRight: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
