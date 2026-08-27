import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { TouchableOpacity, View } from 'react-native'

import { Icon } from '@/components/common/Icon'
import Text from '@/components/common/Text'
import Slider from '@/components/common/Slider'
import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import SoundEffectPresetSaveModal, { type SoundEffectPresetSaveModalType } from './SoundEffectPresetSaveModal'
import { createStyle, confirmDialog, tipDialog, toast } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useSetting } from '@/store/setting/hook'
import {
  createConvolutionSettingPatch,
  createCustomBandSettingPatch,
  createCustomGainsSettingPatch,
  createEqualizerGainsRecord,
  createPresetSettingPatch,
  equalizerFrequencies,
  equalizerPresets,
  getEqualizerGains,
  normalizeEqualizerPresetId,
  soundEffectController,
  soundEffectConvolutionOptions,
} from '@/plugins/player/soundEffect'
import {
  getUserConvolutionPresetList,
  getUserEQPresetList,
  removeUserConvolutionPreset,
  removeUserEQPreset,
  saveUserConvolutionPreset,
  saveUserEQPreset,
} from '@/store/soundEffect'

const minGain = -15
const maxGain = 15
const minPitchPlaybackRate = 0.5
const maxPitchPlaybackRate = 1.5
const defaultSurroundSpeed = 25
const defaultSurroundDistance = 5
const maxUserPresetCount = 31

type TranslateValues = Record<string, string | number | boolean>
type TranslateFn = (key: string, val?: TranslateValues) => string

type PreviewGains = Record<typeof equalizerFrequencies[number], number>
type LayoutMode = 'split' | 'stacked'

const formatGain = (gain: number) => `${gain > 0 ? '+' : ''}${Number.isInteger(gain) ? gain : gain.toFixed(1)}db`
const formatPercent = (value: number) => `${Math.round(value) * 10}%`
const formatPlaybackRate = (value: number) => `${value.toFixed(2)}x`
const formatPlain = (value: number) => `${Math.round(value)}`

const PlaceholderCheckbox = memo(({
  checked,
  label,
  onPress,
}: {
  checked: boolean
  label: string
  onPress: () => void
}) => {
  const theme = useTheme()

  return (
    <TouchableOpacity style={styles.placeholderCheckbox} activeOpacity={0.7} onPress={onPress}>
      <Icon
        name={checked ? 'checkbox-marked' : 'checkbox-blank-outline'}
        size={15}
        color={checked ? theme['c-primary-font-active'] : theme['c-font-label']}
      />
      <Text size={13}>{label}</Text>
    </TouchableOpacity>
  )
})

const PlaceholderSliderRow = memo(({
  label,
  value,
  minimumValue,
  maximumValue,
  step,
  onValueChange,
  onSlidingComplete,
  formatter,
  valueColor,
}: {
  label: string
  value: number
  minimumValue: number
  maximumValue: number
  step: number
  onValueChange: (value: number) => void
  onSlidingComplete?: (value: number) => void
  formatter: (value: number) => string
  valueColor?: string
}) => {
  const theme = useTheme()

  return (
    <View style={styles.placeholderSliderItem}>
      {label ? <Text size={13}>{label}</Text> : null}
      <View style={styles.placeholderSliderContent}>
        <View style={styles.sliderWrap}>
          <Slider
            minimumValue={minimumValue}
            maximumValue={maximumValue}
            step={step}
            value={value}
            onValueChange={onValueChange}
            onSlidingComplete={onSlidingComplete}
          />
        </View>
        <Text size={12} color={valueColor ?? theme['c-font-label']} style={styles.placeholderValue}>{formatter(value)}</Text>
      </View>
    </View>
  )
})

