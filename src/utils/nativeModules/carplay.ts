import { NativeModules, NativeEventEmitter, Platform } from 'react-native'
import playerState from '@/store/player/state'
import { getList } from '@/core/player/playInfo'

type CarPlayItem = {
  id: string
  name: string
  singer: string
  album: string
}

const CarPlayModule = NativeModules.CarPlayModule as
  | { setPlaylist?: (items: CarPlayItem[]) => void }
  | undefined

let selectHandler: ((index: number) => void) | null = null

if (Platform.OS == 'ios' && CarPlayModule) {
  const emitter = new NativeEventEmitter(CarPlayModule as any)
  emitter.addListener('LXCarPlaySelect', (body: { index: number }) => {
    if (selectHandler && typeof body?.index === 'number') selectHandler(body.index)
  })
}

/**
 * 注册车机列表项点击回调（由 App 启动处注入，调用 playList）。
 */
export const setCarPlaySelectHandler = (fn: ((index: number) => void) | null) => {
  selectHandler = fn
}

/**
 * 把当前播放列表同步到车机 CarPlay 模板。需在 iOS + 原生模块存在时才生效。
 */
export const syncCarPlayList = () => {
  if (Platform.OS != 'ios' || !CarPlayModule?.setPlaylist) return
  const listId = playerState.playInfo.playerListId
  const list = (listId ? getList(listId) : []) as any[]
  const items: CarPlayItem[] = list.map((m: any) => ({
    id: m.id ?? '',
    name: m.name ?? '',
    singer: m.singer ?? '',
    album: m.album ?? '',
  }))
  CarPlayModule.setPlaylist(items)
}
