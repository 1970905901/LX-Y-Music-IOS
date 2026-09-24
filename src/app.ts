import '@/utils/errorHandle'
import { init as initLog } from '@/utils/log'
import * as React from 'react'
import { bootLog, getBootLog } from '@/utils/bootLog'
import '@/config/globalData'
import { getFontSize } from '@/utils/data'
import { withTimeout } from '@/utils/withTimeout'
import { exitApp } from './utils/nativeModules/utils'
import { windowSizeTools } from './utils/windowSizeTools'
import { listenLaunchEvent } from './navigation/regLaunchedEvent'
import { tipDialog } from './utils/tools'
import settingState from '@/store/setting/state'

// --- START: CONSOLE LOG PATCH (v2) ---
const originalCreateElement = React.createElement
const createElementWithUndefinedCheck = function(type: any, ...args: any[]) {
  if (type == null) {
    console.error('###UNDEFINED_ELEMENT###', args[0], new Error().stack)
  }
  return originalCreateElement.apply(React, [type, ...args] as any)
}
const reactRuntime = React as { createElement: (type: any, ...args: any[]) => any }
reactRuntime.createElement = createElementWithUndefinedCheck

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

if (__DEV__) {
  const globalWithErrorUtils = global as typeof global & {
    ErrorUtils?: {
      setGlobalHandler: (handler: (error: Error, isFatal: boolean) => void) => void
    }
  }
  globalWithErrorUtils.ErrorUtils?.setGlobalHandler((error, isFatal) => {
    console.error('###FATAL_DIAGNOSTIC###', isFatal, error?.stack ?? error?.message ?? error)
  })
}
// --- END: CONSOLE LOG PATCH (v2) ---

console.log('starting app...')
listenLaunchEvent()

  void Promise.all([
    withTimeout(getFontSize(), 'Font size', 1),
    withTimeout<{ width: number; height: number } | undefined>(
      windowSizeTools.init(),
      'Window size',
      undefined,
    ),
  ])
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
            message: ((err.stack ?? err.message) as string).slice(0, 1600),
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
