import { View } from 'react-native'

import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import Text from '@/components/common/Text'
import { scaleSizeH } from '@/utils/pixelRatio'
import { designSpacing } from '@/theme/DesignTokens'

interface Props {
  title: string
  children: React.ReactNode | React.ReactNode[]
  sectionId?: keyof LX.AppSetting['common.sectionExpandedStatus']
}

export default ({ title, children }: Props) => {
  const theme = useTheme()

  return (
    <View style={styles.container}>
      <View style={styles.titleContainer}>
        <Text
          style={{ ...styles.title, borderLeftColor: theme['c-primary'], color: theme['c-font'] }}
          size={16}
        >
          {title}
        </Text>
      </View>
      <View>{children}</View>
    </View>
  )
}

const styles = createStyle({
  container: {
    marginBottom: scaleSizeH(12),
  },
  titleContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: designSpacing.sm,
  },
  title: {
    borderLeftWidth: 4,
    paddingLeft: designSpacing.sm,
    fontWeight: '600',
    flex: 1,
  },
})
