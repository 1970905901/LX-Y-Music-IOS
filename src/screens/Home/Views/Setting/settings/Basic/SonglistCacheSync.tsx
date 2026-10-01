import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
import SubTitle from '../../components/SubTitle'
import Button from '../../components/Button'
import Text from '@/components/common/Text'
import { confirmDialog, createStyle, toast } from '@/utils/tools'
import { sizeFormate } from '@/utils'
import music from '@/utils/musicSdk'
import { getListDetailAll } from '@/core/songlist'
import { getPlaylistIndex, getCachedPlaylistIndexCount } from '@/core/playlistIndex'
import {
  getSonglistDetailCache,
  getSonglistDetailCacheSummary,
  saveSonglistDetailCache,
  type SonglistDetailCacheSummaryItem,
} from '@/utils/data/songlistDetail'

interface PlatformGroup {
  source: LX.OnlineSource
  name: string
  items: SonglistDetailCacheSummaryItem[]
  songCount: number
  incompleteCount: number
}

const sourceName = (source: LX.OnlineSource) =>
  music.sources.find(item => item.id === source)?.name ?? source

/**
 * 歌单缓存「更新同步」。
 *
 * 每个平台单独一行：显示该平台已缓存的歌单数 / 歌曲数，并提供「刷新同步」，
 * 逐页重拉该平台的全部已缓存歌单并覆盖本地缓存；底部「全部同步」一次同步所有平台。
 *
 * 为什么需要手动同步：歌单详情改为本地整表缓存后，进入歌单直接读缓存（不再每次
 * 重新拉取），平台侧新增/下架歌曲不会自动反映，所以需要主动触发一次全量同步。
 */
