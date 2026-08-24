import { httpFetch } from '../../request'
import axios from 'axios'
import { stringMd5 } from 'react-native-quick-md5'
import { signAndroidParams, getDeviceInfo, buildHeaders } from './utils/shared'

/**
 * Get MV info by song hash
 * @param {string} hash - song hash
 * @returns {Promise<Object>} MV info
 */
const getMvInfo = async (hash) => {
  const device = getDeviceInfo()
  const clienttime = Math.floor(Date.now() / 1000)
  
  const paramsMap = {
    dfid: device.dfid,
    mid: device.mid,
    uuid: '-',
    appid: '1005',
    clientver: '20489',
    clienttime,
  }
  
  const dataMap = {
    data: [{ album_audio_id: hash }],
    fields: '',
  }
  
  const dataStr = JSON.stringify(dataMap)
  const sig = signAndroidParams(paramsMap, dataStr)
  
  try {
    const { body, statusCode } = await httpFetch('https://openapi.kugou.com/kmr/v1/audio/mv', {
      method: 'POST',
      headers: {
        ...buildHeaders(),
        'Content-Type': 'application/json',
        'x-router': 'openapi.kugou.com',
        'KG-TID': '38',
        dfid: device.dfid,
        mid: device.mid,
        clienttime: String(clienttime),
        Cookie: `mid=${device.mid}`,
      },
      params: { ...paramsMap, signature: sig },
      body: dataMap,
    }).promise
    
    if (!body || body.error_code !== 0 || !body.data) {
      return Promise.reject(new Error(body?.message || '获取MV信息失败'))
    }
    
    const mvData = body.data[0]
    
    if (Array.isArray(mvData) && mvData.length > 0) {
      return mvData
    }
    
    if (mvData && mvData.video_info) {
      return mvData
    }
    
    return Promise.reject(new Error('该歌曲暂无MV'))
  } catch (err) {
    throw err
  }
}

/**
 * Get MV info through search API
 * @param {string} songName - song name
 * @param {string} singerName - singer name
 * @returns {Promise<Object>} MV info
 */
const searchMv = async (songName, singerName) => {
  const device = getDeviceInfo()
  const clienttime = Math.floor(Date.now() / 1000)
  const keyword = `${singerName} ${songName}`
  
  const paramsMap = {
    dfid: device.dfid,
    mid: device.mid,
    uuid: '-',
    appid: '1005',
    clientver: '20489',
    clienttime,
    keyword,
    page: 1,
    pagesize: 5,
    platform: 'AndroidFilter',
  }
  
  const sig = signAndroidParams(paramsMap)
  
  try {
    const { body } = await httpFetch('https://complexsearch.kugou.com/v1/search/mv', {
      method: 'GET',
      headers: {
        ...buildHeaders(),
        'x-router': 'complexsearch.kugou.com',
        dfid: device.dfid,
        mid: device.mid,
        clienttime: String(clienttime),
        Cookie: `mid=${device.mid}`,
      },
      params: { ...paramsMap, signature: sig },
    }).promise
    
    if (body && body.error_code === 0 && body.data && body.data.lists && body.data.lists.length > 0) {
      return body.data.lists[0]
    }
    
    return null
  } catch (err) {
    return null
  }
}

/**
 * Get MV playback link
 * @param {string} songId - song ID (album_audio_id)
 * @param {string} songName - song name (optional, for search)
 * @param {string} singerName - singer name (optional, for search)
 * @returns {Promise<Object>} object containing url
 */
