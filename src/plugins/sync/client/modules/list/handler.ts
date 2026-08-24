import { handleRemoteListAction, getLocalListData, setLocalListData } from '../../../listEvent'
import log from '../../../log'
import { removeSyncModeEvent, selectSyncMode } from '@/core/sync'
import { toMD5 } from '@/utils/tools'
import { registerEvent, unregisterEvent } from './localEvent'

const logInfo = (eventName: string, success = false) => {
  log.info(
    `[${eventName}]${eventName.replace('list:sync:list_sync_', '').replace(/_/g, ' ')}${success ? ' success' : ''}`
  )
}
const handler: LX.Sync.ClientSyncHandlerListActions<LX.Sync.Socket> = {
  async onListSyncAction(socket, action) {
    if (!socket.moduleReadys?.list) return
    await handleRemoteListAction(action)
  },

  async list_sync_get_md5(socket) {
    logInfo('list:sync:list_sync_get_md5')
    return toMD5(JSON.stringify(await getLocalListData()))
  },

  async list_sync_get_sync_mode(socket) {
    logInfo('list:sync:list_sync_get_sync_mode')
    const unsubscribe = socket.onClose(() => {
      removeSyncModeEvent()
    })
    return selectSyncMode(socket.data.keyInfo.serverName, 'list').finally(unsubscribe)
  },

  async list_sync_get_list_data(socket) {
    logInfo('list:sync:list_sync_get_list_data')
    return getLocalListData()
  },

  async list_sync_set_list_data(socket, data) {
    logInfo('list:sync:list_sync_set_list_data')
    await setLocalListData(data)
  },

  async list_sync_finished(socket) {
    logInfo('list:sync:finished')
    socket.moduleReadys.list = true
    registerEvent(socket)
    socket.onClose(() => {
      unregisterEvent()
    })
  },
}

export default handler
