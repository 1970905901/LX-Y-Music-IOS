import {memo, useState, useRef, useMemo, useEffect, useCallback} from 'react'
import { View, AppState, Animated, PanResponder } from 'react-native'

import Header from './components/Header'
import Player from './Player'
import PagerView, { type PagerViewOnPageSelectedEvent } from 'react-native-pager-view'
import Pic from './Pic'
import Lyric from './Lyric'
import MiniLyric from '../components/MiniLyric'
import { screenkeepAwake, screenUnkeepAwake } from '@/utils/nativeModules/utils'
import commonState, { type InitState as CommonState } from '@/store/common/state'
import { COMPONENT_IDS } from '@/config/constant'
import { createStyle } from '@/utils/tools'
import { useWindowSize } from '@/utils/hooks'
import { useSettingValue } from '@/store/setting/hook'
import { playNext, playPrev } from '@/core/player/player'
import { registerPager } from '@/utils/pagerScrollControl'
import PlayerPlaylist, { type PlayerPlaylistType } from '@/components/player/PlayerPlaylist.tsx'
import VerticalNew from './VerticalNew'

  const LyricPage = ({ activeIndex }: { activeIndex: number }) => {
    const initedRef = useRef(false)
    switch (activeIndex) {
      case 1:
        if (!initedRef.current) initedRef.current = true
        return <Lyric active={true} />
      default:
        return initedRef.current ? <Lyric active={false} /> : null
    }
  }

const VerticalOld = memo(({ componentId }: { componentId: string }) => {
  const [pageIndex, setPageIndex] = useState(0)
  const pagerViewRef = useRef<PagerView>(null);
  const showLyricRef = useRef(false)
  const playlistRef = useRef<PlayerPlaylistType>(null)
  const { height: winHeight } = useWindowSize()
  const isEnableSlideSwitchSong = useSettingValue('player.isEnableSlideSwitchSong')
  const miniLyricAlign = useSettingValue('playDetail.style.miniLyricAlign')
  const playDetailSwipeSwitch = useSettingValue('common.playDetailSwipeSwitch')

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
        onMoveShouldSetPanResponder: (_, gestureState) => {
          if (!isEnableSlideSwitchSongRef.current || pageIndexRef.current !== 0) return false;
          const { dy, dx } = gestureState;
          return Math.abs(dy) > 15 && Math.abs(dy) > Math.abs(dx) * 1.2;
        },
        onMoveShouldSetPanResponderCapture: (_, gestureState) => {
          if (!isEnableSlideSwitchSongRef.current || pageIndexRef.current !== 0) return false;
          const { dy, dx } = gestureState;
          return Math.abs(dy) > 20 && Math.abs(dy) > Math.abs(dx) * 1.5;
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

  return (
    <>
      <Header isNewUI={false} pageIndex={pageIndex} />
      <View style={styles.container} {...panResponder.panHandlers}>
        <PagerView
          onPageSelected={onPageSelected}
          style={styles.pagerView}
          ref={pagerViewRef}
          scrollEnabled={!isProgressDragging && playDetailSwipeSwitch}
        >
          <View collapsable={false} style={styles.pageContainer}>
            <Animated.View collapsable={false} style={[styles.picPageContainerOld, slideStyle]}>
              <Pic componentId={componentId} />
              <MiniLyric
                onPress={handleSwitchToLyricPage}
                style={[styles.miniLyricContainer, miniLyricAlignStyles[miniLyricAlign]]}
              />
            </Animated.View>
          </View>
          <View collapsable={false}>
            <LyricPage activeIndex={pageIndex} />
          </View>
        </PagerView>
        <Player componentId={componentId} isNewUI={false} />
      </View>
      <PlayerPlaylist ref={playlistRef} />
    </>
  )
})

export default memo(({ componentId }: { componentId: string }) => {
  const isNewUI = useSettingValue('playDetail.style.newUI')
  return isNewUI
    ? <VerticalNew componentId={componentId} />
    : <VerticalOld componentId={componentId} />
})

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
    position: 'relative',
  },
  picPageContainerOld: {
    flex: 1,
    justifyContent: 'center',
    position: 'relative',
  },
  miniLyricContainer: {
    position: 'absolute',
    bottom: '6%',
    left: 0,
    right: 0,
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
