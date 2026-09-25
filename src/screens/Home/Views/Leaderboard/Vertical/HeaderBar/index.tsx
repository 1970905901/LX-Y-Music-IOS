import { forwardRef, useImperativeHandle, useRef } from 'react'
import { View } from 'react-native'

import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import ActiveListName, { type ActiveListNameType } from './ActiveListName'
import Text from '@/components/common/Text'
import { designSpacing } from '@/theme/DesignTokens'

export interface HeaderBarType {
  setBound: (source: LX.OnlineSource, id: string, name: string) => void
}

// 页头：接管「排行榜」大标题（Home 共享页头已对 nav_top 隐藏），
// 当前榜单名以黑色字体与大标题同行展示。
export default forwardRef<HeaderBarType>((_props, ref) => {
  const activeListNameRef = useRef<ActiveListNameType>(null)
  const theme = useTheme()
  const t = useI18n()

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
    <View style={styles.titleRow}>
      <Text style={styles.title} size={34} color={theme['c-font']}>{t('nav_top')}</Text>
      <ActiveListName ref={activeListNameRef} />
    </View>
  )
})

const styles = createStyle({
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: designSpacing.lg,
    marginBottom: designSpacing.sm,
  },
  title: {
    fontWeight: '800',
    lineHeight: 36,
  },
})
