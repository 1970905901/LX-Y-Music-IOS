import {forwardRef, useEffect, useImperativeHandle, useRef, useState} from 'react'
import Dialog, { type DialogType } from '@/components/common/Dialog'
import { toast } from '@/utils/tools'
import Title from './Title'
import List from './List'
import Button from '@/components/common/Button'
import wyApi from '@/utils/musicSdk/wy/user'
import txApi from '@/utils/musicSdk/tx/user'
import { addSongToPlaylist as addKgSongToPlaylist, removeSongsFromPlaylist as removeKgSongsFromPlaylist } from '@/utils/musicSdk/kg/utils/api'
import { useI18n } from '@/lang'
import { addListMusics, moveListMusics } from '@/core/list'
import settingState from '@/store/setting/state'
import {useTheme} from "@/store/theme/hook"
import {getPlaylistType, savePlaylistType} from "@/utils/data"
import {Text, View} from "react-native"
import {addWyLikedSong, removeWyLikedSong, updateWySubscribedPlaylistTrackCount, addTxLikedSong, removeTxLikedSong} from "@/store/user/action.ts";
import {clearListDetailCache} from "@/core/songlist.ts";
import {useWySubscribedPlaylists} from "@/store/user/hook.ts";
import { log } from '@/utils/log'
import { useSettingValue } from '@/store/setting/hook'

export interface SelectInfo {
  musicInfo: LX.Music.MusicInfo | null
  listId: string
  isMove: boolean
}

const initSelectInfo = {}

export interface MusicAddModalProps {
  onAdded?: () => void
}

export interface MusicAddModalType {
  show: (info: SelectInfo) => void
}

