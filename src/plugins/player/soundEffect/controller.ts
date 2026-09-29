import settingState from '@/store/setting/state'
import {
  equalizerFrequencies,
  getEqualizerBandSettingKey,
  getSoundEffectConvolutionAssetUri,
  isSoundEffectSettingKey,
  normalizeConvolutionGain,
  normalizeEqualizerGain,
} from './constants'
import { nativeEqualizerAdapter } from './adapters/nativeEqualizerAdapter'
import type {
  EqualizerFrequency,
  SoundEffectAdapter,
  SoundEffectAdapterCapabilities,
  SoundEffectConfig,
  SoundEffectEqualizerConfig,
  SoundEffectConvolutionConfig,
  SoundEffectPannerConfig,
  SoundEffectPitchShifterConfig,
  SoundEffectPlaybackCoverage,
  SoundEffectPlaybackPath,
  SoundEffectSupportState,
} from './types'

const soundEffectAdapters: readonly SoundEffectAdapter[] = [nativeEqualizerAdapter]
const coveragePriority: Record<SoundEffectPlaybackCoverage, number> = {
  unsupported: 0,
  partial: 1,
  supported: 2,
}

const mergePlaybackCoverage = (
  currentCoverage: Partial<Record<SoundEffectPlaybackPath, SoundEffectPlaybackCoverage>>,
  nextCoverage: Partial<Record<SoundEffectPlaybackPath, SoundEffectPlaybackCoverage>>,
) => {
  const mergedCoverage = { ...currentCoverage }
  for (const [path, coverage] of Object.entries(nextCoverage) as Array<[SoundEffectPlaybackPath, SoundEffectPlaybackCoverage]>) {
    const prevCoverage = mergedCoverage[path] ?? 'unsupported'
    mergedCoverage[path] = coveragePriority[coverage] > coveragePriority[prevCoverage] ? coverage : prevCoverage
  }
  return mergedCoverage
}

const createSupportState = (adapters: readonly SoundEffectAdapter[]): SoundEffectSupportState => {
  const supportedAdapters = adapters.filter(adapter => adapter.isSupported())
  const baseCapabilities: SoundEffectAdapterCapabilities = {
    equalizer: false,
    convolution: false,
    panner: false,
    pitchShifter: false,
    presets: false,
    realTimePreview: false,
    playbackPathCoverage: {
      nativeFlac: 'unsupported',
      trackPlayer: 'unsupported',
    },
  }

  const capabilities = supportedAdapters.reduce<SoundEffectAdapterCapabilities>((result, adapter) => {
    result.equalizer = result.equalizer || adapter.capabilities.equalizer
    result.convolution = result.convolution || adapter.capabilities.convolution
    result.panner = result.panner || adapter.capabilities.panner
    result.pitchShifter = result.pitchShifter || adapter.capabilities.pitchShifter
    result.presets = result.presets || adapter.capabilities.presets
    result.realTimePreview = result.realTimePreview || adapter.capabilities.realTimePreview
    result.playbackPathCoverage = mergePlaybackCoverage(result.playbackPathCoverage, adapter.capabilities.playbackPathCoverage)
    return result
  }, baseCapabilities)

  return {
    isSupported: supportedAdapters.length > 0,
    adapters: supportedAdapters.map(adapter => adapter.id),
    ...capabilities,
  }
}

const buildCurrentEqualizerConfig = (gainsOverride?: Partial<Record<EqualizerFrequency, number>>): SoundEffectEqualizerConfig => {
  const setting = settingState.setting
  const gains = equalizerFrequencies.map(frequency => normalizeEqualizerGain(gainsOverride?.[frequency] ?? setting[getEqualizerBandSettingKey(frequency)]))
  return {
    enabled: gains.some(gain => gain != 0),
    gains,
  }
}

const buildCurrentConvolutionConfig = (): SoundEffectConvolutionConfig => {
  const setting = settingState.setting
  const fileName = setting['player.soundEffect.convolution.fileName'] || ''
  return {
    fileName,
    assetUri: getSoundEffectConvolutionAssetUri(fileName),
    enabled: !!fileName,
    mainGain: normalizeConvolutionGain(setting['player.soundEffect.convolution.mainGain']),
    sendGain: normalizeConvolutionGain(setting['player.soundEffect.convolution.sendGain']),
  }
}

// 【2026-09-29 用户定案】环绕声像不再暴露：恒定下发复位值，清掉存量用户的原生残留
const buildCurrentPannerConfig = (): SoundEffectPannerConfig => {
  return {
    enabled: false,
    soundR: 5,
    speed: 25,
  }
}

// 【2026-09-29 用户定案】变调不再暴露：恒定下发 1（原生链残留复位）
const buildCurrentPitchShifterConfig = (): SoundEffectPitchShifterConfig => {
  return {
    playbackRate: 1,
  }
}

const buildCurrentConfig = (overrides?: Partial<SoundEffectConfig>): SoundEffectConfig => {
  const equalizer = overrides?.equalizer != null
    ? {
        enabled: overrides.equalizer.enabled ?? buildCurrentEqualizerConfig().enabled,
        gains: overrides.equalizer.gains.map(normalizeEqualizerGain),
      }
    : buildCurrentEqualizerConfig()
  const convolutionBase = buildCurrentConvolutionConfig()
  const pannerBase = buildCurrentPannerConfig()
  const pitchShifterBase = buildCurrentPitchShifterConfig()

  return {
    equalizer,
    convolution: {
      fileName: overrides?.convolution?.fileName ?? convolutionBase.fileName,
      assetUri: overrides?.convolution?.assetUri ?? convolutionBase.assetUri,
      enabled: overrides?.convolution?.enabled ?? convolutionBase.enabled,
      mainGain: normalizeConvolutionGain(overrides?.convolution?.mainGain ?? convolutionBase.mainGain),
      sendGain: normalizeConvolutionGain(overrides?.convolution?.sendGain ?? convolutionBase.sendGain),
    },
    panner: {
      enabled: overrides?.panner?.enabled ?? pannerBase.enabled,
      soundR: overrides?.panner?.soundR ?? pannerBase.soundR,
      speed: overrides?.panner?.speed ?? pannerBase.speed,
    },
    pitchShifter: {
      playbackRate: overrides?.pitchShifter?.playbackRate ?? pitchShifterBase.playbackRate,
    },
  }
}

const applyCurrentConfig = async(overrides?: Partial<SoundEffectConfig>) => {
  const config = buildCurrentConfig(overrides)
  const supportedAdapters = soundEffectAdapters.filter(adapter => adapter.isSupported())
  if (!supportedAdapters.length) return
  await Promise.all(supportedAdapters.map(async adapter => adapter.apply(config)))
}

const applyCurrentEqualizerConfig = async(gainsOverride?: Partial<Record<EqualizerFrequency, number>>) => {
  const equalizer = buildCurrentEqualizerConfig(gainsOverride)
  await applyCurrentConfig({ equalizer })
}

const supportState = createSupportState(soundEffectAdapters)

export const soundEffectController = {
  adapters: soundEffectAdapters,
  supportState,
  isSupported: supportState.isSupported,
  isSettingKey: isSoundEffectSettingKey,
  buildCurrentConfig,
  buildCurrentEqualizerConfig,
  applyCurrentConfig,
  applyCurrentEqualizerConfig,
}
