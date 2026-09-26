import { LIST_IDS } from '@/config/constant'
import { addListMusics, setTempList } from '@/core/list'
import { playList, playNext } from '@/core/player/player'
import { addTempPlayList } from '@/core/player/tempPlayList'
import settingState from '@/store/setting/state'
import { getListMusicSync } from '@/utils/listManage'
import { confirmDialog, openUrl, toast } from '@/utils/tools'
import { addDislikeInfo, hasDislike } from '@/core/dislikeList'
import playerState from '@/store/player/state'
import musicSdk from '@/utils/musicSdk'
import { toOldMusicInfo } from '@/utils'
import { httpFetch } from '@/utils/request'
import musicDetailApi from '@/utils/musicSdk/wy/musicDetail'
import userState from '@/store/user/state'
import { weapi } from '@/utils/musicSdk/wy/utils/crypto.js'
import { addWyLikedSong, removeWyLikedSong, addTxLikedSong, removeTxLikedSong, addKgLikedSong, removeKgLikedSong } from '@/store/user/action.ts'
import { navigations } from '@/navigation'
import wyApi from '@/utils/musicSdk/wy/user'
import txApi from '@/utils/musicSdk/tx/user'
import { log } from '@/utils/log'
import { addSongToPlaylist, removeSongsFromPlaylist } from '@/utils/musicSdk/kg/utils/api'

export const handleShowAlbumDetail = (componentId: string, musicInfo: LX.Music.MusicInfoOnline) => {
  const albumId = musicInfo.meta.albumId
  if (!albumId) {
    toast('专辑信息不存在')
    return
  }
  const albumInfo = {
    id: albumId,
    mid: (musicInfo.meta as any).albumMid || albumId,
    name: musicInfo.meta.albumName,
    author: musicInfo.singer,
    img: musicInfo.meta.picUrl,
    source: musicInfo.source,
  }
  navigations.pushAlbumDetailScreen(componentId, albumInfo)
}

