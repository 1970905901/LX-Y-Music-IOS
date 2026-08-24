import {forwardRef, useEffect, useImperativeHandle, useRef, useState} from 'react'
import Dialog, { type DialogType } from '@/components/common/Dialog'
import { toast } from '@/utils/tools'
import Title from './Title'
import List from './List'
import { useI18n } from '@/lang'
import { addListMusics, moveListMusics } from '@/core/list'
import settingState from '@/store/setting/state'
import { useTheme } from '@/store/theme/hook'
import Button from '@/components/common/Button'
import { getPlaylistType, savePlaylistType } from '@/utils/data'
import wyApi from '@/utils/musicSdk/wy/user'
import txApi from '@/utils/musicSdk/tx/user'
import {addWyLikedSong, removeWyLikedSong, updateWySubscribedPlaylistTrackCount, addTxLikedSong, removeTxLikedSong} from '@/store/user/action'
import { clearListDetailCache } from '@/core/songlist'
import {Text, View} from "react-native";
import {useWySubscribedPlaylists} from "@/store/user/hook.ts";
import { log } from '@/utils/log'

export interface SelectInfo {
  selectedList: LX.Music.MusicInfo[]
  listId: string
  isMove: boolean
  // single: boolean
}
const initSelectInfo = { selectedList: [], listId: '', isMove: false }

export interface MusicMultiAddModalProps {
  onAdded?: () => void
  // onRename: (listInfo: LX.List.UserListInfo) => void
  // onImport: (listInfo: LX.List.MyListInfo, index: number) => void
  // onExport: (listInfo: LX.List.MyListInfo, index: number) => void
  // onSync: (listInfo: LX.List.UserListInfo) => void
  // onRemove: (listInfo: LX.List.UserListInfo) => void
}
export interface MusicMultiAddModalType {
  show: (info: SelectInfo) => void
}

