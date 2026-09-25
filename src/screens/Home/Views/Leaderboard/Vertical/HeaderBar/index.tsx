import { forwardRef, useImperativeHandle, useRef } from 'react'
import { View } from 'react-native'

import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import ActiveListName, { type ActiveListNameType } from './ActiveListName'
import { BorderWidths } from '@/theme'

export interface HeaderBarType {
  setBound: (source: LX.OnlineSource, id: string, name: string) => void
}

// 排行榜页顶部：仅展示当前榜单名。平台切换与榜单选择已由推荐页的排行榜区块承担，
// 原平台下拉选择器（SourceSelector）与打开侧边栏抽屉的入口（onShowBound）已移除。
export default forwardRef<HeaderBarType>((_props, ref) => {
  const activeListNameRef = useRef<ActiveListNameType>(null)
  const theme = useTheme()

  useImperativeHandle(
    ref,
    () => ({
      setBound(source, id, name) {
        activeListNameRef.current?.setBound(id, name)
      },
    }),
    [],
  )

  return (
    <View style={{ ...styles.currentList, borderBottomColor: theme['c-border-background'] }}>
      <ActiveListName ref={activeListNameRef} />
    </View>
  )
})

const styles = createStyle({
  currentList: {
    flexDirection: 'row',
    height: 38,
    zIndex: 2,
    borderBottomWidth: BorderWidths.normal,
  },
})