export const handleShowArtistDetail = async(componentId: string, musicInfo: LX.Music.MusicInfoOnline) => {
  log.info('[handleShowArtistDetail] === 开始查看歌手详情 ===', {
    source: musicInfo.source,
    name: musicInfo.name,
    singer: musicInfo.singer,
    hasArtists: !!musicInfo.artists,
    artistsLength: musicInfo.artists?.length || 0,
    artists: musicInfo.artists,
    meta: musicInfo.meta,
    timestamp: new Date().toISOString(),
  })

  if (musicInfo.source !== 'wy' && musicInfo.source !== 'tx' && musicInfo.source !== 'kg') {
    log.info('[handleShowArtistDetail] 暂不支持该音源', { source: musicInfo.source })
    toast('暂不支持该音源查看歌手详情')
    return
  }

  let artists = musicInfo.artists

  if (!artists?.length && musicInfo.singer) {
    log.info('[handleShowArtistDetail] artists 为空，尝试通过搜索API获取', {
      singer: musicInfo.singer,
      source: musicInfo.source,
    })

    try {
      const singerNames = musicInfo.singer.split(/[、,，&/]/).map(s => s.trim()).filter(Boolean)
      const foundArtists: Array<{ id: string | number, mid?: string, name: string, picUrl?: string }> = []

      for (const singerName of singerNames) {
        const searchResult = await musicSdk[musicInfo.source].musicSearch.searchSinger(singerName, 1, 1)
        if (searchResult?.list?.length) {
          const firstResult = searchResult.list[0]
          const resultName = firstResult.name.toLowerCase()
          const searchName = singerName.toLowerCase()
          if (resultName === searchName || resultName.includes(searchName) || searchName.includes(resultName)) {
            foundArtists.push({
              id: firstResult.id,
              mid: firstResult.mid,
              name: firstResult.name,
              picUrl: firstResult.picUrl,
            })
          }
        }
      }

      if (foundArtists.length === 0 && musicInfo.name) {
        log.info('[handleShowArtistDetail] 歌手名搜索未匹配，尝试通过歌曲名搜索获取歌手', {
          songName: musicInfo.name,
          source: musicInfo.source,
        })
        try {
          // 兜底搜索必须与当前歌曲同源：歌曲来自哪个平台，就用哪个平台的接口找歌手
          if (musicInfo.source === 'kg') {
            const response = httpFetch(
              `https://songsearch.kugou.com/song_search_v2?keyword=${encodeURIComponent(musicInfo.name)}&page=1&pagesize=10&userid=0&platform=WebFilter&filter=2&iscorrection=1&area_code=1`,
            )
            const { body } = await response.promise
            const bodyData = body as { data?: { lists?: Array<{ SongName?: string, Singers?: Array<{ id?: string | number, name?: string }> }> } }
            if (bodyData?.data?.lists?.length) {
              for (const song of bodyData.data.lists) {
                const songName = (song.SongName || '').toLowerCase()
                const targetName = musicInfo.name.toLowerCase()
                if (songName.includes(targetName) || targetName.includes(songName)) {
                  if (song.Singers && song.Singers.length > 0) {
                    for (const s of song.Singers) {
                      if (s.id && s.name) {
                        const sName = s.name.toLowerCase()
                        for (const sn of singerNames) {
                          if (sName.includes(sn.toLowerCase()) || sn.toLowerCase().includes(sName)) {
                            foundArtists.push({ id: s.id, name: s.name })
                            break
                          }
                        }
                        if (foundArtists.length > 0) break
                      }
                    }
                    if (foundArtists.length > 0) break
                  }
                }
              }
            }
          } else {
            // wy / tx：歌曲搜索结果自带 artists（含歌手 id/mid），直接用当前平台接口提取
            const searchResult = await musicSdk[musicInfo.source].musicSearch.search(musicInfo.name, 1, 10)
            const list = searchResult?.list ?? []
            for (const song of list) {
              const songName = (song.name || '').toLowerCase()
              const targetName = musicInfo.name.toLowerCase()
              if (!songName || !(songName.includes(targetName) || targetName.includes(songName))) continue
              const songArtists: Array<{ id?: string | number, mid?: string, name?: string }> = song.artists || []
              for (const s of songArtists) {
                if (s.id && s.name) {
                  const sName = s.name.toLowerCase()
                  for (const sn of singerNames) {
                    if (sName.includes(sn.toLowerCase()) || sn.toLowerCase().includes(sName)) {
                      foundArtists.push({ id: s.id, mid: s.mid, name: s.name })
                      break
                    }
                  }
                }
                if (foundArtists.length > 0) break
              }
              if (foundArtists.length > 0) break
            }
          }
        } catch (e: any) {
          log.error('[handleShowArtistDetail] 歌曲名搜索出错', { error: e.message, source: musicInfo.source })
        }
      }

      if (foundArtists.length > 0) {
        artists = foundArtists
        log.info('[handleShowArtistDetail] 通过搜索API成功获取歌手信息', {
          artists,
        })
      }
    } catch (error: any) {
      log.error('[handleShowArtistDetail] 搜索API出错', { error: error.message })
    }
  }

  if (!artists?.length) {
    log.warn('[handleShowArtistDetail] 未找到歌手信息', {
      name: musicInfo.name,
      singer: musicInfo.singer,
      source: musicInfo.source,
    })
    toast('未找到该歌曲的歌手信息')
    return
  }

  const onSelect = (artist: { id: string | number, mid?: string, name: string, picUrl?: string }) => {
    log.info('[handleShowArtistDetail] 选中歌手，跳转歌手详情页', {
      artistId: artist.id,
      artistMid: artist.mid,
      artistName: artist.name,
      source: musicInfo.source,
    })
    navigations.pushArtistDetailScreen(componentId, { id: String(artist.id), mid: artist.mid, name: artist.name, picUrl: artist.picUrl ?? '', source: musicInfo.source })
  }

  if (artists.length > 1) {
    log.info('[handleShowArtistDetail] 多个歌手，显示选择器', { artists })
    global.app_event.showArtistSelector(artists, onSelect)
  } else if (artists.length === 1) {
    log.info('[handleShowArtistDetail] 单个歌手，直接跳转', { artist: artists[0] })
    onSelect(artists[0])
  }
}

export const handleLikeMusic = async(musicInfo: LX.Music.MusicInfoOnline) => {
  const cookie = settingState.setting['common.wy_cookie']
  if (!cookie) {
    toast('请先设置网易云 Cookie')
    return
  }
  if (musicInfo.source !== 'wy') {
    toast('非网易云音源无法执行此操作')
    return
  }

  const songId = musicInfo.meta.songId
  const isLiked = userState.wy_liked_song_ids.has(String(songId))
  const like = !isLiked

  try {
    await wyApi.likeSong(songId, like)
    if (like) {
      toast('喜欢成功')
      addWyLikedSong(songId)
    } else {
      toast('取消喜欢成功')
      removeWyLikedSong(songId)
    }
  } catch (error: any) {
    toast(`操作失败: ${error.message}`)
  }
}

