/**
 * 酷狗「听歌识曲」声学指纹接口（移植自 EchoMusic）。
 *
 * 链路（与 EchoMusic / KuGouMusicApi 对齐）：
 *   JS 录音（8000Hz / 单声道 / 16bit LE PCM）
 *     → POST https://gateway.kugou.com/fingerprint.service/v1/music_trackid_mulit
 *     → 返回若干候选（含 hash_320 / hash_flac / hash_high / 歌手 / 专辑 / 时长 / dist）
 *     → 映射成本项目可播放的 LX.Music.MusicInfoOnline（kg）条目。
 *
 * 签名：Android 版签名 salt + 排序参数串 + **原始 PCM 字节** + salt 取 MD5。
 * 注意不能复用 stringMd5（按字符串处理会把二进制 PCM 当 UTF-8 破坏），必须用
 * CryptoJS 的 MD5 hasher 逐段 update（源码参考 KuGouMusicApi/util/helper.js
 * signatureAndroidParams 里 `Buffer.isBuffer(data)` 的分支）。
 */

import CryptoJS from 'crypto-js'
import { generateHeadersAndParams } from './utils/api'
import { decodeName, formatPlayTime } from '../../index'

const KG_API_BASE = 'https://gateway.kugou.com'
const RECOGNIZE_PATH = '/fingerprint.service/v1/music_trackid_mulit'
const SIGN_SALT = 'OIlwieks28dk2k092lksi2UIkp'

/** 单条识别结果：可播放歌曲 + 置信度（0~1，越大越准） */
export interface RecognizeMatch {
  musicInfo: LX.Music.MusicInfoOnline
  confidence: number
}

// ---------------------------------------------------------------------------
// 基础取值工具（上游返回字段存在别名，全部兜底，避免单个字段缺失就整条失败）
// ---------------------------------------------------------------------------

const toRecord = (value: unknown): Record<string, any> =>
  value != null && typeof value === 'object' ? (value as Record<string, any>) : {}

const getArray = (value: unknown): any[] => (Array.isArray(value) ? value : [])

const readString = (value: unknown, fallback = ''): string => {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return fallback
}

const decodeText = (value: unknown): string => {
  const text = readString(value)
  if (!text) return ''
  try {
    return decodeName(text)
  } catch {
    return text
  }
}

/** 音质 hash 组装：fingerprint 返回的多个 hash 字段对应不同音质 */
function buildQualityPayload(item: Record<string, any>): {
  types: LX.Music.MusicQualityTypeKg[]
  _types: LX.Music._MusicQualityTypeKg
} {
  const types: LX.Music.MusicQualityTypeKg[] = []
  const _types: LX.Music._MusicQualityTypeKg = {}
  const push = (type: LX.Quality, hash: unknown) => {
    const value = readString(hash)
    if (!value) return
    if (_types[type]) return
    types.push({ type, size: null, hash: value })
    _types[type] = { size: null, hash: value }
  }
  push('128k', item.hash_128 || item.hash || item.FileHash)
  push('320k', item.hash_320)
  push('flac', item.hash_flac)
  push('hires', item.hash_high)
  return { types, _types }
}

/** 单条指纹结果 → 可播放的 LX.Music.MusicInfoOnline（kg） */
export function mapRecognizeItem(raw: unknown): RecognizeMatch | null {
  const item = toRecord(raw)
  const { types, _types } = buildQualityPayload(item)
  const hash = readString(item.hash) || types[0]?.hash || ''
  if (!hash) return null

  const name = decodeText(item.songname ?? item.song_name ?? item.filename ?? item.name)
  if (!name) return null

  const authors = getArray(item.authors)
    .map((author) => {
      const record = toRecord(author)
      return {
        id: readString(record.author_id ?? record.singerid),
        name: decodeText(record.author_name ?? record.singername),
      }
    })
    .filter((author) => author.name.length > 0)

  const singer = authors.length
    ? authors.map((author) => author.name).join('、')
    : decodeText(item.singername ?? item.author_name ?? item.singer)

  const albumRecord = toRecord(getArray(item.album).find((entry) => entry != null && typeof entry === 'object'))
  const albumName = decodeText(albumRecord.albumname ?? item.album_name ?? item.albumname)
  const albumId = readString(albumRecord.albumid ?? albumRecord.album_id ?? item.album_id ?? item.albumid)
  const pic = readString(
    item.union_cover ?? albumRecord.sizable_cover ?? item.album_sizable_cover ?? item.cover ?? item.img,
  ).replace('{size}', '480')

  const audioId = readString(
    item.album_audio_id ?? item.mixsongid ?? item.audio_id ?? item.songid ?? item.fileid,
  )
  // timelength 为毫秒；本项目 interval/_interval 统一用秒
  const durationSec = Math.max(0, Math.round(Number(item.timelength ?? item.duration ?? 0) / 1000))
  const interval = durationSec > 0 ? formatPlayTime(durationSec) : null

  const musicInfo = {
    id: `${audioId || hash}_${hash}`,
    name,
    singer,
    artists: authors.length ? authors : undefined,
    source: 'kg',
    interval,
    albumId,
    albumName,
    songmid: audioId,
    _interval: durationSec,
    img: pic || null,
    lrc: null,
    otherSource: null,
    hash,
    mixSongId: audioId,
    types,
    _types,
    typeUrl: {},
    meta: {
      songId: audioId,
      albumName,
      albumId,
      picUrl: pic || null,
      qualitys: types,
      _qualitys: _types,
      hash,
      mixSongId: audioId,
    },
  } as unknown as LX.Music.MusicInfoOnline

  const dist = Number(readString(item.dist, '1'))
  const confidence = Number.isFinite(dist) ? Math.min(Math.max(1 - dist, 0), 1) : 0

  return { musicInfo, confidence }
}

