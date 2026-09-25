import { forwardRef, useImperativeHandle, useState } from 'react'
import { View } from 'react-native'

import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'
import Text from '@/components/common/Text'
import { designSpacing } from '@/theme/DesignTokens'

export interface ActiveListNameType {
  setBound: (id: string, name: string) => void
}

// 当前榜单名展示。原「点击打开侧边栏抽屉」交互已随抽屉一并移除，
// 榜单切换入口统一收敛到推荐页的排行榜区块。
export default forwardRef<ActiveListNameType>((_props, ref) => {
  const theme = useTheme()
  const [currentListName, setCurrentListName] = useState('')

  useImperativeHandle(
    ref,
    () => ({
      setBound(id, name) {
        setCurrentListName(name)
      },
    }),
    [],
  )

  return (
    <View style={styles.currentList}>
      <Text numberOfLines={1} style={styles.currentListText} color={theme['c-font']}>
        {currentListName}
      </Text>
    </View>
  )
})

const styles = createStyle({
  currentList: {
    flexShrink: 1,
    flexDirection: 'row',
    paddingLeft: designSpacing.sm,
    paddingRight: designSpacing.xs,
    paddingBottom: 4,
    alignItems: 'center',
  },
  currentListText: {
    flexShrink: 1,
    fontWeight: '600',
  },
})