export const handleTxLikeMusic = async(musicInfo: LX.Music.MusicInfoOnline) => {
  const cookie = settingState.setting['common.tx_cookie']
  if (!cookie) {
    toast('请先设置QQ音乐 Cookie')
    return
  }
  if (musicInfo.source !== 'tx') {
    toast('非QQ音源无法执行此操作')
    return
  }

  const rawSongMid = (musicInfo.meta as any).songmid || (musicInfo.meta as any).strMediaMid || musicInfo.id
  const songMid = typeof rawSongMid === 'string' && rawSongMid.startsWith('tx_') ? rawSongMid.slice(3) : rawSongMid
  const songId = (musicInfo.meta as any).id

  const isNumericId = songId && /^\d+$/.test(String(songId))

  const likeKey = isNumericId ? String(songId) : songMid

  const songIdentifier = isNumericId ? String(songId) : songMid

  const isLiked = userState.tx_liked_song_ids.has(likeKey)
  const like = !isLiked

  try {
    await txApi.likeSong(songIdentifier, like)
    if (like) {
      toast('喜欢成功')
      addTxLikedSong(likeKey)
    } else {
      toast('取消喜欢成功')
      removeTxLikedSong(likeKey)
    }
  } catch (error: any) {
    toast(`操作失败: ${error.message}`)
  }
}

export const handleKgLikeMusic = async(musicInfo: LX.Music.MusicInfoOnline) => {
  const cookie = settingState.setting['common.kg_cookie']
  if (!cookie) {
    toast('请先设置酷狗音乐 Cookie')
    return
  }
  if (musicInfo.source !== 'kg') {
    toast('非酷狗音源无法执行此操作')
    return
  }

  const meta = musicInfo.meta as any
  const songHash = meta.hash || ''
  const songId = musicInfo.meta.songId
  const likeKey = songHash || String(songId)
  const isLiked = userState.kg_liked_song_ids.has(likeKey)
  const like = !isLiked

  try {
    if (like) {
      const { getUserPlaylists } = await import('@/utils/musicSdk/kg/utils/api')
      const playlistsResult = await getUserPlaylists(cookie)
      if (!playlistsResult.success || !playlistsResult.data) {
        toast('获取歌单列表失败')
        return
      }

      const favoritesPlaylist = playlistsResult.data.createdList.find((p: any) => p.isFavorites)
      if (!favoritesPlaylist?.listid) {
        toast('未找到"我喜欢"歌单，可能是Cookie已失效，请重新登录')
        return
      }

      const meta = musicInfo.meta as any
      const songInfo = {
        name: musicInfo.name || '',
        hash: meta.hash || meta.songmid || songId,
        album_id: meta.albumId ? Number(meta.albumId) : 0,
        mixsongid: meta.mixsongid ? Number(meta.mixsongid) : 0,
      }

      const result = await addSongToPlaylist(cookie, favoritesPlaylist.listid, songInfo)
      if (result.success) {
        toast('喜欢成功')
        addKgLikedSong(likeKey)
      } else {
        toast(`操作失败: ${result.message}，可能是Cookie已失效，请重新登录`)
      }
    } else {
      const { getUserPlaylists, getPlaylistSongs } = await import('@/utils/musicSdk/kg/utils/api')
      const playlistsResult = await getUserPlaylists(cookie)
      if (!playlistsResult.success || !playlistsResult.data) {
        toast('获取歌单列表失败，可能是Cookie已失效，请重新登录')
        return
      }

      const favoritesPlaylist = playlistsResult.data.createdList.find((p: any) => p.isFavorites)
      if (!favoritesPlaylist?.listid) {
        toast('未找到"我喜欢"歌单，可能是Cookie已失效，请重新登录')
        return
      }

      const songsResult = await getPlaylistSongs(cookie, favoritesPlaylist.id, 1, 500)
      if (!songsResult.success || !songsResult.data?.list) {
        toast('获取歌单歌曲失败')
        return
      }

      const meta = musicInfo.meta as any
      const songHash = (meta.hash || '').toString().toLowerCase()
      if (global.lx.isEnableLog) console.log('[KgLike] 查找歌曲:', { songHash, totalSongs: songsResult.data.list.length })

      const targetSong = songsResult.data.list.find((s: any) => {
        const sHash = (s.hash || '').toString().toLowerCase()
        return sHash === songHash || sHash.includes(songHash) || songHash.includes(sHash)
      })

      if (global.lx.isEnableLog) console.log('[KgLike] 找到歌曲:', { found: !!targetSong, fileId: targetSong?.fileId, listid: favoritesPlaylist.listid })

      if (targetSong?.fileId && targetSong.fileId !== 0) {
        const removeResult = await removeSongsFromPlaylist(cookie, favoritesPlaylist.listid, [Number(targetSong.fileId)])
        if (removeResult.success) {
          toast('取消喜欢成功')
          removeKgLikedSong(likeKey)
        } else {
          toast(`操作失败: ${removeResult.message}，可能是Cookie已失效，请重新登录`)
        }
      } else {
        toast('未找到歌曲信息，可能是Cookie已失效，请重新登录')
      }
    }
  } catch (error: any) {
    toast(`操作失败: ${error.message}，可能是Cookie已失效，请重新登录`)
  }
}

