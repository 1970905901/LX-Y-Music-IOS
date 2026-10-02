/**
 * 听歌识曲 —— 业务编排（录音 → 指纹接口）。
 *
 * 拆成三段，便于 UI 显示「录音中 / 识别中」并支持中途取消：
 *   startRecognition()  申请权限 + 开始录音
 *   finishRecognition() 结束录音 → 解码 PCM → 调酷狗指纹接口 → 返回候选
 *   cancelRecognition() 中止录音并丢弃
 */

import { Buffer } from '@craftzdog/react-native-buffer'
import {
  cancelRecognizeRecording,
  isRecognizeSupported,
  startRecognizeRecording,
  stopRecognizeRecording,
} from '@/utils/nativeModules/recognize'
import { matchPcm, type RecognizeMatch } from '@/utils/musicSdk/kg/audioMatch'

/** 单次录音时长上限（与 EchoMusic 保持一致：10 秒足够生成稳定指纹） */
export const RECOGNIZE_MAX_SECONDS = 10

export { isRecognizeSupported }
export type { RecognizeMatch }

export interface RecognizeStartOutcome {
  ok: boolean
  /** 'denied' => 用户拒绝麦克风权限；'unsupported' => 平台/原生不支持 */
  error?: string
}

export const startRecognition = async(): Promise<RecognizeStartOutcome> => startRecognizeRecording()

export const cancelRecognition = async(): Promise<void> => cancelRecognizeRecording()

/**
 * 结束录音并识别。
 * 录音太短（拿不到有效 PCM）时抛错，由上层转成「没有听清，再试一次」提示。
 */
export async function finishRecognition(): Promise<RecognizeMatch[]> {
  const captured = await stopRecognizeRecording()
  if (!captured.ok || !captured.data) {
    throw new Error(captured.error || 'empty')
  }
  // 原生返回 base64 裸 PCM；Buffer 是 Uint8Array 子类，可直接作为 fetch body
  const bytes = Buffer.from(captured.data, 'base64')
  if (bytes.length < 1600) {
    // 8000Hz * 16bit ≈ 16000 字节/秒，< 0.1s 基本是误触
    throw new Error('too-short')
  }
  return matchPcm(bytes as unknown as Uint8Array)
}
