import AsyncStorage from '@react-native-async-storage/async-storage'
import { log } from '@/utils/log'

const partKeyPrefix = '@___PART___'
const partKeyArrPrefix = '@___PART_A___'
const partKeyPrefixRxp = /^@___PART___/
const partKeyArrPrefixRxp = /^@___PART_A___/
const keySplit = ','
const limit = 500000

// 分片键带一次性 token：覆盖写时新分片绝不与旧分片同名，
// 旧指针在提交前始终指向旧分片，读路径不受写入过程影响。
const createPartToken = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

// 从指针值解析分片键（兼容旧格式 @___PART___a,b 与新格式 @___PART_A___[...]）
const parsePartKeys = (pointerValue: string | null): string[] => {
  if (!pointerValue) return []
  if (partKeyPrefixRxp.test(pointerValue)) {
    return pointerValue.replace(partKeyPrefixRxp, '').split(keySplit)
  }
  if (partKeyArrPrefixRxp.test(pointerValue)) {
    try {
      const keys = JSON.parse(pointerValue.replace(partKeyArrPrefixRxp, '')) as unknown
      return Array.isArray(keys) ? keys.filter((key): key is string => typeof key == 'string') : []
    } catch {
      return []
    }
  }
  return []
}

const removePartKeys = async(partKeys: string[]) => {
  if (!partKeys.length) return
  try {
    await AsyncStorage.multiRemove(partKeys)
  } catch (e: any) {
    // 旧分片回收失败不影响已提交的新数据，只留日志（下次写入/删除还会再清）
    log.warn('storage warn[removePartKeys]:', e?.message ?? e)
  }
}

interface StorageWrite {
  key: string
  // 小值 = [[key, valueStr]]；大值 = 全部分片键（旧数据不动，指针后置提交）
  chunks: Array<[string, string]>
  pointer?: string
}

// 只做序列化与键规划：任何写入之前先把全部值准备好（序列化失败不会碰旧数据）
const prepareWrite = (key: string, value: any): StorageWrite => {
  const valueStr = JSON.stringify(value)
  if (valueStr.length <= limit) return { key, chunks: [[key, valueStr]] }

  const token = createPartToken()
  const partKeys: string[] = []
  const chunks: Array<[string, string]> = []
  for (let i = 0, len = Math.floor(valueStr.length / limit); i <= len; i++) {
    const partKey = `${partKeyArrPrefix}${key}#${token}#${i}`
    partKeys.push(partKey)
    chunks.push([partKey, valueStr.substring(i * limit, (i + 1) * limit)])
  }
  return { key, chunks, pointer: partKeyArrPrefix + JSON.stringify(partKeys) }
}

const collectPartKeys = (writes: StorageWrite[]) =>
  writes.reduce<string[]>((acc, item) => item.pointer == null
    ? acc
    : acc.concat(item.chunks.map(([partKey]) => partKey)), [])

// 覆盖写顺序：① 一次 multiSet 落盘全部新值/新分片（旧键全程不动）
//            ② 大值指针逐个单键提交（提交点）
//            ③ 全部提交成功后才回收旧分片
// 任一步失败/进程被杀：每个键要么旧值完好、要么新值已提交，不会出现「删了旧的、新的没写进去」。
const commitWrites = async(writes: StorageWrite[], previousPointers: ReadonlyArray<[string, string | null]>) => {
  if (!writes.length) return

  const chunks = writes.reduce<Array<[string, string]>>((acc, item) => acc.concat(item.chunks), [])
  try {
    await AsyncStorage.multiSet(chunks)
  } catch (e) {
    // 批量落盘失败：小值可能已是完整新值（保留）；大值分片此时还没有被任何指针引用，可安全清理
    await removePartKeys(collectPartKeys(writes))
    throw e
  }

  // 小值已随 multiSet 提交；大值需要指针切换后才对外可见
  const committedKeys = new Set(writes.filter((item) => item.pointer == null).map((item) => item.key))
  const pointerWrites = writes.filter((item) => item.pointer != null)
  for (let i = 0; i < pointerWrites.length; i++) {
    const item = pointerWrites[i]
    try {
      await AsyncStorage.setItem(item.key, item.pointer!)
      committedKeys.add(item.key)
    } catch (e) {
      // 未提交项的新分片是孤儿，清掉；已提交项的旧分片已无引用，一并回收
      await removePartKeys(collectPartKeys(pointerWrites.slice(i)))
      await removePartKeys(previousPointers
        .filter(([key]) => committedKeys.has(key))
        .reduce<string[]>((acc, [, pointer]) => acc.concat(parsePartKeys(pointer)), []))
      throw e
    }
  }

  await removePartKeys(previousPointers.reduce<string[]>((acc, [, pointer]) => acc.concat(parsePartKeys(pointer)), []))
}

const handleGetDataOld = async <T>(partKeys: string): Promise<T> => {
  const keys = partKeys.replace(partKeyPrefixRxp, '').split(keySplit)

  return AsyncStorage.multiGet(keys).then((datas) => {
    return JSON.parse(datas.map((data) => data[1]).join(''))
  })
}

