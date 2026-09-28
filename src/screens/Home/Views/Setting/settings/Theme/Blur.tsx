// screens/Home/Views/Setting/settings/Theme/Blur.tsx

import { memo } from 'react'

import SliderRow from '../../components/SliderRow'
import { useSettingValue } from '@/store/setting/hook'

export default memo(() => {
  const blur = useSettingValue('theme.blur')

  return <SliderRow settingKey="theme.blur" title={'背景模糊度'} value={blur} />
})
