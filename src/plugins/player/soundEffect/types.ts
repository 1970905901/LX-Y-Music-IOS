export type EqualizerFrequency = 31 | 62 | 125 | 250 | 500 | 1000 | 2000 | 4000 | 8000 | 16000

export type SoundEffectBandSettingKey =
  | 'player.soundEffect.eq.31'
  | 'player.soundEffect.eq.62'
  | 'player.soundEffect.eq.125'
  | 'player.soundEffect.eq.250'
  | 'player.soundEffect.eq.500'
  | 'player.soundEffect.eq.1000'
  | 'player.soundEffect.eq.2000'
  | 'player.soundEffect.eq.4000'
  | 'player.soundEffect.eq.8000'
  | 'player.soundEffect.eq.16000'

export type SoundEffectConvolutionSettingKey =
  | 'player.soundEffect.convolution.fileName'
  | 'player.soundEffect.convolution.mainGain'
  | 'player.soundEffect.convolution.sendGain'

export type SoundEffectSettingKey =
  | SoundEffectBandSettingKey
  | SoundEffectConvolutionSettingKey
  | 'player.soundEffect.enabled'
  | 'player.soundEffect.preset'

export type EqualizerPresetNameKey =
  | 'setting_play_sound_effect_preset_none'
  | 'setting_play_sound_effect_preset_pop'
  | 'setting_play_sound_effect_preset_dance'
  | 'setting_play_sound_effect_preset_rock'
  | 'setting_play_sound_effect_preset_electronic'
  | 'setting_play_sound_effect_preset_classical'
  | 'setting_play_sound_effect_preset_vocal'
  | 'setting_play_sound_effect_preset_slow'
  | 'setting_play_sound_effect_preset_subwoofer'
  | 'setting_play_sound_effect_preset_soft'

export interface EqualizerPreset {
  id: Exclude<LX.SoundEffectPresetId, 'custom'>
  nameKey: EqualizerPresetNameKey
  gains: number[]
}

export type SoundEffectConvolutionNameKey =
  | 'setting_play_sound_effect_env_telephone'
  | 'setting_play_sound_effect_env_church'
  | 'setting_play_sound_effect_env_hall'
  | 'setting_play_sound_effect_env_cinema'
  | 'setting_play_sound_effect_env_restaurant'
  | 'setting_play_sound_effect_env_bathroom'
  | 'setting_play_sound_effect_env_indoor'
  | 'setting_play_sound_effect_env_stereo'
  | 'setting_play_sound_effect_env_matrix_1'
  | 'setting_play_sound_effect_env_matrix_2'
  | 'setting_play_sound_effect_env_cardioid'
  | 'setting_play_sound_effect_env_magnetic'
  | 'setting_play_sound_effect_env_spring'

export interface SoundEffectConvolutionOption {
  id: string
  labelKey: SoundEffectConvolutionNameKey
  source: string
  assetUri: string
  mainGain: number
  sendGain: number
}

export interface SoundEffectEqualizerConfig {
  enabled: boolean
  gains: number[]
}

export interface SoundEffectConvolutionConfig {
  fileName: string
  assetUri: string
  enabled: boolean
  mainGain: number
  sendGain: number
}

export interface SoundEffectPannerConfig {
  enabled: boolean
  soundR: number
  speed: number
}

export interface SoundEffectPitchShifterConfig {
  playbackRate: number
}

export interface SoundEffectConfig {
  equalizer: SoundEffectEqualizerConfig
  convolution: SoundEffectConvolutionConfig
  panner: SoundEffectPannerConfig
  pitchShifter: SoundEffectPitchShifterConfig
}

export type SoundEffectAdapterId = 'native_ios_sound_effect'
export type SoundEffectPlaybackPath = 'nativeFlac' | 'trackPlayer'
export type SoundEffectPlaybackCoverage = 'unsupported' | 'partial' | 'supported'

export interface SoundEffectAdapterCapabilities {
  equalizer: boolean
  convolution: boolean
  panner: boolean
  pitchShifter: boolean
  presets: boolean
  realTimePreview: boolean
  playbackPathCoverage: Partial<Record<SoundEffectPlaybackPath, SoundEffectPlaybackCoverage>>
}

export interface SoundEffectAdapter {
  id: SoundEffectAdapterId
  capabilities: SoundEffectAdapterCapabilities
  isSupported: () => boolean
  apply: (config: SoundEffectConfig) => Promise<void> | void
}

export interface SoundEffectSupportState extends SoundEffectAdapterCapabilities {
  isSupported: boolean
  adapters: SoundEffectAdapterId[]
}
