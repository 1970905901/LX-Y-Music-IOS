import { updateSetting } from '@/core/common'
import { reloadConfig } from '@/plugins/player'
import { useI18n } from '@/lang'
import { createStyle, toast } from '@/utils/tools'
import { memo } from 'react'
import { View } from 'react-native'
import { useSettingValue } from '@/store/setting/hook'

import CheckBoxItem from '../../components/CheckBoxItem'

// 开关文案是正向的「与其他应用同时播放」（2026-10-03 用户要求）：
//   开启 = 与其他应用同时播放（不处理音频焦点 → iOS 音频会话带 mixWithOthers）
//   关闭 = 其他应用播放声音时，自动暂停播放
// 存储键仍沿用 player.isHandleAudioFocus（true = 处理音频焦点 = 自动暂停），因此开关的
// 显示值与写入值都要取反；不改存储语义，就不用动 defaultSetting / migrateSetting /
// 播放器初始化（core/player/player.ts、plugins/player/index.ts 都按旧语义读这个键）。
// 注意：默认值 true → 升级后本开关默认是「关闭」（即仍然自动暂停），行为与改动前一致。
export default memo(() => {
  const t = useI18n()
  const isHandleAudioFocus = useSettingValue('player.isHandleAudioFocus')
  const playAlongWithOthers = !isHandleAudioFocus
  const setPlayAlongWithOthers = async(playAlongWithOthers: boolean) => {
    updateSetting({ 'player.isHandleAudioFocus': !playAlongWithOthers })
    // 切换后重新初始化播放器，让 iOS 音频会话分类（mixWithOthers）立即生效。
    await reloadConfig().catch(() => {})
    toast(t('setting_play_handle_audio_focus_tip'))
  }

  return (
    <View style={styles.content}>
      <CheckBoxItem
        check={playAlongWithOthers}
        onChange={setPlayAlongWithOthers}
        label={t('setting_play_handle_audio_focus')}
      />
    </View>
  )
})

const styles = createStyle({
  content: {
    marginTop: 5,
  },
})
