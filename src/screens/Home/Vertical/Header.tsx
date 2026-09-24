import { View } from 'react-native'
import { useNavActiveId, useStatusbarHeight } from '@/store/common/hook'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import Text from '@/components/common/Text'
import { scaleSizeH } from '@/utils/pixelRatio'
import { HEADER_HEIGHT } from '@/config/constant'
import { designSpacing } from '@/theme/DesignTokens'

const Header = () => {
  const id = useNavActiveId()
  const t = useI18n()
  const statusBarHeight = useStatusbarHeight()
  return (
    <View
      style={{
        ...styles.container,
        height: scaleSizeH(HEADER_HEIGHT) + statusBarHeight,
        paddingTop: statusBarHeight,
      }}
    >
      <View style={styles.left}>
        <Text style={styles.title} size={20}>
          {t(id)}
        </Text>
      </View>
    </View>
  )
}

const styles = createStyle({
  container: {
    paddingRight: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  left: {
    flex: 1,
    flexDirection: 'row',
    paddingLeft: 12,
    alignItems: 'center',
  },
  title: {
    paddingLeft: designSpacing.xs,
    paddingRight: designSpacing.sm,
    fontWeight: '700',
  },
})

export default Header
