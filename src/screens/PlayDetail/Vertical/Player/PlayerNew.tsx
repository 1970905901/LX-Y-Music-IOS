import { memo, useMemo } from 'react'
import { StyleSheet, View } from 'react-native'

import PlayInfo from './components/PlayInfo'
import ControlBtn from './components/ControlBtn'
import FeatureBtns from '../FeatureBtns'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { NAV_SHEAR_NATIVE_IDS } from '@/config/constant'
import { useWindowSize } from '@/utils/hooks'
import { scaleSizeW } from '@/utils/pixelRatio'
import { designRadius, designSpacing } from '@/theme/DesignTokens'
import { shadow } from '@/utils/shadow'

const PlayerNew = memo(({ componentId }: { componentId: string }) => {
  const theme = useTheme()
  const { height: winHeight } = useWindowSize()
  const containerStyle = useMemo(() => ({
    paddingHorizontal: scaleSizeW(14),
    paddingBottom: Math.max(Math.round(winHeight * 0.012), 10),
    paddingTop: Math.max(Math.round(winHeight * 0.006), 4),
  }), [winHeight])

  const cardStyle = useMemo(
    () => StyleSheet.compose(styles.card, {
      backgroundColor: theme['c-content-background'],
      borderColor: theme['c-border-background'],
      ...shadow(8),
    }),
    [theme],
  )

  return (
    <View
      style={[styles.container, cardStyle, containerStyle]}
      nativeID={NAV_SHEAR_NATIVE_IDS.playDetail_player}
    >
      <FeatureBtns componentId={componentId} />
      <PlayInfo />
      <ControlBtn />
    </View>
  )
})

export default PlayerNew

const styles = createStyle({
  container: {
    flex: 0,
    flexDirection: 'column',
  },
  card: {
    marginHorizontal: designSpacing.lg,
    borderRadius: designRadius.lg,
    borderWidth: 1,
  },
})
