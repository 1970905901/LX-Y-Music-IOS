import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, ScrollView, TouchableOpacity, View } from 'react-native'
import Text from '@/components/common/Text'
import Image from '@/components/common/Image'
import { Icon } from '@/components/common/Icon'
import { SvgIcon } from '@/components/common/SvgIcon'
import Modal, { type ModalType } from '@/components/common/Modal'
import { createStyle, toast } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useSafeAreaBottom } from '@/store/common/hook'
import { designRadius, designSpacing } from '@/theme/DesignTokens'
import {
  RECOGNIZE_MAX_SECONDS,
  cancelRecognition,
  finishRecognition,
  startRecognition,
  type RecognizeMatch,
} from '@/core/recognize'
import { handlePlay } from '@/components/OnlineList/listAction'
import { pause } from '@/core/player/player'
import playerState from '@/store/player/state'

type RecognizeStatus = 'idle' | 'recording' | 'recognizing'

/**
 * 听歌识曲按钮（放在搜索框最右侧）。
 *
 * 交互：点一下开始录音（最多 10s，与 EchoMusic 一致）→ 再点一下可提前结束 →
 * 自动识别并弹出候选结果。整条链路（录音/签名/请求/结果）见
 * src/core/recognize 与 src/utils/musicSdk/kg/audioMatch.ts。
 */
