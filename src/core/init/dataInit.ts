// import { getPlayInfo } from '@/utils/data'
// import { log } from '@/utils/log'
import { init as musicSdkInit } from '@/utils/musicSdk'
import { getUserLists, setUserList } from '@/core/list'
import { setNavActiveId, forceSyncNavActiveId } from '../common'
import { getViewPrevState, cleanOneDriveDirtyData } from '@/utils/data'
import { bootLog } from '@/utils/bootLog'
import { getDislikeInfo, setDislikeInfo } from '@/core/dislikeList'
import { unlink } from '@/utils/fs'
import { TEMP_FILE_PATH } from '@/utils/tools'
import wyUserApi from '@/utils/musicSdk/wy/user'
import txUserApi from '@/utils/musicSdk/tx/user'
import { getUserPlaylists as getKgUserPlaylists } from '@/utils/musicSdk/kg/utils/api'
import {
  setWyFollowedArtists,
  setWyLikedSongs,
  setWySubscribedAlbums,
  setWyUid,
  setTxLikedSongs,
  setKgLikedSongs,
} from '@/store/user/action.ts'
import { getDownloadTasks } from '@/utils/data/download.ts'
import downloadActions from '@/store/download/action'
import { withTimeout } from '@/utils/withTimeout'

const withInitTimeout = async <T,>(promise: Promise<T>, label: string, fallback: T): Promise<T> =>
  withTimeout(promise, label, fallback)

export default async(appSetting: LX.AppSetting) => {
  void musicSdkInit()
  bootLog('User list init...')
  const userLists = await withInitTimeout(getUserLists(), 'User list', [])
  bootLog('User list data loaded.')
  setUserList(userLists)
  bootLog('User list state set.')
  const dislikeInfo = await withInitTimeout(getDislikeInfo(), 'Dislike info', {
    names: new Set<string>(),
    musicNames: new Set<string>(),
    singerNames: new Set<string>(),
    rules: '',
  })
  bootLog('Dislike info data loaded.')
  setDislikeInfo(dislikeInfo)
  bootLog('User list inited.')

  void cleanOneDriveDirtyData().then(() => { bootLog('OneDrive dirty data cleaned.') }).catch((err) => { bootLog(`OneDrive dirty data clean failed: ${err?.message ?? err}`) })


  bootLog('Download tasks init...')
  const savedTasks = await withInitTimeout(getDownloadTasks(), 'Download tasks', [])
  bootLog('Download task data loaded.')
  downloadActions.setTasks(savedTasks)
  bootLog('Download tasks inited.')

  const wy_cookie = appSetting['common.wy_cookie']
  if (wy_cookie) {
    bootLog('Wy like list init...')
    wyUserApi.getUid(wy_cookie)
      .then((uid: any) => {
        setWyUid(uid)
        wyUserApi.getLikedSongList(uid, wy_cookie).then((ids: any) => {
          setWyLikedSongs(ids)
          bootLog('Wy like list inited.')
        })
        wyUserApi.getAllSublist().then(artists => {
          setWyFollowedArtists(artists)
          bootLog('Wy followed artists inited.')
        }).catch(err => {
          bootLog(`Wy followed artists init failed: ${err.message}`)
        })
        wyUserApi.getAllSubAlbumList().then(albums => {
          setWySubscribedAlbums(albums)
          bootLog('Wy liked albums inited.')
        }).catch(err => {
          bootLog(`Wy liked albums init failed: ${err.message}`)
        })
        // 「我的歌单」按用户规则推迟：**第一次点开该平台歌单时才拉取并缓存**
        // （不在启动时预拉，故这里不再调用 getPlaylistIndex）
      })
      .catch((err: any) => {
        bootLog(`Wy like list init failed: ${err.message}`)
      })
  }

  const tx_cookie = appSetting['common.tx_cookie']
  if (tx_cookie) {
    bootLog('Tx like list init...')
    ;(async() => {
      try {
        const allLikedMids: string[] = []
        let page = 1
        const pageSize = 100
        let hasMore = true

        while (hasMore) {
          const result = await txUserApi.getFavSongs(page, pageSize)
          if (result.list && result.list.length > 0) {
            allLikedMids.push(...result.list.map((song: any) => song.mid))
          }
          hasMore = result.hasMore
          page++
        }

        setTxLikedSongs(allLikedMids)
        bootLog(`Tx like list inited. (${allLikedMids.length} songs)`)
      } catch (err: any) {
        bootLog(`Tx like list init failed: ${err.message}`)
      }
    })()

    // TX「我的歌单」同样推迟到第一次点开时拉取并缓存（见上）
  }

  const kg_cookie = appSetting['common.kg_cookie']
  if (kg_cookie) {
    bootLog('Kg like list init...')
    // kg 的「红心歌曲」需要「我喜欢的音乐」歌单 id：这里直接查一次（**不写**歌单索引缓存），
    // 歌单列表本身按规则推迟到「第一次点开酷狗歌单」时拉取并缓存。
    getKgUserPlaylists(kg_cookie).then(async(result) => {
      const createdList = result?.success && result.data ? (result.data.createdList ?? []) : []
      const favoritesPlaylist = createdList.find((p: any) => p.isFavorites)
      if (favoritesPlaylist) {
        bootLog('Kg like list init...')
        try {
          const { getPlaylistSongs } = await import('@/utils/musicSdk/kg/utils/api')
          const allLikedIds: string[] = []
          let page = 1
          const pageSize = 500
          let hasMore = true

          while (hasMore) {
            const songsResult = await getPlaylistSongs(kg_cookie, favoritesPlaylist.id, page, pageSize)
            if (songsResult.success && songsResult.data?.list?.length) {
              for (const song of songsResult.data.list) {
                const songId = song.hash || song.songmid || song.audio_id
                if (songId) {
                  allLikedIds.push(String(songId))
                }
              }
              hasMore = songsResult.data.list.length === pageSize
              page++
            } else {
              hasMore = false
            }
          }

          setKgLikedSongs(allLikedIds)
          bootLog(`Kg like list inited. (${allLikedIds.length} songs)`)
        } catch (err: any) {
          bootLog(`Kg like list init failed: ${err.message}`)
        }
      }
    }).catch(err => {
      bootLog(`Kg playlists init failed: ${err.message}`)
    })
  }

  setNavActiveId((await getViewPrevState()).id)
  // 退出恢复：只改 navActiveId 不够——Home 可能早于本步骤挂载（首帧 initialPage 落在
  // 默认的推荐页），且 setNavActiveId 在同一值时会短路不发事件。这里强制重播一次，
  // 让 PagerView 校正到恢复出来的 Tab（否则表现为「退出再进只显示推荐主界面」）。
  forceSyncNavActiveId()
  void unlink(TEMP_FILE_PATH)
}
