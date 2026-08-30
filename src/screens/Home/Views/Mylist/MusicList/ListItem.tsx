import { memo, useRef } from 'react'
import { View, TouchableOpacity } from 'react-native'
import { LIST_ITEM_HEIGHT } from '@/config/constant'
import { Icon } from '@/components/common/Icon'
import { createStyle, type RowInfo } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import settingState from '@/store/setting/state'
import { useAssertApiSupport } from '@/store/common/hook'
import { scaleSizeH } from '@/utils/pixelRatio'
import Text from '@/components/common/Text'
import Badge, { type BadgeType } from '@/components/common/Badge'
import Image from '@/components/common/Image'
import PlayingIcon from '@/components/common/PlayingIcon'
import { useI18n } from '@/lang'
import { useIsWyLiked, useIsTxLiked, useIsKgLiked } from '@/store/user/hook'
import { handleLikeMusic, handleTxLikeMusic, handleKgLikeMusic } from '@/components/OnlineList/listAction'
import useCoverUrl from '@/utils/hooks/useCoverUrl'

export const ITEM_HEIGHT = scaleSizeH(LIST_ITEM_HEIGHT)

// 列表项封面：优先用自带 meta.picUrl；为空时按需动态获取（在线接口/本地内嵌/
// 网盘封面/qs 跨平台匹配），解决 cookie 歌单、WebDAV 同步、备份导入的歌单
// 「列表无封面但播放有封面」的问题（播放时 player 走同一 getPicPath 动态获取）。
// 结果带缓存与并发限制，见 core/music/coverUrl.ts。

const useQualityTag = (musicInfo: LX.Music.MusicInfo) => {
  const t = useI18n()
  let info: { type: BadgeType | null; text: string } = { type: null, text: '' }
  if (musicInfo.source === 'local') return info
  const qualitys = (musicInfo.meta as LX.Music.MusicInfoMeta_online)?._qualitys ?? {}
  const showHighest = settingState.setting['common.quality_show_highest']

  if (showHighest) {
    if (qualitys.master) {
      info.type = 'secondary'
      info.text = t('quality_lossless_master')
    } else if (qualitys.atmos_plus) {
      info.type = 'secondary'
      info.text = t('quality_lossless_atmos_plus')
    } else if (qualitys.atmos) {
      info.type = 'secondary'
      info.text = t('quality_lossless_atmos')
    } else if (qualitys.hires) {
      info.type = 'secondary'
      info.text = t('quality_lossless_24bit')
    } else if (qualitys.flac) {
      info.type = 'sq'
      info.text = t('quality_lossless')
    } else if (qualitys['320k']) {
      info.type = 'hq'
      info.text = t('quality_high_quality')
    }
  } else {
    if (qualitys.hires) {
      info.type = 'secondary'
      info.text = t('quality_lossless_24bit')
    } else if (qualitys.flac) {
      info.type = 'sq'
      info.text = t('quality_lossless')
    } else if (qualitys['320k']) {
      info.type = 'hq'
      info.text = t('quality_high_quality')
    } else if ((qualitys as any)['192k']) {
      info.type = 'hq'
      info.text = '192k'
    }
  }

  return info
}

