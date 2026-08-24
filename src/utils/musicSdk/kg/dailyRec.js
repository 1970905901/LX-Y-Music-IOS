/**
 * KuGou Music daily recommendation API
 * Includes: song recommendations, daily recommendations, new songs
 */
import { httpFetch } from '../../request'
import { log } from '@/utils/log'
import { stringMd5 } from 'react-native-quick-md5'
import { formatPlayTime } from '../../index'
import { getBatchMusicQualityInfo } from './quality_detail'
import { signAndroidParams, getDeviceInfo, buildHeaders } from './utils/shared'

// Transform song to app format
const transformSong = (item, index) => {
  try {
    const hash = item.hash || item.audio_info?.hash || ''
    const audioId = item.audio_id || item.audio_info?.audio_id || 0
    const songname = item.songname || item.audio_info?.songname || item.name || ''
    const singername = item.author_name || item.singername || item.audio_info?.singername || ''
    const albumName = item.album_name || item.audio_info?.album_name || ''
    const albumId = item.album_id || item.audio_info?.album_id || ''
    const rawDuration = item.time_length || item.timelength || item.timelen || item.duration || item.audio_info?.timelength || item.audio_info?.duration || 0
    const duration = rawDuration > 10000 ? Math.floor(rawDuration / 1000) : rawDuration
    let img = item.sizable_cover || item.image || item.audio_info?.image || 
              item.album_sizable_cover || item.album_info?.sizable_cover ||
              item.trans_param?.union_cover || ''
    if (!img && hash) {
      img = `https://imge.kugou.com/stdmusic/{size}/${hash.substring(0, 8)}.jpg`
    }
    const mixsongid = item.mixsongid || item.audio_info?.mixsongid || 0

    return {
      id: `kg__${hash}`,
      name: songname,
      singer: singername,
      source: 'kg',
      interval: duration ? formatPlayTime(duration) : '',
      img: img ? img.replace('{size}', '400') : '',
      albumName,
      albumId: String(albumId),
      songmid: String(audioId),
      hash,
      mixSongId: mixsongid,
      types: [{ type: '128k', size: null }],
      _types: { '128k': { size: null } },
      typeUrl: {},
      meta: {
        songId: String(audioId),
        albumName,
        albumId: String(albumId),
        picUrl: img ? img.replace('{size}', '400') : '',
        qualitys: [{ type: '128k', size: null }],
        _qualitys: { '128k': { size: null } },
        hash,
        mixsongid,
      },
    }
  } catch (e) {
    log.error(`[KG DailyRec] transformSong[${index}] 失败`, e.message)
    return null
  }
}

const transformSongList = async (rawList, sourceName = 'unknown') => {
  if (!rawList || !Array.isArray(rawList)) return []
  log.info(`[KG DailyRec] transformSongList ${sourceName}`, { count: rawList.length })

  const songList = rawList.map((item, i) => transformSong(item, i)).filter(Boolean)

  const hashList = songList.map(song => song.hash).filter(Boolean)
  let qualityInfoMap = {}
  try {
    qualityInfoMap = await getBatchMusicQualityInfo(hashList).promise
  } catch (error) {
    log.error(`[KG DailyRec] getBatchMusicQualityInfo 失败:`, error.message)
  }

  return songList.map(song => {
    const qualityInfo = qualityInfoMap[song.hash]
    if (!qualityInfo) return song

    return {
      ...song,
      types: qualityInfo.types,
      _types: qualityInfo._types,
      meta: {
        ...song.meta,
        qualitys: qualityInfo.types,
        _qualitys: qualityInfo._types,
      },
    }
  })
}

