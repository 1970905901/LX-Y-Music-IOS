import { useEffect, useState, useRef } from 'react'
import { AppState } from 'react-native'
import TrackPlayer, { State, Event } from 'react-native-track-player'
import {
  getNativeFlacBufferedPosition,
  getNativeFlacDuration,
  getNativeFlacPosition,
  isNativeFlacActive,
  onNativeFlacPlayerEvent,
} from './nativeFlac'
import { getUnifiedPlaybackState, onUnifiedPlayerEvent } from './engine'

/** Get current playback state and subsequent updatates  */
export const usePlaybackState = () => {
  const [state, setState] = useState(State.None)

  useEffect(() => {
    async function setPlayerState() {
      const unifiedState = await getUnifiedPlaybackState()
      switch (unifiedState) {
        case 'loading':
          setState(State.Connecting)
          break
        case 'buffering':
          setState(State.Buffering)
          break
        case 'playing':
          setState(State.Playing)
          break
        case 'paused':
          setState(State.Paused)
          break
        case 'stopped':
          setState(State.Stopped)
          break
        case 'idle':
        default:
          setState(State.None)
          break
      }
    }

    void setPlayerState()

    const removeUnifiedListener = onUnifiedPlayerEvent((event) => {
      if (event.type == 'ended') {
        setState(State.Stopped)
        return
      }
      if (event.type == 'error') {
        setState(State.Paused)
        return
      }
      if (event.type != 'state') return
      switch (event.state) {
        case 'loading':
          setState(State.Connecting)
          break
        case 'buffering':
          setState(State.Buffering)
          break
        case 'playing':
          setState(State.Playing)
          break
        case 'paused':
          setState(State.Paused)
          break
        case 'stopped':
          setState(State.Stopped)
          break
        case 'idle':
        default:
          setState(State.None)
          break
      }
    })

    return () => {
      removeUnifiedListener()
    }
  }, [])

  return state
}

/**
 * Attaches a handler to the given TrackPlayer events and performs cleanup on unmount
 * @param events - TrackPlayer events to subscribe to
 * @param handler - callback invoked when the event fires
 */
// export const useTrackPlayerEvents = (events, handler) => {
//   const savedHandler = useRef()

//   useEffect(() => {
//     savedHandler.current = handler
//   }, [handler])

//   useEffect(() => {
//     // eslint-disable-next-line no-undef
//     if (__DEV__) {
//       const allowedTypes = Object.values(Event)
//       const invalidTypes = events.filter(type => !allowedTypes.includes(type))
//       if (invalidTypes.length) {
//         console.warn(
//           'One or more of the events provided to useTrackPlayerEvents is ' +
//             `not a valid TrackPlayer event: ${invalidTypes.join("', '")}. ` +
//             'A list of available events can be found at ' +
//             'https://react-native-kit.github.io/react-native-track-player/documentation/#events',
//         )
//       }
//     }

//     const subs = events.map(event =>
//       TrackPlayer.addEventListener(event, payload => savedHandler.current({ ...payload, type: event })),
//     )

//     return () => subs.forEach(sub => sub.remove())
//   }, [events])
// }

const pollTrackPlayerStates = [
  State.Playing,
  State.Buffering,
] as const
/**
 * Poll for track progress for the given interval (in miliseconds)
 * @param updateInterval - ms interval
 */
export function useProgress(updateInterval: number) {
  const [state, setState] = useState({ position: 0, duration: 0, buffered: 0 })
  const playerState = usePlaybackState()
  const stateRef = useRef(state)
  const isUnmountedRef = useRef(true)
  useEffect(() => {
    isUnmountedRef.current = false
    return () => {
      isUnmountedRef.current = true
    }
  }, [])

  const getProgress = async() => {
    const [position, duration, buffered] = isNativeFlacActive()
      ? await Promise.all([
        getNativeFlacPosition(),
        getNativeFlacDuration(),
        getNativeFlacBufferedPosition(),
      ])
      : await Promise.all([
        TrackPlayer.getPosition(),
        TrackPlayer.getDuration(),
        TrackPlayer.getBufferedPosition(),
      ])
    // After the asynchronous code is executed, if the component has been uninstalled, do not update the status
    if (isUnmountedRef.current) return

    if (
      position === stateRef.current.position &&
      duration === stateRef.current.duration &&
      buffered === stateRef.current.buffered
    ) return

    const state = { position, duration, buffered }
    stateRef.current = state
    setState(state)
  }

  useEffect(() => {
    // @ts-expect-error
    if (!pollTrackPlayerStates.includes(playerState)) return

    // 省电门（2026-10-02）：这份进度轮询只在 App 前台有意义（后台没有可渲染的进度
    // UI）。退后台立刻停表——否则每秒 3 次原生桥往返 + setState 会持续唤醒 JS 线程。
    // 与 useBufferProgress、core/init/player/playProgress.ts 的门控保持一致。
    let appActive = AppState.currentState === 'active'
    let interval: ReturnType<typeof setInterval> | null = null
    const clearItv = () => {
      if (interval == null) return
      clearInterval(interval)
      interval = null
    }
    const startItv = () => {
      if (!appActive || interval) return
      interval = setInterval(() => { void getProgress() }, updateInterval || 1000)
    }
    void getProgress()
    startItv()
    const progressStateSub = AppState.addEventListener('change', (next) => {
      const nextActive = next === 'active'
      if (nextActive === appActive) return
      appActive = nextActive
      if (!appActive) {
        clearItv()
        return
      }
      void getProgress()
      startItv()
    })
    return () => {
      progressStateSub.remove()
      clearItv()
    }
  }, [playerState, updateInterval])

  return state
}