export default memo(
  ({
    item,
    index,
    activeIndex,
    onPress,
    onShowMenu,
    onLongPress,
    selectedList,
    rowInfo,
    isShowAlbumName,
    isShowInterval,
    showCover,
  }: {
    item: LX.Music.MusicInfo
    index: number
    activeIndex: number
    onPress: (item: LX.Music.MusicInfo, index: number) => void
    onLongPress: (item: LX.Music.MusicInfo, index: number) => void
    onShowMenu: (
      item: LX.Music.MusicInfo,
      index: number,
      position: { x: number; y: number; w: number; h: number }
    ) => void
    selectedList: LX.Music.MusicInfo[]
    rowInfo: RowInfo
    isShowAlbumName: boolean
    isShowInterval: boolean
    showCover: boolean
    onScrollBeginDrag?: () => void
  }) => {
    const theme = useTheme()
    const coverUrl = useCoverUrl(item)
    // 汽水(qs) 等音源经 filterListDetail 构造的歌曲可能不带 meta 字段，这里兜底避免
    // 下方 item.meta.xxx 访问 undefined 时整行抛错、导致整列表空白（尤其播放态重渲染时）。
    const meta = (item.meta ?? {}) as any
    const isSelected = selectedList.includes(item)
    const isSupported = useAssertApiSupport(item.source)
    const moreButtonRef = useRef<TouchableOpacity>(null)

    const isWyLiked = useIsWyLiked(meta.songId)
    const txSongId = meta.id
    const isNumericId = txSongId && /^\d+$/.test(String(txSongId))
    const txSongMid = isNumericId 
      ? String(txSongId) 
      : (item.meta as any).songmid || (item.meta as any).strMediaMid || (typeof item.id === 'string' && item.id.startsWith('tx_') ? item.id.slice(3) : item.id)
    const isTxLiked = useIsTxLiked(txSongMid)
    const isKgLiked = useIsKgLiked(meta.hash || meta.songId)
    const showLikeButton = item.source === 'wy' || item.source === 'tx' || item.source === 'kg'
    const isLiked = item.source === 'wy' ? isWyLiked : item.source === 'tx' ? isTxLiked : item.source === 'kg' ? isKgLiked : false

    const handleLike = () => {
      if (item.source === 'wy') {
        handleLikeMusic(item as LX.Music.MusicInfoOnline)
      } else if (item.source === 'tx') {
        handleTxLikeMusic(item as LX.Music.MusicInfoOnline)
      } else if (item.source === 'kg') {
        handleKgLikeMusic(item as LX.Music.MusicInfoOnline)
      }
    }

    const tagInfo = useQualityTag(item)

    const handleShowMenu = () => {
      if (moreButtonRef.current?.measure) {
        moreButtonRef.current.measure((fx, fy, width, height, px, py) => {
          onShowMenu(item, index, {
            x: Math.ceil(px),
            y: Math.ceil(py),
            w: Math.ceil(width),
            h: Math.ceil(height),
          })
        })
      }
    }

    const active = activeIndex == index
    const singer = `${item.singer}${isShowAlbumName && meta.albumName ? `·${meta.albumName}` : ''}`

    return (
      <View
        style={{
          ...styles.listItem,
          width: rowInfo.rowWidth,
          height: ITEM_HEIGHT,
          backgroundColor: isSelected ? theme['c-primary-background-hover'] : 'rgba(0,0,0,0)',
          opacity: isSupported ? 1 : 0.5,
        }}
      >
        <TouchableOpacity
          style={styles.listItemLeft}
          onPress={() => {
            onPress(item, index)
          }}
          onLongPress={() => {
            onLongPress(item, index)
          }}
        >



          <View style={showCover ? styles.sn : styles.snIndex}>
            {showCover ? (
              <Image url={coverUrl} style={styles.albumArt} />
            ) : active ? (
              <PlayingIcon />
            ) : (
              <Text color={theme['c-font']} size={12}>
                {index + 1}
              </Text>
            )}
          </View>
          <View style={styles.itemInfo}>
            <Text color={active ? theme['c-primary-font'] : theme['c-font']} numberOfLines={1}>
              {item.name}
              {item.alias ? <Text color={theme['c-font-label']}> ({item.alias})</Text> : null}
            </Text>
            <View style={styles.listItemSingle}>
              <Badge>{item.source.toUpperCase()}</Badge>
              {tagInfo.type ? <Badge type={tagInfo.type}>{tagInfo.text}</Badge> : null}
              {item.source !== 'local' && meta.fee === 1 ? <Badge type="vip">VIP</Badge> : null}
              {item.source === 'wy' && meta.originCoverType === 2 ? <Badge type="normal">cover</Badge> : null}
              <Text
                style={styles.listItemSingleText}
                size={11}
                color={active ? theme['c-primary-alpha-200'] : theme['c-500']}
                numberOfLines={1}
              >
                {singer}
              </Text>
            </View>
          </View>
          {isShowInterval ? (
            <Text
              size={11}
              color={active ? theme['c-primary-alpha-400'] : theme['c-500']}
              numberOfLines={1}
            >
              {item.interval}
            </Text>
          ) : null}
        </TouchableOpacity>
        {showLikeButton ? (
          <TouchableOpacity onPress={handleLike} style={styles.likeButton}>
            <Icon name={isLiked ? "love-filled" : "love"} size={16} color={isLiked ? theme['c-liked'] : theme['c-350']} />
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity onPress={handleShowMenu} ref={moreButtonRef} style={styles.moreButton}>
          <Icon name="dots-vertical" style={{ color: theme['c-350'] }} size={12} />
        </TouchableOpacity>
      </View>
    )
  },
  (prevProps, nextProps) => {
    return !!(
      prevProps.item === nextProps.item &&
      prevProps.index === nextProps.index &&
      prevProps.isShowAlbumName === nextProps.isShowAlbumName &&
      prevProps.isShowInterval === nextProps.isShowInterval &&
      prevProps.activeIndex != nextProps.index &&
      nextProps.activeIndex != nextProps.index &&
      nextProps.selectedList.includes(nextProps.item) ==
      prevProps.selectedList.includes(nextProps.item) &&
      prevProps.showCover === nextProps.showCover
    )
  }
)

const styles = createStyle({
  listItem: {
    // width: '50%',
    flexDirection: 'row',
    flexWrap: 'nowrap',
    // paddingLeft: 10,
    paddingRight: 2,
    alignItems: 'center',
    // borderBottomWidth: BorderWidths.normal,
  },
  listItemLeft: {
    flex: 1,
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sn: {
    width: 70,
    justifyContent: 'center',
    alignItems: 'center',
    paddingLeft: 5,
    paddingRight: 5,
  },
  snIndex: {
    width: 40,
    justifyContent: 'center',
    alignItems: 'center',
    paddingLeft: 5,
    paddingRight: 5,
  },
  albumArt: {
    width: 52,
    height: 52,
    borderRadius: 4,
  },
  itemInfo: {
    flexGrow: 1,
    flexShrink: 1,
    // paddingTop: 10,
    // paddingBottom: 10,
    paddingRight: 2,
  },
  // listItemTitle: {
  //   flexGrow: 0,
  //   flexShrink: 1,
  // },
  listItemSingle: {
    paddingTop: 3,
    flexDirection: 'row',
    // alignItems: 'flex-end',
  },
  listItemSingleText: {
    // backgroundColor: 'rgba(0,0,0,0.2)',
    flexGrow: 0,
    flexShrink: 1,
    fontWeight: '300',
    // fontSize: 15,
  },
  // listItemBadge: {
  //   // fontSize: 10,
  //   paddingLeft: 5,
  //   paddingTop: 2,
  //   alignSelf: 'flex-start',
  // },
  listItemRight: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
    justifyContent: 'center',
  },

  moreButton: {
    height: '80%',
    paddingLeft: 10,
    paddingRight: 16,
    // paddingTop: 10,
    // paddingBottom: 10,
    // backgroundColor: 'rgba(0,0,0,0.2)',
    justifyContent: 'center',
  },
  likeButton: {
    height: '80%',
    paddingHorizontal: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
})
