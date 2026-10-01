import { memo, useState, useEffect } from 'react'
import { StyleSheet, View } from 'react-native'

import SubTitle from '../../components/SubTitle'
import Button from '../../components/Button'
import CheckBox from '@/components/common/CheckBox'
import { toast, confirmDialog, resetNotificationPermissionCheck, resetIgnoringBatteryOptimizationCheck } from '@/utils/tools'
import { sizeFormate } from '@/utils'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import Text from '@/components/common/Text'
import { getAppCacheSize, clearAppCache, enforceCacheLimit } from '@/utils/nativeModules/cache'
import { clearLyric, clearMusicUrl, clearOtherSource, getMetaCache } from '@/utils/data'
import { clearSonglistDetailCache, getSonglistDetailCacheSummary } from '@/utils/data/songlistDetail'
import { clearPlaylistIndexCache, getPlaylistIndexCacheSummary } from '@/utils/data/playlistIndex'

// 缓存大小上限预设（MB，0 = 不限制）
const CACHE_LIMIT_OPTIONS = [
  { value: 0, label: '不限制' },
  { value: 128, label: '128MB' },
  { value: 256, label: '256MB' },
  { value: 512, label: '512MB' },
  { value: 1024, label: '1GB' },
  { value: 2048, label: '2GB' },
]

const CacheRow = ({ label, action, disabled, onPress }: {
  label: string
  action: string
  disabled?: boolean
  onPress: () => void
}) => (
  <View style={styles.row}>
    <Text size={12} style={styles.rowLabel} numberOfLines={2}>{label}</Text>
    <Button disabled={disabled} onPress={onPress}>{action}</Button>
  </View>
)

/**
 * 资源管理器：应用内**全部**可清理的缓存集中在这里，逐项统计 + 逐项清理。
 *
 * 1) 应用缓存（Caches/Tmp：播放缓存、封面/图片缓存等）
 * 2) 歌单缓存（本地保存的歌单整表，见 utils/data/songlistDetail）
 * 3) 歌曲 URL 缓存（storage）
 * 4) 歌词缓存（storage）
 * 5) 换源歌曲信息缓存（storage）
 *
 * 此前 3/4/5 分散在「其他设置 - 其他缓存管理」里，歌单缓存则完全没有入口；
 * 现已统一收口到本面板，「其他设置」不再保留缓存入口。
 */
