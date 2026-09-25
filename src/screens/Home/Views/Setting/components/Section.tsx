import { View } from 'react-native'

import { createStyle } from '@/utils/tools'
import { scaleSizeH } from '@/utils/pixelRatio'

interface Props {
  children: React.ReactNode | React.ReactNode[]
  sectionId?: keyof LX.AppSetting['common.sectionExpandedStatus']
}

// 页面大标题已由 SettingDetail 顶部页头承担，Section 不再渲染自己的标题行，
// 避免进入设置详情页后出现两行相同的标题。
export default ({ children }: Props) => {
  return (
    <View style={styles.container}>
      <View>{children}</View>
    </View>
  )
}

const styles = createStyle({
  container: {
    marginBottom: scaleSizeH(12),
  },
})
