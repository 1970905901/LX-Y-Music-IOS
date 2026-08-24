import { LIST_IDS } from '@/config/constant'
import { markListsChanged } from '@/core/sync/webdavSync'
import { getPlayHistory, savePlayHistory } from '@/utils/data'

const MAX_HISTORY_SIZE = 5000
const MAX_HISTORY_TIME = 31 * 24 * 60 * 60 * 1000

type AddPlayHistoryParams = {
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

const addPlayHistoryInternal = async ({
  musicInfo,
  playTime,
  maxTime,
  listId,
}: AddPlayHistoryParams) => {
  const playedAt = Date.now()
  const day = getHistoryDay(playedAt)
  const history = await getPlayHistory()
  const existedIndex = history.findIndex(
    item => item.musicInfo.id === musicInfo.id && getHistoryDay(item.playedAt) === day
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

export const addPlayHistory = (params: AddPlayHistoryParams) => {
  const nextTask = addPlayHistoryQueue.catch(() => {}).then(() => addPlayHistoryInternal(params))
  addPlayHistoryQueue = nextTask.then(() => undefined, () => undefined)
  return nextTask
}

export const getPlayHistoryByRange = async (startTime: number, endTime: number) => {
  const history = await getPlayHistory()
  return history.filter(item => item.playedAt >= startTime && item.playedAt <= endTime)
}
