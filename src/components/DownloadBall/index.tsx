import { memo, useState, useEffect, useRef, useMemo } from 'react'
import { View, TouchableOpacity, Animated, Easing } from 'react-native'
import * as Progress from 'react-native-progress'
import { Icon } from '@/components/common/Icon'
import { useTheme } from '@/store/theme/hook'
import { useSafeAreaBottom } from '@/store/common/hook'
import { createStyle, clamp01 } from '@/utils/tools'
import { navigations } from '@/navigation'
import commonState from '@/store/common/state'

import DownloadTask = LX.Download.DownloadTask

export default memo(() => {
  const theme = useTheme()
  const safeAreaBottom = useSafeAreaBottom()
  const [isVisible, setIsVisible] = useState(false)
  const [activeTasks, setActiveTasks] = useState<Map<string, DownloadTask>>(new Map())
  const scaleAnim = useRef(new Animated.Value(0)).current
  // 目标可见性（与渲染用的 isVisible 分开）：事件回调与动画回调都读它，
  // 避免闭包里的陈旧值决定「要不要显示/要不要卸载」
  const visibleRef = useRef(false)

  const { totalProgress, isCompleted } = useMemo(() => {
    if (activeTasks.size === 0) return { totalProgress: 0, isCompleted: true }

    const allFinished = Array.from(activeTasks.values()).every(t => t.status === 'completed' || t.status === 'error')
    // 全部结束时直接画满圈：失败任务的 percent 可能停在 30%~40%，
    // 若继续取平均值会出现「勾已完成、圆环却只画了一小截」的矛盾状态。
    if (allFinished) return { totalProgress: 1, isCompleted: true }

    let currentProgress = 0
    for (const task of activeTasks.values()) {
      currentProgress += task.progress.percent
    }
    // 收敛到 [0,1]：原生下载回调的 percent 可能越界，react-native-progress
    // 的插值不接受越界输入，会导致圆环画过头。
    const totalProgress = clamp01(currentProgress / activeTasks.size)

    return { totalProgress, isCompleted: allFinished }
  }, [activeTasks])

  useEffect(() => {
    const handleTaskAdd = (task: LX.Download.DownloadTask) => {
      // 用 ref 而不是闭包里的 isVisible：effect 依赖 isVisible 会在每次显隐时重订阅，
      // 且「关闭动画进行中新增任务」时旧闭包认为仍可见 → 不重播入场动画，
      // 悬浮球会以 scale=0 隐藏着接收任务（用户看不到任何下载反馈）。
      if (!visibleRef.current) {
        visibleRef.current = true
        setIsVisible(true)
        Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true }).start()
      }
      setActiveTasks(prev => new Map(prev).set(task.id, task))
    }

    const handleProgressUpdate = ({ id, progress }: { id: string, progress: LX.Download.DownloadTask['progress'] }) => {
      setActiveTasks(prev => {
        if (!prev.has(id)) return prev
        const newTasks = new Map(prev)
        const task = newTasks.get(id)!
        newTasks.set(id, { ...task, progress })
        return newTasks
      })
    }

    const handleStatusUpdate = ({ id, status }: { id: string, status: LX.Download.DownloadTask['status'] }) => {
      setActiveTasks(prev => {
        if (!prev.has(id)) return prev
        const newTasks = new Map(prev)
        const task = newTasks.get(id)!
        newTasks.set(id, { ...task, status })
        return newTasks
      })
    }

    global.app_event.on('download_task_add', handleTaskAdd)
    global.app_event.on('download_progress_update', handleProgressUpdate)
    global.app_event.on('download_status_update', handleStatusUpdate)

    return () => {
      global.app_event.off('download_task_add', handleTaskAdd)
      global.app_event.off('download_progress_update', handleProgressUpdate)
      global.app_event.off('download_status_update', handleStatusUpdate)
    }
  }, [isVisible, scaleAnim])

  useEffect(() => {
    if (isVisible && isCompleted && activeTasks.size > 0) {
      Animated.sequence([
        Animated.timing(scaleAnim, { toValue: 1.2, duration: 200, useNativeDriver: true }),
        Animated.timing(scaleAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start()
    }
  }, [isCompleted, isVisible, activeTasks.size, scaleAnim])


  const handlePress = () => {
    // 先标记不可见：关闭动画期间新增的下载任务会重新触发入场动画，而不是被
    // 旧回调的「无条件 setVisible(false)」吞掉。
    visibleRef.current = false
    Animated.timing(scaleAnim, {
      toValue: 0,
      duration: 300,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
    }).start(({ finished }) => {
      // 动画被打断（期间又有新任务入场）时不卸载，交给那次入场收尾
      if (!finished || visibleRef.current) return
      setIsVisible(false)
      setActiveTasks(new Map())
    })
    navigations.pushDownloadManagerScreen(commonState.componentIds[commonState.componentIds.length - 1]?.id)
  }

  if (!isVisible) return null

  return (
    <Animated.View
      style={[
        styles.container,
        {
          // 悬浮在迷你播放器胶囊上方：胶囊 + tab 栏最高约到 safeAreaBottom + 150，
          // 原 bottom:70 会与播放器/tab 栏重叠
          bottom: 160 + safeAreaBottom,
        },
        { transform: [{ scale: scaleAnim }] },
      ]}
    >
      <TouchableOpacity onPress={handlePress}>
        <Progress.Circle
          size={50}
          progress={totalProgress}
          showsText={false}
          color={isCompleted ? (theme as unknown as Record<string, string>)['c-success'] : theme['c-primary']}
          unfilledColor="rgba(0,0,0,0.2)"
          borderWidth={0}
          thickness={3}
        />
        <View style={styles.iconContainer}>
          <Icon name={isCompleted ? 'checkbox-marked' : 'download-2'} size={22} color={isCompleted ? (theme as unknown as Record<string, string>)['c-success'] : theme['c-primary-font-active']} />
        </View>
      </TouchableOpacity>
    </Animated.View>
  )
})

const styles = createStyle({
  container: {
    position: 'absolute',
    right: 15,
    zIndex: 100,
  },
  iconContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
})
