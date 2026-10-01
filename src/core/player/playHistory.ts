import { LIST_IDS } from '@/config/constant'
import { markListsChanged } from '@/core/sync/webdavSync'
import { getPlayHistory, savePlayHistory } from '@/utils/data'

const MAX_HISTORY_SIZE = 5000
const MAX_HISTORY_TIME = 31 * 24 * 60 * 60 * 1000

interface AddPlayHistoryParams {
  musicInfo: LX.Music.MusicInfo
  playTime: number
  maxTime: number
  listId: string | null
}

let addPlayHistoryQueue = Promise.resolve()

const getHistoryDay = (time: number) => {
  const date = new Date(time)
  const y = date.getFullYear()
  const m = `${date.getMonth() + 1}`.padStart(2, '0')
  const d = `${date.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${d}`
}

export const resolvePlayHistorySource = (listId: string | null): LX.Player.PlayHistorySource => {
  if (!listId) return 'List'

  const sourceListId = listId
  if (sourceListId === 'search') return 'Search'
  if (sourceListId === LIST_IDS.DEFAULT) return 'Search'
  if (sourceListId.startsWith('dailyrec_') || sourceListId === 'heartbeat' || sourceListId === 'similar_songs_list') return 'Rec'
  if (sourceListId.startsWith('artist_detail_') || sourceListId.startsWith('album_')) return 'Detail'
  return 'List'
}

const addPlayHistoryInternal = async({
  musicInfo,
  playTime,
  maxTime,
  listId,
}: AddPlayHistoryParams) => {
  const playedAt = Date.now()
  const day = getHistoryDay(playedAt)
  const history = await getPlayHistory()
  const existedIndex = history.findIndex(
    item => item.musicInfo.id === musicInfo.id && getHistoryDay(item.playedAt) === day,
  )

  const source = resolvePlayHistorySource(listId)
  const item: LX.Player.PlayHistoryItem = {
    id: `${musicInfo.id}_${playedAt}`,
    musicInfo,
    playedAt,
    playTime,
    maxTime,
    listId,
    source,
  }

  if (existedIndex > -1) history.splice(existedIndex, 1)
  history.unshift(item)
  for (let index = history.length - 1; index > -1; index--) {
    if (history[index].playedAt < playedAt - MAX_HISTORY_TIME) history.splice(index, 1)
  }
  if (history.length > MAX_HISTORY_SIZE) history.splice(MAX_HISTORY_SIZE)

  await savePlayHistory(history)
  global.app_event.playHistoryUpdated()
  markListsChanged()
}

export const addPlayHistory = async(params: AddPlayHistoryParams) => {
  const nextTask = addPlayHistoryQueue.catch(() => {}).then(async() => addPlayHistoryInternal(params))
  addPlayHistoryQueue = nextTask.then(() => undefined, () => undefined)
  return nextTask
}

export const getPlayHistoryByRange = async(startTime: number, endTime: number) => {
  const history = await getPlayHistory()
  return history.filter(item => item.playedAt >= startTime && item.playedAt <= endTime)
}

/**
 * 从播放历史移除条目。
 *
 * - entryIds：历史条目 id（`${musicInfo.id}_${playedAt}`），精确删一条；
 * - musicIds：歌曲 id，用于「按歌移除」——同一首歌在多天各有一条历史。
 *
 * 播放历史此前**没有删除接口**，列表菜单里的「移除」点了没有任何反应
 * （OnlineList 的 handleRemoveMusic 只处理平台歌单 id）。删完发
 * playHistoryUpdated，播放历史页据此自动刷新。
 */
export const removePlayHistoryItems = async({
  entryIds = [],
  musicIds = [],
}: {
  entryIds?: string[]
  musicIds?: string[]
}): Promise<number> => {
  if (!entryIds.length && !musicIds.length) return 0
  const history = await getPlayHistory()
  const entrySet = new Set(entryIds)
  const musicSet = new Set(musicIds)
  const next = history.filter(item => !entrySet.has(item.id) && !musicSet.has(item.musicInfo.id))
  const removed = history.length - next.length
  if (!removed) return 0
  await savePlayHistory(next)
  global.app_event.playHistoryUpdated()
  return removed
}

/** 清空全部播放历史 */
export const clearPlayHistory = async() => {
  const history = await getPlayHistory()
  if (!history.length) return 0
  await savePlayHistory([])
  global.app_event.playHistoryUpdated()
  return history.length
}
