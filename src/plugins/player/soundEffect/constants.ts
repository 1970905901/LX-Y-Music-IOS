import settingState from '@/store/setting/state'
import { getConvolutionAssetUri } from './assets'
import type {
  EqualizerFrequency,
  EqualizerPreset,
  SoundEffectConvolutionOption,
  SoundEffectBandSettingKey,
  SoundEffectSettingKey,
} from './types'

const bandSettingKeyMap: Record<EqualizerFrequency, SoundEffectBandSettingKey> = {
  31: 'player.soundEffect.eq.31',
  62: 'player.soundEffect.eq.62',
  125: 'player.soundEffect.eq.125',
  250: 'player.soundEffect.eq.250',
  500: 'player.soundEffect.eq.500',
  1000: 'player.soundEffect.eq.1000',
  2000: 'player.soundEffect.eq.2000',
  4000: 'player.soundEffect.eq.4000',
  8000: 'player.soundEffect.eq.8000',
  16000: 'player.soundEffect.eq.16000',
}

export const equalizerFrequencies: readonly EqualizerFrequency[] = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]

export const equalizerPresets: readonly EqualizerPreset[] = Object.freeze([
  {
    id: 'none',
    nameKey: 'setting_play_sound_effect_preset_none',
    gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  {
    id: 'pop',
    nameKey: 'setting_play_sound_effect_preset_pop',
    gains: [6, 5, -3, -2, 5, 4, -4, -3, 6, 4],
  },
  {
    id: 'dance',
    nameKey: 'setting_play_sound_effect_preset_dance',
    gains: [4, 3, -4, -6, 0, 0, 3, 4, 4, 5],
  },
  {
    id: 'rock',
    nameKey: 'setting_play_sound_effect_preset_rock',
    gains: [7, 6, 2, 1, -3, -4, 2, 1, 4, 5],
  },
  {
    id: 'classical',
    nameKey: 'setting_play_sound_effect_preset_classical',
    gains: [6, 7, 1, 2, -1, 1, -4, -6, -7, -8],
  },
  {
    id: 'vocal',
    nameKey: 'setting_play_sound_effect_preset_vocal',
    gains: [-5, -6, -4, -3, 3, 4, 5, 4, -3, -3],
  },
  {
    id: 'slow',
    nameKey: 'setting_play_sound_effect_preset_slow',
    gains: [5, 4, 2, 0, -2, 0, 3, 6, 7, 8],
  },
  {
    id: 'electronic',
    nameKey: 'setting_play_sound_effect_preset_electronic',
    gains: [6, 5, 0, -5, -4, 0, 6, 8, 8, 7],
  },
  {
    id: 'subwoofer',
    nameKey: 'setting_play_sound_effect_preset_subwoofer',
    gains: [8, 7, 5, 4, 0, 0, 0, 0, 0, 0],
  },
  {
    id: 'soft',
    nameKey: 'setting_play_sound_effect_preset_soft',
    gains: [-5, -5, -4, -4, 3, 2, 4, 4, 0, 0],
  },
])

export const soundEffectConvolutionOptions: readonly SoundEffectConvolutionOption[] = Object.freeze([
  {
    id: 'telephone',
    labelKey: 'setting_play_sound_effect_env_telephone',
    source: 'filter-telephone.wav',
    assetUri: getConvolutionAssetUri('filter-telephone.wav'),
    mainGain: 0,
    sendGain: 30,
  },
  {
    id: 'church',
    labelKey: 'setting_play_sound_effect_env_church',
    source: 's2_r4_bd.wav',
    assetUri: getConvolutionAssetUri('s2_r4_bd.wav'),
    mainGain: 18,
    sendGain: 9,
  },
  {
    id: 'hall',
    labelKey: 'setting_play_sound_effect_env_hall',
    source: 'bright-hall.wav',
    assetUri: getConvolutionAssetUri('bright-hall.wav'),
    mainGain: 8,
    sendGain: 24,
  },
  {
    id: 'cinema',
    labelKey: 'setting_play_sound_effect_env_cinema',
    source: 'cinema-diningroom.wav',
    assetUri: getConvolutionAssetUri('cinema-diningroom.wav'),
    mainGain: 6,
    sendGain: 23,
  },
  {
    id: 'restaurant',
    labelKey: 'setting_play_sound_effect_env_restaurant',
    source: 'dining-living-true-stereo.wav',
    assetUri: getConvolutionAssetUri('dining-living-true-stereo.wav'),
    mainGain: 6,
    sendGain: 18,
  },
  {
    id: 'bathroom',
    labelKey: 'setting_play_sound_effect_env_bathroom',
    source: 'living-bedroom-leveled.wav',
    assetUri: getConvolutionAssetUri('living-bedroom-leveled.wav'),
    mainGain: 6,
    sendGain: 21,
  },
  {
    id: 'indoor',
    labelKey: 'setting_play_sound_effect_env_indoor',
    source: 'spreader50-65ms.wav',
    assetUri: getConvolutionAssetUri('spreader50-65ms.wav'),
    mainGain: 10,
    sendGain: 25,
  },
  {
    id: 'stereo',
    labelKey: 'setting_play_sound_effect_env_stereo',
    source: 's3_r1_bd.wav',
    assetUri: getConvolutionAssetUri('s3_r1_bd.wav'),
    mainGain: 18,
    sendGain: 8,
  },
  {
    id: 'matrix_1',
    labelKey: 'setting_play_sound_effect_env_matrix_1',
    source: 'matrix-reverb1.wav',
    assetUri: getConvolutionAssetUri('matrix-reverb1.wav'),
    mainGain: 15,
    sendGain: 9,
  },
  {
    id: 'matrix_2',
    labelKey: 'setting_play_sound_effect_env_matrix_2',
    source: 'matrix-reverb2.wav',
    assetUri: getConvolutionAssetUri('matrix-reverb2.wav'),
    mainGain: 13,
    sendGain: 10,
  },
  {
    id: 'cardioid',
    labelKey: 'setting_play_sound_effect_env_cardioid',
    source: 'cardiod-35-10-spread.wav',
    assetUri: getConvolutionAssetUri('cardiod-35-10-spread.wav'),
    mainGain: 18,
    sendGain: 6,
  },
  {
    id: 'magnetic',
    labelKey: 'setting_play_sound_effect_env_magnetic',
    source: 'tim-omni-35-10-magnetic.wav',
    assetUri: getConvolutionAssetUri('tim-omni-35-10-magnetic.wav'),
    mainGain: 10,
    sendGain: 2,
  },
  {
    id: 'spring',
    labelKey: 'setting_play_sound_effect_env_spring',
    source: 'feedback-spring.wav',
    assetUri: getConvolutionAssetUri('feedback-spring.wav'),
    mainGain: 18,
    sendGain: 8,
  },
])

const presetAliasMap: Partial<Record<LX.SoundEffectPresetId, Exclude<LX.SoundEffectPresetId, 'custom'>>> = {
  loudness: 'pop',
  slowSong: 'slow',
  bass: 'subwoofer',
  speech: 'vocal',
  deep: 'soft',
}

export const normalizeEqualizerPresetId = (presetId: LX.SoundEffectPresetId): LX.SoundEffectPresetId => {
  return presetAliasMap[presetId] ?? presetId
}

export const getEqualizerBandSettingKey = (frequency: EqualizerFrequency): SoundEffectBandSettingKey => {
  return bandSettingKeyMap[frequency]
}

export const soundEffectSettingKeys: readonly SoundEffectSettingKey[] = Object.freeze([
  'player.soundEffect.enabled',
  'player.soundEffect.preset',
  'player.soundEffect.convolution.fileName',
  'player.soundEffect.convolution.mainGain',
  'player.soundEffect.convolution.sendGain',
  ...equalizerFrequencies.map(getEqualizerBandSettingKey),
])

export const createEqualizerGainsRecord = (gains?: readonly number[]) => {
  const result: Record<EqualizerFrequency, number> = {
    31: 0,
    62: 0,
    125: 0,
    250: 0,
    500: 0,
    1000: 0,
    2000: 0,
    4000: 0,
    8000: 0,
    16000: 0,
  }
  if (!gains) return result
  equalizerFrequencies.forEach((frequency, index) => {
    result[frequency] = gains[index] ?? 0
  })
  return result
}

export const normalizeEqualizerGain = (gain: number) => Math.round(gain * 10) / 10
export const normalizeConvolutionGain = (gain: number) => Math.min(50, Math.max(0, Math.round(gain)))

export const hasEnabledEqualizerGains = (gains: readonly number[]) => {
  return gains.some(gain => normalizeEqualizerGain(gain) != 0)
}

export const getEqualizerPreset = (presetId: LX.SoundEffectPresetId) => {
  const normalizedPresetId = normalizeEqualizerPresetId(presetId)
  return equalizerPresets.find(preset => preset.id == normalizedPresetId) ?? equalizerPresets[0]
}

export const getEqualizerGains = (setting = settingState.setting) => {
  return createEqualizerGainsRecord(equalizerFrequencies.map(frequency => setting[getEqualizerBandSettingKey(frequency)]))
}

export const isSoundEffectActive = (setting = settingState.setting) => {
  return hasEnabledEqualizerGains(equalizerFrequencies.map(frequency => setting[getEqualizerBandSettingKey(frequency)])) ||
    !!setting['player.soundEffect.convolution.fileName']
}

const createEqualizerSettingPatch = (presetId: LX.SoundEffectPresetId, gains: readonly number[]): Partial<LX.AppSetting> => {
  const patch: Partial<LX.AppSetting> = {
    'player.soundEffect.preset': hasEnabledEqualizerGains(gains) ? presetId : 'none',
    'player.soundEffect.enabled': hasEnabledEqualizerGains(gains),
  }
  equalizerFrequencies.forEach((frequency, index) => {
    patch[getEqualizerBandSettingKey(frequency)] = normalizeEqualizerGain(gains[index] ?? 0)
  })
  return patch
}

export const createPresetSettingPatch = (presetId: Exclude<LX.SoundEffectPresetId, 'custom'>): Partial<LX.AppSetting> => {
  const preset = getEqualizerPreset(presetId)
  return createEqualizerSettingPatch(preset.id, preset.gains)
}

export const createCustomBandSettingPatch = (
  frequency: EqualizerFrequency,
  gain: number,
  setting = settingState.setting,
): Partial<LX.AppSetting> => {
  const nextGains = equalizerFrequencies.map(item => item == frequency ? gain : setting[getEqualizerBandSettingKey(item)])
  return createEqualizerSettingPatch('custom', nextGains)
}

export const createCustomGainsSettingPatch = (gains: readonly number[]): Partial<LX.AppSetting> => {
  return createEqualizerSettingPatch('custom', gains)
}

export const getSoundEffectConvolutionOption = (source?: string | null) => {
  return soundEffectConvolutionOptions.find(option => option.source == source) ?? null
}

export const getSoundEffectConvolutionAssetUri = (source?: string | null) => {
  return getSoundEffectConvolutionOption(source)?.assetUri ?? ''
}

export const createConvolutionSettingPatch = (source: string | null): Partial<LX.AppSetting> => {
  const option = getSoundEffectConvolutionOption(source)
  if (!option) {
    return {
      'player.soundEffect.convolution.fileName': '',
    }
  }
  return {
    'player.soundEffect.convolution.fileName': option.source,
    'player.soundEffect.convolution.mainGain': option.mainGain,
    'player.soundEffect.convolution.sendGain': option.sendGain,
  }
}

export const isSoundEffectSettingKey = (key: keyof LX.AppSetting): key is SoundEffectSettingKey => {
  return soundEffectSettingKeys.includes(key as SoundEffectSettingKey)
}
