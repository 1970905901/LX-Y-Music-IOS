import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import { memo } from 'react'
import { View } from 'react-native'
import { useSettingValue } from '@/store/setting/hook'

import CheckBoxItem from '../../components/CheckBoxItem'

// 说明（2026-10-03 改造）：原「返回软件时自动播放」在代码里从未接线（只有设置项、
// 没有消费方），现按需求改成「启动软件自动播放」——启动 App 后，只要求链路里
// 恢复出一首处于暂停状态的歌，就自动开始播放（实现见 core/init/player/playInfo.ts）。
// 存储键同步改名 player.autoPlayOnReturn → player.startupAutoPlay（老键在
// config/setting.ts 做一次性迁移）。
export default memo(() => {
  const t = useI18n()
  const startupAutoPlay = useSettingValue('player.startupAutoPlay')
  const setStartupAutoPlay = (startupAutoPlay: boolean) => {
    updateSetting({ 'player.startupAutoPlay': startupAutoPlay })
  }

  return (
    <View style={styles.content}>
      <CheckBoxItem
        check={startupAutoPlay}
        label={t('setting_player_auto_play_on_startup')}
        onChange={setStartupAutoPlay}
        helpDesc={t('setting_player_auto_play_on_startup_tip')}
      />
    </View>
  )
})

const styles = createStyle({
  content: {
    marginTop: 5,
  },
})
