import { NativeModules, Platform, DeviceEventEmitter } from 'react-native'

const { MusicRecognitionModule } = NativeModules

export interface MusicRecognitionInterface {
  checkOverlayPermission(): Promise<boolean>
  openOverlayPermissionActivity(): Promise<boolean>
  checkMicrophonePermission(): Promise<boolean>
  showFloatingButton(): void
  hideFloatingButton(): void
  getLastRecordingPath(): Promise<string>
  playLastRecording(): void
  isAvailable(): boolean
}

export type RecognitionResult = {
  action: 'log' | 'play'
  message?: string
  songname?: string
  singername?: string
  album?: string
  hash?: string
  duration?: string
  cover?: string
  albumId?: string
  songId?: string
}

const isNativeAvailable = Platform.OS === 'android' && !!MusicRecognitionModule

let recognitionListener: ReturnType<typeof DeviceEventEmitter.addListener> | null = null

const musicRecognition: MusicRecognitionInterface = {
  isAvailable: () => isNativeAvailable,

  checkOverlayPermission: () => {
    if (!isNativeAvailable) return Promise.reject(new Error('Native module not available'))
    return MusicRecognitionModule.checkOverlayPermission()
  },

  openOverlayPermissionActivity: () => {
    if (!isNativeAvailable) return Promise.resolve(false)
    return MusicRecognitionModule.openOverlayPermissionActivity()
  },

  checkMicrophonePermission: () => {
    if (!isNativeAvailable) return Promise.resolve(false)
    return MusicRecognitionModule.checkMicrophonePermission()
  },

  showFloatingButton: () => {
    if (!isNativeAvailable) return
    MusicRecognitionModule.showFloatingButton()
  },

  hideFloatingButton: () => {
    if (!isNativeAvailable) return
    MusicRecognitionModule.hideFloatingButton()
  },

  getLastRecordingPath: () => {
    if (!isNativeAvailable) return Promise.reject(new Error('Native module not available'))
    return MusicRecognitionModule.getLastRecordingPath()
  },

  playLastRecording: () => {
    if (!isNativeAvailable) return
    MusicRecognitionModule.playLastRecording()
  },
}

export function startRecognitionListener(onResult: (event: RecognitionResult) => void) {
  if (!isNativeAvailable) return
  if (recognitionListener) recognitionListener.remove()
  recognitionListener = DeviceEventEmitter.addListener('MusicRecognitionEvent', (event: RecognitionResult) => {
    if (event.action === 'log') {
      console.log(`[Native][log] ${event.message}`)
    }
    onResult(event)
  })
}

export function stopRecognitionListener() {
  if (recognitionListener) {
    recognitionListener.remove()
    recognitionListener = null
  }
}

export default musicRecognition
