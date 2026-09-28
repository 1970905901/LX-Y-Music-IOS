import { memo, useState, useRef, useMemo, useEffect, useCallback } from 'react'
import { View, AppState } from 'react-native'
import PagerView, { type PagerViewOnPageSelectedEvent } from 'react-native-pager-view'
import MiniLyric from '../components/MiniLyric'
import Pic from './Pic'
import Lyric from './Lyric'
import SongInfo from './components/SongInfo'
import Header from './components/Header'
import Player from './Player'
import { screenkeepAwake, screenUnkeepAwake } from '@/utils/nativeModules/utils'
import commonState, { type InitState as CommonState } from '@/store/common/state'
import { createStyle } from '@/utils/tools'
import { useSettingValue } from '@/store/setting/hook'
import PlayerPlaylist, { type PlayerPlaylistType } from '@/components/player/PlayerPlaylist.tsx'
import { registerPager } from '@/utils/pagerScrollControl'
import { scaleSizeW } from '@/utils/pixelRatio'
import { useWindowSize } from '@/utils/hooks'
import { COMPONENT_IDS } from '@/config/constant'

const LyricPage = ({ pagerHeight = 0, isActive = false }: { pagerHeight?: number, isActive?: boolean }) => {
  // 歌词页始终预挂载（pagerHeight 就绪后），isActive 只控制滚动/定位：
  // 若等首次滑到歌词页才挂载，FlatList 需在现场渲染大量歌词行 + 布局测量 + 无动画定位，
  // 全部挤在滑动完成的一帧里，PagerView 切页会出现明显顿挫（iPhone/iPad 竖屏“顿一下”的主因）。
  // active=false 时 Lyric 内部不启动滚动循环、不定位，常驻成本仅是一次性的初始行渲染。
  if (pagerHeight <= 0) return null
  return <Lyric key="lyric" active={isActive} pagerHeight={pagerHeight} />
}

