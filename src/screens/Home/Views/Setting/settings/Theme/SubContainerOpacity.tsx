import { memo } from 'react'

import SliderRow from '../../components/SliderRow'
import { useSettingValue } from '@/store/setting/hook'

export default memo(() => {
  const subContainerOpacity = useSettingValue('theme.subContainerOpacity')

  return (
    <SliderRow
      settingKey="theme.subContainerOpacity"
      title={'容器背景不透明度'}
      value={subContainerOpacity}
    />
  )
})
