/**
 * 酷狗音乐歌单列表项 - 复刻QQ音乐歌单列表项
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

interface PlaylistItem {
  id: string
  name: string
  cover: string
  songCount: number
  desc?: string
  isFavorites?: boolean
  isCollected?: boolean
}

interface ListItemProps {
  item: PlaylistItem
  onPress: (item: PlaylistItem) => void
  onMenuPress: (item: PlaylistItem, position: Position) => void
}

export default memo(({ item, onPress, onMenuPress }: ListItemProps) => {
  const theme = useTheme()
  const menuBtnRef = useRef<TouchableOpacity>(null)

  const handleMenuPress = () => {
    menuBtnRef.current?.measure((fx, fy, width, height, px, py) => {
      const position = { x: Math.ceil(px), y: Math.ceil(py), w: Math.ceil(width), h: Math.ceil(height) }
      onMenuPress(item, position)
    })
  }

  const showMenu = !item.isFavorites && !item.isCollected

  return (
    <TouchableOpacity
      style={[styles.container, { backgroundColor: theme['c-primary-light-900-alpha-300'] }]}
      onPress={() => { onPress(item) }}
    >
      <View style={styles.coverContainer}>
        {item.isFavorites ? (
          <View style={[styles.cover, styles.favoritesPlaceholder, { backgroundColor: theme['c-primary-background'] }]}>
            <Icon name="love-filled" color="#FF4D6A" size={20} />
          </View>
        ) : (
          <Image url={item.cover} style={styles.cover} />
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
  // 不可再设 width：卡片靠父容器 stretch 撑满，否则与 marginHorizontal 相加会溢出、右侧被裁切
  container: {
    height: scaleSizeH(64),
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: designSpacing.md,
    marginHorizontal: designSpacing.md,
    marginBottom: designSpacing.sm,
    borderRadius: designRadius.md,
    overflow: 'hidden',
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
  favoritesPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: designRadius.md,
    overflow: 'hidden',
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
    borderRadius: 8,
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