export default forwardRef<MusicMultiAddModalType, MusicMultiAddModalProps>(({ onAdded }, ref) => {
  const t = useI18n()
  const dialogRef = useRef<DialogType>(null)
  const [selectInfo, setSelectInfo] = useState<SelectInfo>(initSelectInfo)
  const [playlistType, setPlaylistType] = useState<'local' | 'wy' | 'tx'>('local')
  const theme = useTheme()
  const subscribedPlaylists = useWySubscribedPlaylists()

  useEffect(() => {
    getPlaylistType().then(setPlaylistType);
  }, []);

  const handlePlaylistTypeChange = (type: 'local' | 'wy' | 'tx') => {
    setPlaylistType(type);
    void savePlaylistType(type);
  };

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
      setSelectInfo({ ...selectInfo, selectedList: [] })
    })
  }

  const handleSelect = (listInfo: LX.List.MyListInfo) => {
    dialogRef.current?.setVisible(false)
    const { selectedList, listId: fromListId, isMove } = selectInfo
    
    log.info('[MusicMultiAddModal] handleSelect 开始', {
      playlistType,
      toListId: listInfo.id,
      toListName: listInfo.name,
      fromListId,
      isMove,
      selectedCount: selectedList.length,
      selectedSongs: selectedList.map(m => ({
        name: m.name,
        source: m.source,
        songId: m.meta?.songId,
      })),
    })
    
    if (playlistType === 'wy') {
      if (!selectedList.length) {
        log.error('[MusicMultiAddModal] 网易歌单添加失败: selectedList 为空')
        return
      }
      
      const invalidSongs = selectedList.filter(m => {
        const songId = m.meta.songId;
        return !songId || typeof songId !== 'string' || !/^\d+$/.test(songId);
      });
      
      if (invalidSongs.length > 0) {
        log.error('[MusicMultiAddModal] 网易歌单添加失败: 部分歌曲 ID 格式不正确', {
          invalidCount: invalidSongs.length,
          invalidSongs: invalidSongs.map(m => ({
            name: m.name,
            source: m.source,
            songId: m.meta?.songId,
          })),
          expected: '纯数字ID',
        })
        toast(`${invalidSongs.length}首歌曲不支持添加到网易云歌单（ID格式不兼容）`)
        return;
      }
      
      const toListId = String(listInfo.id)
      if (toListId.startsWith('tx__')) {
        log.error('[MusicMultiAddModal] 网易歌单添加失败: 目标歌单 ID 格式错误', {
          toListId,
          expected: '网易云歌单ID（纯数字）',
        })
        toast('目标歌单 ID 格式错误，请选择网易云歌单')
        return
      }
      
      const songIds = selectedList.map(m => m.meta.songId).reverse()
      const sourcePlaylist = subscribedPlaylists.find(p => `wy__${p.id}` === fromListId)

      if (isMove) {
        wyApi.manipulatePlaylistTracks('add', toListId, songIds).then(() => {
          if (listInfo.name === listInfo.creator.nickname + '喜欢的音乐') {
            for (const songId of songIds) {
              addWyLikedSong(songId);
            }
          }
          const sourcePlaylistId = fromListId.replace('wy__', '')
          clearListDetailCache('wy', toListId)
          global.app_event.playlist_updated({ source: 'wy', listId: toListId })
          return wyApi.manipulatePlaylistTracks('del', sourcePlaylistId, songIds)
        }).then(() => {
          if (sourcePlaylist?.name === sourcePlaylist?.creator?.nickname + '喜欢的音乐') {
            for (const songId of songIds) {
              removeWyLikedSong(songId)
            }
          }
          onAdded?.()
          toast(t('list_edit_action_tip_move_success'))
          updateWySubscribedPlaylistTrackCount(toListId, songIds.length)
          const sourcePlaylistId = fromListId.replace('wy__', '')
          updateWySubscribedPlaylistTrackCount(sourcePlaylistId, -songIds.length)
          clearListDetailCache('wy', sourcePlaylistId)
          global.app_event.playlist_updated({ source: 'wy', listId: sourcePlaylistId })
          log.info('[MusicMultiAddModal] 网易歌单移动成功', { toListId, songCount: songIds.length })
        }).catch((err) => {
          log.error('[MusicMultiAddModal] 网易歌单移动失败', {
            error: err.message || err,
            toListId,
            songCount: songIds.length,
            fromListId,
          })
          toast(err.message || t('list_edit_action_tip_move_failed'))
        })
      } else {
        wyApi.manipulatePlaylistTracks('add', toListId, songIds).then(() => {
          if (listInfo.name === listInfo.creator.nickname + '喜欢的音乐') {
            for (const songId of songIds) {
              addWyLikedSong(songId);
            }
          }
          onAdded?.()
          toast(t('list_edit_action_tip_add_success'))
          updateWySubscribedPlaylistTrackCount(toListId, songIds.length)
          clearListDetailCache('wy', toListId)
          global.app_event.playlist_updated({ source: 'wy', listId: toListId })
          log.info('[MusicMultiAddModal] 网易歌单添加成功', { toListId, songCount: songIds.length })
        }).catch((err) => {
          log.error('[MusicMultiAddModal] 网易歌单添加失败', {
            error: err.message || err,
            toListId,
            songCount: songIds.length,
          })
          toast(err.message || t('list_edit_action_tip_add_failed'))
        })
      }
      return
    }
    
    if (playlistType === 'tx') {
      if (!selectedList.length) {
        log.error('[MusicMultiAddModal] QQ歌单添加失败: selectedList 为空')
        return
      }
      
      const nonTxSongs = selectedList.filter(m => m.source !== 'tx');
      if (nonTxSongs.length > 0) {
        log.error('[MusicMultiAddModal] QQ歌单添加失败: 部分歌曲来源不是QQ音乐', {
          nonTxCount: nonTxSongs.length,
          nonTxSongs: nonTxSongs.map(m => ({
            name: m.name,
            source: m.source,
          })),
          note: 'QQ歌单只能添加QQ音乐的歌曲',
        })
        toast(`QQ歌单只能添加QQ音乐的歌曲，有${nonTxSongs.length}首歌曲不支持跨平台添加`)
        return;
      }
      
      const invalidSongs = selectedList.filter(m => !m.meta.mid && !m.meta.songId);
      if (invalidSongs.length > 0) {
        log.error('[MusicMultiAddModal] QQ歌单添加失败: 部分歌曲 mid 为空', {
          invalidCount: invalidSongs.length,
          invalidSongs: invalidSongs.map(m => ({
            name: m.name,
            source: m.source,
            meta: m.meta,
          })),
        })
        toast(`${invalidSongs.length}首歌曲 mid 为空，无法添加`)
        return;
      }
      
      const toListId = String(listInfo.id).replace('tx__', '')
      if (!toListId || toListId === String(listInfo.id)) {
        log.error('[MusicMultiAddModal] QQ歌单添加失败: 目标歌单 ID 格式错误', {
          originalId: listInfo.id,
          toListId,
          expected: 'tx__开头的ID',
        })
        toast('目标歌单 ID 格式错误，请选择 QQ 歌单')
        return
      }
      
      const songMids = selectedList.map(m => String(m.meta.mid || m.meta.songId))
      
      log.info('[MusicMultiAddModal] QQ歌单添加开始', {
        toListId,
        songCount: songMids.length,
        songMids,
        songSources: selectedList.map(m => m.source),
      })
      
      txApi.addSongToPlaylist(toListId, songMids).then(() => {
        if (listInfo.dirid === 201) {
          for (const music of selectedList) {
            const txSongId = (music.meta as any).id
            const isNumericId = txSongId && /^\d+$/.test(String(txSongId))
            const likeKey = isNumericId ? String(txSongId) : String(music.meta.mid || music.meta.songId)
            addTxLikedSong(likeKey)
          }
        }
        onAdded?.()
        toast(t('list_edit_action_tip_add_success'))
        global.app_event.playlist_updated({ source: 'tx', listId: toListId })
        log.info('[MusicMultiAddModal] QQ歌单添加成功', { toListId, songCount: songMids.length, dirid: listInfo.dirid })
      }).catch((err) => {
        log.error('[MusicMultiAddModal] QQ歌单添加失败', {
          error: err.message || err,
          toListId,
          songCount: songMids.length,
          songMids,
          songSources: selectedList.map(m => m.source),
        })
        toast(err.message || t('list_edit_action_tip_add_failed'))
      })
      return
    }
    if (selectInfo.isMove) {
      void moveListMusics(
        selectInfo.listId,
        listInfo.id,
        [...selectInfo.selectedList],
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
        [...selectInfo.selectedList],
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
      {selectInfo.selectedList.length ? (
        <>
          <Title selectedList={selectInfo.selectedList} isMove={selectInfo.isMove} />
          <View style={{ flexDirection: 'row', justifyContent: 'center', paddingVertical: 10 }}>
            <Button onPress={() => handlePlaylistTypeChange('local')} style={{ marginRight: 10, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 4, backgroundColor: playlistType === 'local' ? theme['c-button-background-active'] : theme['c-button-background'] }}>
              <Text color={theme['c-button-font']}>本地歌单</Text>
            </Button>
            <Button onPress={() => handlePlaylistTypeChange('wy')} style={{ marginRight: 10, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 4, backgroundColor: playlistType === 'wy' ? theme['c-button-background-active'] : theme['c-button-background'] }}>
              <Text color={theme['c-button-font']}>网易歌单</Text>
            </Button>
            <Button onPress={() => handlePlaylistTypeChange('tx')} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 4, backgroundColor: playlistType === 'tx' ? theme['c-button-background-active'] : theme['c-button-background'] }}>
              <Text color={theme['c-button-font']}>QQ歌单</Text>
            </Button>
          </View>
          <List listId={selectInfo.listId} onPress={handleSelect} playlistType={playlistType} />
        </>
      ) : null}
    </Dialog>
  );
})
