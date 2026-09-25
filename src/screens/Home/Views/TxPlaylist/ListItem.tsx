/**
 * QQ音乐歌单列表项 - 复刻网易云"我的歌单"列表项
 */

import { memo, useRef } from 'react'
import { View, TouchableOpacity, StyleSheet } from 'react-native'
import Image from '@/components/common/Image'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { Icon } from '@/components/common/Icon'
import type { Position } from '@/components/common/Menu'
import { scaleSizeH } from '@/utils/pixelRatio'
import { designRadius, designSpacing } from '@/theme/DesignTokens'
import { shadow } from '@/utils/shadow'

interface PlaylistItem {
  id: string
  name: string
  cover: string
  songCount: number
  desc?: string
  isFavorites?: boolean
  isCollected?: boolean
  dirid?: number
}

interface ListItemProps {
  item: PlaylistItem
  /** 横屏多列时每列宽度（如 '50%'），竖屏为 '100%' */
  rowWidth?: `${number}%`
  onPress: (item: PlaylistItem) => void
  onMenuPress: (item: PlaylistItem, position: Position) => void
}

export default memo(({ item, rowWidth = '100%', onPress, onMenuPress }: ListItemProps) => {
  const theme = useTheme()
  const menuBtnRef = useRef<TouchableOpacity>(null)

  const handleMenuPress = () => {
    menuBtnRef.current?.measure((fx, fy, width, height, px, py) => {
      const position = { x: Math.ceil(px), y: Math.ceil(py), w: Math.ceil(width), h: Math.ceil(height) }
      onMenuPress(item, position)
    })
  }

  const showMenu = !(item.isFavorites || item.isCollected)

  return (
    <TouchableOpacity
      style={[styles.container, { width: rowWidth, backgroundColor: theme['c-content-background'], borderColor: theme['c-border-background'] }]}
      onPress={() => onPress(item)}
    >
      <View style={styles.coverContainer}>
        <Image url={item.cover} style={styles.cover} />
        {item.isFavorites && (
          <View style={styles.favoritesOverlay}>
            <Icon name="love-filled" color="white" size={20} />
          </View>
        )}
      </View>

      <View style={styles.info}>
        <Text size={16} numberOfLines={2} color={theme['c-font']} style={{ fontWeight: '700' }}>{item.name}</Text>
        {item.songCount > 0 ? (
          <Text size={12} color={theme['c-font-label']} style={{ marginTop: 4 }}>
            {item.songCount} 首
          </Text>
        ) : null}
      </View>

      {showMenu && (
        <TouchableOpacity
          ref={menuBtnRef}
          style={styles.menuButton}
          onPress={(e) => {
            e.stopPropagation()
            handleMenuPress()
          }}
        >
          <Icon name="dots-vertical" color={theme['c-font-label']} size={20} />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  )
})

const styles = StyleSheet.create({
  // 卡片行样式与「我的」tab 歌单卡片完全一致
  container: {
    height: scaleSizeH(64),
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: designSpacing.md,
    marginHorizontal: designSpacing.md,
    marginBottom: designSpacing.sm,
    borderWidth: 1,
    borderRadius: designRadius.md,
    overflow: 'hidden',
    ...shadow(2),
  },
  coverContainer: {
    position: 'relative',
    marginRight: designSpacing.md,
  },
  cover: {
    width: 40,
    height: 40,
    borderRadius: designRadius.md,
  },
  favoritesOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: designRadius.md,
  },
  info: {
    flex: 1,
  },
  menuButton: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    justifyContent: 'center',
    alignItems: 'center',
  },
})