export default () => {
  const theme = useTheme()
  const safeAreaBottom = useSafeAreaBottom()
  const modalRef = useRef<ModalType>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const statusRef = useRef<RecognizeStatus>('idle')
  const activeRef = useRef(true)
  const startedAtRef = useRef(0)

  const [status, setStatus] = useState<RecognizeStatus>('idle')
  const [remaining, setRemaining] = useState(RECOGNIZE_MAX_SECONDS)
  const [matches, setMatches] = useState<RecognizeMatch[]>([])

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => {
    activeRef.current = true
    return () => {
      activeRef.current = false
      clearTimer()
      // 页面卸载时若还在录音，静默中止，避免麦克风长时间占用
      if (statusRef.current === 'recording') void cancelRecognition()
    }
  }, [clearTimer])

  const failTips = useCallback((error?: string) => {
    switch (error) {
      case 'denied':
        toast('需要麦克风权限，请在系统设置里允许后重试')
        break
      case 'unsupported':
        toast('当前平台暂不支持听歌识曲')
        break
      case 'too-short':
        toast('录音太短了，再听一会儿')
        break
      default:
        toast('识别失败，请稍后再试')
    }
  }, [])

  // 结束录音并识别
  const finish = useCallback(async() => {
    if (statusRef.current !== 'recording') return
    statusRef.current = 'recognizing'
    setStatus('recognizing')
    clearTimer()
    try {
      const list = await finishRecognition()
      if (!activeRef.current) return
      if (list.length) {
        setMatches(list)
        modalRef.current?.setVisible(true)
      } else {
        toast('没听出这首歌，靠近声源再试试')
      }
    } catch (error: any) {
      if (activeRef.current) failTips(error?.message)
    } finally {
      if (activeRef.current) {
        statusRef.current = 'idle'
        setStatus('idle')
      }
    }
  }, [clearTimer, failTips])

  const start = useCallback(async() => {
    if (statusRef.current !== 'idle') return
    // 先占位，避免权限弹窗期间重复点击
    statusRef.current = 'recognizing'
    setStatus('recognizing')
    // 录音要接管 AVAudioSession（切到 Record 分类），先把正在播放的歌曲暂停：
    // 否则会话切换会把播放引擎打断在半途，留下「UI 还在播放、实际没声音」的僵态。
    if (playerState.isPlay) {
      try {
        await pause()
      } catch {
        // 暂停失败不阻断识别
      }
    }
    const result = await startRecognition()
    if (!activeRef.current) {
      if (result.ok) void cancelRecognition()
      return
    }
    if (!result.ok) {
      statusRef.current = 'idle'
      setStatus('idle')
      failTips(result.error)
      return
    }
    startedAtRef.current = Date.now()
    setRemaining(RECOGNIZE_MAX_SECONDS)
    statusRef.current = 'recording'
    setStatus('recording')
    clearTimer()
    timerRef.current = setInterval(() => {
      const elapsed = (Date.now() - startedAtRef.current) / 1000
      const left = Math.max(0, Math.ceil(RECOGNIZE_MAX_SECONDS - elapsed))
      setRemaining(left)
      if (elapsed >= RECOGNIZE_MAX_SECONDS) void finish()
    }, 200)
  }, [clearTimer, failTips, finish])

  const handlePress = useCallback(() => {
    if (statusRef.current === 'idle') {
      void start()
    } else if (statusRef.current === 'recording') {
      void finish()
    }
  }, [finish, start])

  const handleSelect = useCallback(async(match: RecognizeMatch) => {
    modalRef.current?.setVisible(false)
    await handlePlay(match.musicInfo)
  }, [])

  const handleRetry = useCallback(() => {
    modalRef.current?.setVisible(false)
    statusRef.current = 'idle'
    setStatus('idle')
    void start()
  }, [start])

  return (
    <>
      <TouchableOpacity
        style={styles.button}
        onPress={handlePress}
        activeOpacity={0.7}
        disabled={status === 'recognizing'}
      >
        {status === 'recognizing' ? (
          <ActivityIndicator size="small" color={theme['c-primary']} />
        ) : status === 'recording' ? (
          <Text size={13} color={theme['c-primary']} style={styles.countdown}>{remaining}s</Text>
        ) : (
          <SvgIcon name="mic" size={17} color={theme['c-font-label']} />
        )}
      </TouchableOpacity>

      <Modal ref={modalRef} bgColor="rgba(0,0,0,0.35)">
        {/* 底部结果面板：iPad 横屏限宽并水平居中（本项目弹层约定） */}
        <View style={styles.sheetWrap} pointerEvents="box-none">
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: theme['c-primary-light-900-alpha-300'],
                borderColor: theme['c-border-background'],
                paddingBottom: Math.max(safeAreaBottom, designSpacing.md),
              },
            ]}
          >
            <View style={styles.sheetHeader}>
              <Text size={16} color={theme['c-font']}>识别结果</Text>
              <TouchableOpacity onPress={() => modalRef.current?.setVisible(false)} style={styles.closeBtn}>
                <Icon name="close" size={16} color={theme['c-font-label']} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.list} keyboardShouldPersistTaps="always">
              {matches.slice(0, 5).map((match, index) => (
                <TouchableOpacity
                  key={`${match.musicInfo.id}_${index}`}
                  style={styles.row}
                  activeOpacity={0.7}
                  onPress={() => { void handleSelect(match) }}
                >
                  <Image url={match.musicInfo.meta.picUrl} style={styles.cover} />
                  <View style={styles.rowText}>
                    <Text size={15} color={theme['c-font']} numberOfLines={1}>{match.musicInfo.name}</Text>
                    <Text size={12} color={theme['c-font-label']} numberOfLines={1}>
                      {[match.musicInfo.singer, match.musicInfo.meta.albumName].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <Text size={12} color={theme['c-font-label']} style={styles.confidence}>
                    {Math.round(match.confidence * 100)}%
                  </Text>
                  <Icon name="play" size={16} color={theme['c-primary']} />
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.retry} onPress={handleRetry} activeOpacity={0.7}>
              <Text size={14} color={theme['c-primary']}>重新识别</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  )
}

const styles = createStyle({
  button: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingRight: designSpacing.xs,
  },
  countdown: {
    fontVariant: ['tabular-nums'],
  },
  sheetWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
  },
  sheet: {
    width: '100%',
    maxWidth: 560,
    paddingTop: designSpacing.sm,
    borderTopLeftRadius: designRadius.lg,
    borderTopRightRadius: designRadius.lg,
    borderWidth: 1,
    borderBottomWidth: 0,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: designSpacing.lg,
    paddingBottom: designSpacing.sm,
  },
  closeBtn: {
    padding: designSpacing.xs,
  },
  list: {
    flexGrow: 0,
    flexShrink: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: designSpacing.lg,
    paddingVertical: designSpacing.sm,
  },
  cover: {
    width: 44,
    height: 44,
    borderRadius: designRadius.md,
  },
  rowText: {
    flexGrow: 1,
    flexShrink: 1,
    paddingHorizontal: designSpacing.sm,
  },
  confidence: {
    paddingRight: designSpacing.sm,
  },
  retry: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 44,
    marginTop: designSpacing.xs,
  },
})
