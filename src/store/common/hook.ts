import { type COMPONENT_IDS } from '@/config/constant'
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
