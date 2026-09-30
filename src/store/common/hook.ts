import { COMPONENT_IDS } from '@/config/constant'
import { useCallback, useEffect, useRef, useState } from 'react'
import state, { type InitState } from './state'

export const useFontSize = () => {
  const [value, update] = useState(state.fontSize)

  useEffect(() => {
    global.state_event.on('fontSizeUpdated', update)
    return () => {
      global.state_event.off('fontSizeUpdated', update)
    }
  }, [])

  return value
}

// 全局顶部间距偏移（pt）：所有页面 Header 均以 useStatusbarHeight 作为
// 距状态栏的 paddingTop，在此统一加一点留白，避免标题贴住状态栏/灵动岛。
// 只读偏移，不写入 state，避免影响 SizeView 的原始高度校准。
const STATUSBAR_TOP_OFFSET = 6

export const useStatusbarHeight = () => {
  const [value, update] = useState(state.statusbarHeight)

  useEffect(() => {
    global.state_event.on('statusbarHeightUpdated', update)
    return () => {
      global.state_event.off('statusbarHeightUpdated', update)
    }
  }, [])

  return value + STATUSBAR_TOP_OFFSET
}

/**
 * 底部安全区高度（pt）：Home 指示器 / iPad 底部区域。
 * 底部弹层、列表需用它补 paddingBottom，否则最后一行会被系统 UI 遮挡。
 * 由 SizeView 在启动与窗口尺寸变化（旋转 / 分屏）时从原生侧同步。
 */
export const useSafeAreaBottom = () => {
  const [value, update] = useState(state.safeAreaBottom)

  useEffect(() => {
    global.state_event.on('safeAreaBottomUpdated', update)
    return () => {
      global.state_event.off('safeAreaBottomUpdated', update)
    }
  }, [])

  return value
}

// 底部悬浮层（悬浮迷你播放器 + 底部 Tab）的固定部分总高（pt），
// 实际避让高度还需叠加底部安全区（useBottomOverlayInset）。
export const BOTTOM_OVERLAY_BASE_HEIGHT = 180

/**
 * 底部悬浮层避让高度（pt）：迷你播放器 + 底部 Tab + 底部安全区。
 * 各列表 FlatList 的 contentContainerStyle.paddingBottom 统一使用该值：
 * 相当于在列表末尾追加一段滚动空白，让最后一行能滚到悬浮层上方、可正常点击，
 * 列表容器自身高度不变（仍占满页面），播放器与 Tab 仍是悬浮层、不移动不缩小。
 * safeAreaBottom 随 iPad 旋转 / 窗口尺寸变化自动同步，横竖屏切换后依然准确。
 */
export const useBottomOverlayInset = () => {
  const safeAreaBottom = useSafeAreaBottom()
  return BOTTOM_OVERLAY_BASE_HEIGHT + safeAreaBottom
}

export const useComponentIds = () => {
  const [value, update] = useState(state.componentIds)

  useEffect(() => {
    global.state_event.on('componentIdsUpdated', update)
    return () => {
      global.state_event.off('componentIdsUpdated', update)
    }
  }, [])

  return value
}

/**
 * Home 是否被压栈页（播放详情 / 设置详情 / 歌单详情等）**完全覆盖**（不可见）。
 * componentIds 是 RNN 栈内组件列表（底→顶），Home 在栈底：顶层不是 home 即被
 * 覆盖。用于「不可见即省电」——暂停 Home 内玻璃的 Metal 渲染循环与装饰动画，
 * 返回 Home 时恢复（原生下一帧重捕获背景，无残帧）。
 * ⚠️ 只用于「挂在 Home 内」的组件；独立屏幕（专辑页等）用 useScreenCovered。
 */
export const useHomeCovered = () => {
  const ids = useComponentIds()
  return ids.length > 0 && String(ids[ids.length - 1]?.name) !== COMPONENT_IDS.home
}

/**
 * 「传入 componentId 的屏幕」是否被压栈页覆盖：栈顶不是自己即被覆盖。
 * componentId 未知（调用方未传）时恒 false（不门控，行为与旧版一致）——
 * 用于 PlayerBar 这类多屏复用组件：Home 实例传 home 的 id，专辑页实例
 * 不传则不做省电门控。配合 <LiquidGlass paused> 实现不可见即暂停渲染。
 */
export const useScreenCovered = (componentId?: string) => {
  const ids = useComponentIds()
  if (!componentId) return false
  return String(ids[ids.length - 1]?.id) !== String(componentId)
}

const hasVisible = (visibleNames: COMPONENT_IDS[], ids: InitState['componentIds']) => {
  const names = ids.map(item => item.name)
  return names.length == visibleNames.length ? visibleNames.every((n) => names.includes(n)) : false
}
export const usePageVisible = (
  visibleNames: COMPONENT_IDS[],
  onChange: (visible: boolean) => void,
) => {
  // 用 ref 持有最新参数，事件订阅只建立一次（依赖数组恒空），
  // 避免调用方传入的数组字面量/内联函数导致反复订阅解绑。
  const visibleNamesRef = useRef(visibleNames)
  const onChangeRef = useRef(onChange)
  visibleNamesRef.current = visibleNames
  onChangeRef.current = onChange

  useEffect(() => {
    let visible = hasVisible(visibleNamesRef.current, state.componentIds)
    const handlecheck = (ids: InitState['componentIds']) => {
      const res = hasVisible(visibleNamesRef.current, ids)
      // console.log(visible, res, res == visible)
      if (res == visible) return
      visible = res
      onChangeRef.current(visible)
    }
    global.state_event.on('componentIdsUpdated', handlecheck)
    return () => {
      global.state_event.off('componentIdsUpdated', handlecheck)
    }
  }, [])
}

export const useAssertApiSupport = (source: LX.Source) => {
  const isSupported = useCallback(
    () => global.lx.qualityList[source] != null || source == 'local' || source == 'bilibili',
    [source],
  )
  const [value, update] = useState(isSupported)

  useEffect(() => {
    // source 变化时同步一次最新支持状态，并订阅后续更新事件
    update(isSupported())
    const handleUpdate = () => {
      update(isSupported())
    }

    global.state_event.on('apiSourceUpdated', handleUpdate)
    return () => {
      global.state_event.off('apiSourceUpdated', handleUpdate)
    }
  }, [isSupported])

  return value
}

export const useNavActiveId = () => {
  const [value, update] = useState(state.navActiveId)

  useEffect(() => {
    global.state_event.on('navActiveIdUpdated', update)
    return () => {
      global.state_event.off('navActiveIdUpdated', update)
    }
  }, [])

  return value
}

export const useBgPic = () => {
  const [value, update] = useState(state.bgPic)

  useEffect(() => {
    global.state_event.on('bgPicUpdated', update)
    return () => {
      global.state_event.off('bgPicUpdated', update)
    }
  }, [])

  return value
}

export const useSourceNames = () => {
  const [value, update] = useState(state.sourceNames)

  useEffect(() => {
    global.state_event.on('sourceNamesUpdated', update)
    return () => {
      global.state_event.off('sourceNamesUpdated', update)
    }
  }, [])

  return value
}
