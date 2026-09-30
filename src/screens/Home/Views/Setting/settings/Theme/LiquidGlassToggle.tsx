// screens/Home/Views/Setting/settings/Theme/LiquidGlassToggle.tsx
// 液态玻璃（vendored LiquidGlassKit 的 Metal 折射引擎）开关，全 iOS 版本显示。
// 开：Tab 栏 / 迷你播放条 / 收起圆钮用 Metal 液态玻璃（折射 + 边缘光，随主题染色），
//     即 DnV1eX/LiquidGlassKit 的核心效果（上游定位即 iOS 13~18 的 backport）；
//     **iOS 26.2+ 例外**——呈现系统原生 UIGlassEffect(.regular)（2026-09-30 定案，
//     见 LGGlassViewFactory.swift 的 createGlassBacking：系统合成零捕获成本，规避自研
//     Metal 在 26.2+/27 的跳动/闪烁/前景碎片问题链）。故行下方必须标注版本分档，
//     否则 26.2+ 用户会以为「开了没生效 / 和系统自带的一模一样」。
// 关：退回系统磨砂（UIBlurEffect.systemMaterial）+ 染色覆层。
// 切换实时生效：原生宿主重建背衬并重放缓存的主题属性（见 LiquidGlassViewManager.mm
// 的 applyLiquidMode:）。磨砂形态才有「玻璃不透明度」设置（ThemeScreen 控制显隐）。

import { memo } from 'react'
import { View } from 'react-native'

import CheckBoxItem from '../../components/CheckBoxItem'
import Text from '@/components/common/Text'
import { createStyle } from '@/utils/tools'
import { useI18n } from '@/lang'
import { updateSetting } from '@/core/common'
import { useSettingValue } from '@/store/setting/hook'
import { useTheme } from '@/store/theme/hook'
import { designTypography } from '@/theme/DesignTokens'

export default memo(() => {
  const t = useI18n()
  const theme = useTheme()
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
      {/* 开关效果按 iOS 版本分两档，且 26.2+ 的「开」并非自研液态玻璃而是系统材质，
          只说标题用户无从得知，故在行下方常驻一行说明（样式对齐 SliderRow 的 desc：
          次级文字色 + caption 字号，不抢标题视觉层级）。
          卡片自身已带 8pt 下外边距，这里不再叠加 marginTop。 */}
      <Text style={styles.desc} color={theme['c-font-label']} size={designTypography.caption}>
        {t('setting_basic_theme_liquid_glass_desc')}
      </Text>
    </View>
  )
})

const styles = createStyle({
  content: {
    marginTop: 5,
    marginBottom: 15,
  },
  desc: {
    lineHeight: 16,
  },
})