export function useBufferProgress() {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    let isUnmounted = false
    let preBuffered = 0
    let duration = 0
    let interval: ReturnType<typeof setInterval> | null = null
    // 省电门（2026-10-02）：缓冲进度条只在 App 前台可见。锁屏后台播放是本 App 的主
    // 场景，此时每秒一次的原生桥往返 + setState 只会白白唤醒 JS 线程（原生 FLAC 路径
    // 的 updateBuffer 会一直轮询到整首歌缓冲完），故退后台即停表、回前台补一次实测
    // 再按需重启（缓冲进度是实测值，不存在状态残留）。
    let appActive = AppState.currentState === 'active'
    // 「当前引擎状态是否需要轮询」：退后台只停表、保留该意愿，回前台据此恢复。
    let pollWanted = false

    const clearItv = () => {
      if (!interval) return
      clearInterval(interval)
      interval = null
    }
    const resetBuffer = () => {
      clearItv()
      pollWanted = false
      preBuffered = 0
      duration = 0
      if (!isUnmounted) setProgress(0)
    }
    const updateBuffer = async() => {
      const buffered = await (isNativeFlacActive()
        ? Promise.all([
          getNativeFlacBufferedPosition(),
          duration ? Promise.resolve(duration) : getNativeFlacDuration(),
        ]).then(([buffered, _duration]) => {
          duration = _duration
          return buffered
        })
        : (duration ? TrackPlayer.getBufferedPosition() : Promise.all([TrackPlayer.getBufferedPosition(), TrackPlayer.getDuration()]).then(([buffered, _duration]) => {
            duration = _duration
            return buffered
          })))
      // console.log('updateBuffer', buffered, duration, buffered > 0, buffered == duration)
      // After the asynchronous code is executed, if the component has been uninstalled, do not update the status
      if (buffered > 0 && buffered == duration) {
        clearItv()
        pollWanted = false
      }
      if (buffered == preBuffered || isUnmounted) return
      preBuffered = buffered
      setProgress(duration ? (buffered / duration) : 0)
    }

    // 需要轮询时才真正起表：后台（!appActive）或已在轮询中则不起第二份表
    const startItv = () => {
      if (!appActive || isUnmounted || interval) return
      interval = setInterval(updateBuffer, 1000)
    }

    const sub = TrackPlayer.addEventListener(Event.PlaybackState, data => {
      if (isNativeFlacActive()) return
      switch (data.state) {
        case State.None:
          // console.log('state', 'None')
          setProgress(0)
          break
        // case State.Ready:
        //   console.log('state', 'Ready')
        //   break
        // case State.Stopped:
        //   console.log('state', 'Stopped')
        //   break
        // case State.Paused:
        //   console.log('state', 'Paused')
        //   break
        // case State.Playing:
        //   console.log('state', 'Playing')
        //   break
        case State.Buffering:
          // console.log('state', 'Buffering')
          clearItv()
          duration = 0
          pollWanted = true
          startItv()
          void updateBuffer()
          break
        // case State.Connecting:
        //   console.log('state', 'Connecting')
        //   break
        // default:
        //   console.log('playback-state', data)
        //   break
      }
    })
    const removeNativeFlacListener = onNativeFlacPlayerEvent((event) => {
      switch (event.type) {
        case 'state':
          switch (event.state) {
            case 'loading':
            case 'buffering':
            case 'playing':
              clearItv()
              duration = event.duration ?? duration
              pollWanted = true
              startItv()
              void updateBuffer()
              break
            case 'paused':
              clearItv()
              pollWanted = false
              void updateBuffer()
              break
            case 'idle':
            case 'stopped':
              resetBuffer()
              break
          }
          break
        case 'ended':
          resetBuffer()
          break
        case 'error':
          clearItv()
          pollWanted = false
          void updateBuffer()
          break
      }
    })

    void updateBuffer()
    if (isNativeFlacActive()) void updateBuffer()
    void TrackPlayer.getState().then((state) => {
      if (!isNativeFlacActive() && state == State.Buffering) {
        pollWanted = true
        startItv()
      }
    })
    // 前后台切换：退后台立刻停表（后台零唤醒），回前台补一次实测并按需恢复轮询。
    // AppState 只在真正跨过前台/非前台边界时才改变 appActive（inactive 不触发停表：
    // 控制中心/来电横幅等短暂 inactive 后马上回 active，停表再起表反而更费）。
    const appStateSub = AppState.addEventListener('change', (next) => {
      const nextActive = next === 'active'
      if (nextActive === appActive) return
      appActive = nextActive
      if (!appActive) {
        clearItv()
        return
      }
      if (!pollWanted) return
      void updateBuffer()
      startItv()
    })
    return () => {
      isUnmounted = true
      appStateSub.remove()
      sub.remove()
      removeNativeFlacListener()
      clearItv()
    }
  }, [])

  return progress
}
