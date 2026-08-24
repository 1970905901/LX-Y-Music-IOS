import { httpFetch } from '../../request'
import { formatPlayTime, sizeFormate } from '../../index'
import { formatSingerName } from '../utils'
import { signRequest } from './utils'
import { txLog } from '@/utils/txLog'
import { getComm, parseTxQualityTypes } from './utils/common'

export default {
  successCode: 0,

  async getAlbumDetail(albumMid, retryNum = 0) {
    if (retryNum > 2) {
      txLog.error('=== txApi.getAlbumDetail 重试次数超限 ===', { albumMid, retryNum })
      return Promise.reject(new Error('获取专辑详情失败'))
    }

    txLog.info('=== txApi.getAlbumDetail 开始 ===', { albumMid, retryNum })

    const requestData = {
      comm: getComm(),
      req: {
        module: 'music.musichallAlbum.AlbumInfoServer',
        method: 'GetAlbumDetail',
        param: {
          albumMId: albumMid,
        },
      },
    }

    txLog.info('=== txApi.getAlbumDetail 请求参数 ===', {
      albumMid,
      module: requestData.req.module,
      method: requestData.req.method,
    })

    const request = signRequest(requestData)

    try {
      const { body } = await request

      txLog.info('=== txApi.getAlbumDetail 原始响应 ===', {
        albumMid,
        bodyCode: body?.code,
        reqCode: body?.req?.code,
        bodyPreview: JSON.stringify(body).slice(0, 500),
      })

      if (!body || !body.req || body.code != this.successCode || body.req.code != this.successCode) {
        txLog.warn('=== txApi.getAlbumDetail 获取失败，准备重试 ===', {
          albumMid,
          bodyCode: body?.code,
          reqCode: body?.req?.code,
          retryNum: retryNum + 1,
        })
        return this.getAlbumDetail(albumMid, ++retryNum)
      }

      const data = body.req.data
      txLog.info('=== txApi.getAlbumDetail 获取成功 ===', {
        albumMid,
        dataKeys: data ? Object.keys(data) : [],
      })

      return data
    } catch (error) {
      txLog.error('=== txApi.getAlbumDetail 出错 ===', {
        albumMid,
        error: error.message,
        stack: error.stack,
        retryNum: retryNum + 1,
      })
      return this.getAlbumDetail(albumMid, ++retryNum)
    }
  },

  async getAlbum(albumMid, retryNum = 0) {
    if (retryNum > 2) {
      txLog.error('=== txApi.getAlbum 重试次数超限 ===', { albumMid, retryNum })
      return Promise.reject(new Error('获取专辑详情失败'))
    }
    
    txLog.info('=== txApi.getAlbum 开始 ===', { albumMid, retryNum })

    const requestData = {
      comm: getComm(),
      req: {
        module: 'music.musichallAlbum.AlbumSongList',
        method: 'GetAlbumSongList',
        param: {
          albumMid,
          begin: 0,
          num: 20,
        },
      },
    }

    txLog.info('=== txApi.getAlbum 请求参数 ===', {
      albumMid,
      module: requestData.req.module,
      method: requestData.req.method,
      uid: requestData.comm.uid,
    })

    const request = signRequest(requestData)

    try {
      const { body } = await request

      txLog.info('=== txApi.getAlbum 原始响应 ===', {
        albumMid,
        bodyCode: body?.code,
        reqCode: body?.req?.code,
        reqSubcode: body?.req?.subcode,
        bodyPreview: JSON.stringify(body).slice(0, 200),
      })

      const bodyCode = body?.code
      const reqCode = body?.req?.code
      
      if (!body || !body.req || bodyCode != this.successCode || reqCode != this.successCode) {
        txLog.warn('=== txApi.getAlbum 获取失败 ===', {
          albumMid,
          bodyCode,
          reqCode,
          retryNum: retryNum + 1,
        })
        
        if (reqCode === 104400 || reqCode === 500003) {
          txLog.warn('=== txApi.getAlbum 需要登录或参数错误，跳过重试 ===', { albumMid, reqCode })
          return Promise.reject(new Error(`获取专辑详情失败: 错误码${reqCode}`))
        }
        
        return this.getAlbum(albumMid, ++retryNum)
      }

      const data = body.req.data
      const songList = data.songList || data.list || []
      songList.sort((a, b) => {
        const ai = (a.songInfo ?? a).index_album ?? (a.songInfo ?? a).index_cd ?? (a.songInfo ?? a).id ?? Infinity
        const bi = (b.songInfo ?? b).index_album ?? (b.songInfo ?? b).index_cd ?? (b.songInfo ?? b).id ?? Infinity
        return ai - bi
      })

      const list = this.handleResult(songList)
      
      let detailInfo = null
      try {
        detailInfo = await this.getAlbumDetail(albumMid)
        txLog.info('=== txApi.getAlbum 获取专辑详情成功 ===', {
          albumMid,
          hasDetailInfo: !!detailInfo,
          detailInfoKeys: detailInfo ? Object.keys(detailInfo) : [],
          basicInfo: detailInfo?.basicInfo ? {
            name: detailInfo.basicInfo.name,
            time_public: detailInfo.basicInfo.time_public,
            publishDate: detailInfo.basicInfo.publishDate,
            subtitle: detailInfo.basicInfo.subtitle,
            language: detailInfo.basicInfo.language,
            genre: detailInfo.basicInfo.genre,
          } : null,
          singers: detailInfo?.singers ? detailInfo.singers.slice(0, 3).map(s => ({ id: s.id, name: s.name || s.singerName })) : null,
          singerList: detailInfo?.singer?.singerList ? detailInfo.singer.singerList.slice(0, 3).map(s => ({ id: s.id, name: s.name || s.singerName })) : null,
        })
      } catch (e) {
        txLog.warn('=== txApi.getAlbum 获取专辑详情失败，使用默认信息 ===', { albumMid, error: e.message })
      }

      const info = this.handleAlbumInfo(data, albumMid, detailInfo)
      
      txLog.info('=== txApi.getAlbum 最终专辑信息 ===', {
        albumMid,
        albumName: info.name,
        artist: info.artist,
        publishTime: info.publishTime,
        size: info.size,
        artistId: info.artistId,
      })

      return {
        list,
        info,
      }
    } catch (error) {
      txLog.error('=== txApi.getAlbum 出错 ===', {
        albumMid,
        error: error.message,
        stack: error.stack,
        retryNum: retryNum + 1,
      })
      return this.getAlbum(albumMid, ++retryNum)
    }
  },

  handleResult(rawList) {
    if (!rawList || !Array.isArray(rawList)) return []
    
    txLog.info('=== txApi.handleAlbumResult 开始 ===', {
      rawListLength: rawList.length,
      firstItem: rawList[0] ? { 
        id: rawList[0].id, 
        name: rawList[0].title,
        hasSongInfo: !!rawList[0].songInfo,
        songInfoKeys: rawList[0].songInfo ? Object.keys(rawList[0].songInfo) : [],
      } : null,
    })

    const list = []
    rawList.forEach((item, index) => {
      const songInfo = item.songInfo || item
      
      txLog.info('=== txApi.handleAlbumResult 原始数据诊断 ===', {
        index,
        itemId: item.id,
        itemMid: item.mid,
        itemIndex: item.index,
        itemSort: item.sort,
        itemOrder: item.order,
        itemSeq: item.seq,
        songInfoIndex: songInfo.index,
        hasSongInfo: !!item.songInfo,
        songInfoId: songInfo.id,
        songInfoMid: songInfo.mid,
        songInfoTitle: songInfo.title,
        songInfoKeys: Object.keys(songInfo),
      })
      
      if (!songInfo.file?.media_mid) {
        txLog.info('=== txApi.handleAlbumResult 跳过无media_mid的歌曲 ===', {
          name: songInfo.title,
          hasFile: !!songInfo.file,
          hasMediaMid: !!songInfo.file?.media_mid,
        })
        return
      }

      let types = []
      let _types = {}
      const file = songInfo.file
      if (file.size_128mp3 != 0) {
        let size = sizeFormate(file.size_128mp3)
        types.push({ type: '128k', size })
        _types['128k'] = { size }
      }
      if (file.size_320mp3 !== 0) {
        let size = sizeFormate(file.size_320mp3)
        types.push({ type: '320k', size })
        _types['320k'] = { size }
      }
      if (file.size_flac !== 0) {
        let size = sizeFormate(file.size_flac)
        types.push({ type: 'flac', size })
        _types.flac = { size }
      }
      if (file.size_hires !== 0) {
        let size = sizeFormate(file.size_hires)
        types.push({ type: 'hires', size })
        _types.hires = { size }
      }
      if (file.size_new?.[1] !== 0) {
        let size = sizeFormate(file.size_new[1])
        types.push({ type: 'atmos', size })
        _types.atmos = { size }
      }
      if (file.size_new?.[2] !== 0) {
        let size = sizeFormate(file.size_new[2])
        types.push({ type: 'atmos_plus', size })
        _types.atmos_plus = { size }
      }
      if (file.size_new?.[0] !== 0) {
        let size = sizeFormate(file.size_new[0])
        types.push({ type: 'master', size })
        _types.master = { size }
      }

      let albumId = ''
      let albumName = ''
      if (songInfo.album) {
        albumName = songInfo.album.name
        albumId = songInfo.album.mid
      }

      const processedSongmid = songInfo.mid || songInfo.id
      const processedMeta = {
        songId: songInfo.id,
        id: songInfo.id,
        mid: songInfo.mid,
        songmid: processedSongmid,
        strMediaMid: songInfo.file.media_mid,
        albumName,
        albumId,
        albumMid: songInfo.album?.mid ?? '',
        vid: songInfo.mv?.vid || '',
        picUrl: albumId === '' || albumId === '空'
          ? songInfo.singer?.length
            ? `https://y.gtimg.cn/music/photo_new/T001R500x500M000${songInfo.singer[0]?.mid}.jpg`
            : ''
          : `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumId}.jpg`,
        qualitys: types,
        _qualitys: _types,
      }
      
      txLog.info('=== txApi.handleAlbumResult 处理歌曲 ===', {
        index,
        songName: songInfo.title,
        originalMid: songInfo.mid,
        processedSongmid,
        hasMeta: !!processedMeta,
        metaSongmid: processedMeta.songmid,
      })
      
      list.push({
        id: String(songInfo.id),
        singer: formatSingerName(songInfo.singer, 'name'),
        artists: songInfo.singer?.map(s => ({ id: s.id || s.mid, mid: s.mid, name: s.name })) || [],
        name: songInfo.title,
        albumName,
        albumId,
        source: 'tx',
        interval: formatPlayTime(songInfo.interval),
        songId: songInfo.id,
        albumMid: songInfo.album?.mid ?? '',
        strMediaMid: songInfo.file.media_mid,
        songmid: songInfo.mid || songInfo.id,
        img: albumId === '' || albumId === '空'
          ? songInfo.singer?.length
            ? `https://y.gtimg.cn/music/photo_new/T001R500x500M000${songInfo.singer[0]?.mid}.jpg`
            : ''
          : `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumId}.jpg`,
        types,
        _types,
        typeUrl: {},
        vid: songInfo.mv?.vid || '',
        meta: processedMeta,
      })
    })

    txLog.info('=== txApi.handleAlbumResult 完成 ===', {
      inputCount: rawList.length,
      outputCount: list.length,
    })

    return list
  },

  handleAlbumInfo(data, albumMid, detailInfo = null) {
    if (!data) return null
    
    const songList = data.songList || data.list || []
    const firstSong = songList[0]
    
    const basicInfo = detailInfo?.basicInfo || detailInfo?.album || {}
    const singers = detailInfo?.singers || detailInfo?.singer?.singerList || []
    
    txLog.info('=== txApi.handleAlbumInfo 诊断 ===', {
      albumMid,
      basicInfoKeys: Object.keys(basicInfo),
      basicInfoAlbumName: basicInfo.albumName,
      basicInfoName: basicInfo.name,
      basicInfoPublishDate: basicInfo.publishDate,
      basicInfoTimePublic: basicInfo.time_public,
      singersLength: singers.length,
      firstSinger: singers[0] ? Object.keys(singers[0]) : null,
      singers0Name: singers[0]?.name,
      singers0Id: singers[0]?.id,
      singers0SingerId: singers[0]?.singerId,
      singers0SingerMid: singers[0]?.singerMid,
      dataAlbumName: data.albumName,
      firstSongAlbumName: firstSong?.album?.name,
      firstSongSinger: firstSong?.singer?.map(s => ({ id: s.id, mid: s.mid, name: s.name })) || null,
    })
    
    const artistName = singers.length ? formatSingerName(singers.map(s => ({ name: s.name || s.singerName })), 'name') : formatSingerName(firstSong?.singer || [], 'name')
    const artistObj = singers.length 
      ? singers.map(s => ({ id: s.id || s.singerId || s.singerMid, mid: s.mid || s.singerMid, name: s.name || s.singerName }))
      : (firstSong?.singer || []).map(s => ({ id: s.id || s.mid, mid: s.mid, name: s.name }))
    
    return {
      id: albumMid,
      mid: albumMid,
      name: basicInfo.albumName || data.albumName || firstSong?.album?.name || firstSong?.title || '',
      artist: artistName,
      artistId: singers[0]?.id || singers[0]?.singerId || singers[0]?.singerMid || firstSong?.singer?.[0]?.id || '',
      artists: artistObj,
      picUrl: `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumMid}.jpg`,
      publishTime: basicInfo.time_public || basicInfo.publishDate || data.time_public || '',
      size: data.totalNum || data.total_num || songList.length,
      source: 'tx',
    }
  },
}