/** 把接口返回的候选列表映射并按置信度降序排序 */
export function mapRecognizeList(list: unknown): RecognizeMatch[] {
  if (!Array.isArray(list)) return []
  return list
    .map((item) => mapRecognizeItem(item))
    .filter((match): match is RecognizeMatch => match != null)
    .sort((a, b) => b.confidence - a.confidence)
}

// ---------------------------------------------------------------------------
// 签名 + 请求
// ---------------------------------------------------------------------------

function wordArrayFromBytes(uint8: Uint8Array): CryptoJS.lib.WordArray {
  const words: number[] = []
  for (let i = 0; i < uint8.length; i += 4) {
    words.push(
      ((uint8[i] || 0) << 24) |
        ((uint8[i + 1] || 0) << 16) |
        ((uint8[i + 2] || 0) << 8) |
        (uint8[i + 3] || 0),
    )
  }
  return CryptoJS.lib.WordArray.create(words, uint8.length)
}

/** md5(salt + 排序参数串 + 原始 PCM 字节 + salt) */
export function signAndroidBinary(params: Record<string, any>, bytes: Uint8Array): string {
  const paramsString = Object.keys(params)
    .sort()
    .map((key) => `${key}=${typeof params[key] === 'object' ? JSON.stringify(params[key]) : params[key]}`)
    .join('')
  const hasher = CryptoJS.algo.MD5.create()
  hasher.update(CryptoJS.enc.Utf8.parse(SIGN_SALT))
  hasher.update(CryptoJS.enc.Utf8.parse(paramsString))
  hasher.update(wordArrayFromBytes(bytes))
  hasher.update(CryptoJS.enc.Utf8.parse(SIGN_SALT))
  return hasher.finalize().toString(CryptoJS.enc.Hex)
}

/**
 * 提交一段裸 PCM 做听歌识曲
 * @param bytes 8000Hz / 单声道 / 16bit LE PCM
 * @returns 按置信度降序的候选（可能为空数组）
 */
export async function matchPcm(bytes: Uint8Array): Promise<RecognizeMatch[]> {
  if (bytes.length === 0) return []
  const { headers, defaultParams } = generateHeadersAndParams()
  const params = {
    ...defaultParams,
    fpid: Date.now(),
    area_code: 1,
    include_unpublish: 1,
    useid: 0,
    multi_result: 1,
  }
  const signature = signAndroidBinary(params, bytes)
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries({ ...params, signature })) {
    if (value === undefined || value === null) continue
    query.append(key, String(value))
  }
  const url = `${KG_API_BASE}${RECOGNIZE_PATH}?${query.toString()}`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...headers,
      // 覆盖 generateHeadersAndParams 的 application/json：这里提交二进制 PCM
      'Content-Type': 'application/octet-stream',
      'User-Agent': 'KuGou/11490 (Android)',
    },
    body: bytes as any,
  })

  if (!response.ok) throw new Error(`recognize http ${response.status}`)
  const body = (await response.json()) as { status?: number, data?: unknown }
  if (body?.status !== 1) return []
  return mapRecognizeList(body.data)
}

export default { matchPcm, mapRecognizeList, mapRecognizeItem, signAndroidBinary }