export default forwardRef<MusicAddModalType, MusicAddModalProps>(({ onAdded }, ref) => {
  const t = useI18n()
  const dialogRef = useRef<DialogType>(null)
  const [selectInfo, setSelectInfo] = useState<SelectInfo>(initSelectInfo as SelectInfo)
  const [playlistType, setPlaylistType] = useState<'local' | 'wy' | 'tx' | 'kg'>('local')
  const theme = useTheme()
  const subscribedPlaylists = useWySubscribedPlaylists()
  const kgCookie = useSettingValue('common.kg_cookie')

  useEffect(() => {
    getPlaylistType().then(setPlaylistType)
  }, [])

  const handlePlaylistTypeChange = (type: 'local' | 'wy' | 'tx' | 'kg') => {
    setPlaylistType(type)
    void savePlaylistType(type)
  }


  useImperativeHandle(ref, () => ({
    show(selectInfo) {
      setSelectInfo(selectInfo)
      requestAnimationFrame(() => {
        dialogRef.current?.setVisible(true)
      })
    },
  }))

  const handleHide = () => {
    requestAnimationFrame(() => {
      setSelectInfo({ ...selectInfo, musicInfo: null })
    })
  }

  const handleSelect = (listInfo: LX.List.MyListInfo) => {
    dialogRef.current?.setVisible(false)
    const { musicInfo, listId: fromListId, isMove } = selectInfo
    
    log.info('[MusicAddModal] handleSelect 开始', {
      playlistType,
      toListId: listInfo.id,
      toListName: listInfo.name,
      fromListId,
      isMove,
      musicInfo: musicInfo ? {
        name: musicInfo.name,
        singer: musicInfo.singer,
        source: musicInfo.source,
        songId: musicInfo.meta?.songId,
      } : null,
    })
    
    if (playlistType === 'wy') {
      if (!musicInfo) {
        log.error('[MusicAddModal] 网易歌单添加失败: musicInfo 为空')
        return;
      }
      
      const songId = String(musicInfo.meta.songId);
      if (!songId || !/^\d+$/.test(songId)) {
        log.error('[MusicAddModal] 网易歌单添加失败: songId 格式不正确', {
          songId,
          songIdType: typeof musicInfo.meta.songId,
          expected: '纯数字ID',
          musicSource: musicInfo.source,
        })
        toast('该歌曲不支持添加到网易云歌单（ID格式不兼容）')
        return;
      }
      
      const toListId = String(listInfo.id);
      if (toListId.startsWith('tx__')) {
        log.error('[MusicAddModal] 网易歌单添加失败: 目标歌单 ID 格式错误', {
          toListId,
          expected: '网易云歌单ID（纯数字）',
        })
        toast('目标歌单 ID 格式错误，请选择网易云歌单')
        return;
      }
      
      const sourcePlaylist = subscribedPlaylists.find(p => `wy__${p.id}` === fromListId);

      if (isMove) {
        wyApi.manipulatePlaylistTracks('add', toListId, [songId]).then(() => {
          if (listInfo.name === listInfo.creator.nickname + '喜欢的音乐') {
            addWyLikedSong(songId)
          }
          const sourcePlaylistId = fromListId.replace('wy__', '');
          clearListDetailCache('wy', toListId)
          global.app_event.playlist_updated({ source: 'wy', listId: toListId })
          return wyApi.manipulatePlaylistTracks('del', sourcePlaylistId, [songId]);
        }).then(() => {
          if (sourcePlaylist?.name === sourcePlaylist?.creator?.nickname + '喜欢的音乐') {
            removeWyLikedSong(songId)
          }
          onAdded?.()
          toast(t('list_edit_action_tip_move_success'));
          updateWySubscribedPlaylistTrackCount(toListId, 1);
          const sourcePlaylistId = fromListId.replace('wy__', '')
          updateWySubscribedPlaylistTrackCount(sourcePlaylistId, -1);
          clearListDetailCache('wy', sourcePlaylistId)
          global.app_event.playlist_updated({ source: 'wy', listId: sourcePlaylistId })
          log.info('[MusicAddModal] 网易歌单移动成功', { toListId, songId })
        }).catch((err) => {
          log.error('[MusicAddModal] 网易歌单移动失败', {
            error: err.message || err,
            toListId,
            songId,
            fromListId,
          })
          toast(err.message || t('list_edit_action_tip_move_failed'));
        });
      } else {
        wyApi.manipulatePlaylistTracks('add', toListId, [songId]).then(() => {
          if (listInfo.name === listInfo.creator.nickname + '喜欢的音乐') {
            addWyLikedSong(songId)
          }
          onAdded?.()
          toast(t('list_edit_action_tip_add_success'))
          updateWySubscribedPlaylistTrackCount(toListId, 1)
          clearListDetailCache('wy', toListId)
          global.app_event.playlist_updated({ source: 'wy', listId: toListId })
          log.info('[MusicAddModal] 网易歌单添加成功', { toListId, songId })
        }).catch((err) => {
          log.error('[MusicAddModal] 网易歌单添加失败', {
            error: err.message || err,
            toListId,
            songId,
          })
          toast(err.message || t('list_edit_action_tip_add_failed'));
        });
      }
      return;
    }
    
    if (playlistType === 'tx') {
      if (!musicInfo) {
        log.error('[MusicAddModal] QQ歌单添加失败: musicInfo 为空')
        return;
      }
      
      if (musicInfo.source !== 'tx') {
        log.error('[MusicAddModal] QQ歌单添加失败: 歌曲来源不是QQ音乐', {
          musicSource: musicInfo.source,
          songName: musicInfo.name,
          note: 'QQ歌单只能添加QQ音乐的歌曲',
        })
        toast('QQ歌单只能添加QQ音乐的歌曲，不支持跨平台添加')
        return;
      }
      
      const songMid = musicInfo.meta.mid || musicInfo.meta.songId;
      if (!songMid) {
        log.error('[MusicAddModal] QQ歌单添加失败: 歌曲 mid 为空', {
          musicInfo,
          meta: musicInfo.meta,
        })
        toast('歌曲 mid 为空，无法添加')
        return;
      }
      
      const toListId = String(listInfo.id).replace('tx__', '');
      if (!toListId || toListId === String(listInfo.id)) {
        log.error('[MusicAddModal] QQ歌单添加失败: 目标歌单 ID 格式错误', {
          originalId: listInfo.id,
          toListId,
          expected: 'tx__开头的ID',
        })
        toast('目标歌单 ID 格式错误，请选择 QQ 歌单')
        return;
      }
      
      log.info('[MusicAddModal] QQ歌单添加开始', {
        toListId,
        songMid,
        musicSource: musicInfo.source,
        isMove,
      })
      
      if (isMove) {
        const sourcePlaylistId = fromListId.replace('tx__', '')
        txApi.addSongToPlaylist(toListId, [String(songMid)]).then(() => {
          if (listInfo.dirid === 201) {
            const txSongId = (musicInfo.meta as any).id
            const isNumericId = txSongId && /^\d+$/.test(String(txSongId))
            const likeKey = isNumericId ? String(txSongId) : songMid
            addTxLikedSong(likeKey)
          }
          clearListDetailCache('tx', toListId)
          global.app_event.playlist_updated({ source: 'tx', listId: toListId })
          return txApi.removeSongFromPlaylist(sourcePlaylistId, [String(songMid)])
        }).then(() => {
          onAdded?.()
          toast(t('list_edit_action_tip_move_success'))
          clearListDetailCache('tx', sourcePlaylistId)
          global.app_event.playlist_updated({ source: 'tx', listId: sourcePlaylistId })
          log.info('[MusicAddModal] QQ歌单移动成功', { toListId, songMid, sourcePlaylistId })
        }).catch((err) => {
          log.error('[MusicAddModal] QQ歌单移动失败', {
            error: err.message || err,
            toListId,
            songMid,
            sourcePlaylistId,
          })
          toast(err.message || t('list_edit_action_tip_move_failed'));
        });
      } else {
        txApi.addSongToPlaylist(toListId, [String(songMid)]).then(() => {
          if (listInfo.dirid === 201) {
            const txSongId = (musicInfo.meta as any).id
            const isNumericId = txSongId && /^\d+$/.test(String(txSongId))
            const likeKey = isNumericId ? String(txSongId) : songMid
            addTxLikedSong(likeKey)
          }
          onAdded?.()
          toast(t('list_edit_action_tip_add_success'))
          global.app_event.playlist_updated({ source: 'tx', listId: toListId })
          log.info('[MusicAddModal] QQ歌单添加成功', { toListId, songMid, dirid: listInfo.dirid })
        }).catch((err) => {
          log.error('[MusicAddModal] QQ歌单添加失败', {
            error: err.message || err,
            toListId,
            songMid,
            musicSource: musicInfo.source,
          })
          toast(err.message || t('list_edit_action_tip_add_failed'));
        });
      }
      return;
    }

    if (playlistType === 'kg') {
      if (!musicInfo) {
        log.error('[MusicAddModal] 酷狗歌单操作失败: musicInfo 为空')
        return;
      }

      const toListId = (listInfo as any).listid || Number(String(listInfo.id).replace('kg__', ''));
      if (!toListId || isNaN(toListId)) {
        log.error('[MusicAddModal] 酷狗歌单操作失败: 无法获取歌单数字ID', {
          listId: listInfo.id,
          listid: (listInfo as any).listid,
        })
        toast('歌单ID格式错误')
        return;
      }

      if (!kgCookie) {
        toast('请先登录酷狗音乐，Cookie可能已失效')
        return;
      }

      const songName = musicInfo.name || '';
      const songHash = (musicInfo.meta as any)?.hash || '';
      const albumId = (musicInfo.meta as any)?.albumId || 0;
      const mixsongid = Number((musicInfo.meta as any)?.mixSongId) || Number(musicInfo.meta?.songId) || 0;

      if (isMove) {
        const sourcePlaylistId = fromListId.replace('kg__', '')
        addKgSongToPlaylist(kgCookie, toListId, {
          name: songName,
          hash: songHash,
          album_id: albumId,
          mixsongid,
        }).then((result) => {
          if (result.success) {
            clearListDetailCache('kg', toListId)
            global.app_event.playlist_updated({ source: 'kg', listId: toListId })
            return removeKgSongsFromPlaylist(kgCookie, Number(sourcePlaylistId), [songHash])
          } else {
            throw new Error(result.message || t('list_edit_action_tip_move_failed'))
          }
        }).then((result) => {
          if (result?.success) {
            onAdded?.()
            toast(t('list_edit_action_tip_move_success'))
            clearListDetailCache('kg', sourcePlaylistId)
            global.app_event.playlist_updated({ source: 'kg', listId: sourcePlaylistId })
            log.info('[MusicAddModal] 酷狗歌单移动成功', { toListId, songName, sourcePlaylistId })
          } else {
            toast(result?.message || t('list_edit_action_tip_move_failed'))
          }
        }).catch((err) => {
          log.error('[MusicAddModal] 酷狗歌单移动失败', { error: err.message })
          toast(err.message || t('list_edit_action_tip_move_failed'))
        })
      } else {
        log.info('[MusicAddModal] 酷狗歌单添加开始', {
          toListId,
          songName,
          songHash,
        })

        addKgSongToPlaylist(kgCookie, toListId, {
          name: songName,
          hash: songHash,
          album_id: albumId,
          mixsongid,
        }).then((result) => {
          if (result.success) {
            onAdded?.()
            toast(t('list_edit_action_tip_add_success'))
            log.info('[MusicAddModal] 酷狗歌单添加成功', { toListId, songName })
            const globalCollectionId = String(listInfo.id).replace('kg__', '')
            clearListDetailCache('kg', globalCollectionId)
            const newCover = result.song?.cover ? result.song.cover.replace('{size}', '400') : undefined
            global.app_event.playlist_updated({ source: 'kg', listId: globalCollectionId, addedSong: result.song, newCover })
          } else {
            log.error('[MusicAddModal] 酷狗歌单添加失败', { error: result.message })
            toast(result.message || t('list_edit_action_tip_add_failed'))
          }
        }).catch((err) => {
          log.error('[MusicAddModal] 酷狗歌单添加失败', {
            error: err.message || err,
          })
          toast(err.message || t('list_edit_action_tip_add_failed'))
        })
      }
      return;
    }

    if (selectInfo.isMove) {
      void moveListMusics(
        selectInfo.listId,
        listInfo.id,
        [selectInfo.musicInfo!],
        settingState.setting['list.addMusicLocationType']
      )
        .then(() => {
          onAdded?.()
          toast(t('list_edit_action_tip_move_success'))
        })
        .catch(() => {
          toast(t('list_edit_action_tip_move_failed'))
        })
    } else {
      void addListMusics(
        listInfo.id,
        [selectInfo.musicInfo!],
        settingState.setting['list.addMusicLocationType']
      )
        .then(() => {
          onAdded?.()
          toast(t('list_edit_action_tip_add_success'))
        })
        .catch(() => {
          toast(t('list_edit_action_tip_add_failed'))
        })
    }
  }


  return (
    <Dialog ref={dialogRef} onHide={handleHide}>
      {selectInfo.musicInfo ? (
        <>
          <Title musicInfo={selectInfo.musicInfo} isMove={selectInfo.isMove} />
          <View style={{ flexDirection: 'row', justifyContent: 'center', paddingVertical: 10, flexWrap: 'wrap', gap: 8 }}>
            <Button onPress={() => handlePlaylistTypeChange('local')} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 4, backgroundColor: playlistType === 'local' ? theme['c-button-background-active'] : theme['c-button-background'] }}>
              <Text color={theme['c-button-font']}>本地歌单</Text>
            </Button>
            <Button onPress={() => handlePlaylistTypeChange('wy')} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 4, backgroundColor: playlistType === 'wy' ? theme['c-button-background-active'] : theme['c-button-background'] }}>
              <Text color={theme['c-button-font']}>网易歌单</Text>
            </Button>
            <Button onPress={() => handlePlaylistTypeChange('tx')} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 4, backgroundColor: playlistType === 'tx' ? theme['c-button-background-active'] : theme['c-button-background'] }}>
              <Text color={theme['c-button-font']}>QQ歌单</Text>
            </Button>
            <Button onPress={() => handlePlaylistTypeChange('kg')} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 4, backgroundColor: playlistType === 'kg' ? theme['c-button-background-active'] : theme['c-button-background'] }}>
              <Text color={theme['c-button-font']}>酷狗歌单</Text>
            </Button>
          </View>
          <List musicInfo={selectInfo.musicInfo} onPress={handleSelect} playlistType={playlistType} />
        </>
      ) : null}
    </Dialog>
  )
})
