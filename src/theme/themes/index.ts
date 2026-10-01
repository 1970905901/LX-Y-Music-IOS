import { getUserTheme, saveUserTheme } from '@/utils/data'
import themes from '@/theme/themes/themes'
import settingState from '@/store/setting/state'
import themeState from '@/store/theme/state'
import { isUrl } from '@/utils'
import { privateStorageDirectoryPath } from '@/utils/fs'
import { type ImageSourcePropType } from 'react-native'
import chinaInkImage from './images/china_ink.jpg'
import jqbgImage from './images/jqbg.jpg'
import landingMoonImage from './images/landingMoon2.png'
import myzcbgImage from './images/myzcbg.jpg'
import xnklImage from './images/xnkl.png'

export const BG_IMAGES = {
  'china_ink.jpg': chinaInkImage as ImageSourcePropType,
  'jqbg.jpg': jqbgImage as ImageSourcePropType,
  'landingMoon.png': landingMoonImage as ImageSourcePropType,
  'myzcbg.jpg': myzcbgImage as ImageSourcePropType,
  'xnkl.png': xnklImage as ImageSourcePropType,
} as const

let userThemes: LX.Theme[]
export const getAllThemes = async() => {
  userThemes ??= await getUserTheme()
  return {
    themes,
    userThemes,
    dataPath: privateStorageDirectoryPath + '/theme_images',
  }
}

export const saveTheme = async(theme: LX.Theme) => {
  const targetTheme = userThemes.find((t) => t.id === theme.id)
  if (targetTheme) Object.assign(targetTheme, theme)
  else userThemes.push(theme)
  await saveUserTheme(userThemes)
}

export const removeTheme = async(id: string) => {
  const index = userThemes.findIndex((t) => t.id === id)
  if (index < 0) return
  userThemes.splice(index, 1)
  await saveUserTheme(userThemes)
}

export type LocalTheme = (typeof themes)[number]
type ColorsKey = keyof LX.Theme['config']['themeColors']
const varColorRxp = /^var\((.+)\)$/

/**
 * 把已有颜色改写为指定 alpha（0~1），用于「底边不透明度」。
 * 与 applyOpacity 的区别：applyOpacity 是在原 alpha 上**叠加**比例，而这里要的是
 * **直接设定**最终 alpha（滑杆 80 = 0.80，与主题自带值一致，而不是 0.80 × 0.8）。
 * 只处理 rgb/rgba/#rrggbb(#rrggbbaa) 三类主题色格式，其余原样返回。
 */
const withAlpha = (color: string, alpha: number): string => {
  const ratio = Math.min(Math.max(alpha, 0), 1)
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)$/.exec(color)
  if (rgba) return `rgba(${rgba[1]}, ${rgba[2]}, ${rgba[3]}, ${ratio.toFixed(2)})`
  const hex = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(color.trim())
  if (hex) return `#${hex[1]}${Math.round(ratio * 255).toString(16).padStart(2, '0')}`
  return color
}

