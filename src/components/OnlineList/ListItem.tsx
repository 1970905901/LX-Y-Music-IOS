import { memo, useEffect, useRef, useState } from 'react'
import { View, TouchableOpacity } from 'react-native'
import Text from '@/components/common/Text'
import Badge, { type BadgeType } from '@/components/common/Badge'
import { Icon } from '@/components/common/Icon'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'
import settingState from '@/store/setting/state'
import { scaleSizeH } from '@/utils/pixelRatio'
import { LIST_ITEM_HEIGHT } from '@/config/constant'
import { createStyle, type RowInfo } from '@/utils/tools'
import Image from '@/components/common/Image'
import PlayingIcon from '@/components/common/PlayingIcon'
import { useIsWyLiked, useIsTxLiked, useIsKgLiked } from '@/store/user/hook'
import { fetchQsCover, getCachedQsCover } from '@/core/music/qsCover'
import { handleLikeMusic, handleTxLikeMusic, handleKgLikeMusic } from './listAction'

// 汽水(qs) 源自身通常不返回可用封面（meta.picUrl 为空）。
// 这里在列表项里按需用跨平台匹配（企鹅→网易→酷狗→酷我→咪咕）补全，
// 结果按「歌名|歌手」缓存，同名歌曲只请求一次。
// 放在列表项里做，才能同时覆盖排行榜、歌单详情、导入后的我的列表等所有展示场景
// （这些页面的列表由各自组件持有，只在 core 里回写 store 无法刷新界面）。
const useQsCover = (item: LX.Music.MusicInfoOnline): string => {
  const [url, setUrl] = useState(() => (item.source === 'qs' ? getCachedQsCover(item) : ''))

  useEffect(() => {
    if (item.source !== 'qs') {
      setUrl('')
      return
    }
    const cached = getCachedQsCover(item)
    if (cached) {
      setUrl(cached)
      return
    }
    let ignore = false
    void fetchQsCover(item).then((pic) => {
      if (!ignore && pic) setUrl(pic)
    })
    return () => {
      ignore = true
    }
  }, [item])

  // 汽水(qs) 自带封面 URL 常因签名/防盗链失效（排行榜、导入歌单的 meta.picUrl
  // 非空但加载失败），因此优先用跨平台匹配到的封面，匹配不到再回退自带封面。
  return item.source === 'qs' ? url || item.meta.picUrl : item.meta.picUrl
}

export const ITEM_HEIGHT = scaleSizeH(LIST_ITEM_HEIGHT)

const useQualityTag = (musicInfo: LX.Music.MusicInfoOnline) => {
  const t = useI18n()
  let info: { type: BadgeType | null; text: string } = { type: null, text: '' }
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
    }
  }

  return info
}

