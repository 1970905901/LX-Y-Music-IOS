// screens/Home/Views/Setting/settings/Theme/LiquidGlassToggle.tsx
// 液态玻璃（vendored LiquidGlassKit 的 Metal 折射引擎）开关，全 iOS 版本显示。
// 开：Tab 栏 / 迷你播放条 / 收起圆钮用 Metal 液态玻璃（折射 + 边缘光，随主题染色），
//     即 DnV1eX/LiquidGlassKit 的核心效果（上游定位即 iOS 13~18 的 backport）；
// 关：退回系统磨砂（iOS 26+ 的 UIGlassEffect / 其余系统 UIBlurEffect）+ 染色覆层。
// 切换实时生效：原生宿主重建背衬并重放缓存的主题属性（见 LiquidGlassViewManager.mm
// 的 applyLiquidMode:）。磨砂形态才有「玻璃不透明度」设置（ThemeScreen 控制显隐）。

import { memo } from 'react'
import { View } from 'react-native'

import CheckBoxItem from '../../components/CheckBoxItem'
import { createStyle } from '@/utils/tools'
import { useI18n } from '@/lang'
import { updateSetting } from '@/core/common'
import { useSettingValue } from '@/store/setting/hook'

export default memo(() => {
  const t = useI18n()
  const liquidGlass = useSettingValue('theme.liquidGlass')
  const setLiquidGlass = (liquid: boolean) => {
    updateSetting({ 'theme.liquidGlass': liquid })
  }

  return (
    <View style={styles.content}>
      <CheckBoxItem
        check={liquidGlass}
        label={t('setting_basic_theme_liquid_glass')}
        onChange={setLiquidGlass}
      />
    </View>
  )
})

const styles = createStyle({
  content: {
    marginTop: 5,
    marginBottom: 15,
  },
})
