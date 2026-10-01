import { memo } from 'react'
import SubTitle from '../../components/SubTitle'
import CheckBoxItem from '../../components/CheckBoxItem'
import { useI18n } from '@/lang'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'

type MenuSettingKey =
  | 'menu.playLater'
  | 'menu.dislike'

const SettingItem = ({ settingKey, label, helpDesc }: { settingKey: MenuSettingKey, label: string, helpDesc?: string }) => {
  const value = useSettingValue(settingKey)
  const handleChange = (newValue: boolean) => {
    updateSetting({ [settingKey]: newValue })
  }

  return (
    <CheckBoxItem
      check={value}
      onChange={handleChange}
      label={label}
      helpDesc={helpDesc}
    />
  )
}

export default memo(() => {
  const t = useI18n()

  return (
    <SubTitle title="菜单设置">
      {/* 与列表设置页其它开关行保持同一套「整行卡片」样式：
          之前这里是「带底纹的外框里再放两个无边框复选框」，双层容器视觉上与页面
          其它设置行不一致（用户反馈违和）。 */}
      <SettingItem
        settingKey="menu.playLater"
        label={t('play_later')}
        helpDesc="在歌曲菜单中显示「稍后播放」"
      />
      <SettingItem
        settingKey="menu.dislike"
        label={t('dislike')}
        helpDesc="在歌曲菜单中显示「不喜欢」"
      />
    </SubTitle>
  )
})