export default memo(
  ({
    item,
    index,
    showSource,
    onPress,
    onLongPress,
    onShowMenu,
    selectedList,
    rowInfo,
    isShowAlbumName,
    playingId,
    isShowInterval,
    listId,
    showCover = true,
    hideMenu = false,
  }: {
    item: LX.Music.MusicInfoOnline
    index: number
    showSource?: boolean
    onPress: (item: LX.Music.MusicInfoOnline, index: number) => void
    onLongPress: (item: LX.Music.MusicInfoOnline, index: number) => void
    onShowMenu: (
      item: LX.Music.MusicInfoOnline,
      index: number,
      position: { x: number; y: number; w: number; h: number }
    ) => void
    selectedList: LX.Music.MusicInfoOnline[]
    rowInfo: RowInfo
    isShowAlbumName: boolean
    isShowInterval: boolean
    playingId?: string | null;
    listId?: string
    showCover?: boolean
    hideMenu?: boolean
  }) => {
    const theme = useTheme()
    const isPlaying = playingId === item.id;
    const isSelected = selectedList.includes(item)
    const coverUrl = useQsCover(item)
    const isWyLiked = useIsWyLiked(item.meta.songId)
    const txSongId = (item.meta as any).id
    const isNumericId = txSongId && /^\d+$/.test(String(txSongId))
    const txSongMid = isNumericId 
      ? String(txSongId) 
      : (item.meta as any).songmid || (item.meta as any).strMediaMid || (typeof item.id === 'string' && item.id.startsWith('tx_') ? item.id.slice(3) : item.id)
    const isTxLiked = useIsTxLiked(txSongMid)
    const isKgLiked = useIsKgLiked((item.meta as any).hash || item.meta.songId)

    const moreButtonRef = useRef<TouchableOpacity>(null)
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

    const showLikeButton = item.source === 'wy' || item.source === 'tx' || item.source === 'kg'
    const isLiked = item.source === 'wy' ? isWyLiked : item.source === 'tx' ? isTxLiked : item.source === 'kg' ? isKgLiked : false

    const handleLike = () => {
      if (item.source === 'wy') {
        handleLikeMusic(item)
      } else if (item.source === 'tx') {
        handleTxLikeMusic(item)
      } else if (item.source === 'kg') {
        handleKgLikeMusic(item)
      }
    }

    const tagInfo = useQualityTag(item)
    const historySource = (item as LX.Music.MusicInfoOnline & { playHistorySource?: LX.Player.PlayHistorySource }).playHistorySource
    const singer = `${item.singer}${isShowAlbumName && item.meta.albumName ? `·${item.meta.albumName}` : ''}`

    return (
      <View
        style={{
          ...styles.listItem,
          width: rowInfo.rowWidth,
          height: ITEM_HEIGHT,
          backgroundColor: isPlaying || isSelected ? theme['c-primary-background-hover'] : 'rgba(0,0,0,0)',
        }}
      >
        <TouchableOpacity
          style={styles.listItemLeft}
          onPress={() => onPress(item, index)}
          onLongPress={() => onLongPress(item, index)}
        >


          <View style={showCover ? styles.sn : styles.snIndex}>
            {showCover ? (
              <Image url={coverUrl} style={styles.albumArt} />
            ) : isPlaying ? (
              <PlayingIcon />
            ) : (
              <Text color={theme['c-font']} size={12}>
                {index + 1}
              </Text>
            )}
          </View>
          <View style={styles.itemInfo}>
            <Text numberOfLines={1} color={isPlaying ? theme['c-primary-font'] : theme['c-font']}>
              {item.name}
              {item.alias ? <Text color={theme['c-font-label']}> ({item.alias})</Text> : null}
            </Text>
            <View style={styles.listItemSingle}>
              {showSource ? <Badge type="tertiary">{item.source.toUpperCase()}</Badge> : null}
              {tagInfo.type ? <Badge type={tagInfo.type}>{tagInfo.text}</Badge> : null}
              {item.meta.fee === 1 ? <Badge type="vip">VIP</Badge> : null}
              {item.source === 'wy' && item.meta.originCoverType === 2 ? <Badge type="normal">cover</Badge> : null}
              {historySource ? <Badge type="normal">{historySource}</Badge> : null}
              <Text
                style={styles.listItemSingleText}
                size={11}
                color={isPlaying ? theme['c-primary-alpha-200'] : theme['c-500']}
                numberOfLines={1}
              >
                {singer}
              </Text>
            </View>
          </View>
          {isShowInterval ? (
            <Text size={11} color={isPlaying ? theme['c-primary-alpha-200'] : theme['c-500']} numberOfLines={1}>
              {item.interval}
            </Text>
          ) : null}
        </TouchableOpacity>

        {showLikeButton ? (
          <TouchableOpacity onPress={handleLike} style={styles.likeButton}>
            <Icon name={isLiked ? "love-filled" : "love"} size={16} color={isLiked ? theme['c-liked'] : theme['c-350']} />
          </TouchableOpacity>
        ) : null}

        {hideMenu ? null : (
          <TouchableOpacity onPress={handleShowMenu} ref={moreButtonRef} style={styles.moreButton}>
            <Icon name="dots-vertical" style={{ color: theme['c-350'] }} size={12} />
          </TouchableOpacity>
        )}
      </View>
    )
  },
  (prevProps, nextProps) => {
    return !!(
      prevProps.item === nextProps.item &&
      prevProps.index === nextProps.index &&
      prevProps.showSource === nextProps.showSource &&
      prevProps.isShowAlbumName === nextProps.isShowAlbumName &&
      prevProps.isShowInterval === nextProps.isShowInterval &&
      prevProps.listId === nextProps.listId &&
      prevProps.playingId === nextProps.playingId &&
      prevProps.hideMenu === nextProps.hideMenu &&
      (prevProps.item as any).playHistorySource === (nextProps.item as any).playHistorySource &&
      nextProps.selectedList.includes(nextProps.item) ==
      prevProps.selectedList.includes(nextProps.item) &&
      prevProps.showCover === nextProps.showCover
    )
  }
)

const styles = createStyle({
  listItem: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    paddingRight: 2,
    alignItems: 'center',
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
    paddingLeft: 2,
    paddingRight: 2,
  },
  listItemSingle: {
    paddingTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
  },
  listItemTimeLabel: {
    marginRight: 5,
    fontWeight: '400',
  },
  listItemSingleText: {
    flexGrow: 0,
    flexShrink: 1,
    fontWeight: '300',
  },
  listItemBadge: {
    paddingLeft: 5,
    paddingTop: 2,
    alignSelf: 'flex-start',
  },
  listItemRight: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
    justifyContent: 'center',
  },
  likeButton: {
    height: '80%',
    paddingHorizontal: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  moreButton: {
    height: '80%',
    paddingLeft: 10,
    paddingRight: 16,
    justifyContent: 'center',
  },
})