const VerticalNew = memo(({ componentId }: { componentId: string }) => {
  const [pageIndex, setPageIndex] = useState(0)
  // 正在从左往右滑向歌词页（从封面切到歌词），用于让 LyricPage 提前激活高亮定位
  const pagerViewRef = useRef<PagerView>(null)
  const showLyricRef = useRef(false)
  const playlistRef = useRef<PlayerPlaylistType>(null)
  const [pagerHeight, setPagerHeight] = useState(0)
  const { height: winHeight } = useWindowSize()
  const miniLyricAlign = useSettingValue('playDetail.style.miniLyricAlign')
  // 用 ref 追踪滑动方向，避免高频 onScroll 触发大量 setState 导致卡顿
  // 仅在首次变为 true 时触发一次 setState 通知子组件
  const isComingLyricRef = useRef(false)
  const [, setForceUpdate] = useState(0)

  const [isProgressDragging, setIsProgressDragging] = useState(false)

  const onPageSelected = ({ nativeEvent }: PagerViewOnPageSelectedEvent) => {
    setPageIndex(nativeEvent.position)
    showLyricRef.current = nativeEvent.position === 1
    // 页面选择完成后：滑向封面页，取消标记并通知子组件更新
    if (nativeEvent.position === 0 && isComingLyricRef.current) {
      isComingLyricRef.current = false
      setForceUpdate(v => v + 1)
    }
    if (showLyricRef.current) {
      screenkeepAwake()
    } else {
      screenUnkeepAwake()
    }
  }

  // 在 PagerView 滑动过程中检测方向：position===0（封面页）且 offset>0 表示正在滑向歌词页。
  // 用 ref 存状态避免高频 onScroll 触发 setState；首次变为 true 时通过 setForceUpdate 通知子组件。
  const handlePageScroll = useCallback((e: { nativeEvent: { offset: number, position: number } }) => {
    const coming = e.nativeEvent.position === 0 && e.nativeEvent.offset > 0
    if (coming && !isComingLyricRef.current) {
      isComingLyricRef.current = true
      setForceUpdate(v => v + 1)
    }
  }, [])

  const handleSwitchToLyricPage = useCallback(() => {
    pagerViewRef.current?.setPage(1)
  }, [])

  useEffect(() => {
    let appstateListener = AppState.addEventListener('change', (state) => {
      switch (state) {
        case 'active':
          if (showLyricRef.current && !commonState.componentIds.find(item => item.name === COMPONENT_IDS.comment)) screenkeepAwake()
          break
        case 'background':
          screenUnkeepAwake()
          break
      }
    })

    const handleComponentIdsChange = (ids: CommonState['componentIds']) => {
      if (ids.find(item => item.name === COMPONENT_IDS.comment)) screenUnkeepAwake()
      else if (AppState.currentState === 'active') screenkeepAwake()
    }

    // 进度条拖动期间禁用 PagerView 横滑，避免与“切到歌词页”的原生手势冲突
    const handleProgressDragState = (dragging: boolean) => { setIsProgressDragging(dragging) }
    global.app_event.on('progressDragState', handleProgressDragState)

    // 将 PagerView ref 注册给同步手势锁，供进度条拖动时立即禁用原生横滑
    registerPager(pagerViewRef)

    // 必须用具名函数注册/移除，否则 off 传入新箭头函数无法匹配已注册的监听器，
    // 会导致监听器泄漏（组件多次挂载后点击 ☰ 弹出多个队列面板）。
    const handleShowPlaylist = () => { playlistRef.current?.show() }

    global.state_event.on('componentIdsUpdated', handleComponentIdsChange)
    global.app_event.on('switchToLyricPage', handleSwitchToLyricPage)
    global.app_event.on('showPlaylist', handleShowPlaylist)

    return () => {
      global.state_event.off('componentIdsUpdated', handleComponentIdsChange)
      global.app_event.off('progressDragState', handleProgressDragState)
      registerPager(null)
      global.app_event.off('switchToLyricPage', handleSwitchToLyricPage)
      global.app_event.off('showPlaylist', handleShowPlaylist)
      appstateListener.remove()
      screenUnkeepAwake()
    }
  }, [handleSwitchToLyricPage])

  const containerPaddingH = useMemo(() => scaleSizeW(10), [])
  const isSmallWindow = winHeight < 700
  // 歌曲信息块（歌名/歌手/专辑 + 迷你歌词）整体上移。
  // picPageContainerNew 用 justifyContent:'space-between'（封面贴顶、信息块贴底），
  // 容器高度里扣掉 paddingBottom 后，剩余的多余空间全部落到「封面 ↔ 信息块」的中缝上，
  // 因此加大底部内边距 = 把信息块整体往上推，封面位置与尺寸都不受影响。
  //
  // 取值必须保证「封面 + 信息块 + paddingBottom ≤ 容器高度」，否则 flexShrink:0 的
  // 信息块会被挤出容器底、压到下方控制条上。迷你歌词扩到 3 行并放大字号后信息块明显变高：
  //   390x844（用户机型）：容器约 511pt，封面 146 + 信息块约 273 → 中缝约 82pt；
  //                        取 0.05*height≈42pt 后中缝约 40pt、信息块上移约 104pt、
  //                        底部仍留 42pt，封面与歌曲名之间保持约 40pt 呼吸间距。
  //   小屏（iPhone SE 667pt）：容器仅约 384pt，封面 + 信息块几乎占满，中缝只剩约 11pt，
  //                        再做上移必然溢出，故小屏不做上移（paddingBottom 归 0），
  //                        仅保留字号放大与小歌词行数降级（见 MiniLyric 的 isSmallWindow）。
  const pageBottomPadding = useMemo(() => ({
    paddingBottom: isSmallWindow ? 0 : Math.round(winHeight * 0.05),
  }), [isSmallWindow, winHeight])

  return (
    <>
      <Header pageIndex={pageIndex} />
      <View style={styles.container}>
        <PagerView
          onPageSelected={onPageSelected}
          onPageScroll={handlePageScroll}
          style={styles.pagerView}
          ref={pagerViewRef}
          scrollEnabled={!isProgressDragging}
          overScrollMode="never"
          onLayout={({ nativeEvent }) => {
            const h = Math.round(nativeEvent.layout.height)
            if (h > 0 && h !== pagerHeight) setPagerHeight(h)
          }}
        >
          <View collapsable={false} style={styles.pageContainer}>
            <View collapsable={false} style={[styles.picPageContainerNew, pageBottomPadding, { paddingTop: containerPaddingH }]}>
              <View style={styles.picContainer}>
                {/* 移植用户实测正常的 v20260826（e58d1ab1）VerticalOld 封面用法：
                    不传 maxCoverHeight，让 Pic 内部按 isNewUI=false 计算封面尺寸
                    （50% 高/85% 宽，container 居中布局）——这正是参考版封面正常的分支。 */}
                <Pic componentId={componentId} />
              </View>
              <View style={[styles.infoContainer, { paddingHorizontal: containerPaddingH, marginTop: containerPaddingH }]}>
                <SongInfo componentId={componentId} />
                <MiniLyric
                  onPress={handleSwitchToLyricPage}
                  style={[styles.miniLyricContainerNew, miniLyricAlignStyles[miniLyricAlign as keyof typeof miniLyricAlignStyles]]}
                />
              </View>
            </View>
          </View>
          <View collapsable={false} style={{ flex: 1, width: '100%', height: '100%' }}>
            <LyricPage pagerHeight={pagerHeight} isActive={pageIndex === 1 || isComingLyricRef.current} />
          </View>
        </PagerView>
        {/* Progress bar must live OUTSIDE the PagerView so its horizontal drag never
            enters the native pager gesture domain (otherwise left-drag stutters / is
            hijacked as a page swipe).
            常驻控制条：Player 控制条始终挂载并可见——封面页(pageIndex===0)与
            歌词页(pageIndex===1)底部都显示该控制条（不折叠、不透明隐藏）。
            Player 本身是 memo + 稳定 props，pageIndex 变化不会引起其重渲染；
            保留挂载避免切页卸载/重挂导致的掉帧。 */}
        <View>
          <Player componentId={componentId} />
        </View>
      </View>
      <PlayerPlaylist ref={playlistRef} />
    </>
  )
})