const handleGetData = async <T>(partKeys: string): Promise<T> => {
  if (partKeys.startsWith(partKeyPrefix)) return handleGetDataOld<T>(partKeys)

  const keys = JSON.parse(partKeys.replace(partKeyArrPrefixRxp, '')) as string[]
  return AsyncStorage.multiGet(keys).then((datas) => {
    return JSON.parse(datas.map((data) => data[1]).join(''))
  })
}

export const saveData = async(key: string, value: any) => {
  try {
    const previous = await AsyncStorage.getItem(key)
    // 序列化失败（如循环引用）也走这里：必须留日志，否则只表现为「像没写进缓存」
    await commitWrites([prepareWrite(key, value)], [[key, previous]])
  } catch (e: any) {
    // saving error
    log.error('storage error[saveData]:', key, e.message)
    throw e
  }
}

export const getData = async <T = unknown>(key: string): Promise<T | null> => {
  let value: string | null
  try {
    value = await AsyncStorage.getItem(key)
  } catch (e: any) {
    // error reading value
    log.error('storage error[getData]:', key, e.message)
    throw e
  }
  if (value && (partKeyPrefixRxp.test(value) || partKeyArrPrefixRxp.test(value))) {
    return handleGetData<T>(value)
  } else if (value == null) return value
  return JSON.parse(value)
}

export const removeData = async(key: string) => {
  let value: string | null
  try {
    value = await AsyncStorage.getItem(key)
  } catch (e: any) {
    // error reading value
    log.error('storage error[removeData]:', key, e.message)
    throw e
  }
  if (value) {
    if (partKeyPrefixRxp.test(value)) {
      let partKeys = value.replace(partKeyPrefixRxp, '').split(keySplit)
      partKeys.push(key)
      try {
        await AsyncStorage.multiRemove(partKeys)
      } catch (e: any) {
        // remove error
        log.error('storage error[removeData]:', key, e.message)
        throw e
      }
      return
    } else if (partKeyArrPrefixRxp.test(value)) {
      let partKeys = JSON.parse(value.replace(partKeyArrPrefixRxp, '')) as string[]
      partKeys.push(key)
      try {
        await AsyncStorage.multiRemove(partKeys)
      } catch (e: any) {
        // remove error
        log.error('storage error[removeData]:', key, e.message)
        throw e
      }
      return
    }
  }

  try {
    await AsyncStorage.removeItem(key)
  } catch (e: any) {
    // remove error
    log.error('storage error[removeData]:', key, e.message)
    throw e
  }
}

export const getAllKeys = async() => {
  let keys
  try {
    keys = await AsyncStorage.getAllKeys()
  } catch (e: any) {
    // read key error
    log.error('storage error[getAllKeys]:', e.message)
    throw e
  }

  return keys
}

export const getDataMultiple = async <T extends readonly string[]>(keys: T) => {
  type RawData = { [K in keyof T]: [T[K], string | null] }
  let datas: RawData
  try {
    datas = (await AsyncStorage.multiGet(keys)) as RawData
  } catch (e: any) {
    // read error
    log.error('storage error[getDataMultiple]:', e.message)
    throw e
  }
  const promises: Array<Promise<ReadonlyArray<[unknown | null]>>> = []
  for (const [, value] of datas) {
    if (value && (partKeyPrefixRxp.test(value) || partKeyArrPrefixRxp.test(value))) {
      promises.push(handleGetData(value))
    } else {
      promises.push(Promise.resolve(value ? JSON.parse(value) : value))
    }
  }
  return Promise.all(promises).then((values) => {
    return datas.map(([key], index) => [key, values[index]]) as { [K in keyof T]: [T[K], unknown] }
  })
}

export const saveDataMultiple = async(datas: Array<[string, any]>) => {
  try {
    // 先把旧值整体读出来（回收旧分片用），再一次批量落盘：
    // 任一步失败都不会先删旧数据，每个键要么旧值完好、要么新值已提交
    const previous = await AsyncStorage.multiGet(datas.map(([key]) => key))
    await commitWrites(datas.map(([key, value]) => prepareWrite(key, value)), previous)
  } catch (e: any) {
    // save error
    log.error('storage error[saveDataMultiple]:', e.message)
    throw e
  }
}

export const removeDataMultiple = async(keys: string[]) => {
  if (!keys.length) return
  const datas = await AsyncStorage.multiGet(keys)
  let allKeys = []
  for (const [key, value] of datas) {
    allKeys.push(key)
    if (value) {
      if (partKeyPrefixRxp.test(value)) {
        allKeys.push(...value.replace(partKeyPrefixRxp, '').split(keySplit))
      } else if (partKeyArrPrefixRxp.test(value)) {
        allKeys.push(...(JSON.parse(value.replace(partKeyArrPrefixRxp, '')) as string[]))
      }
    }
  }
  try {
    await AsyncStorage.multiRemove(allKeys)
  } catch (e: any) {
    // remove error
    log.error('storage error[removeDataMultiple]:', e.message)
    throw e
  }
}

export const clearAll = async() => {
  try {
    await AsyncStorage.clear()
  } catch (e: any) {
    // clear error
    log.error('storage error[clearAll]:', e.message)
    throw e
  }
}

export { useAsyncStorage } from '@react-native-async-storage/async-storage'
