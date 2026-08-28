import {memo, useState, useRef, useMemo, useEffect, useCallback} from 'react'
import { View, AppState, Animated, PanResponder } from 'react-native'
import PagerView, { type PagerViewOnPageSelectedEvent } from 'react-native-pager-view'
import MiniLyric from '../components/MiniLyric'
import Pic from './Pic'
import Lyric from './Lyric'
import SongInfo from './components/SongInfo'
import Header, { HEADER_HEIGHT } from './components/Header'
import Player from './Player'
import { screenkeepAwake, screenUnkeepAwake } from '@/utils/nativeModules/utils'
import commonState, { type InitState as CommonState } from '@/store/common/state'
import { createStyle } from '@/utils/tools'
import { useWindowSize } from '@/utils/hooks'
import { useSettingValue } from '@/store/setting/hook'
import { playNext, playPrev } from '@/core/player/player'
import PlayerPlaylist, { type PlayerPlaylistType } from '@/components/player/PlayerPlaylist.tsx'
import { registerPager } from '@/utils/pagerScrollControl'
import { scaleSizeW } from '@/utils/pixelRatio'
import { COMPONENT_IDS } from '@/config/constant'

const LyricPage = ({ activeIndex, pagerHeight = 0, isComingLyric = false }: { activeIndex: number; pagerHeight?: number; isComingLyric?: boolean }) => {
  const initedRef = useRef(false)
  switch (activeIndex) {
    case 1:
      if (!initedRef.current) initedRef.current = true
      return <Lyric key="lyric" active={true} pagerHeight={pagerHeight} />
    default:
      // 用户在封面页时：如果正在从左往右滑向歌词页（isComingLyric=true），
      // 提前让歌词页开始定位高亮行；否则保持默认 active=false 抑制滚动。
      const isActive = initedRef.current && isComingLyric
      return initedRef.current ? <Lyric key="lyric" active={isActive} pagerHeight={pagerHeight} /> : null
  }
}