const PresetAddButton = memo(({
  onPress,
  disabled = false,
}: {
  onPress: () => void
  disabled?: boolean
}) => {
  const theme = useTheme()

  return (
    <TouchableOpacity
      activeOpacity={disabled ? 1 : 0.7}
      onPress={() => {
        if (disabled) return
        onPress()
      }}
      style={{
        ...styles.presetAddButton,
        borderColor: theme['c-primary-font-active'],
        opacity: disabled ? 0.35 : 0.7,
      }}>
      <Text size={15} color={theme['c-primary-font-active']} style={styles.presetAddText}>+</Text>
    </TouchableOpacity>
  )
})

const EqualizerSection = memo(({
  presetId,
  previewGains,
  userPresetList,
  activeUserPresetId,
  onReset,
  onPresetPress,
  onSavePreset,
  saveDisabled,
  onUserPresetPress,
  onUserPresetLongPress,
  onValueChange,
  onSlidingComplete,
  layoutMode,
}: {
  presetId: LX.SoundEffectPresetId
  previewGains: PreviewGains
  userPresetList: LX.SoundEffect.EQPreset[]
  activeUserPresetId: string | null
  onReset: () => void
  onPresetPress: (presetId: Exclude<LX.SoundEffectPresetId, 'custom'>) => void
  onSavePreset: () => void
  saveDisabled: boolean
  onUserPresetPress: (preset: LX.SoundEffect.EQPreset) => void
  onUserPresetLongPress: (preset: LX.SoundEffect.EQPreset) => void
  onValueChange: (frequency: typeof equalizerFrequencies[number], value: number) => void
  onSlidingComplete: (frequency: typeof equalizerFrequencies[number], value: number) => void
  layoutMode: LayoutMode
}) => {
  const t = useI18n() as TranslateFn
  const theme = useTheme()
  const dividerColor = theme['c-primary-alpha-500']

  const equalizerRows = useMemo(() => {
    const result: Array<Array<typeof equalizerFrequencies[number]>> = []
    for (let index = 0; index < equalizerFrequencies.length; index += 2) {
      result.push(equalizerFrequencies.slice(index, index + 2))
    }
    return result
  }, [])

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{t('setting_play_sound_effect_equalizer')}</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity activeOpacity={0.7} onPress={onReset} style={{ ...styles.resetButton, backgroundColor: theme['c-button-background'] }}>
            <Text size={12} color={theme['c-button-font']}>{t('setting_play_sound_effect_reset')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {layoutMode == 'split'
        ? (
            <View style={styles.equalizerGrid}>
              {equalizerRows.map((row, rowIndex) => (
                <View key={rowIndex} style={styles.equalizerRow}>
                  {row.map((frequency, frequencyIndex) => (
                    <View
                      key={frequency}
                      style={{
                        ...styles.equalizerItem,
                        borderRightWidth: frequencyIndex == 0 ? 1 : 0,
                        borderRightColor: dividerColor,
                        paddingRight: frequencyIndex == 0 ? 8 : 0,
                        paddingLeft: frequencyIndex == 1 ? 8 : 0,
                      }}>
                      <View style={styles.equalizerSliderRow}>
                        <Text size={13} style={styles.equalizerLabel}>{frequency >= 1000 ? `${frequency / 1000}k` : `${frequency}`}</Text>
                        <View style={styles.sliderWrap}>
                          <Slider
                            minimumValue={minGain}
                            maximumValue={maxGain}
                            step={0.1}
                            value={previewGains[frequency]}
                            onValueChange={value => { onValueChange(frequency, Number(value)) }}
                            onSlidingComplete={value => { onSlidingComplete(frequency, Number(value)) }}
                          />
                        </View>
                        <Text size={12} color={theme['c-font-label']} style={styles.equalizerValue}>{formatGain(previewGains[frequency])}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          )
        : (
            <View style={styles.stackedEqualizerList}>
              {equalizerFrequencies.map(frequency => (
                <View key={frequency} style={styles.stackedEqualizerItem}>
                  <View style={styles.equalizerSliderRow}>
                    <Text size={13} style={styles.equalizerLabel}>{frequency >= 1000 ? `${frequency / 1000}k` : `${frequency}`}</Text>
                    <View style={styles.sliderWrap}>
                      <Slider
                        minimumValue={minGain}
                        maximumValue={maxGain}
                        step={0.1}
                        value={previewGains[frequency]}
                        onValueChange={value => { onValueChange(frequency, Number(value)) }}
                        onSlidingComplete={value => { onSlidingComplete(frequency, Number(value)) }}
                      />
                    </View>
                    <Text size={12} color={theme['c-font-label']} style={styles.equalizerValue}>{formatGain(previewGains[frequency])}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}

      <View style={styles.presetList}>
        {equalizerPresets.filter(preset => preset.id != 'none').map(preset => {
          const isActive = preset.id == presetId
          return (
            <TouchableOpacity
              key={preset.id}
              activeOpacity={0.7}
              style={{
                ...styles.presetButton,
                backgroundColor: isActive ? theme['c-button-background-selected'] : theme['c-button-background'],
              }}
              onPress={() => { onPresetPress(preset.id) }}>
              <Text size={13} color={isActive ? theme['c-button-font-selected'] : theme['c-button-font']}>
                {t(preset.nameKey)}
              </Text>
            </TouchableOpacity>
          )
        })}
        {userPresetList.map(preset => {
          const isActive = preset.id == activeUserPresetId
          return (
            <TouchableOpacity
              key={preset.id}
              activeOpacity={0.7}
              style={{
                ...styles.presetButton,
                backgroundColor: isActive ? theme['c-button-background-selected'] : theme['c-button-background'],
              }}
              onPress={() => { onUserPresetPress(preset) }}
              onLongPress={() => { onUserPresetLongPress(preset) }}>
              <Text size={13} color={isActive ? theme['c-button-font-selected'] : theme['c-button-font']}>
                {preset.name}
              </Text>
            </TouchableOpacity>
          )
        })}
        <PresetAddButton onPress={onSavePreset} disabled={saveDisabled} />
      </View>
    </View>
  )
})

const EnvironmentSection = memo(({
  selectedSource,
  mainGain,
  sendGain,
  userPresetList,
  activeUserPresetId,
  onToggleConvolution,
  onMainGainChange,
  onSendGainChange,
  onSavePreset,
  saveDisabled,
  onUserPresetPress,
  onUserPresetLongPress,
}: {
  selectedSource: string
  mainGain: number
  sendGain: number
  userPresetList: LX.SoundEffect.ConvolutionPreset[]
  activeUserPresetId: string | null
  onToggleConvolution: (source: string) => void
  onMainGainChange: (value: number) => void
  onSendGainChange: (value: number) => void
  onSavePreset: () => void
  saveDisabled: boolean
  onUserPresetPress: (preset: LX.SoundEffect.ConvolutionPreset) => void
  onUserPresetLongPress: (preset: LX.SoundEffect.ConvolutionPreset) => void
}) => {
  const t = useI18n() as TranslateFn
  const theme = useTheme()
  const disabledConvolution = !selectedSource

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{t('setting_play_sound_effect_environment')}</Text>
      </View>
      <View style={styles.envList}>
        {soundEffectConvolutionOptions.map(item => (
          <PlaceholderCheckbox
            key={item.id}
            checked={selectedSource == item.source}
            label={t(item.labelKey)}
            onPress={() => { onToggleConvolution(item.source) }}
          />
        ))}
      </View>

      <View style={{ ...styles.placeholderGroup, opacity: disabledConvolution ? 0.45 : 1 }}>
        <PlaceholderSliderRow
          label={t('setting_play_sound_effect_environment_origin_gain')}
          value={mainGain}
          minimumValue={0}
          maximumValue={50}
          step={1}
          onValueChange={value => {
            if (disabledConvolution) return
            onMainGainChange(Number(value))
          }}
          formatter={formatPercent}
        />
        <PlaceholderSliderRow
          label={t('setting_play_sound_effect_environment_effect_gain')}
          value={sendGain}
          minimumValue={0}
          maximumValue={50}
          step={1}
          onValueChange={value => {
            if (disabledConvolution) return
            onSendGainChange(Number(value))
          }}
          formatter={formatPercent}
        />
      </View>

      <View style={styles.presetList}>
        {userPresetList.map(preset => {
          const isActive = preset.id == activeUserPresetId
          return (
            <TouchableOpacity
              key={preset.id}
              activeOpacity={0.7}
              style={{
                ...styles.presetButton,
                backgroundColor: isActive ? theme['c-button-background-selected'] : theme['c-button-background'],
              }}
              onPress={() => { onUserPresetPress(preset) }}
              onLongPress={() => { onUserPresetLongPress(preset) }}>
              <Text size={13} color={isActive ? theme['c-button-font-selected'] : theme['c-button-font']}>
                {preset.name}
              </Text>
            </TouchableOpacity>
          )
        })}
        <PresetAddButton onPress={onSavePreset} disabled={disabledConvolution || saveDisabled} />
      </View>
    </View>
  )
})

const PitchSection = memo(({
  playbackRate,
  onReset,
  onValueChange,
  onShowTip,
}: {
  playbackRate: number
  onReset: () => void
  onValueChange: (value: number) => void
  onShowTip: () => void
}) => {
  const t = useI18n() as TranslateFn
  const theme = useTheme()

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionHeaderTitle}>
          <Text style={styles.sectionTitle}>{t('setting_play_sound_effect_pitch')}</Text>
          <TouchableOpacity activeOpacity={0.7} onPress={onShowTip} style={styles.tipButton}>
            <Icon name="help" size={14} color={theme['c-font-label']} />
          </TouchableOpacity>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity activeOpacity={0.7} onPress={onReset} style={{ ...styles.resetButton, backgroundColor: theme['c-button-background'] }}>
            <Text size={12} color={theme['c-button-font']}>{t('setting_play_sound_effect_reset')}</Text>
          </TouchableOpacity>
        </View>
      </View>
      <PlaceholderSliderRow
        label=""
        value={playbackRate}
        minimumValue={minPitchPlaybackRate}
        maximumValue={maxPitchPlaybackRate}
        step={0.01}
        onValueChange={value => { onValueChange(Number(value)) }}
        formatter={formatPlaybackRate}
      />
    </View>
  )
})

const SurroundSection = memo(({
  enabled,
  speed,
  distance,
  onToggle,
  onSpeedChange,
  onDistanceChange,
}: {
  enabled: boolean
  speed: number
  distance: number
  onToggle: () => void
  onSpeedChange: (value: number) => void
  onDistanceChange: (value: number) => void
}) => {
  const t = useI18n() as TranslateFn
  const theme = useTheme()

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{t('setting_play_sound_effect_surround')}</Text>
        <PlaceholderCheckbox
          checked={enabled}
          label={t('setting_play_sound_effect_surround_enable')}
          onPress={onToggle}
        />
      </View>
      <View>
        <PlaceholderSliderRow
          label={t('setting_play_sound_effect_surround_speed')}
          value={speed}
          minimumValue={1}
          maximumValue={50}
          step={1}
          onValueChange={value => { onSpeedChange(Number(value)) }}
          formatter={formatPlain}
          valueColor={speed != defaultSurroundSpeed ? theme['c-primary-font-active'] : undefined}
        />
        <PlaceholderSliderRow
          label={t('setting_play_sound_effect_surround_distance')}
          value={distance}
          minimumValue={1}
          maximumValue={30}
          step={1}
          onValueChange={value => { onDistanceChange(Number(value)) }}
          formatter={formatPlain}
          valueColor={distance != defaultSurroundDistance ? theme['c-primary-font-active'] : undefined}
        />
      </View>
    </View>
  )
})

export default memo(({ showTip = true, layoutMode = 'split' }: {
  showTip?: boolean
  layoutMode?: LayoutMode
}) => {
  const t = useI18n() as TranslateFn
  const theme = useTheme()
  const dividerColor = theme['c-primary-alpha-500']
  const setting = useSetting()
  const savePresetModalRef = useRef<SoundEffectPresetSaveModalType>(null)
  const [previewGains, setPreviewGains] = useState<PreviewGains>(() => getEqualizerGains(setting))
  const [userEqPresetList, setUserEqPresetList] = useState<LX.SoundEffect.EQPreset[]>([])
  const [userConvolutionPresetList, setUserConvolutionPresetList] = useState<LX.SoundEffect.ConvolutionPreset[]>([])
  const presetId = normalizeEqualizerPresetId(setting['player.soundEffect.preset'])
  const convolutionSource = setting['player.soundEffect.convolution.fileName']
  const convolutionMainGain = setting['player.soundEffect.convolution.mainGain']
  const convolutionSendGain = setting['player.soundEffect.convolution.sendGain']
  const pitchPlaybackRate = setting['player.soundEffect.pitchShifter.playbackRate']
  const surroundEnabled = setting['player.soundEffect.panner.enable']
  const surroundSpeed = setting['player.soundEffect.panner.speed']
  const soundDistance = setting['player.soundEffect.panner.soundR']
  const activeEqUserPresetId = useMemo(() => userEqPresetList.find(preset =>
    equalizerFrequencies.every(frequency => preset[`hz${frequency}` as keyof LX.SoundEffect.EQPreset] == previewGains[frequency]),
  )?.id ?? null, [previewGains, userEqPresetList])
  const activeConvolutionUserPresetId = useMemo(() => userConvolutionPresetList.find(preset =>
    preset.source == convolutionSource &&
    preset.mainGain == convolutionMainGain &&
    preset.sendGain == convolutionSendGain,
  )?.id ?? null, [convolutionMainGain, convolutionSendGain, convolutionSource, userConvolutionPresetList])
  const isEqPresetLimitReached = userEqPresetList.length >= maxUserPresetCount
  const isConvolutionPresetLimitReached = userConvolutionPresetList.length >= maxUserPresetCount

  useEffect(() => {
    setPreviewGains(getEqualizerGains(setting))
  }, [setting])

  useEffect(() => {
    let cancelled = false
    const loadPresetLists = async() => {
      const [eqList, convolutionList] = await Promise.all([
        getUserEQPresetList(),
        getUserConvolutionPresetList(),
      ])
      if (cancelled) return
      setUserEqPresetList(eqList)
      setUserConvolutionPresetList(convolutionList)
    }
    void loadPresetLists()
    return () => {
      cancelled = true
    }
  }, [])

  const handleReset = () => {
    updateSetting(createPresetSettingPatch('none'))
  }

  const handlePresetPress = (nextPresetId: Exclude<LX.SoundEffectPresetId, 'custom'>) => {
    const preset = equalizerPresets.find(item => item.id == nextPresetId)
    if (!preset) return
    const nextPreview = createEqualizerGainsRecord(preset.gains)
    setPreviewGains(nextPreview)
    updateSetting(createPresetSettingPatch(nextPresetId))
  }

  const handleValueChange = (frequency: typeof equalizerFrequencies[number], value: number) => {
    value = Math.round(value * 10) / 10
    setPreviewGains(prev => {
      const next = {
        ...prev,
        [frequency]: value,
      }
      void soundEffectController.applyCurrentEqualizerConfig(next)
      return next
    })
  }

  const handleSlidingComplete = (frequency: typeof equalizerFrequencies[number], value: number) => {
    updateSetting(createCustomBandSettingPatch(frequency, value, setting))
  }

  const handleToggleConvolution = (source: string) => {
    if (convolutionSource == source) {
      updateSetting({ 'player.soundEffect.convolution.fileName': '' })
      return
    }
    updateSetting(createConvolutionSettingPatch(source))
  }

  const handleUpdateConvolutionMainGain = (value: number) => {
    updateSetting({ 'player.soundEffect.convolution.mainGain': Math.round(value) })
  }

  const handleUpdateConvolutionSendGain = (value: number) => {
    updateSetting({ 'player.soundEffect.convolution.sendGain': Math.round(value) })
  }

  const handleResetPitch = () => {
    updateSetting({ 'player.soundEffect.pitchShifter.playbackRate': 1 })
  }

  const handleShowPitchTip = () => {
    void tipDialog({
      title: t('setting_play_sound_effect_pitch'),
      message: t('setting_play_sound_effect_pitch_tip'),
    })
  }

  const handleUpdatePitch = (value: number) => {
    updateSetting({ 'player.soundEffect.pitchShifter.playbackRate': value })
  }

  const handleShowSaveEqPreset = () => {
    if (isEqPresetLimitReached) {
      toast(t('setting_play_sound_effect_preset_limit', { num: maxUserPresetCount }))
      return
    }
    savePresetModalRef.current?.show({
      title: t('setting_play_sound_effect_save_eq_title'),
      onSave: async(name) => {
        const nextList = await saveUserEQPreset({
          name,
          hz31: previewGains[31],
          hz62: previewGains[62],
          hz125: previewGains[125],
          hz250: previewGains[250],
          hz500: previewGains[500],
          hz1000: previewGains[1000],
          hz2000: previewGains[2000],
          hz4000: previewGains[4000],
          hz8000: previewGains[8000],
          hz16000: previewGains[16000],
        })
        setUserEqPresetList(nextList)
      },
    })
  }

  const handleApplyEqPreset = (preset: LX.SoundEffect.EQPreset) => {
    const gains = [
      preset.hz31,
      preset.hz62,
      preset.hz125,
      preset.hz250,
      preset.hz500,
      preset.hz1000,
      preset.hz2000,
      preset.hz4000,
      preset.hz8000,
      preset.hz16000,
    ]
    setPreviewGains(createEqualizerGainsRecord(gains))
    updateSetting(createCustomGainsSettingPatch(gains))
  }

  const handleRemoveEqPreset = async(preset: LX.SoundEffect.EQPreset) => {
    const confirm = await confirmDialog({
      title: t('setting_play_sound_effect_remove_preset_title'),
      message: t('setting_play_sound_effect_remove_preset_message', { name: preset.name }),
    })
    if (!confirm) return
    setUserEqPresetList(await removeUserEQPreset(preset.id))
  }

  const handleShowSaveConvolutionPreset = () => {
    if (isConvolutionPresetLimitReached) {
      toast(t('setting_play_sound_effect_preset_limit', { num: maxUserPresetCount }))
      return
    }
    savePresetModalRef.current?.show({
      title: t('setting_play_sound_effect_save_env_title'),
      onSave: async(name) => {
        if (!convolutionSource) return
        const nextList = await saveUserConvolutionPreset({
          name,
          source: convolutionSource,
          mainGain: convolutionMainGain,
          sendGain: convolutionSendGain,
        })
        setUserConvolutionPresetList(nextList)
      },
    })
  }

  const handleApplyConvolutionPreset = (preset: LX.SoundEffect.ConvolutionPreset) => {
    updateSetting({
      'player.soundEffect.convolution.fileName': preset.source,
      'player.soundEffect.convolution.mainGain': preset.mainGain,
      'player.soundEffect.convolution.sendGain': preset.sendGain,
    })
  }

  const handleRemoveConvolutionPreset = async(preset: LX.SoundEffect.ConvolutionPreset) => {
    const confirm = await confirmDialog({
      title: t('setting_play_sound_effect_remove_preset_title'),
      message: t('setting_play_sound_effect_remove_preset_message', { name: preset.name }),
    })
    if (!confirm) return
    setUserConvolutionPresetList(await removeUserConvolutionPreset(preset.id))
  }

  const handleToggleSurround = () => {
    updateSetting({ 'player.soundEffect.panner.enable': !surroundEnabled })
  }

  const handleUpdateSurroundSpeed = (value: number) => {
    updateSetting({ 'player.soundEffect.panner.speed': Math.round(value) })
  }

  const handleUpdateSurroundDistance = (value: number) => {
    updateSetting({ 'player.soundEffect.panner.soundR': Math.round(value) })
  }

  if (layoutMode == 'stacked') {
    return (
      <View style={styles.container}>
        <View style={styles.sectionBlock}>
          <EnvironmentSection
            selectedSource={convolutionSource}
            mainGain={convolutionMainGain}
            sendGain={convolutionSendGain}
            userPresetList={userConvolutionPresetList}
            activeUserPresetId={activeConvolutionUserPresetId}
            onToggleConvolution={handleToggleConvolution}
            onMainGainChange={handleUpdateConvolutionMainGain}
            onSendGainChange={handleUpdateConvolutionSendGain}
            onSavePreset={handleShowSaveConvolutionPreset}
            saveDisabled={isConvolutionPresetLimitReached}
            onUserPresetPress={handleApplyConvolutionPreset}
            onUserPresetLongPress={preset => { void handleRemoveConvolutionPreset(preset) }}
          />
        </View>
        <View style={{ ...styles.sectionBlock, ...styles.sectionBlockWithDivider, borderTopColor: dividerColor }}>
          <EqualizerSection
            presetId={presetId}
            previewGains={previewGains}
            userPresetList={userEqPresetList}
            activeUserPresetId={activeEqUserPresetId}
            onReset={handleReset}
            onPresetPress={handlePresetPress}
            onSavePreset={handleShowSaveEqPreset}
            saveDisabled={isEqPresetLimitReached}
            onUserPresetPress={handleApplyEqPreset}
            onUserPresetLongPress={preset => { void handleRemoveEqPreset(preset) }}
            onValueChange={handleValueChange}
            onSlidingComplete={handleSlidingComplete}
            layoutMode={layoutMode}
          />
        </View>
        <View style={{ ...styles.sectionBlock, ...styles.sectionBlockWithDivider, borderTopColor: dividerColor }}>
          <PitchSection
            playbackRate={pitchPlaybackRate}
            onReset={handleResetPitch}
            onValueChange={handleUpdatePitch}
            onShowTip={handleShowPitchTip}
          />
        </View>
        <View style={{ ...styles.sectionBlock, ...styles.sectionBlockWithDivider, borderTopColor: dividerColor }}>
          <SurroundSection
            enabled={surroundEnabled}
            speed={surroundSpeed}
            distance={soundDistance}
            onToggle={handleToggleSurround}
            onSpeedChange={handleUpdateSurroundSpeed}
            onDistanceChange={handleUpdateSurroundDistance}
          />
        </View>
        {showTip ? (
          <View style={styles.tip}>
            <Text size={12} color={theme['c-font-label']}>{t('setting_play_sound_effect_tip')}</Text>
          </View>
        ) : null}
        <SoundEffectPresetSaveModal ref={savePresetModalRef} />
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <View style={styles.layout}>
        <View style={styles.leftColumn}>
          <View style={styles.sectionBlock}>
            <EnvironmentSection
              selectedSource={convolutionSource}
              mainGain={convolutionMainGain}
              sendGain={convolutionSendGain}
              userPresetList={userConvolutionPresetList}
              activeUserPresetId={activeConvolutionUserPresetId}
              onToggleConvolution={handleToggleConvolution}
              onMainGainChange={handleUpdateConvolutionMainGain}
              onSendGainChange={handleUpdateConvolutionSendGain}
              onSavePreset={handleShowSaveConvolutionPreset}
              saveDisabled={isConvolutionPresetLimitReached}
              onUserPresetPress={handleApplyConvolutionPreset}
              onUserPresetLongPress={preset => { void handleRemoveConvolutionPreset(preset) }}
            />
          </View>
          <View style={{ ...styles.sectionBlock, ...styles.sectionBlockWithDivider, borderTopColor: dividerColor }}>
            <PitchSection
              playbackRate={pitchPlaybackRate}
              onReset={handleResetPitch}
              onValueChange={handleUpdatePitch}
              onShowTip={handleShowPitchTip}
            />
          </View>
          <View style={{ ...styles.sectionBlock, ...styles.sectionBlockWithDivider, borderTopColor: dividerColor }}>
            <SurroundSection
              enabled={surroundEnabled}
              speed={surroundSpeed}
              distance={soundDistance}
              onToggle={handleToggleSurround}
              onSpeedChange={handleUpdateSurroundSpeed}
              onDistanceChange={handleUpdateSurroundDistance}
            />
          </View>
          {showTip ? (
            <View style={styles.tip}>
              <Text size={12} color={theme['c-font-label']}>{t('setting_play_sound_effect_tip')}</Text>
            </View>
          ) : null}
        </View>

        <View style={{ ...styles.columnDivider, borderRightColor: dividerColor }} />

        <View style={styles.rightColumn}>
          <View style={styles.sectionBlock}>
            <EqualizerSection
              presetId={presetId}
              previewGains={previewGains}
              userPresetList={userEqPresetList}
              activeUserPresetId={activeEqUserPresetId}
              onReset={handleReset}
              onPresetPress={handlePresetPress}
              onSavePreset={handleShowSaveEqPreset}
              saveDisabled={isEqPresetLimitReached}
              onUserPresetPress={handleApplyEqPreset}
              onUserPresetLongPress={preset => { void handleRemoveEqPreset(preset) }}
              onValueChange={handleValueChange}
              onSlidingComplete={handleSlidingComplete}
              layoutMode={layoutMode}
            />
          </View>
        </View>
      </View>
      <SoundEffectPresetSaveModal ref={savePresetModalRef} />
    </View>
  )
})

const styles = createStyle({
  container: {
    paddingTop: 5,
    paddingLeft: 15,
    paddingRight: 15,
    paddingBottom: 15,
  },
  layout: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 12,
  },
  leftColumn: {
    flex: 1,
    minWidth: 0,
  },
  rightColumn: {
    flex: 1,
    minWidth: 0,
  },
  columnDivider: {
    width: 1,
    borderRightWidth: 1,
    borderStyle: 'dashed',
    borderRightColor: 'rgba(120, 180, 160, 0.5)',
    marginVertical: 2,
  },
  sectionBlock: {
    minWidth: 0,
  },
  sectionBlockWithDivider: {
    borderTopWidth: 1,
    borderStyle: 'dashed',
    paddingTop: 14,
    marginTop: 12,
  },
  section: {
    paddingBottom: 2,
  },
  sectionTitle: {
    fontWeight: '600',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 8,
  },
  sectionHeaderTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  tipButton: {
    padding: 2,
  },
  resetButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
  },
  envList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  placeholderCheckbox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 10,
    marginBottom: 6,
    gap: 3,
  },
  placeholderGroup: {
    gap: 8,
  },
  placeholderSliderItem: {
    gap: 2,
  },
  placeholderSliderContent: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  placeholderValue: {
    width: 48,
    textAlign: 'right',
  },
  tip: {
    marginTop: 10,
  },
  equalizerGrid: {
    marginBottom: 10,
  },
  equalizerRow: {
    flexDirection: 'row',
  },
  equalizerItem: {
    flex: 1,
    marginBottom: 6,
  },
  equalizerSliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  equalizerLabel: {
    width: 24,
  },
  equalizerValue: {
    width: 38,
    textAlign: 'right',
  },
  stackedEqualizerList: {
    marginBottom: 10,
  },
  stackedEqualizerItem: {
    marginBottom: 6,
  },
  presetList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
  },
  presetButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginRight: 8,
    marginBottom: 8,
  },
  presetAddButton: {
    minWidth: 24,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 8,
    marginBottom: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetAddText: {
    lineHeight: 15,
    fontWeight: '600',
  },
  sliderWrap: {
    flex: 1,
    minWidth: 0,
  },
})
