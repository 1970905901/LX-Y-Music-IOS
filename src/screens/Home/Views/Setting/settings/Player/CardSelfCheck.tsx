import { memo, useState } from 'react'
import { Alert, View } from 'react-native'

import Button from '../../components/Button'
import Text from '@/components/common/Text'
import { useI18n } from '@/lang'
import { createStyle, toast } from '@/utils/tools'
import { getCardDiagnostics, reassertNowPlayingSession } from '@/utils/nativeModules/nowPlaying'
import { reloadConfig } from '@/plugins/player'

/**
 * 媒体卡片自检 / 修复（控制中心 / 灵动岛卡片失效时用）。
 *
 * 为什么需要它：卡片失效（按钮按了没反应、进度条不走）时，仅凭 App 内表现无法区分
 * 是哪一层断了 —— 系统没把按键送到 App（系统侧）还是 App 侧发布/会话断了。这里一次性
 * 把两层的关键计数摊开：
 *   · 「收到遥控命令」：切到控制中心按一下播放/暂停，回来看是否 +1 —— 不涨 = 系统侧；
 *   · 「最近发布 / 卡片速率 / 显示态」：App 侧发布链是否正常、卡片是否被系统判成暂停；
 * 并就地提供两级修复（都不需要重启 App）：
 *   · 重建会话：非破坏性重绑（激活音频会话 + 重挂遥控命令目标 + 重发卡片信息）；
 *   · 重建播放器：播放器级重建（等价于「重启 App」的那一步），作为最后手段。
 */
export default memo(() => {
  const t = useI18n()
  const [busy, setBusy] = useState(false)

  const describeState = (state: number) => {
    switch (state) {
      case 1: return 'playing'
      case 2: return 'paused'
      case 3: return 'stopped'
      default: return 'unknown'
    }
  }
  const describeAge = (ms: number) => (ms < 0 ? t('setting_play_card_self_check_never') : `${(ms / 1000).toFixed(1)}s`)

  const run = async() => {
    if (busy) return
    setBusy(true)
    try {
      const d = await getCardDiagnostics()
      if (!d) {
        toast(t('setting_play_card_self_check_unavailable'))
        return
      }
      const lines = [
        `${t('setting_play_card_self_check_version')}: ${d.appVersion || '?'}`,
        `${t('setting_play_card_self_check_engine')}: ${d.nativeFlacOwnsSession ? 'nativeFlac' : 'AVPlayer'} / playing=${d.enginePlaying ? 'Y' : 'N'}`,
        `${t('setting_play_card_self_check_card')}: info=${d.infoCount} state=${describeState(d.internalState)} rate=${d.rate}`,
        `${t('setting_play_card_self_check_publish')}: ${describeAge(d.sincePublishMs)} / session=${d.sessionActive ? 'Y' : 'N'} / recvEvents=${d.receivingRemoteEvents ? 'Y' : 'N'}`,
        `${t('setting_play_card_self_check_recv')}: ${d.recvCount} (${describeAge(d.sinceRecvMs)}) / reassert=${d.reassertCount}`,
        '',
        t('setting_play_card_self_check_hint'),
      ]
      Alert.alert(t('setting_play_card_self_check'), lines.join('\n'), [
        {
          text: t('setting_play_card_self_check_reassert'),
          onPress: () => {
            void reassertNowPlayingSession().then(() => { toast(t('setting_play_card_self_check_reassert_done')) }).catch(() => {})
          },
        },
        {
          text: t('setting_play_card_self_check_rebuild_player'),
          onPress: () => {
            void reloadConfig().then(() => { toast(t('setting_play_card_self_check_rebuild_player_done')) }).catch(() => {})
          },
        },
        { text: t('setting_play_card_self_check_close'), style: 'cancel' },
      ])
    } catch (error) {
      // 桥调用失败必须可见（与 nowPlaying.ts 的 reportNowPlayingBridgeFailure 纪律一致），
      // 不能静默吞掉变成「点了没反应」
      console.warn('###LXNowPlaying### CardSelfCheck failed:', error instanceof Error ? error.message : String(error))
      toast(t('setting_play_card_self_check_unavailable'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.row}>
      <Text size={12} style={styles.label} numberOfLines={3}>{t('setting_play_card_self_check_desc')}</Text>
      <Button disabled={busy} onPress={() => { void run() }}>{t('setting_play_card_self_check_btn')}</Button>
    </View>
  )
})

const styles = createStyle({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 10,
    paddingTop: 8,
    paddingBottom: 8,
  },
  label: {
    flex: 1,
    marginRight: 10,
  },
})