const VerticalNew = memo(({ componentId }: { componentId: string }) => {
  const [pageIndex, setPageIndex] = useState(0)
  // 正在从左往右滑向歌词页（从封面切到歌词），用于让 LyricPage 提前激活高亮定位
  const pagerViewRef = useRef<PagerView>(null);
  const showLyricRef = useRef(false)
  const playlistRef = useRef<PlayerPlaylistType>(null)
  const { height: winHeight } = useWindowSize()
  const [pagerHeight, setPagerHeight] = useState(0)
  const isEnableSlideSwitchSong = useSettingValue('player.isEnableSlideSwitchSong')
  const miniLyricAlign = useSettingValue('playDetail.style.miniLyricAlign')
  // 用 ref 追踪滑动方向，避免高频 onScroll 触发大量 setState 导致卡顿
  // 仅在首次变为 true 时触发一次 setState 通知子组件
  const isComingLyricRef = useRef(false)
  const [, setForceUpdate] = useState(0)

  const slideOffset = useRef(new Animated.Value(0)).current;
  const maxSlide = winHeight * 0.5;
  const slideThreshold = winHeight * 0.12;
  const velocityThreshold = 800;
  const isAnimating = useRef(false);
  const [isProgressDragging, setIsProgressDragging] = useState(false);

  const isEnableSlideSwitchSongRef = useRef(isEnableSlideSwitchSong)
  const pageIndexRef = useRef(pageIndex)
  useEffect(() => {
    isEnableSlideSwitchSongRef.current = isEnableSlideSwitchSong
  }, [isEnableSlideSwitchSong])
  useEffect(() => {
    pageIndexRef.current = pageIndex
  }, [pageIndex])

  const resetSlide = useCallback(() => {
    Animated.spring(slideOffset, {
      toValue: 0,
      tension: 65,
      friction: 11,
      useNativeDriver: true,
    }).start();
  }, [slideOffset]);

  const animateOut = useCallback((direction: 'up' | 'down') => {
    if (isAnimating.current) return
    isAnimating.current = true
    const toValue = direction === 'up' ? -winHeight : winHeight;
    Animated.timing(slideOffset, {
      toValue,
      duration: 300,
      useNativeDriver: true,
    }).start(() => {
      slideOffset.setValue(0);
      isAnimating.current = false
    });
  }, [slideOffset, winHeight]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        // 仅捕获“明显垂直”的拖拽用于切歌；水平分量不能占主导，
        // 否则会吞掉 PagerView 的横向切页手势，导致切页卡顿/不跟手。
        // 只用 capture 阶段判断，阈值放宽到 dy > dx*2（强垂直意图），
        // 普通带轻微上下抖动的横向滑页不会被拦截（这是此前切页不顺滑的主因）。
        onMoveShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponderCapture: (_, gestureState) => {
          if (!isEnableSlideSwitchSongRef.current || pageIndexRef.current !== 0) return false;
          const { dy, dx } = gestureState;
          return Math.abs(dy) > 20 && Math.abs(dy) > Math.abs(dx) * 2;
        },
        onPanResponderMove: (_, gestureState) => {
          const { dy } = gestureState;
          const dampening = dy > 0 ? 0.6 : 0.8;
          const dampedDy = dy * dampening;
          const clampedDy = Math.max(-maxSlide, Math.min(maxSlide, dampedDy));
          slideOffset.setValue(clampedDy);
        },
        onPanResponderRelease: (_, gestureState) => {
          const { dy, vy } = gestureState;
          const shouldPlayNext = dy < -slideThreshold || vy < -velocityThreshold / 1000;
          const shouldPlayPrev = dy > slideThreshold || vy > velocityThreshold / 1000;

          if (shouldPlayNext) {
            animateOut('up');
            setTimeout(() => void playNext(), 150);
          } else if (shouldPlayPrev) {
            animateOut('down');
            setTimeout(() => void playPrev(), 150);
          } else {
            resetSlide();
          }
        },
        onPanResponderTerminate: () => {
          resetSlide();
        },
        onPanResponderTerminationRequest: () => {
          return false;
        },
      }),
    [maxSlide, slideThreshold, velocityThreshold, slideOffset, animateOut, resetSlide]
  );

  const slideStyle = useMemo(() => {
    const scale = slideOffset.interpolate({
      inputRange: [-maxSlide, 0, maxSlide],
      outputRange: [0.92, 1, 0.92],
    });
    const opacity = slideOffset.interpolate({
      inputRange: [-maxSlide, -maxSlide * 0.3, 0, maxSlide * 0.3, maxSlide],
      outputRange: [0.7, 0.9, 1, 0.9, 0.7],
    });
    return {
      transform: [
        { translateY: slideOffset },
        { scale },
      ],
      opacity,
    };
  }, [slideOffset, maxSlide]);

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
  const handlePageScroll = useCallback((e: { nativeEvent: { offset: number; position: number } }) => {
    const coming = e.nativeEvent.position === 0 && e.nativeEvent.offset > 0
    if (coming && !isComingLyricRef.current) {
      isComingLyricRef.current = true
      setForceUpdate(v => v + 1)
    }
  }, [])

  const handleSwitchToLyricPage = useCallback(() => {
    pagerViewRef.current?.setPage(1);
  }, []);

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
    const handleProgressDragState = (dragging: boolean) => setIsProgressDragging(dragging)
    global.app_event.on('progressDragState', handleProgressDragState)

    // 将 PagerView ref 注册给同步手势锁，供进度条拖动时立即禁用原生横滑
    registerPager(pagerViewRef)

    global.state_event.on('componentIdsUpdated', handleComponentIdsChange)
    global.app_event.on('switchToLyricPage', handleSwitchToLyricPage)
    global.app_event.on('showPlaylist', () => { playlistRef.current?.show() })

    return () => {
      global.state_event.off('componentIdsUpdated', handleComponentIdsChange)
      global.app_event.off('progressDragState', handleProgressDragState)
      registerPager(null)
      global.app_event.off('switchToLyricPage', handleSwitchToLyricPage)
      global.app_event.off('showPlaylist', () => { playlistRef.current?.show() })
      appstateListener.remove()
      screenUnkeepAwake()
    }
  }, [])

  const containerPaddingH = useMemo(() => scaleSizeW(10), [])

  return (
    <>
      <Header pageIndex={pageIndex} />
      <View style={styles.container}>
        <PagerView
          onPageSelected={onPageSelected}
          onScroll={handlePageScroll}
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
            <Animated.View collapsable={false} {...panResponder.panHandlers} style={[styles.picPageContainerNew, slideStyle, { paddingTop: containerPaddingH }]}>
              <View style={styles.picContainer}>
                {/* 移植用户实测正常的 v20260826（e58d1ab1）VerticalOld 封面用法：
                    不传 maxCoverHeight，让 Pic 内部按 isNewUI=false 计算封面尺寸
                    （50% 高/85% 宽，container 居中布局）——这正是参考版封面正常的分支。 */}
                <Pic componentId={componentId} />
              </View>
              <View style={[styles.infoContainer, { paddingHorizontal: containerPaddingH, marginTop: containerPaddingH }]}>
                <SongInfo />
                <MiniLyric
                  onPress={handleSwitchToLyricPage}
                  style={[styles.miniLyricContainerNew, miniLyricAlignStyles[miniLyricAlign as keyof typeof miniLyricAlignStyles]]}
                />
              </View>
            </Animated.View>
          </View>
          <View collapsable={false} style={{ flex: 1, width: '100%', height: '100%' }}>
            <LyricPage activeIndex={pageIndex} pagerHeight={pagerHeight} isComingLyric={isComingLyricRef.current} />
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
    // 注意：此处绝不能加 overflow: 'hidden'——该视图同时挂载 slideStyle 的
    // transform/opacity（原生驱动动画）。iOS 上 clipsToBounds 与 transform
    // 叠加在同一图层时，会把带 transform 的后代（旋转封面）剔除出渲染树，
    // 导致封面空白（SongInfo 等无 transform 的子视图不受影响）。
    // 旧 UI（v20260826 实测封面正常）的 picPageContainerOld 就没有 overflow。
    // 滑动切歌动画的裁切由 PagerView 原生页面裁切兜底，无需在此裁剪。
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
