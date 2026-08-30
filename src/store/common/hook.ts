import { type COMPONENT_IDS } from '@/config/constant'
import { useEffect, useState } from 'react'
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
  useEffect(() => {
    let visible = hasVisible(visibleNames, state.componentIds)
    const handlecheck = (ids: InitState['componentIds']) => {
      const res = hasVisible(visibleNames, ids)
      // console.log(visible, res, res == visible)
      if (res == visible) return
      visible = res
      onChange(visible)
    }
    global.state_event.on('componentIdsUpdated', handlecheck)
    return () => {
      global.state_event.off('componentIdsUpdated', handlecheck)
    }
  }, [])
}

export const useAssertApiSupport = (source: LX.Source) => {
  const [value, update] = useState(global.lx.qualityList[source] != null || source == 'local' || source == 'bilibili')

  useEffect(() => {
    const handleUpdate = () => {
      update(global.lx.qualityList[source] != null || source == 'local' || source == 'bilibili')
    }

    global.state_event.on('apiSourceUpdated', handleUpdate)
    return () => {
      global.state_event.off('apiSourceUpdated', handleUpdate)
    }
  }, [])

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
