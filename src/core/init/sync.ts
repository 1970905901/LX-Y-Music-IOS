import { AppState } from 'react-native'
import { connectServer, getStatus, hasClientConnection } from '@/plugins/sync'
import { updateSetting } from '@/core/common'
import { getSyncHost } from '@/plugins/sync/data'
import settingState from '@/store/setting/state'
import { SYNC_CODE } from '@/plugins/sync/constants'


export default async(setting: LX.AppSetting) => {
  const ensureSyncConnected = async() => {
    if (!settingState.setting['sync.enable']) return

    const host = await getSyncHost()
    if (!host) return
    if (hasClientConnection()) return

    const status = getStatus()
    switch (status.message) {
      case SYNC_CODE.connecting:
      case SYNC_CODE.missingAuthCode:
      case SYNC_CODE.authFailed:
      case SYNC_CODE.msgBlockedIp:
        return
    }

    void connectServer(host).catch(() => {})
  }

  AppState.addEventListener('change', (state) => {
    if (state != 'active') return

    void ensureSyncConnected()
    // Some devices deliver the websocket close event slightly after the app returns.
    setTimeout(() => {
      void ensureSyncConnected()
    }, 1500)
  })

  if (!setting['sync.enable']) return

  const host = await getSyncHost()
  // console.log(host)
  if (!host) {
    updateSetting({ 'sync.enable': false })
    return
  }
  void connectServer(host)
}
