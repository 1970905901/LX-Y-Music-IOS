import '@/utils/errorHandle'
import { init as initLog } from '@/utils/log'
import { proLog } from '@/utils/pro-log'
import { bootLog, getBootLog } from '@/utils/bootLog'
import '@/config/globalData'
import { getFontSize } from '@/utils/data'
import { exitApp } from './utils/nativeModules/utils'
import { windowSizeTools } from './utils/windowSizeTools'
import { listenLaunchEvent } from './navigation/regLaunchedEvent'
import { tipDialog } from './utils/tools'
import settingState from '@/store/setting/state'

// --- START: CONSOLE LOG PATCH (v2) ---
if (__DEV__) {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  const PREFIX = '###RN_DEBUG_START###';
  const SUFFIX = '###RN_DEBUG_END###';

  /**
   * @param {'log' | 'warn' | 'error'} type
   * @param {any[]} args
   */
  const remoteLog = (type: 'log' | 'warn' | 'error', ...args: unknown[]) => {
    try {
      const payload = {
        type: type,
        payload: args,
      };

      originalLog(`${PREFIX}${JSON.stringify(payload)}${SUFFIX}`);

    } catch (e) {
      originalLog('Logger Patch Error:', e);
      if (type === 'warn') {
        originalWarn.apply(console, args);
      } else if (type === 'error') {
        originalError.apply(console, args);
      } else {
        originalLog.apply(console, args);
      }
    }
  };

  // Override global console object
  console.log = (...args) => remoteLog('log', ...args);
  console.warn = (...args) => remoteLog('warn', ...args);
  console.error = (...args) => remoteLog('error', ...args);
}
// --- END: CONSOLE LOG PATCH (v2) ---

console.log('starting app...')
listenLaunchEvent()

void Promise.all([getFontSize(), windowSizeTools.init()])
  .then(async ([fontSize]) => {
    global.lx.fontSize = fontSize
    bootLog('Font size setting loaded.')

    let isInited = false
    let handlePushedHomeScreen: () => void | Promise<void>

    const tryGetBootLog = () => {
      try {
        return getBootLog()
      } catch (err) {
        return 'Get boot log failed.'
      }
    }

    const handleInit = async () => {
      if (isInited) return
      void initLog()
      const { default: init } = await import('@/core/init')
      try {
        handlePushedHomeScreen = await init()
      } catch (err: any) {
        void tipDialog({
          title: '初始化失败 (Init Failed)',
          message: `Boot Log:\n${tryGetBootLog()}\n\n${(err.stack ?? err.message) as string}`,
          btnText: 'Exit',
          bgClose: false,
        }).then(() => {
          exitApp()
        })
        return
      }
      isInited ||= true
    }
    const { init: initNavigation, navigations } = await import('@/navigation')

    initNavigation(async () => {
      await handleInit()
      if (!isInited) return

      await navigations
        .pushHomeScreen()
        .then(() => {
          void handlePushedHomeScreen()
        })
        .catch((err: any) => {
          void tipDialog({
            title: 'Error',
            message: err.message,
            btnText: 'Exit',
            bgClose: false,
          }).then(() => {
            exitApp()
          })
        })
    })
  })
  .catch((err) => {
    void tipDialog({
      title: '初始化失败 (Init Failed)',
      message: `Boot Log:\n\n${(err.stack ?? err.message) as string}`,
      btnText: 'Exit',
      bgClose: false,
    }).then(() => {
      exitApp()
    })
  })
