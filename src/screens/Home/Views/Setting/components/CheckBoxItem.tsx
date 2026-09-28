import { memo } from 'react'

import { View } from 'react-native'

import CheckBox, { type CheckBoxProps } from '@/components/common/CheckBox'
import { createStyle } from '@/utils/tools'

export default memo((props: CheckBoxProps) => {
  return (
    <View style={styles.container}>
      {/* block：设置页的开关项都独占整行，卡片铺满可用宽度并去掉并排间隙用的右外边距
          （统一样式由 CheckBox 的 card 变体提供，对齐推荐页「排行榜」按钮） */}
      <CheckBox {...props} block />
    </View>
  )
})

const styles = createStyle({
  container: {
    justifyContent: 'center',
    // 行间距由 Card 自身的 marginBottom（8pt）统一提供，这里不再叠加，
    // 否则相邻两行会变成 16pt 的双倍间隙。
  },
})
