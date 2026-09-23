import { memo } from 'react'
import { View, TouchableOpacity } from 'react-native'
import { createStyle } from '@/utils/tools'
import { type ListInfoItem } from '@/store/songlist/state'
import Text from '@/components/common/Text'
import { scaleSizeW } from '@/utils/pixelRatio'
import { NAV_SHEAR_NATIVE_IDS } from '@/config/constant'
import { useTheme } from '@/store/theme/hook'
import Image from '@/components/common/Image'
import { designRadius, designSpacing, designTypography } from '@/theme/DesignTokens'

const gap = scaleSizeW(15)
export default memo(
  ({
    item,
    index,
    width,
    showSource,
    onPress,
  }: {
    item: ListInfoItem
    index: number
    showSource: boolean
    width: number
    onPress: (item: ListInfoItem, index: number) => void
  }) => {
    const theme = useTheme()
    const itemWidth = width - gap
    const handlePress = () => {
      onPress(item, index)
    }
    return item.source ? (
      <View style={{ ...styles.listItem, width: itemWidth }}>
        <View style={{ ...styles.listItemImg, backgroundColor: theme['c-content-background'] }}>
          <TouchableOpacity activeOpacity={0.5} onPress={handlePress}>
            <Image
              url={item.img}
              nativeID={`${NAV_SHEAR_NATIVE_IDS.songlistDetail_pic}_from_${item.id}`}
              style={{
                width: itemWidth,
                height: itemWidth,
                borderRadius: designRadius.lg,
              }}
            />
            {showSource ? (
              <Text style={styles.sourceLabel} size={11} color="#FFFFFF">
                {item.source}
              </Text>
            ) : null}
            {item.play_count ? (
              <Text style={styles.playCount} size={11} color="#FFFFFF" numberOfLines={1}>
                {item.play_count}
              </Text>
            ) : null}
          </TouchableOpacity>
        </View>
        <TouchableOpacity activeOpacity={0.5} onPress={handlePress}>
          <Text style={styles.listItemTitle} numberOfLines={2}>
            {item.name}
          </Text>
        </TouchableOpacity>
        {/* <Text>{JSON.stringify(item)}</Text> */}
      </View>
    ) : (
      <View style={{ ...styles.listItem, width: itemWidth }} />
    )
  }
)

const styles = createStyle({
  listItem: {
    // width: 90,
    margin: 10,
  },
  listItemImg: {
    borderRadius: designRadius.lg,
    marginBottom: designSpacing.sm,
    overflow: 'hidden',
    // iOS 专属阴影（仅 iPhone/iPad）
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.2,
    shadowRadius: 1.41,
  },
  sourceLabel: {
    paddingLeft: 8,
    paddingTop: 3,
    paddingBottom: 3,
    paddingRight: 8,
    position: 'absolute',
    left: 8,
    bottom: 8,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  playCount: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    position: 'absolute',
    top: 8,
    right: 8,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  listItemTitle: {
    fontSize: designTypography.caption,
    fontWeight: '600',
    // overflow: 'hidden',
    marginBottom: 5,
  },
})
