import { memo } from 'react'

import { View } from 'react-native'
import { createStyle } from '@/utils/tools'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { designSpacing } from '@/theme/DesignTokens'

interface Props {
  title: string
  children: React.ReactNode | React.ReactNode[]
  collapsible?: boolean
  sectionId?: keyof LX.AppSetting['common.sectionExpandedStatus']
}

export default memo(({ title, children }: Props) => {
  const theme = useTheme()

  return (
    <View style={styles.container}>
      <View style={styles.titleRow}>
        <Text style={{ ...styles.title, color: theme['c-font-label'] }} size={14}>
          {title}
        </Text>
      </View>
      {children}
    </View>
  )
})

const styles = createStyle({
  container: {
    marginTop: designSpacing.sm,
    marginBottom: designSpacing.sm,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: designSpacing.sm,
  },
  title: {
    fontWeight: '700',
    textTransform: 'uppercase',
    flex: 1,
  },
})
