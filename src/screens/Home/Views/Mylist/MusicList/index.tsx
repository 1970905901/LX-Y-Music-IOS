import { useCallback, useRef, useState } from 'react'

import listState from '@/store/list/state'
import ListMenu, { type ListMenuType, type Position, type SelectInfo } from './ListMenu'
import {
  handleDislikeMusic,
  handlePlay,
  handlePlayLater,
  handleRemove,
  handleUpdateMusicInfo,
  handleUpdateMusicPosition,
  handleClearMusicCache,
} from './listAction'
import List, { type ListType } from './List'
import ListMusicAdd, {
  type MusicAddModalType as ListMusicAddType,
} from '@/components/MusicAddModal'
import ListMusicMultiAdd, {
  type MusicMultiAddModalType as ListAddMultiType,
} from '@/components/MusicMultiAddModal'
import { createStyle } from '@/utils/tools'
import { View, StyleSheet, Keyboard } from 'react-native'
import ActiveList, { type ActiveListType } from './ActiveList'
import MultipleModeBar, { type SelectMode, type MultipleModeBarType } from './MultipleModeBar'
import ListSearchBar from './ListSearchBar'

import MusicPositionModal, { type MusicPositionModalType } from './MusicPositionModal'
import MetadataEditModal, {
  type MetadataEditType,
  type MetadataEditProps,
} from '@/components/MetadataEditModal'
import { downloadMusic } from '@/core/download'
import MusicToggleModal, { type MusicToggleModalType } from './MusicToggleModal'
import { handleShowAlbumDetail, handleShowArtistDetail } from '@/components/OnlineList/listAction.ts'
import { useSettingValue } from '@/store/setting/hook.ts'
import { updateSetting } from '@/core/common.ts'
import commonState from '@/store/common/state'
import SimilarSongsModal, { type SimilarSongsModalType } from '@/components/selector/SimilarSongsModal'
import PageTopInset from '@/components/common/PageTopInset'

export interface MusicListProps {
  onBack?: () => void
  /** 指定要展示的列表 id。传入时优先于持久化的「上次选中列表」。 */
  listId?: string
}