export const getMvUrl = async (songId, songName, singerName) => {
  try {
    let mvInfo = null
    try {
      mvInfo = await getMvInfo(songId)
    } catch (e) {}
    
    let videoId = null
    
    if (Array.isArray(mvInfo) && mvInfo.length > 0) {
      const officialMv = mvInfo.find(mv => mv.is_ugc === 0 && mv.is_other === 0) || mvInfo[0]
      videoId = officialMv.video_id
    }
    else if (mvInfo && mvInfo.video_info && mvInfo.video_info.length > 0) {
      const videoInfo = mvInfo.video_info[mvInfo.video_info.length - 1]
      if (videoInfo && videoInfo.hash) {
        videoId = videoInfo.hash
      }
    }
    
    if (!videoId && songName && singerName) {
      const searchResult = await searchMv(songName, singerName)
      
      if (searchResult && searchResult.videoid) {
        videoId = searchResult.videoid
      }
    }
    
    if (!videoId) {
      return Promise.reject(new Error('该歌曲暂无MV'))
    }
    
    const device = getDeviceInfo()
    const clienttime = Math.floor(Date.now() / 1000)
    const dfid = device.dfid || '-'
    const mid = device.mid || '-'
    const uuid = stringMd5(`${dfid}${mid}`)
    
    const SIGN_PARAMS_KEY_SALT = 'OIlwieks28dk2k092lksi2UIkp'
    const detailKey = stringMd5(`1005${SIGN_PARAMS_KEY_SALT}20489${clienttime}`)
    
    const detailDataMap = {
      appid: 1005,
      clientver: 20489,
      clienttime,
      mid,
      uuid,
      dfid,
      token: device.token || '',
      key: detailKey,
      show_resolution: 1,
      data: [{ video_id: videoId }],
    }
    
    const detailDataStr = JSON.stringify(detailDataMap)
    const detailSig = signAndroidParams({}, detailDataStr)
    
    const { body: detailBody } = await httpFetch('https://gateway.kugou.com/v1/video', {
      method: 'POST',
      headers: {
        ...buildHeaders(),
        'Content-Type': 'application/json',
        'x-router': 'kmr.service.kugou.com',
        dfid,
        mid,
        clienttime: String(clienttime),
        Cookie: `mid=${mid}`,
      },
      params: { signature: detailSig },
      body: detailDataMap,
    }).promise
    
    let videoHash = null
    if (detailBody?.data?.[0]) {
      const detail = detailBody.data[0]
      videoHash = detail.hd_hash || detail.sd_hash || detail.ld_hash || null
    }
    
    if (!videoHash) {
      return Promise.reject(new Error('获取MV播放链接失败'))
    }
    
    const SIGN_KEY_SALT = '57ae12eb6890223e355ccfcb74edf70d'
    const key = stringMd5(`${videoHash}${SIGN_KEY_SALT}1005${mid}${device.userid || 0}`)
    
    const urlParams = {
      backupdomain: 1,
      cmd: 123,
      ext: 'mp4',
      ismp3: 0,
      hash: videoHash,
      pid: 1,
      type: 1,
      dfid,
      mid,
      uuid: '-',
      appid: 1005,
      clientver: 20489,
      clienttime,
      key,
    }
    if (device.token) urlParams.token = device.token
    if (device.userid && device.userid !== '0') urlParams.userid = Number(device.userid)
    
    const urlSig = signAndroidParams(urlParams, '')
    urlParams.signature = urlSig
    
    const sortedKeys = Object.keys(urlParams).sort()
    const queryParts = sortedKeys.map(k => `${encodeURIComponent(k)}=${encodeURIComponent(urlParams[k])}`)
    const queryStr = queryParts.join('&')
    
    const trackermvUrl = `https://trackermv.kugou.com/v2/interface/index?${queryStr}`
    
    const urlResponse = await axios({
      url: trackermvUrl,
      method: 'GET',
      headers: {
        'User-Agent': 'Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi',
        'x-router': 'trackermv.kugou.com',
        dfid,
        mid,
        clienttime: String(clienttime),
        Cookie: `mid=${mid}`,
      },
    })
    
    const urlBody = urlResponse.data
    
    if (urlBody?.status === 1 && urlBody?.data) {
      const videoData = urlBody.data[videoHash.toLowerCase()] || urlBody.data[videoHash]
      if (videoData?.downurl) {
        return { url: videoData.downurl }
      }
      if (videoData?.backupdownurl?.length) {
        return { url: videoData.backupdownurl[0] }
      }
    }
    
    return Promise.reject(new Error('获取MV播放链接失败'))
  } catch (err) {
    return Promise.reject(err)
  }
}
