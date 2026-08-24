import { useMemo, useCallback } from 'react'
import { toast } from '@/utils/tools'
import { MUSIC_TOGGLE_MODE_LIST, MUSIC_TOGGLE_MODE } from '@/config/constant'
import { useSettingValue } from '@/store/setting/hook'
import { useI18n } from '@/lang'
import { updateSetting } from '@/core/common'
import userState from '@/store/user/state'
import playerState from '@/store/player/state'
import wyApi from '@/utils/musicSdk/wy'
import { playOnlineList } from '@/core/list'
import settingState from '@/store/setting/state'

export const usePlayModeToggle = () => {
  const togglePlayMethod = useSettingValue('player.togglePlayMethod')
  const t = useI18n()

  const toggleNextPlayMode = useCallback(async () => {
    let list = [...MUSIC_TOGGLE_MODE_LIST] as any[]

    const playMusicInfo = playerState.playMusicInfo.musicInfo
    const musicInfo = playMusicInfo
      ? ('progress' in playMusicInfo ? playMusicInfo.metadata.musicInfo : playMusicInfo)
      : null
    const isWy = musicInfo?.source === 'wy'
    const songId = (musicInfo as any)?.meta?.songId || (musicInfo as any)?.songmid || musicInfo?.id
    const isLiked = userState.wy_liked_song_ids.has(String(songId))
    const playlistId = userState.wy_subscribed_playlists[0]?.id

    if (isWy && isLiked && playlistId) {
      list.splice(list.length - 1, 0, MUSIC_TOGGLE_MODE.heartbeat)
    }

    let index = list.indexOf(togglePlayMethod)
    if (++index >= list.length) index = 0
    const mode = list[index]
    updateSetting({ 'player.togglePlayMethod': mode })

    if (mode === MUSIC_TOGGLE_MODE.heartbeat) {
      toast(t('play_heartbeat') || '心动模式已开启')
      try {
        const cookie = settingState.setting['common.wy_cookie']
        const res = await wyApi.dailyRec.getHeartbeatModeList(cookie, playlistId, songId)
        if (res?.list?.length) {
          const mInfo = playMusicInfo
            ? ('progress' in playMusicInfo ? playMusicInfo.metadata.musicInfo : playMusicInfo)
            : musicInfo
          const heartbeatList = [mInfo, ...res.list].filter(Boolean) as any[]
          const isCurrent = mInfo?.id === musicInfo?.id
          playOnlineList('heartbeat', heartbeatList, 0, isCurrent)
        } else {
          toast('心动模式获取歌曲为空')
        }
      } catch {
        toast('心动模式加载失败')
      }
      return
    }

    const modeNameMap: Record<string, string> = {
      [MUSIC_TOGGLE_MODE.listLoop]: 'play_list_loop',
      [MUSIC_TOGGLE_MODE.random]: 'play_list_random',
      [MUSIC_TOGGLE_MODE.list]: 'play_list_order',
      [MUSIC_TOGGLE_MODE.singleLoop]: 'play_single_loop',
      [MUSIC_TOGGLE_MODE.heartbeat]: 'play_heartbeat',
    }
    toast(t(modeNameMap[mode] as any ?? 'play_single'))
  }, [togglePlayMethod, t])

  const playModeIcon = useMemo(() => {
    const iconMap: Record<string, string> = {
      [MUSIC_TOGGLE_MODE.listLoop]: 'list-loop',
      [MUSIC_TOGGLE_MODE.random]: 'list-random',
      [MUSIC_TOGGLE_MODE.list]: 'list-order',
      [MUSIC_TOGGLE_MODE.singleLoop]: 'single-loop',
      [MUSIC_TOGGLE_MODE.heartbeat]: 'svg:heartbeat',
    }
    return iconMap[togglePlayMethod] ?? 'single'
  }, [togglePlayMethod])

  return { toggleNextPlayMode, playModeIcon }
}
