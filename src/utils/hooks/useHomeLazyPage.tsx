import { useEffect, useMemo, useState, type ReactNode } from 'react'

import commonState, { type InitState as CommonState } from '@/store/common/state'
import type { NAV_ID_Type } from '@/config/constant'

// 改这两项设置时，被「设置」浮层盖住的列表页需要隐藏，返回时才按新样式重建列表。
// （原 Main.tsx 顶部的 hideKeys 常量，语义不变。）
const hideKeys = ['list.isShowAlbumName', 'list.isShowInterval'] as Readonly<
Array<keyof LX.AppSetting>
>

/**
 * Home 的 PagerView 懒挂载页：只在第一次切到本页时挂载，之后**保持挂载**不再卸载。
 *
 * 为什么是「保持挂载」而不是「离开即卸载」：这些页面普遍持有较多本地 state——
 * 搜索关键词、列表滚动位置、WebDAV 已浏览目录、本地下载筛选条件、歌单排序等
 * （WebDAV 14 个 useState、TxPlaylist/KgPlaylist 各 10 个、LocalDownload 7 个、
 * Search 6 个、MyPlaylist 5 个）。卸载会让用户「切走再回来」丢失这些状态，属功能回退。
 * 惰性挂载 + 常驻是这些页面的既定取舍，本 hook 只是把原来 13 份复制粘贴的样板收敛成一处。
 *
 * 例外：`LeaderboardPage` 不适用本 hook —— 它无跨切页状态（当前榜单由
 * getLeaderboardSetting 持久化兜底），且内部有一个左侧 12pt 全高的透明手势层
 * （SwipeBackArea），常驻会一直占着一份完整歌曲列表 + 手势层，故它单独实现为
 * 「离开即卸载」。
 *
 * @param navId 本页对应的导航 id
 * @param render 页面内容工厂（只在挂载时求值一次，避免每次重渲染新建元素）
 */
export const useHomeLazyPage = (navId: NAV_ID_Type, render: () => ReactNode) => {
  const [visible, setVisible] = useState(commonState.navActiveId == navId)

  // render 只在挂载时求值一次：与原来 useMemo(() => <Xxx />, []) 的行为一致
  // （render 由调用方以稳定闭包传入，此处 [] 依赖即等价）。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const component = useMemo(render, [])

  useEffect(() => {
    let currentId: CommonState['navActiveId'] = commonState.navActiveId

    const handleNavIdUpdate = (id: CommonState['navActiveId']) => {
      currentId = id
      if (id == navId) {
        // 延后一帧挂载：切页瞬间的布局/滚动更稳，与原实现保持一致。
        requestAnimationFrame(() => {
          setVisible(true)
        })
      }
      // 注意：切走时**不**置 false —— 见函数头注释（保留各页本地 state）。
    }

    // 「设置」是覆盖在其他页之上的浮层；被它盖住时把本页隐藏以省渲染，
    // 但仅限「当前确实在设置页」时才隐藏，避免切页过程中被误隐藏。
    const handleHideByTheme = () => {
      if (currentId != 'nav_setting') return
      setVisible(false)
    }
    const handleConfigUpdated = (keys: Array<keyof LX.AppSetting>) => {
      // hideKeys 变化时，若正被设置浮层盖住，则隐藏自己以便返回时按新样式重建。
      if (keys.some((k) => hideKeys.includes(k))) handleHideByTheme()
    }

    global.state_event.on('navActiveIdUpdated', handleNavIdUpdate)
    global.state_event.on('themeUpdated', handleHideByTheme)
    global.state_event.on('languageChanged', handleHideByTheme)
    global.state_event.on('configUpdated', handleConfigUpdated)

    return () => {
      global.state_event.off('navActiveIdUpdated', handleNavIdUpdate)
      global.state_event.off('themeUpdated', handleHideByTheme)
      global.state_event.off('languageChanged', handleHideByTheme)
      global.state_event.off('configUpdated', handleConfigUpdated)
    }
  }, [navId])

  return visible ? component : null
}
