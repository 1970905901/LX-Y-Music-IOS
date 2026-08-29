import { updateSetting } from '@/core/common'
import { createStyle, toast } from '@/utils/tools'
import { memo } from 'react'
import { View } from 'react-native'
import { useSettingValue } from '@/store/setting/hook'
import { setScreenOrientation } from '@/utils/nativeModules/utils'
import { useI18n } from '@/lang'
import { Platform } from 'react-native'

import CheckBoxItem from '../../components/CheckBoxItem'

export default memo(() => {
  const lockLandscape = useSettingValue('common.lockLandscape')
  const t = useI18n()

  const setLockLandscape = (value: boolean) => {
    updateSetting({ 'common.lockLandscape': value })
    // 切换横屏模式后，首页需要重启软件才会生效，给出即时提示（说明文字里的提示用户不易注意到）。
    toast(t('setting_basic_lock_landscape_restart_tip'))
    // iOS 无 UtilsModule.setScreenOrientation，横屏锁定由 RNN 的 layout.orientation 配置处理
    if (Platform.OS === 'ios') return
    setScreenOrientation(value ? 'landscape' : 'portrait')
  }

  return (
    <View style={styles.content}>
      <CheckBoxItem
        check={lockLandscape}
        label={t('setting_basic_lock_landscape')}
        helpDesc={t('setting_basic_lock_landscape_tip')}
        onChange={setLockLandscape}
      />
    </View>
  )
})

const styles = createStyle({
  content: {
    marginTop: 5,
  },
})