export const buildActiveThemeColors = (theme: LX.Theme): LX.ActiveTheme => {
  let bgImg: ImageSourcePropType | undefined
  if (theme.isCustom) {
    if (theme.config.extInfo['bg-image']) {
      theme.config.extInfo['bg-image'] = isUrl(theme.config.extInfo['bg-image'])
        ? theme.config.extInfo['bg-image']
        : `${privateStorageDirectoryPath}/theme_images/${theme.config.extInfo['bg-image']}`
    }
  } else {
    const extInfo = (theme as LocalTheme).config.extInfo
    if (extInfo['bg-image']) {
      bgImg = BG_IMAGES[extInfo['bg-image']]
    }
  }

  theme.config.extInfo = { ...theme.config.extInfo }

  for (const [k, v] of Object.entries(theme.config.extInfo)) {
    if (!v.startsWith('var(')) continue
    (theme.config.extInfo as any)[k] = theme.config.themeColors[v.replace(varColorRxp, '$1') as ColorsKey]
  }

  const activeTheme: LX.ActiveTheme = {
    id: theme.id,
    name: theme.name,
    isDark: theme.isDark,
    ...theme.config.themeColors,
    ...theme.config.extInfo,
    'c-font': theme.config.themeColors['c-850'],
    'c-font-label': theme.config.themeColors['c-450'],
    'c-primary-font': theme.config.themeColors['c-primary'],
    'c-primary-font-hover': theme.config.themeColors['c-primary-alpha-300'],
    'c-primary-font-active': theme.config.themeColors['c-primary-dark-100-alpha-200'],
    'c-primary-background': theme.config.themeColors['c-primary-light-400-alpha-700'],
    'c-primary-background-hover': theme.config.themeColors['c-primary-light-300-alpha-800'],
    'c-primary-background-active': theme.config.themeColors['c-primary-light-100-alpha-800'],
    'c-primary-input-background': theme.config.themeColors['c-primary-light-400-alpha-700'],
    'c-button-font': theme.config.themeColors['c-primary-alpha-100'],
    'c-button-font-selected': theme.config.themeColors['c-primary-dark-100-alpha-100'],
    'c-button-background': theme.config.themeColors['c-primary-light-400-alpha-700'],
    'c-button-background-selected': theme.config.themeColors['c-primary-alpha-600'],
    'c-button-background-hover': theme.config.themeColors['c-primary-light-300-alpha-600'],
    'c-button-background-active': theme.config.themeColors['c-primary-light-100-alpha-600'],
    'c-list-header-border-bottom': theme.config.themeColors['c-primary-alpha-900'],
    'c-content-background': theme.config.themeColors['c-primary-light-1000'],
    'c-border-background': theme.config.themeColors['c-primary-light-100-alpha-700'],
    'c-liked': theme.config.extInfo['c-liked']!,
    'bg-image': bgImg,
  }

  // 「底边不透明度」：全软件半透明底（排行榜按钮 / 设置页开关行与操作按钮 /
  // 首页卡片等）统一取自 c-primary-light-900-alpha-200，这里按用户设置直接设定
  // 它的最终 alpha。未设置（旧版本无该键 → NaN）时保持主题自带值，外观不变。
  const cardOpacity = Number(settingState.setting['theme.cardOpacity'])
  if (Number.isFinite(cardOpacity)) {
    activeTheme['c-primary-light-900-alpha-200'] =
      withAlpha(activeTheme['c-primary-light-900-alpha-200'], cardOpacity / 100)
    // 同档的 -alpha-300 也要跟着设置走：「我的」页歌曲列表卡片、推荐页平台胶囊 /
    // 功能网格 / 每日推荐卡等用的是这一档。此前只改了 -alpha-200，那些元素滑到
    // 0%（全透明）或 100%（最浓）都纹丝不动 —— 用户反馈的「我的页面整体没有跟随
    // 底边不透明度」就是这个原因。
    activeTheme['c-primary-light-900-alpha-300'] =
      withAlpha(activeTheme['c-primary-light-900-alpha-300'], cardOpacity / 100)
  }

  if (theme.isDark) {
    activeTheme['c-primary-font-active'] = activeTheme['c-000']
  }

  return activeTheme
}

// const copyTheme = (theme: LX.Theme): LX.Theme => {
//   return {
//     ...theme,
//     config: {
//       ...theme.config,
//       extInfo: { ...theme.config.extInfo },
//       themeColors: { ...theme.config.themeColors },
//     },
//   }
// }
// type IDS = LocalTheme['id']
export const getTheme = async() => {
  // fs.promises.readdir()
  const shouldUseDarkColors = themeState.shouldUseDarkColors
  // let themeId = settingState.setting['theme.id'] == 'auto'
  //   ? shouldUseDarkColors
  //     ? settingState.setting['theme.darkId']
  //     : settingState.setting['theme.lightId']
  //   // : 'china_ink'
  //   : settingState.setting['theme.id']
  let themeId: string
  if (settingState.setting['common.isAutoTheme'] && shouldUseDarkColors) {
    // 跟随系统 + 系统当前为深色 → black
    themeId = 'black'
  } else if (
    !settingState.setting['common.isAutoTheme'] &&
    settingState.setting['common.isDarkMode']
  ) {
    // 不跟随系统 + 手动开启深色模式 → black
    themeId = 'black'
  } else {
    // 其他情况使用用户选定的浅色主题
    themeId = settingState.setting['theme.id']
  }
  // themeId = 'naruto'
  // themeId = 'pink'
  // themeId = 'black'
  let theme: LocalTheme | LX.Theme | undefined = themes.find((theme) => theme.id == themeId)
  if (!theme) {
    userThemes = await getUserTheme()
    theme = userThemes.find((theme) => theme.id == themeId)
    if (!theme) {
      themeId =
        settingState.setting['theme.id'] == 'auto' && shouldUseDarkColors ? 'black' : 'green'
      theme = themes.find((theme) => theme.id == themeId) as LX.Theme
    }
  }

  return theme
}
