/**
 * 听歌识曲 —— 原生麦克风录音能力（iOS，UtilsModule）。
 *
 * 原生侧（ios/LxMusicMobile/AppDelegate.mm 的 UtilsModule）用 AVAudioRecorder 直接按
 * 8000Hz / 单声道 / 16bit LE PCM 写 WAV，再把 data 块的裸 PCM 以 base64 交回。
 * JS 侧只负责驱动「开始 → 等待 → 结束」并把 PCM 交给指纹接口（见
 * src/utils/musicSdk/kg/audioMatch.ts）。
 *
 * 非 iOS / 原生方法缺失时统一安全降级（不抛异常），由调用方给出「暂不支持」提示。
 */

import { NativeModules, Platform } from 'react-native'

const { UtilsModule } = NativeModules

export interface RecognizeStartResult {
  ok: boolean
  /** 'denied' | 'unsupported' | 原生错误描述 */
  error?: string
}

export interface RecognizeStopResult extends RecognizeStartResult {
  /** base64 编码的裸 PCM（8000Hz / 单声道 / 16bit LE） */
  data?: string
  sampleRate?: number
  /** 录音时长（秒） */
  duration?: number
}

export const isRecognizeSupported = (): boolean =>
  Platform.OS === 'ios' &&
  typeof UtilsModule?.recognizeStart === 'function' &&
  typeof UtilsModule?.recognizeStop === 'function'

/** 申请麦克风权限并开始录音 */
export const startRecognizeRecording = async(): Promise<RecognizeStartResult> => {
  if (!isRecognizeSupported()) return { ok: false, error: 'unsupported' }
  try {
    const result = (await UtilsModule.recognizeStart()) as RecognizeStartResult
    return result ?? { ok: false, error: 'unsupported' }
  } catch (error: any) {
    return { ok: false, error: error?.message || 'start failed' }
  }
}

/** 结束录音并取回 PCM */
export const stopRecognizeRecording = async(): Promise<RecognizeStopResult> => {
  if (!isRecognizeSupported()) return { ok: false, error: 'unsupported' }
  try {
    const result = (await UtilsModule.recognizeStop()) as RecognizeStopResult
    return result ?? { ok: false, error: 'unsupported' }
  } catch (error: any) {
    return { ok: false, error: error?.message || 'stop failed' }
  }
}

/** 取消录音（丢弃音频，不产生任何数据） */
export const cancelRecognizeRecording = async(): Promise<void> => {
  if (!isRecognizeSupported() || typeof UtilsModule?.recognizeCancel !== 'function') return
  try {
    await UtilsModule.recognizeCancel()
  } catch {
    // 取消路径的异常无意义，静默吞掉
  }
}
