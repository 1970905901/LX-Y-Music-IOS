import { memo } from 'react'

import SliderRow from '../../components/SliderRow'
import { useSettingValue } from '@/store/setting/hook'

export default memo(() => {
  const picOpacity = useSettingValue('theme.picOpacity')

  return <SliderRow settingKey="theme.picOpacity" title={'背景图片不透明度'} value={picOpacity} />
})
