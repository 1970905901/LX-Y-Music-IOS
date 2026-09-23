import { View } from 'react-native'

import Button from '@/components/common/Button'
import { type TagInfoItem } from '@/store/songlist/state'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'
import Text from '@/components/common/Text'
import { designRadius, designSpacing, designTypography } from '@/theme/DesignTokens'

export interface TagGroupProps {
  name: string
  list: TagInfoItem[]
  onTagChange: (name: string, id: string) => void
  activeId: string
}

export default ({ name, list, onTagChange, activeId }: TagGroupProps) => {
  const theme = useTheme()
  return (
    <View>
      {name ? (
        <Text style={styles.tagTypeTitle} size={designTypography.caption} color={theme['c-font-label']}>
          {name}
        </Text>
      ) : null}
      <View style={styles.tagTypeList}>
        {list.map((item) =>
          activeId == item.id ? (
            <View
              style={{
                ...styles.tagButton,
                backgroundColor: theme['c-primary'],
                borderColor: theme['c-primary'],
              }}
              key={item.id}
            >
              <Text style={styles.tagButtonText} color={theme['c-primary-light-1000']}>
                {item.name}
              </Text>
            </View>
          ) : (
            <Button
              style={{
                ...styles.tagButton,
                backgroundColor: theme['c-primary-light-900-alpha-300'],
                borderColor: theme['c-border-background'],
              }}
              key={item.id}
              onPress={() => {
                onTagChange(item.name, item.id)
              }}
            >
              <Text style={styles.tagButtonText} color={theme['c-font']}>
                {item.name}
              </Text>
            </Button>
          )
        )}
      </View>
    </View>
  )
}

const styles = createStyle({
  tagTypeTitle: {
    marginTop: designSpacing.md,
    marginBottom: designSpacing.sm,
    fontWeight: '600',
  },
  tagTypeList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  tagButton: {
    height: 34,
    borderWidth: 1,
    borderRadius: designRadius.pill,
    marginRight: designSpacing.sm,
    marginBottom: designSpacing.sm,
    justifyContent: 'center',
  },
  tagButtonText: {
    fontSize: designTypography.caption,
    fontWeight: '600',
    paddingLeft: designSpacing.sm,
    paddingRight: designSpacing.sm,
  },
})
