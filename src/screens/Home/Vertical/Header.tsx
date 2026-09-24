import type { ReactNode } from 'react'
import { View } from 'react-native'
import { useNavActiveId, useStatusbarHeight } from '@/store/common/hook'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import Text from '@/components/common/Text'
import { scaleSizeH } from '@/utils/pixelRatio'
import { HEADER_HEIGHT } from '@/config/constant'
import { designSpacing } from '@/theme/DesignTokens'
import { type InitState as CommonState } from '@/store/common/state'
import GlobalSearch from '@/components/GlobalSearch'

const headerComponents: Partial<Record<CommonState['navActiveId'], ReactNode>> = {}

const Header = () => {
  const id = useNavActiveId()
  const t = useI18n()
  const statusBarHeight = useStatusbarHeight()
  const isSearchPage = id === 'nav_search'

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
      {isSearchPage ? headerComponents[id] : <GlobalSearch />}
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
    height: '100%',
  },
  title: {
    paddingLeft: designSpacing.xs,
    paddingRight: designSpacing.sm,
    fontWeight: '700',
  },
})

export default Header