export default VerticalNew

const styles = createStyle({
  container: {
    flex: 1,
    flexDirection: 'column',
  },
  pagerView: {
    flex: 1,
  },
  pageContainer: {
    flex: 1,
    flexDirection: 'column',
    position: 'relative',
  },
  picPageContainerNew: {
    flex: 1,
    flexDirection: 'column',
    justifyContent: 'space-between',
    position: 'relative',
    // 注意：此处绝不能加 overflow: 'hidden'——iOS 上 clipsToBounds 与 transform
    // （旋转封面）叠加在同一图层时，会把带 transform 的后代剔除出渲染树，
    // 导致封面空白（SongInfo 等无 transform 的子视图不受影响）。
    // 旧 UI（v20260826 实测封面正常）的 picPageContainerOld 就没有 overflow。
  },
  picContainer: {
    alignItems: 'center',
    flexShrink: 0,
  },
  infoContainer: {
    flex: 0,
    flexShrink: 0,
  },
  miniLyricContainerNew: {
    paddingHorizontal: 10,
  },
  miniLyricAlignLeft: {
    alignItems: 'flex-start',
  },
  miniLyricAlignCenter: {
    alignItems: 'center',
  },
  miniLyricAlignRight: {
    alignItems: 'flex-end',
  },
})

// 类型安全的“小歌词对齐”样式查表，替代 styles[`miniLyricAlign${...}`] 的
// 字符串动态索引（后者因 key 被推断为 string 触发 TS7053）。
const miniLyricAlignStyles = {
  left: styles.miniLyricAlignLeft,
  center: styles.miniLyricAlignCenter,
  right: styles.miniLyricAlignRight,
}