export default memo(() => {
  const t = useI18n()
  const cacheLimit = useSettingValue('player.cacheLimit')
  const [appCacheSize, setAppCacheSize] = useState<string | null>(null)
  const [songlistCache, setSonglistCache] = useState<{ count: number, songCount: number, size: number } | null>(null)
  const [playlistIndexCache, setPlaylistIndexCache] = useState<{ count: number, playlistCount: number } | null>(null)
  const [metaCache, setMetaCache] = useState<{
    otherSourceKeys: string[]
    musicUrlKeys: string[]
    lyricKeys: string[]
  } | null>(null)
  const [appCleaning, setAppCleaning] = useState(false)
  const [songlistCleaning, setSonglistCleaning] = useState(false)
  const [playlistIndexCleaning, setPlaylistIndexCleaning] = useState(false)
  const [urlCleaning, setUrlCleaning] = useState(false)
  const [lyricCleaning, setLyricCleaning] = useState(false)
  const [otherSourceCleaning, setOtherSourceCleaning] = useState(false)

  const refreshAppCache = () => {
    // getAppCacheSize（iOS 原生 CacheModule）遍历 Caches + Tmp，已包含云盘播放缓存、
    // 播放器缓存、封面缓存等全部应用缓存，无需再叠加子目录统计。
    void getAppCacheSize().then((size) => {
      setAppCacheSize(sizeFormate(size))
    })
  }

  const refreshSonglistCache = () => {
    // 歌单缓存存在 AsyncStorage 里，不在 Caches/Tmp 目录，getAppCacheSize 统计不到
    void getSonglistDetailCacheSummary().then((summary) => {
      setSonglistCache({ count: summary.count, songCount: summary.songCount, size: summary.size })
    })
  }

  const refreshMetaCache = () => {
    void getMetaCache().then(setMetaCache)
  }

  const refreshPlaylistIndexCache = () => {
    // 「我的歌单」列表缓存（各平台一份，见 utils/data/playlistIndex）
    void getPlaylistIndexCacheSummary().then((summary) => {
      setPlaylistIndexCache({ count: summary.count, playlistCount: summary.playlistCount })
    })
  }

  const refreshAll = () => {
    refreshAppCache()
    refreshSonglistCache()
    refreshMetaCache()
    refreshPlaylistIndexCache()
  }

  const handleCleanAppCache = () => {
    if (appCacheSize == null) return
    void confirmDialog({
      message: t('confirm_tip'),
      confirmButtonText: t('list_remove_tip_button'),
    }).then((confirm) => {
      if (!confirm) return
      setAppCleaning(true)
      // clearAppCache 清理 Caches + Tmp 全部缓存；clearMusicUrl 清理播放链接缓存（storage），
      // 二者互补，无需再单独清理云盘/播放器子目录。
      void Promise.all([
        clearAppCache(),
        clearMusicUrl(),
        resetNotificationPermissionCheck(),
        resetIgnoringBatteryOptimizationCheck(),
      ])
        .then(() => { toast(t('setting_other_cache_clear_success_tip')) })
        .finally(() => {
          refreshAll()
          setAppCleaning(false)
        })
    })
  }

  const handleClearSonglistCache = () => {
    if (!songlistCache?.count) return
    void confirmDialog({
      message: '清空后再次进入歌单需要重新联网拉取全部歌曲，是否继续？',
      confirmButtonText: t('list_remove_tip_button'),
    }).then((confirm) => {
      if (!confirm) return
      setSonglistCleaning(true)
      void clearSonglistDetailCache()
        .then(() => { toast(t('setting_other_cache_clear_success_tip')) })
        .finally(() => {
          refreshSonglistCache()
          setSonglistCleaning(false)
        })
    })
  }

  const handleClearMusicUrlCache = () => {
    if (!metaCache?.musicUrlKeys.length) return
    setUrlCleaning(true)
    void clearMusicUrl(metaCache.musicUrlKeys)
      .then(() => { toast(t('setting_other_cache_clear_success_tip')) })
      .finally(() => {
        refreshMetaCache()
        setUrlCleaning(false)
      })
  }

  const handleClearPlaylistIndexCache = () => {
    if (!playlistIndexCache?.count) return
    void confirmDialog({
      message: '清空后「我的歌单」需要重新联网拉取列表，是否继续？',
      confirmButtonText: t('list_remove_tip_button'),
    }).then((confirm) => {
      if (!confirm) return
      setPlaylistIndexCleaning(true)
      void clearPlaylistIndexCache()
        .then(() => { toast(t('setting_other_cache_clear_success_tip')) })
        .finally(() => {
          refreshPlaylistIndexCache()
          setPlaylistIndexCleaning(false)
        })
    })
  }

  const handleClearLyricCache = () => {
    if (!metaCache?.lyricKeys.length) return
    setLyricCleaning(true)
    void clearLyric(metaCache.lyricKeys)
      .then(() => { toast(t('setting_other_cache_clear_success_tip')) })
      .finally(() => {
        refreshMetaCache()
        setLyricCleaning(false)
      })
  }

  const handleClearOtherSourceCache = () => {
    if (!metaCache?.otherSourceKeys.length) return
    setOtherSourceCleaning(true)
    void clearOtherSource(metaCache.otherSourceKeys)
      .then(() => { toast(t('setting_other_cache_clear_success_tip')) })
      .finally(() => {
        refreshMetaCache()
        setOtherSourceCleaning(false)
      })
  }

  const handleSetCacheLimit = (value: number) => {
    updateSetting({ 'player.cacheLimit': value })
  }

  useEffect(() => {
    refreshSonglistCache()
    refreshMetaCache()
    refreshPlaylistIndexCache()
  }, [])

  useEffect(() => {
    if (Number(cacheLimit) > 0) {
      void enforceCacheLimit(Number(cacheLimit) * 1024 * 1024).finally(() => { refreshAll() })
    } else {
      refreshAppCache()
    }
    // 只在缓存上限变化时执行一次；refreshAll 每次渲染都会重建，入了依赖会死循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheLimit])

  return (
    <SubTitle title={t('setting__other_resource_cache')}>
      <View style={styles.list}>
        <CacheRow
          label={appCacheSize == null
            ? t('setting_other_cache_getting')
            : t('setting_other_cache_size') + appCacheSize}
          action={t('setting_other_cache_clear_btn')}
          disabled={appCleaning}
          onPress={handleCleanAppCache}
        />
        <CacheRow
          label={songlistCache == null
            ? t('setting_other_cache_getting')
            : `歌单缓存：${songlistCache.count} 个歌单 · ${songlistCache.songCount} 首（约 ${sizeFormate(songlistCache.size)}）`}
          action="清空歌单缓存"
          disabled={songlistCleaning || !songlistCache?.count}
          onPress={handleClearSonglistCache}
        />
        <CacheRow
          label={playlistIndexCache == null
            ? t('setting_other_cache_getting')
            : `歌单列表缓存：${playlistIndexCache.count} 个平台 · ${playlistIndexCache.playlistCount} 个歌单`}
          action="清空歌单列表缓存"
          disabled={playlistIndexCleaning || !playlistIndexCache?.count}
          onPress={handleClearPlaylistIndexCache}
        />
        <CacheRow
          label={metaCache == null
            ? t('setting_other_cache_getting')
            : `${t('setting__other_music_url_label')}${metaCache.musicUrlKeys.length}`}
          action={t('setting__other_music_url_clear_btn')}
          disabled={urlCleaning || !metaCache?.musicUrlKeys.length}
          onPress={handleClearMusicUrlCache}
        />
        <CacheRow
          label={metaCache == null
            ? t('setting_other_cache_getting')
            : `${t('setting__other_lyric_raw_label')}${metaCache.lyricKeys.length}`}
          action={t('setting__other_lyric_raw_clear_btn')}
          disabled={lyricCleaning || !metaCache?.lyricKeys.length}
          onPress={handleClearLyricCache}
        />
        <CacheRow
          label={metaCache == null
            ? t('setting_other_cache_getting')
            : `${t('setting__other_other_source_label')}${metaCache.otherSourceKeys.length}`}
          action={t('setting__other_other_source_clear_btn')}
          disabled={otherSourceCleaning || !metaCache?.otherSourceKeys.length}
          onPress={handleClearOtherSourceCache}
        />
      </View>
      <Text size={12} style={styles.limitTitle}>缓存大小上限（超出后自动清理最旧的缓存）</Text>
      <View style={styles.limitList}>
        {CACHE_LIMIT_OPTIONS.map((opt) => (
          <CheckBox
            key={opt.value}
            marginRight={8}
            check={Number(cacheLimit) == opt.value}
            label={opt.label}
            onChange={() => { handleSetCacheLimit(opt.value) }}
            need
          />
        ))}
      </View>
    </SubTitle>
  )
})

const styles = StyleSheet.create({
  list: {
    gap: 4,
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowLabel: {
    flex: 1,
    marginRight: 8,
  },
  limitTitle: {
    marginBottom: 4,
  },
  limitList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 5,
  },
})
