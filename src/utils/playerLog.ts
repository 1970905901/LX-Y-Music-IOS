import { log } from '@/utils/log'
import settingState from '@/store/setting/state'

export const playerLog = {
  isEnabled: false,

  init() {
    const settingValue = settingState.setting['common.isEnablePlayerLog']
    this.isEnabled = settingValue !== undefined ? settingValue : false
  },

  updateEnabled(enabled: boolean) {
    this.isEnabled = enabled
  },

  info(...msgs: any[]) {
    if (!this.isEnabled) return
    if (!global.lx.isEnableLog) return
    const msg = msgs
      .map((m) =>
        typeof m == 'string' ? m : m instanceof Error ? (m.stack ?? m.message) : JSON.stringify(m)
      )
      .join(' ')
    log.info('[Player] ' + msg)
  },

  warn(...msgs: any[]) {
    if (!this.isEnabled) return
    if (!global.lx.isEnableLog) return
    const msg = msgs
      .map((m) =>
        typeof m == 'string' ? m : m instanceof Error ? (m.stack ?? m.message) : JSON.stringify(m)
      )
      .join(' ')
    log.warn('[Player] ' + msg)
  },

  error(...msgs: any[]) {
    if (!this.isEnabled) return
    if (!global.lx.isEnableLog) return
    const msg = msgs
      .map((m) =>
        typeof m == 'string' ? m : m instanceof Error ? (m.stack ?? m.message) : JSON.stringify(m)
      )
      .join(' ')
    log.error('[Player] ' + msg)
  },
}

export default playerLog