export default memo(() => {
  const [items, setItems] = useState<SonglistDetailCacheSummaryItem[]>([])
  const [stats, setStats] = useState({ count: 0, songCount: 0, incompleteCount: 0, size: 0 })
  // null = 未同步；'all' = 全部同步中；否则为正在同步的平台
  const [syncingSource, setSyncingSource] = useState<LX.OnlineSource | 'all' | null>(null)
  const [progress, setProgress] = useState(0)
  const [progressTotal, setProgressTotal] = useState(0)
  // 各平台「我的歌单」列表缓存条数
  const [indexCounts, setIndexCounts] = useState<Record<string, number>>({})
  const syncing = syncingSource != null

  const refreshStats = useCallback(() => {
    void getSonglistDetailCacheSummary().then(async(summary) => {
      setItems(summary.items)
      setStats({
        count: summary.count,
        songCount: summary.songCount,
        incompleteCount: summary.incompleteCount,
        size: summary.size,
      })
      const sources = [...new Set(summary.items.map(item => item.source))]
      const entries = await Promise.all(
        sources.map(async source => [source, await getCachedPlaylistIndexCount(source)] as const),
      )
      setIndexCounts(Object.fromEntries(entries))
    })
  }, [])

  useEffect(() => {
    refreshStats()
  }, [refreshStats])

  // 按平台分组：平台设置里每个平台一行，各自可单独刷新同步
  const groups = useMemo(() => {
    const map = new Map<LX.OnlineSource, PlatformGroup>()
    for (const item of items) {
      let group = map.get(item.source)
      if (!group) {
        group = {
          source: item.source,
          name: sourceName(item.source),
          items: [],
          songCount: 0,
          incompleteCount: 0,
        }
        map.set(item.source, group)
      }
      group.items.push(item)
      group.songCount += item.songCount
      if (!item.complete) group.incompleteCount++
    }
    return [...map.values()].sort((a, b) => b.items.length - a.items.length)
  }, [items])

  const runSync = useCallback(async(
    targets: SonglistDetailCacheSummaryItem[],
    tag: LX.OnlineSource | 'all',
  ) => {
    setSyncingSource(tag)
    setProgress(0)
    setProgressTotal(targets.length)
    const targetSources = [...new Set(targets.map(item => item.source))]
    // 第一步：刷新各平台的「我的歌单」列表本身（新建/收藏/删除的歌单会在这步出现）
    const indexFailed: LX.OnlineSource[] = []
    for (const source of targetSources) {
      try {
        await getPlaylistIndex(source, { force: true })
      } catch (err) {
        console.log('[SonglistCacheSync] 歌单列表刷新失败', source, (err as Error)?.message)
        indexFailed.push(source)
      }
    }
    // 第二步：逐张重拉已缓存歌单的全部歌曲并覆盖缓存
    let success = 0
    for (let i = 0; i < targets.length; i++) {
      const item = targets[i]
      setProgress(i + 1)
      try {
        const list = await getListDetailAll(item.source, item.id, true)
        if (!list.length) continue
        const cached = await getSonglistDetailCache(item.source, item.id)
        await saveSonglistDetailCache({
          source: item.source,
          id: item.id,
          name: item.name,
          total: list.length,
          complete: true,
          updatedAt: Date.now(),
          info: cached?.info ?? { name: item.name },
          list,
        })
        success++
      } catch (err) {
        console.log('[SonglistCacheSync] 同步失败', item.source, item.id, (err as Error)?.message)
      }
    }
    toast(indexFailed.length
      ? `同步完成：歌单内容 ${success}/${targets.length}；${indexFailed.map(s => sourceName(s)).join('、')} 的「我的歌单」刷新失败（未登录或 Cookie 失效）`
      : `同步完成：歌单列表已更新，歌单内容 ${success}/${targets.length}`)
    setSyncingSource(null)
    refreshStats()
  }, [refreshStats])

  const confirmAndSync = useCallback((targets: SonglistDetailCacheSummaryItem[], tag: LX.OnlineSource | 'all', label: string) => {
    if (syncing || !targets.length) return
    void confirmDialog({
      message: `将重新拉取${label}的全部歌曲，共 ${targets.length} 个歌单，歌单较大时耗时较长，是否继续？`,
      confirmButtonText: '开始同步',
    }).then((confirm) => {
      if (!confirm) return
      void runSync(targets, tag)
    })
  }, [syncing, runSync])

  return (
    <SubTitle title="歌单缓存与更新同步">
      <View style={styles.info}>
        <Text size={12}>
          已缓存 {stats.count} 个歌单 · {stats.songCount} 首歌曲（约 {sizeFormate(stats.size)}）
        </Text>
        {stats.incompleteCount
          ? <Text size={12}>有 {stats.incompleteCount} 个歌单尚未拉全，进入对应歌单会自动补全</Text>
          : null}
        <Text size={12}>
          「我的歌单」列表与歌单歌曲都已本地保存：进入页面直接读缓存，不再每次重新拉取。
          「刷新同步」会先更新该平台的「我的歌单」列表，再重拉已缓存歌单的全部歌曲。
        </Text>
      </View>
      {groups.length
        ? groups.map((group) => (
          <View key={group.source} style={styles.row}>
            <Text size={12} style={styles.rowLabel} numberOfLines={2}>
              {group.name}：我的歌单 {indexCounts[group.source] ?? 0} 个 · 已缓存 {group.items.length} 张（{group.songCount} 首）
              {group.incompleteCount ? `（${group.incompleteCount} 个未拉全）` : ''}
            </Text>
            <Button
              disabled={syncing}
              onPress={() => { confirmAndSync(group.items, group.source, group.name) }}
            >
              {syncingSource === group.source ? `同步中 ${progress}/${progressTotal}` : '刷新同步'}
            </Button>
          </View>
        ))
        : <Text size={12} style={styles.empty}>暂无歌单缓存，进入任意歌单后会自动缓存</Text>}
      <View style={styles.btnRow}>
        <Button
          disabled={syncing || !items.length}
          onPress={() => { confirmAndSync(items, 'all', '全部平台') }}
        >
          {syncingSource === 'all' ? `同步中 ${progress}/${progressTotal}` : '全部同步'}
        </Button>
        <Button disabled={syncing} onPress={refreshStats}>
          刷新统计
        </Button>
      </View>
    </SubTitle>
  )
})

const styles = createStyle({
  info: {
    marginBottom: 5,
    gap: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  rowLabel: {
    flex: 1,
    marginRight: 8,
  },
  empty: {
    marginBottom: 4,
  },
  btnRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 4,
  },
})
