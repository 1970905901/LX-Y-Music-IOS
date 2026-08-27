import { storageDataPrefix } from '@/config/constant'
import { getData, saveData } from '@/plugins/storage'

const soundEffectEQPresetListKey = (storageDataPrefix as Record<string, string>).soundEffectEQPresetList
const soundEffectConvolutionPresetListKey = (storageDataPrefix as Record<string, string>).soundEffectConvolutionPresetList

const createId = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
const normalizePresetName = (name: string) => name.trim().slice(0, 20)

let userEqPresetList: LX.SoundEffect.EQPreset[] | null = null
let userConvolutionPresetList: LX.SoundEffect.ConvolutionPreset[] | null = null

const getCachedList = async<T>(key: string, cache: T[] | null) => {
  if (cache != null) return cache
  return (await getData<T[]>(key)) ?? []
}

const savePresetList = async<T>(key: string, list: T[]) => {
  await saveData(key, list)
  return list
}

export const getUserEQPresetList = async() => {
  // eslint-disable-next-line require-atomic-updates
  userEqPresetList = await getCachedList<LX.SoundEffect.EQPreset>(soundEffectEQPresetListKey, userEqPresetList)
  return [...userEqPresetList]
}

export const saveUserEQPreset = async(preset: Omit<LX.SoundEffect.EQPreset, 'id'>) => {
  // eslint-disable-next-line require-atomic-updates
  userEqPresetList = await getCachedList<LX.SoundEffect.EQPreset>(soundEffectEQPresetListKey, userEqPresetList)
  const nextPreset: LX.SoundEffect.EQPreset = {
    ...preset,
    name: normalizePresetName(preset.name),
    id: createId(),
  }
  userEqPresetList.push(nextPreset)
  await savePresetList(soundEffectEQPresetListKey, userEqPresetList)
  return [...userEqPresetList]
}

export const removeUserEQPreset = async(id: string) => {
  // eslint-disable-next-line require-atomic-updates
  userEqPresetList = await getCachedList<LX.SoundEffect.EQPreset>(soundEffectEQPresetListKey, userEqPresetList)
  // eslint-disable-next-line require-atomic-updates
  userEqPresetList = userEqPresetList.filter(item => item.id != id)
  await savePresetList(soundEffectEQPresetListKey, userEqPresetList)
  return [...userEqPresetList]
}

export const getUserConvolutionPresetList = async() => {
  // eslint-disable-next-line require-atomic-updates
  userConvolutionPresetList = await getCachedList<LX.SoundEffect.ConvolutionPreset>(soundEffectConvolutionPresetListKey, userConvolutionPresetList)
  return [...userConvolutionPresetList]
}

export const saveUserConvolutionPreset = async(preset: Omit<LX.SoundEffect.ConvolutionPreset, 'id'>) => {
  // eslint-disable-next-line require-atomic-updates
  userConvolutionPresetList = await getCachedList<LX.SoundEffect.ConvolutionPreset>(soundEffectConvolutionPresetListKey, userConvolutionPresetList)
  const nextPreset: LX.SoundEffect.ConvolutionPreset = {
    ...preset,
    name: normalizePresetName(preset.name),
    id: createId(),
  }
  userConvolutionPresetList.push(nextPreset)
  await savePresetList(soundEffectConvolutionPresetListKey, userConvolutionPresetList)
  return [...userConvolutionPresetList]
}

export const removeUserConvolutionPreset = async(id: string) => {
  // eslint-disable-next-line require-atomic-updates
  userConvolutionPresetList = await getCachedList<LX.SoundEffect.ConvolutionPreset>(soundEffectConvolutionPresetListKey, userConvolutionPresetList)
  // eslint-disable-next-line require-atomic-updates
  userConvolutionPresetList = userConvolutionPresetList.filter(item => item.id != id)
  await savePresetList(soundEffectConvolutionPresetListKey, userConvolutionPresetList)
  return [...userConvolutionPresetList]
}
