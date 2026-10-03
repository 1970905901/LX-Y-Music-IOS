import { useCallback } from 'react'
import { TouchableOpacity, View } from 'react-native'

import Input from '@/components/common/Input'
import { Icon } from '@/components/common/Icon'
import Text from '@/components/common/Text'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'
import { BorderWidths } from '@/theme'
import { designRadius, designSpacing } from '@/theme/DesignTokens'

export interface ListSearchBarProps {
  onSearch: (keyword: string) => void
  onExitSearch: () => void
}

/**
 * 「我的收藏 / 自建列表」的搜索输入条 —— **就地过滤**的入口。
 *
 * 为什么不是旧版那套（用户反馈「太割裂」）：旧版点放大镜会连带四件事——
 * ① 把页头藏起来、② 在原页头位置盖一条输入条、③ 结果另开一个浮层列表、
 * ④ 点结果再把原列表滚到那首歌。于是「搜索」和「列表」变成两个互不相干的世界。
 *
 * 现在：输入条只是页头**下方普通的一行**（普通布局流，不 absolute 覆盖任何东西），
 * 输入直接过滤下方同一个列表（见 List.tsx + listFilter.ts），
 * 结果行就是列表行本身，取消后整表原样回来。
 *
 * 非受控输入：进入搜索即挂载、退出即卸载，文本自然清空，父级只需要拿关键字。
 */
export default ({ onSearch, onExitSearch }: ListSearchBarProps) => {
  const t = useI18n()
  const theme = useTheme()

  const handleChangeText = useCallback((text: string) => {
    onSearch(text.trim())
  }, [onSearch])

  return (
    <View style={{ ...styles.container, borderBottomColor: theme['c-border-background'] }}>
      <View style={{ ...styles.inputBox, backgroundColor: theme['c-primary-input-background'] }}>
        <Icon name="search-2" size={12} color={theme['c-font-label']} style={styles.searchIcon} />
        <Input
          autoFocus
          clearBtn
          returnKeyType='search'
          placeholder={t('list_search_placeholder')}
          onChangeText={handleChangeText}
          style={styles.input}
        />
      </View>
      <TouchableOpacity style={styles.btn} onPress={onExitSearch}>
        <Text color={theme['c-button-font']} numberOfLines={1}>{t('list_select_cancel')}</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = createStyle({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: designSpacing.md,
    paddingRight: designSpacing.sm,
    // 与页头行同高，进出搜索时列表高度变化最小
    height: 44,
    borderBottomWidth: BorderWidths.normal,
  },
  inputBox: {
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: 32,
    borderRadius: designRadius.sm,
    paddingLeft: 8,
  },
  searchIcon: {
    flexGrow: 0,
    flexShrink: 0,
  },
  input: {
    paddingLeft: 5,
    paddingRight: 5,
  },
  btn: {
    flexGrow: 0,
    flexShrink: 0,
    paddingLeft: 12,
    paddingRight: 4,
    height: '100%',
    justifyContent: 'center',
  },
})
