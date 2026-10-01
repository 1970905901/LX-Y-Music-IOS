import themeActions from '@/store/theme/action'
import { getTheme } from '@/theme/themes'
import { updateSetting } from './common'
import themeState from '@/store/theme/state'

export const setShouldUseDarkColors = (shouldUseDarkColors: boolean) => {
  themeActions.setShouldUseDarkColors(shouldUseDarkColors)
}

export const applyTheme = (theme: LX.Theme) => {
  themeActions.setTheme(theme)
}

/**
 * 用当前主题重新生成色板并广播（不改主题 id）。
 * 供「底边不透明度」这类**走主题色令牌**的设置项在调整后实时生效：
 * buildActiveThemeColors 会读取最新设置重算颜色，themeUpdated 事件驱动全局刷新。
 */
export const refreshActiveTheme = () => {
  void getTheme().then((theme) => {
    applyTheme(theme)
  })
}

export const setTheme = (id: string) => {
  updateSetting({ 'theme.id': id })
  void getTheme().then((theme) => {
    if (theme.id == themeState.theme.id) return
    applyTheme(theme)
  })
}
