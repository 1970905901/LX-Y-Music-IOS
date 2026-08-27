import {memo, useState, useRef, useMemo, useEffect, useCallback} from 'react'
import { View, AppState, Animated, PanResponder } from 'react-native'

import Header, { HEADER_HEIGHT } from './components/Header'
import Player from './Player'
import PagerView, { type PagerViewOnPageSelectedEvent } from 'react-native-pager-view'
import Pic from './Pic'
import Lyric from './Lyric'
import SongInfo from './components/SongInfo'
import MiniLyric from '../components/MiniLyric'
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

const LyricPage = ({ activeIndex, pagerHeight = 0 }: { activeIndex: number; pagerHeight?: number }) => {
  const initedRef = useRef(false)
  switch (activeIndex) {
    case 1:
      if (!initedRef.current) initedRef.current = true
      return <Lyric key="lyric" active={true} pagerHeight={pagerHeight} />
    default:
      return initedRef.current ? <Lyric key="lyric" active={false} pagerHeight={pagerHeight} /> : null
  }
}

const VerticalNew = memo(({ componentId }: { componentId: string }) => {
  const [pageIndex, setPageIndex] = useState(0)
  const pagerViewRef = useRef<PagerView>(null);
  const showLyricRef = useRef(false)
  const playlistRef = useRef<PlayerPlaylistType>(null)
  const { height: winHeight } = useWindowSize()
  // 直接测量 PagerView 的真实渲染高度（与歌词页可用高度一致），作为歌词
  // FlatList 的确定高度来源。PagerView 在普通 flex:1 容器里撑满，onLayout
  // 测得的高度比“PagerView 子页面”或“winHeight 估算”都可靠，避免歌词页
  // 因高度算小而在下方露出空白。
  const [pagerHeight, setPagerHeight] = useState(0)
  const isEnableSlideSwitchSong = useSettingValue('player.isEnableSlideSwitchSong')
  const miniLyricAlign = useSettingValue('playDetail.style.miniLyricAlign')

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
    if (showLyricRef.current) {
      screenkeepAwake()
    } else {
      screenUnkeepAwake()
    }
  }

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
                {/* 移植旧 UI（VerticalOld，参考版 93604d3e 封面正常）的 Pic 用法：
                    不传 maxCoverHeight，让 Pic 内部按 isNewUI（playDetail.style.newUI）自行计算
                    封面尺寸。此前传 maxCoverHeight 导致 Pic 走 maxCoverHeight 分支，
                    实测封面空白。 */}
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
            <LyricPage activeIndex={pageIndex} pagerHeight={pagerHeight} />
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
    overflow: 'hidden',
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