export default {
  /**
   * Song recommendations (personalized)
   */
  async getRecommendSongs(retryNum = 0) {
    if (retryNum > 2) return Promise.reject(new Error('try max num'))

    try {
      const device = getDeviceInfo()
      log.info('[KG DailyRec] getRecommendSongs 开始')

      const clienttime = Math.floor(Date.now() / 1000)
      const paramsMap = {
        dfid: device.dfid,
        mid: device.mid,
        uuid: '-',
        appid: '1005',
        clientver: '20489',
        clienttime,
        platform: 'ios',
        userid: Number(device.userid) || 0,
      }
      const sig = signAndroidParams(paramsMap, '')

      const url = `https://gateway.kugou.com/everyday_song_recommend`
      log.info('[KG DailyRec] getRecommendSongs URL:', url)

      const { body, statusCode } = await httpFetch(url, {
        method: 'POST',
        headers: {
          ...buildHeaders(),
          'x-router': 'everydayrec.service.kugou.com',
          dfid: device.dfid,
          mid: device.mid,
          clienttime: String(clienttime),
          Cookie: device.cookieStr || `mid=${device.mid}`,
        },
        params: { ...paramsMap, signature: sig },
      }).promise

      log.info('[KG DailyRec] getRecommendSongs 响应', { statusCode, status: body?.status, error_code: body?.error_code })

      if (body?.status !== 1 && body?.error_code !== 0) {
        throw new Error(`API错误: ${body?.error_code} ${body?.error || ''}`)
      }

      const songs = body?.data?.song_list || body?.data?.songs || body?.data?.list || []
      log.info('[KG DailyRec] getRecommendSongs 成功', { count: songs.length })
      return transformSongList(songs, 'recommend')
    } catch (e) {
      log.error('[KG DailyRec] getRecommendSongs 失败', e.message)
      if (retryNum < 2) return this.getRecommendSongs(retryNum + 1)
      throw e
    }
  },

  /**
   * Daily recommendations
   */
  async getEverydayRecommend(retryNum = 0) {
    if (retryNum > 2) return Promise.reject(new Error('try max num'))

    try {
      const device = getDeviceInfo()
      log.info('[KG DailyRec] getEverydayRecommend 开始')

      const clienttime = Math.floor(Date.now() / 1000)
      const defaultParams = {
        dfid: device.dfid,
        mid: device.mid,
        uuid: '-',
        appid: '1005',
        clientver: '20489',
        clienttime,
      }
      const paramsMap = { ...defaultParams, platform: 'ios' }
      const sig = signAndroidParams(paramsMap, '')

      const url = `https://gateway.kugou.com/everyday_song_recommend`
      log.info('[KG DailyRec] getEverydayRecommend URL:', url)

      const { body, statusCode } = await httpFetch(url, {
        method: 'POST',
        headers: {
          ...buildHeaders(),
          'x-router': 'everydayrec.service.kugou.com',
          'Content-Type': 'application/json',
          dfid: device.dfid,
          mid: device.mid,
          clienttime: String(clienttime),
          Cookie: `mid=${device.mid}`,
        },
        params: { ...paramsMap, signature: sig },
      }).promise

      log.info('[KG DailyRec] getEverydayRecommend 响应', { statusCode, status: body?.status })

      if (body?.status !== 1 && body?.error_code !== 0) {
        throw new Error(`API错误: ${body?.error_code} ${body?.error || ''}`)
      }

      const songs = body?.data?.song_list || body?.data?.songs || body?.data?.list || []
      log.info('[KG DailyRec] getEverydayRecommend 成功', { count: songs.length })
      return transformSongList(songs, 'everyday')
    } catch (e) {
      log.error('[KG DailyRec] getEverydayRecommend 失败', e.message)
      if (retryNum < 2) return this.getEverydayRecommend(retryNum + 1)
      throw e
    }
  },

  /**
   * New song express
   */
  async getNewSongs(retryNum = 0) {
    if (retryNum > 2) return Promise.reject(new Error('try max num'))

    try {
      const device = getDeviceInfo()
      log.info('[KG DailyRec] getNewSongs 开始')

      const clienttime = Math.floor(Date.now() / 1000)
      const paramsMap = {
        dfid: device.dfid,
        mid: device.mid,
        uuid: '-',
        appid: '1005',
        clientver: '20489',
        clienttime,
        token: device.token,
        userid: Number(device.userid) || 0,
      }
      const dataMap = { rank_id: 21608, userid: Number(device.userid) || 0, page: 1, pagesize: 30, tags: [] }
      const dataStr = JSON.stringify(dataMap)
      const sig = signAndroidParams(paramsMap, dataStr)

      const url = `https://gateway.kugou.com/musicadservice/container/v1/newsong_publish`
      log.info('[KG DailyRec] getNewSongs URL:', url)

      const { body, statusCode } = await httpFetch(url, {
        method: 'POST',
        headers: {
          ...buildHeaders(),
          'Content-Type': 'application/json',
          dfid: device.dfid,
          mid: device.mid,
          clienttime: String(clienttime),
          Cookie: `mid=${device.mid}`,
        },
        params: { ...paramsMap, signature: sig },
        body: dataMap,
      }).promise

      log.info('[KG DailyRec] getNewSongs 响应', { statusCode, status: body?.status, error_code: body?.error_code })

      if (body?.status !== 1 && body?.error_code !== 0) {
        throw new Error(`API错误: ${body?.error_code} ${body?.error || ''}`)
      }

      const songs = Array.isArray(body?.data) ? body.data : (body?.data?.songs || body?.data?.song_list || [])
      log.info('[KG DailyRec] getNewSongs 成功', { count: songs.length })
      return transformSongList(songs, 'newsong')
    } catch (e) {
      log.error('[KG DailyRec] getNewSongs 失败', e.message)
      if (retryNum < 2) return this.getNewSongs(retryNum + 1)
      throw e
    }
  },
}
