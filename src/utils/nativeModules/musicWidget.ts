import { NativeModules, NativeEventEmitter, Platform } from 'react-native'

const { MusicWidgetModule } = NativeModules
const isIOS = Platform.OS === 'ios'

// iOS 无 MusicWidgetModule 原生实现（小组件为安卓特性），emitter 置空，方法安全降级。
const widgetEmitter = isIOS || !MusicWidgetModule ? null : new NativeEventEmitter(MusicWidgetModule)

/**
 * Update the home screen widget with current playback info
 */
export const updateWidget = async (
    title: string,
    artist: string,
    isPlaying: boolean,
    artworkUrl?: string,
): Promise<void> => {
    if (isIOS || !MusicWidgetModule) return
    return MusicWidgetModule.updateWidget(title, artist, isPlaying, artworkUrl ?? '')
}

/**
 * Listen for widget button press events
 */
export const onWidgetPlayPause = (callback: () => void) => {
    if (!widgetEmitter) return () => {}
    return widgetEmitter.addListener('widget-play-pause', callback)
}

export const onWidgetPrev = (callback: () => void) => {
    if (!widgetEmitter) return () => {}
    return widgetEmitter.addListener('widget-prev', callback)
}

export const onWidgetNext = (callback: () => void) => {
    if (!widgetEmitter) return () => {}
    return widgetEmitter.addListener('widget-next', callback)
}