/**
 * 列表里点一首歌：加入默认列表并从该位置开始播放。
 *
 * 必须保证「点了一定有反馈」：原先的实现是
 *   加入默认列表 → 在列表里按 id 找回下标 → 找不到就 return（静默）
 * 写列表失败（存储异常 / 写入被拒）时 .then 根本不会执行，或 findIndex 返回 -1 时静默返回，
 * 用户看到的就是「点了没反应」——榜单这类分页列表偶发命中，正是这类时序/失败导致。
 * 现在改成：写列表失败或找不到时，直接用临时列表播这一首，任何情况下都有响应。
 */
export const handlePlay = async(musicInfo: LX.Music.MusicInfoOnline) => {
  if (!musicInfo) return
  const listId = LIST_IDS.DEFAULT
  const addMusicLocationType = settingState.setting['list.addMusicLocationType']
  try {
    // 已在列表里就不必再写一次，直接播
    let index = getListMusicSync(listId).findIndex((m) => m.id == musicInfo.id)
    if (index < 0) {
      await addListMusics(listId, [musicInfo], addMusicLocationType)
      index = getListMusicSync(listId).findIndex((m) => m.id == musicInfo.id)
    }
    if (index < 0) throw new Error('song not found in list after add')
    // playList 内部失败（如播放引擎异常）会以 Promise 拒绝收场且无 UI 反馈，这里补兜底
    void playList(listId, index).catch((err: any) => {
      log.warn('[OnlineList] playList failed', { err: err?.message })
      toast('播放失败，请重试')
    })
  } catch (err: any) {
    log.warn('[OnlineList] 加入默认列表失败，回退临时列表播放', { err: err?.message, id: musicInfo.id })
    try {
      await setTempList(`click__${musicInfo.id}`, [musicInfo])
      void playList(LIST_IDS.TEMP, 0)
    } catch {
      toast('播放失败，请重试')
    }
  }
}
export const handlePlayLater = (
  musicInfo: LX.Music.MusicInfoOnline,
  selectedList: LX.Music.MusicInfoOnline[],
  onCancelSelect: () => void,
) => {
  if (selectedList.length) {
    addTempPlayList(selectedList.map((s) => ({ listId: '', musicInfo: s })))
    onCancelSelect()
  } else {
    addTempPlayList([{ listId: '', musicInfo }])
  }
}

export const handleShowMusicSourceDetail = async(minfo: LX.Music.MusicInfoOnline) => {
  const url = musicSdk[minfo.source as LX.OnlineSource]?.getMusicDetailPageUrl(
    toOldMusicInfo(minfo),
  )
  if (!url) return
  void openUrl(url)
}

export const handleDislikeMusic = async(musicInfo: LX.Music.MusicInfoOnline, listId?: string) => {
  if (listId === 'dailyrec_wy') {
    const cookie = settingState.setting['common.wy_cookie']
    if (!cookie) {
      toast('请先设置网-易-云 Cookie')
      return
    }

    const songId = musicInfo.id.replace('wy_', '')

    try {
      const { body, statusCode } = await httpFetch('https://music.163.com/weapi/v2/discovery/recommend/dislike', {
        method: 'post',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36 Edg/108.0.1462.54',
          origin: 'https://music.163.com',
          Referer: 'https://music.163.com',
          cookie,
        },
        form: weapi({
          resId: songId,
          resType: 4,
          sceneType: 1,
        }),
      }).promise

      const bodyData = body as { code?: number, data?: any }

      if (statusCode == 200 && bodyData.code === 200) {
        const newMusicResult = await musicDetailApi.filterList({ songs: [bodyData.data], privileges: [] })
        if (newMusicResult.length) {
          const newMusicInfo = newMusicResult[0]
          global.list_event.daily_rec_music_replace(musicInfo.id, newMusicInfo as LX.Music.MusicInfoOnline)
          toast('操作成功！')
        } else {
          global.list_event.daily_rec_music_replace(musicInfo.id, null)
          toast('操作成功！')
        }
      } else {
        toast('操作失败')
      }
    } catch (error: any) {
      toast(`操作失败: ${error.message}`)
    }
    return
  }

  // --- For other lists, keep the original local "dislike" logic ---
  const confirm = await confirmDialog({
    message: musicInfo.singer
      ? global.i18n.t('lists_dislike_music_singer_tip', {
        name: musicInfo.name,
        singer: musicInfo.singer,
      })
      : global.i18n.t('lists_dislike_music_tip', { name: musicInfo.name }),
    cancelButtonText: global.i18n.t('cancel_button_text_2'),
    confirmButtonText: global.i18n.t('confirm_button_text'),
    bgClose: false,
  })
  if (!confirm) return
  await addDislikeInfo([{ name: musicInfo.name, singer: musicInfo.singer }])
  toast(global.i18n.t('lists_dislike_music_add_tip'))
  if (hasDislike(playerState.playMusicInfo.musicInfo)) {
    void playNext(true)
  }
}
