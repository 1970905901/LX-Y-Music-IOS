import { memo, useMemo } from 'react'
import { View } from 'react-native'
import { usePlayMusicInfo } from '@/store/player/hook'
import { useSettingValue } from '@/store/setting/hook'
import { useI18n } from '@/lang'
import { getPlayQuality } from '@/core/music/utils'
import Badge, { type BadgeType } from '@/components/common/Badge'
import { createStyle } from '@/utils/tools'

// 平台英文缩写映射（用户指定：酷狗=KG，网易=WY，企鹅=QQ，酷我=KW，咪咕=MG）
const SOURCE_ABBR: Record<string, string> = {
  kg: 'KG',
  wy: 'WY',
  tx: 'QQ',
  kw: 'KW',
  mg: 'MG',
  qs: 'QS',
  local: '本地',
  xm: 'XM',
  bilibili: 'BILI',
  gitee: 'GITEE',
}

function getQualityBadge(quality: string, t: (k: string) => string): { label: string, type: BadgeType } {
  switch (quality) {
    case 'master':
      return { label: t('quality_lossless_master'), type: 'vip' }
    case 'atmos_plus':
      return { label: t('quality_lossless_atmos_plus'), type: 'secondary' }
    case 'atmos':
      return { label: t('quality_lossless_atmos'), type: 'secondary' }
    case 'hires':
      return { label: t('quality_lossless_24bit'), type: 'secondary' }
    case 'flac':
      return { label: t('quality_lossless'), type: 'sq' }
    case '320k':
      return { label: t('quality_high_quality'), type: 'hq' }
    case '192k':
      return { label: '192K', type: 'hq' }
    case '128k':
      return { label: '128K', type: 'tertiary' }
    default:
      return { label: quality.toUpperCase(), type: 'tertiary' }
  }
}

export default memo(() => {
  const t = useI18n()
  const playMusicInfo = usePlayMusicInfo()
  const playQuality = useSettingValue('player.playQuality')

  const musicInfo = playMusicInfo.musicInfo
    ? 'progress' in playMusicInfo.musicInfo
      ? playMusicInfo.musicInfo.metadata.musicInfo
      : playMusicInfo.musicInfo
    : null

  const abbr = musicInfo ? (SOURCE_ABBR[musicInfo.source] ?? musicInfo.source.toUpperCase()) : ''

  const qualityBadge = useMemo(() => {
    if (!musicInfo || musicInfo.source === 'local') return null
    try {
      const quality = getPlayQuality(playQuality as LX.Quality, musicInfo as LX.Music.MusicInfoOnline)
      return getQualityBadge(quality, t)
    } catch {
      return null
    }
  }, [musicInfo, playQuality, t])

  if (!musicInfo) return null

  return (
    <View style={styles.row}>
      <Badge type="tertiary">{abbr}</Badge>
      {qualityBadge ? <Badge type={qualityBadge.type}>{qualityBadge.label}</Badge> : null}
    </View>
  )
})

const styles = createStyle({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
})
