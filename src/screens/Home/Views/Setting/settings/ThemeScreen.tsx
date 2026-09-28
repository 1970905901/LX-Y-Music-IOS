import { memo } from 'react'
import Section from '../components/Section'
import Theme from './Theme/Theme'
import ThemeMode from './Theme/ThemeMode'
import IsDynamicBg from './Theme/IsDynamicBg'
import IsLandscapeStretch from './Theme/IsLandscapeStretch'
import IsFontShadow from './Theme/IsFontShadow'
import Blur from './Theme/Blur'
import LiquidGlassToggle from './Theme/LiquidGlassToggle'
import GlassOpacity from './Theme/GlassOpacity'
import CustomBg from './Theme/CustomBg'
import PicOpacity from './Theme/PicOpacity'
import SubContainerOpacity from './Theme/SubContainerOpacity'
import { isIOS26OrAbove } from '@/utils/tools'
import { useSettingValue } from '@/store/setting/hook'

export default memo(() => {
  const liquidGlass = useSettingValue('theme.liquidGlass')
  // 「玻璃不透明度」只对磨砂形态有意义：
  //   - iOS 26+ 且液态玻璃开 → 隐藏（液态的浓度由主题染色表达，不暴露滑杆）；
  //   - 其余情况（iOS 26 以下永远磨砂 / iOS 26+ 关闭液态玻璃）→ 显示。
  const showGlassOpacity = !isIOS26OrAbove || !liquidGlass

  return (
    <Section sectionId="setting_theme">
      <Theme />
      <ThemeMode />
      <IsDynamicBg />
      <IsLandscapeStretch />
      <CustomBg />
      <PicOpacity />
      <Blur />
      {/* 液态玻璃开关仅 iOS 26+ 出现：开 = vendored Metal 液态玻璃，关 = 系统磨砂 */}
      {isIOS26OrAbove && <LiquidGlassToggle />}
      {showGlassOpacity && <GlassOpacity />}
      <SubContainerOpacity />
      <IsFontShadow />
    </Section>
  )
})
