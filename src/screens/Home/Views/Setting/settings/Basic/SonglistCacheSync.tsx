import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
import SubTitle from '../../components/SubTitle'
import Button from '../../components/Button'
import Text from '@/components/common/Text'
import { confirmDialog, createStyle, toast } from '@/utils/tools'
import music from '@/utils/musicSdk'
import { getPlaylistIndex, getCachedPlaylistIndexCount } from '@/core/playlistIndex'
import { getSonglistDetailCacheSummary } from '@/utils/data/songlistDetail'
import settingState from '@/store/setting/state'

/**
 * cookie 歌单（我的歌单）缓存与手动同步。
 *
 * 规则（用户定义）：
 * - 登录酷狗 / QQ / 网易后，对应平台的「我的歌单」**第一次点开时刷新并缓存**，
 *   之后打开直接用缓存；
 * - 只有在这里点「刷新歌单」才会重新拉取并重新写缓存；
 * - 推荐页推荐歌单 / 排行榜 / 歌单页列表**不缓存**，故不在此面板出现。
 */

const COOKIE_SOURCES = [
  { source: 'wy', settingKey: 'common.wy_cookie' },
  { source: 'tx', settingKey: 'common.tx_cookie' },
  { source: 'kg', settingKey: 'common.kg_cookie' },
] as const

const sourceName = (source: string) =>
  music.sources.find(item => item.id === source)?.name ?? source

interface Row {
  source: LX.OnlineSource
  cookieKey: string
  loggedIn: boolean
  playlistCount: number
  songCount: number
}

export default memo(() => {
  const [rows, setRows] = useState<Row[]>([])
  const [syncingSource, setSyncingSource] = useState<LX.OnlineSource | 'all' | null>(null)
  const syncing = syncingSource != null

  const refreshStats = useCallback(async() => {
    // 不请求体积：避免为每条缓存（MB 级）做整串序列化（省 CPU / 省电）
    const summary = await getSonglistDetailCacheSummary({ withSize: false }).catch(() => null)
    const items = summary?.items ?? []
    const next: Row[] = []
    for (const { source, settingKey } of COOKIE_SOURCES) {
      const cookie = (settingState.setting[settingKey] as string | undefined) ?? ''
      const list = items.filter(item => item.source === source)
      next.push({
        source: source as LX.OnlineSource,
        cookieKey: settingKey,
        loggedIn: !!cookie,
        playlistCount: list.length,
        songCount: list.reduce((sum, item) => sum + item.songCount, 0),
      })
    }
    setRows(next)
  }, [])

  useEffect(() => {
    void refreshStats()
  }, [refreshStats])

  const cachedInfo = useMemo(() => rows.filter(row => row.playlistCount > 0), [rows])

  /** 刷新某个平台的 cookie 歌单（索引）：重新拉取并重新写缓存 */
  const refreshOne = useCallback(async(source: LX.OnlineSource) => {
    await getPlaylistIndex(source, { force: true })
    await getCachedPlaylistIndexCount(source)
  }, [])

  const handleRefresh = useCallback((source: LX.OnlineSource) => {
    if (syncing) return
    setSyncingSource(source)
    void refreshOne(source)
      .then(() => { toast(`已刷新：${sourceName(source)} 歌单`) })
      .catch((err: Error) => { toast(`刷新失败：${err?.message ?? '未登录或 Cookie 失效'}`) })
      .finally(() => {
        setSyncingSource(null)
        void refreshStats()
      })
  }, [syncing, refreshOne, refreshStats])

  const handleRefreshAll = useCallback(() => {
    if (syncing) return
    const targets = rows.filter(row => row.loggedIn)
    if (!targets.length) {
      toast('请先登录酷狗 / QQ / 网易平台')
      return
    }
    void confirmDialog({
      message: `将依次刷新 ${targets.length} 个平台的「我的歌单」并重新缓存，是否继续？`,
      confirmButtonText: '开始同步',
    }).then((confirm) => {
      if (!confirm) return
      setSyncingSource('all')
      void (async() => {
        let ok = 0
        for (const row of targets) {
          try {
            await refreshOne(row.source)
            ok++
          } catch (err) {
            console.log('[SonglistCacheSync] 刷新失败', row.source, (err as Error)?.message)
          }
        }
        toast(`全部同步完成：成功 ${ok}/${targets.length} 个平台`)
      })().finally(() => {
        setSyncingSource(null)
        void refreshStats()
      })
    })
  }, [syncing, rows, refreshOne, refreshStats])

  return (
    <SubTitle title="cookie 歌单缓存与同步">
      <View style={styles.info}>
        <Text size={12}>
          登录平台后，「我的歌单」第一次点开时刷新并缓存，之后打开直接读缓存；
          需要更新时点下面的「刷新歌单」。
        </Text>
        {cachedInfo.length
          ? <Text size={12}>已缓存 {cachedInfo.reduce((n, row) => n + row.playlistCount, 0)} 张歌单 · {cachedInfo.reduce((n, row) => n + row.songCount, 0)} 首</Text>
          : null}
      </View>
      {rows.map(row => (
        <View key={row.source} style={styles.row}>
          <Text size={12} style={styles.rowLabel} numberOfLines={2}>
            {sourceName(row.source)}歌单（cookie）：{row.loggedIn
              ? `${row.playlistCount} 张 · ${row.songCount} 首`
              : '未登录'}
          </Text>
          <Button
            disabled={syncing || !row.loggedIn}
            onPress={() => { handleRefresh(row.source) }}
          >
            {syncingSource === row.source ? '刷新中...' : '刷新歌单'}
          </Button>
        </View>
      ))}
      <View style={styles.btnRow}>
        <Button disabled={syncing} onPress={handleRefreshAll}>
          {syncingSource === 'all' ? '同步中...' : '全部同步'}
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
  btnRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 4,
  },
})