export default ({ onBack, listId }: MusicListProps) => {
  const activeListRef = useRef<ActiveListType>(null)
  const listRef = useRef<ListType>(null)
  const multipleModeBarRef = useRef<MultipleModeBarType>(null)
  const listMusicAddRef = useRef<ListMusicAddType>(null)
  const listMusicMultiAddRef = useRef<ListAddMultiType>(null)
  const musicPositionModalRef = useRef<MusicPositionModalType>(null)

  const metadataEditTypeRef = useRef<MetadataEditType>(null)
  const listMenuRef = useRef<ListMenuType>(null)
  const musicToggleModalRef = useRef<MusicToggleModalType>(null)
  const similarSongsModalRef = useRef<SimilarSongsModalType>(null)
  const isShowMultipleModeBar = useRef(false)
  const selectedInfoRef = useRef<SelectInfo>()

  const showCover = useSettingValue('list.isShowCover')
  const handleToggleView = useCallback(() => {
    updateSetting({ 'list.isShowCover': !showCover })
  }, [showCover])

  // ---- 就地搜索（我的收藏 / 自建列表） ----------------------------------
  // 搜索不再是「另一个界面」：输入条只是页头下方的一行（见 ListSearchBar），
  // 关键字交给 List 就地过滤**同一个列表**，结果行就是列表行本身。
  // 旧实现（藏页头 + 弹浮层结果 + 点结果跳列表）被用户评价「太割裂」，已整体移除。
  const [isSearching, setIsSearching] = useState(false)
  const [searchKeyword, setSearchKeyword] = useState('')
  const isSearchingRef = useRef(false)
  isSearchingRef.current = isSearching

  const handleExitSearch = useCallback(() => {
    // 先收键盘再卸载输入条：输入框消失后键盘若还在，会挡住列表一大截
    Keyboard.dismiss()
    isSearchingRef.current = false
    setIsSearching(false)
    setSearchKeyword('')
  }, [])
  const handleToggleSearch = useCallback(() => {
    if (isSearchingRef.current) {
      handleExitSearch()
      return
    }
    isSearchingRef.current = true
    setIsSearching(true)
  }, [handleExitSearch])
  const handleSearchKeyword = useCallback((keyword: string) => {
    setSearchKeyword(keyword)
  }, [])

  const hancelMultiSelect = useCallback(() => {
    // 多选会隐藏页头（搜索条也在页头区），正搜索时一并退出并还原整表，
    // 避免留下「只有半截列表、又找不到搜索入口」的状态。
    if (isSearchingRef.current) handleExitSearch()
    activeListRef.current?.setVisibleBar(false)
    isShowMultipleModeBar.current = true
    multipleModeBarRef.current?.show()
    listRef.current?.setIsMultiSelectMode(true)
  }, [handleExitSearch])
  const hancelExitSelect = useCallback(() => {
    activeListRef.current?.setVisibleBar(true)
    multipleModeBarRef.current?.exitSelectMode()
    listRef.current?.setIsMultiSelectMode(false)
    isShowMultipleModeBar.current = false
  }, [])
  const hancelSwitchSelectMode = useCallback((mode: SelectMode) => {
    multipleModeBarRef.current?.setSwitchMode(mode)
    listRef.current?.setSelectMode(mode)
  }, [])
  const hancelScrollToTop = useCallback(() => {
    listRef.current?.scrollToTop()
  }, [])
  const handleShowArtist = useCallback((info: SelectInfo) => {
    if (info.musicInfo.source !== 'local') {
      void handleShowArtistDetail(commonState.componentIds[commonState.componentIds.length - 1]?.id, info.musicInfo)
    }
  }, [])

  const handleShowAlbum = useCallback((info: SelectInfo) => {
    if (info.musicInfo.source !== 'local') {
      handleShowAlbumDetail(commonState.componentIds[commonState.componentIds.length - 1]?.id, info.musicInfo)
    }
  }, [])

  const showMenu = useCallback(
    (musicInfo: LX.Music.MusicInfo, index: number, position: Position) => {
      listMenuRef.current?.show(
        {
          musicInfo,
          index,
          listId: listState.activeListId,
          single: false,
          selectedList: listRef.current!.getSelectedList(),
        },
        position,
      )
    },
    [],
  )

  const handleAddMusic = useCallback((info: SelectInfo) => {
    if (info.selectedList.length) {
      listMusicMultiAddRef.current?.show({
        selectedList: info.selectedList,
        listId: info.listId,
        isMove: false,
      })
    } else {
      listMusicAddRef.current?.show({
        musicInfo: info.musicInfo,
        listId: info.listId,
        isMove: false,
      })
    }
  }, [])
  const handleMoveMusic = useCallback((info: SelectInfo) => {
    if (info.selectedList.length) {
      listMusicMultiAddRef.current?.show({
        selectedList: info.selectedList,
        listId: info.listId,
        isMove: true,
      })
    } else {
      listMusicAddRef.current?.show({
        musicInfo: info.musicInfo,
        listId: info.listId,
        isMove: true,
      })
    }
  }, [])
  const handleEditMetadata = useCallback((info: SelectInfo) => {
    if (info.musicInfo.source != 'local') return
    selectedInfoRef.current = info
    metadataEditTypeRef.current?.show(info.musicInfo.meta.filePath)
  }, [])
  const handleUpdateMetadata = useCallback<MetadataEditProps['onUpdate']>((info) => {
    if (!selectedInfoRef.current || selectedInfoRef.current.musicInfo.source != 'local') return
    handleUpdateMusicInfo(selectedInfoRef.current.listId, selectedInfoRef.current.musicInfo, info)
  }, [])

  return (
    <View style={styles.container}>
      <View style={{ ...StyleSheet.absoluteFillObject, zIndex: 2 }} pointerEvents="box-none">
        <MultipleModeBar
          ref={multipleModeBarRef}
          onSwitchMode={hancelSwitchSelectMode}
          onSelectAll={(isAll) => listRef.current?.selectAll(isAll)}
          onExitSelectMode={hancelExitSelect}
        />
      </View>
      <View style={{ flex: 1 }}>
        {/* 固定页头：页头（PageTopInset + ActiveList）不再作为列表的 ListHeaderComponent
            塞进滚动内容里。此前「冷启动后第一次点开试听列表 / 我的收藏」会整页上飘、标题被
            顶到刘海后面（返回再进就正常）——页头在可滚动内容里时，首帧布局/原生安全区插图
            落定产生的偏移会把页头一起推上去。独立出来后页头位置只由页面顶部决定，
            与列表滚动彻底解耦。
            注意 withSafeAreaTop：页头独立在列表之外后，拿不到 RN 自动给列表叠加的
            安全区顶部插图（原先进列表内容里时是系统让的位），必须自己补，否则大标题会
            比「推荐」页标题高一个安全区（iPhone 59~62pt）贴住状态栏。 */}
        <View>
          <PageTopInset withSafeAreaTop />
          <ActiveList
            ref={activeListRef}
            onShowSearchBar={handleToggleSearch}
            onScrollToTop={hancelScrollToTop}
            showCover={showCover}
            onToggleView={handleToggleView}
            onBack={onBack}
          />
        </View>
        {/* 搜索条：页头下方的一行，普通布局流（不覆盖页头、不弹浮层） */}
        {isSearching ? (
          <ListSearchBar onSearch={handleSearchKeyword} onExitSearch={handleExitSearch} />
        ) : null}
        <List
          ref={listRef}
          listId={listId}
          filterKeyword={isSearching ? searchKeyword : ''}
          onShowMenu={showMenu}
          onMuiltSelectMode={hancelMultiSelect}
          onSelectAll={(isAll) => multipleModeBarRef.current?.setIsSelectAll(isAll)}
          showCover={showCover}
        />
      </View>
      <ListMusicAdd ref={listMusicAddRef} onAdded={hancelExitSelect} />
      <ListMusicMultiAdd ref={listMusicMultiAddRef} onAdded={hancelExitSelect} />
      <MusicPositionModal
        ref={musicPositionModalRef}
        onUpdatePosition={(info, postion) => {
          handleUpdateMusicPosition(
            postion,
            info.listId,
            info.musicInfo,
            info.selectedList,
            hancelExitSelect,
          )
        }}
      />
      <ListMenu
        ref={listMenuRef}
        onPlay={(info) => {
          handlePlay(info.listId, info.index)
        }}
        onPlayLater={(info) => {
          hancelExitSelect()
          handlePlayLater(info.listId, info.musicInfo, info.selectedList, hancelExitSelect)
        }}
        onRemove={(info) => {
          hancelExitSelect()
          handleRemove(info.listId, info.musicInfo, info.selectedList, hancelExitSelect)
        }}
        onDislikeMusic={(info) => {
          void handleDislikeMusic(info.musicInfo)
        }}
        onDownload={(info) => { downloadMusic(info.musicInfo) }}
        onAdd={handleAddMusic}
        onMove={handleMoveMusic}
        onEditMetadata={handleEditMetadata}
        onChangePosition={(info) => musicPositionModalRef.current?.show(info)}
        onToggleSource={(info) => musicToggleModalRef.current?.show(info)}
        onArtistDetail={handleShowArtist}
        onAlbumDetail={handleShowAlbum}
        onSimilarSongs={(info) => {
          similarSongsModalRef.current?.show(info.musicInfo)
        }}
        onClearCache={(info) => {
          void handleClearMusicCache(info.musicInfo)
        }}
      />
      <MetadataEditModal ref={metadataEditTypeRef} onUpdate={handleUpdateMetadata} />
      <MusicToggleModal ref={musicToggleModalRef} />
      <SimilarSongsModal ref={similarSongsModalRef} />
    </View>
  )
}

const styles = createStyle({
  container: {
    flex: 1,
    flexDirection: 'column',
  },
})
