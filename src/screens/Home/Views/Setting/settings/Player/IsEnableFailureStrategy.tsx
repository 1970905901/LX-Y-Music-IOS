import { memo, useCallback } from 'react'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import CheckBoxItem from '../../components/CheckBoxItem'

export default memo(() => {
  const t = useI18n()
  const isEnableFailureStrategy = useSettingValue('player.enableFailureStrategy')

  const setEnableFailureStrategy = useCallback((val: boolean) => {
    updateSetting({ 'player.enableFailureStrategy': val })
  }, [])

  return (
    <CheckBoxItem
      check={isEnableFailureStrategy}
      label={t('setting_play_failure_enable') || '优先重试3次'}
      helpDesc="开启后优先重试播放歌曲三次，若都失败则执行播放失败策略。但会导致播放失败策略执行延后"
      onChange={setEnableFailureStrategy}
    />
  )
})
