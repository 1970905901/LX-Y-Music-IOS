// import { getPlayInfo } from '@/utils/data'
// import { log } from '@/utils/log'
import { init as musicSdkInit } from '@/utils/musicSdk'
import { getUserLists, setUserList } from '@/core/list'
import { setNavActiveId } from '../common'
import { getViewPrevState, cleanOneDriveDirtyData } from '@/utils/data'
import { bootLog } from '@/utils/bootLog'
import { getDislikeInfo, setDislikeInfo } from '@/core/dislikeList'
import { unlink } from '@/utils/fs'
import { TEMP_FILE_PATH } from '@/utils/tools'
import wyUserApi from '@/utils/musicSdk/wy/user'
import txUserApi from '@/utils/musicSdk/tx/user'
import { getPlaylistIndex } from '@/core/playlistIndex'
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
        // 「我的歌单」索引缓存优先：命中则不联网（离线也有列表），未命中才拉取并写缓存
        getPlaylistIndex('wy').then((result) => {
          bootLog(`Wy subscribed playlists ${result.fromCache ? 'loaded from cache' : 'inited'}.`)
        }).catch((err: any) => {
          bootLog(`Wy subscribed playlists init failed: ${err.message}`)
        })
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

    bootLog('Tx playlists init...')
    getPlaylistIndex('tx').then((result) => {
      bootLog(`Tx playlists ${result.fromCache ? 'loaded from cache' : 'inited'}.`)
    }).catch(err => {
      bootLog(`Tx playlists init failed: ${err.message}`)
    })
  }

  const kg_cookie = appSetting['common.kg_cookie']
  if (kg_cookie) {
    bootLog('Kg playlists init...')
    getPlaylistIndex('kg').then(async(result) => {
      bootLog(`Kg playlists ${result.fromCache ? 'loaded from cache' : 'inited'}.`)

      const favoritesPlaylist = (result.lists.created ?? []).find((p: any) => p.isFavorites)
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
  void unlink(TEMP_FILE_PATH)
}
