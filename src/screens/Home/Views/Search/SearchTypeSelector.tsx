import { useEffect, useMemo, useState } from 'react'
import { ScrollView, TouchableOpacity } from 'react-native'

import { createStyle } from '@/utils/tools'
import { type SearchType } from '@/store/search/state'
import { useI18n } from '@/lang'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { getSearchSetting } from '@/utils/data'
import { designRadius, designSpacing } from '@/theme/DesignTokens'

const SEARCH_TYPE_LIST = ['music', 'songlist', 'singer', 'album'] as const

export default () => {
  const t = useI18n()
  const theme = useTheme()
  const [type, setType] = useState<SearchType>('music')

  useEffect(() => {
    void getSearchSetting().then((info) => {
      setType(info.type)
    })

    const handleTypeChange = (newType: SearchType) => {
      setType(newType)
    }
    global.app_event.on('searchTypeChanged', handleTypeChange)
    return () => {
      global.app_event.off('searchTypeChanged', handleTypeChange)
    }
  }, [])

  const list = useMemo(() => {
    return SEARCH_TYPE_LIST.map((type) => ({ label: t(`search_type_${type}`), id: type }))
  }, [t])

  const handleTypeChange = (type: SearchType) => {
    setType(type)
    global.app_event.searchTypeChanged(type)
  }

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps={'always'} horizontal={true}>
      {list.map((item) => (
        <TouchableOpacity
          style={{
            ...styles.button,
            backgroundColor: type == item.id
              ? theme['c-primary']
              : theme['c-primary-light-900-alpha-200'],
            borderColor: type == item.id ? theme['c-primary'] : theme['c-border-background'],
            borderWidth: 1,
          }}
          onPress={() => {
            handleTypeChange(item.id)
          }}
          key={item.id}
        >
          <Text
            style={{
              ...styles.buttonText,
              color: type == item.id ? theme['c-primary-light-1000'] : theme['c-font-label'],
            }}
          >
            {item.label}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  )
}

const styles = createStyle({
  container: {
    height: '100%',
    flexGrow: 0,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  button: {
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    paddingLeft: designSpacing.sm,
    paddingRight: designSpacing.sm,
    marginRight: designSpacing.sm,
    borderRadius: designRadius.pill,
    borderWidth: 1,
  },
  buttonText: {
    textAlign: 'center',
    fontWeight: '600',
  },
})
