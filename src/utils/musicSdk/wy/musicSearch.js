import { httpFetch } from '../../request'
import { sizeFormate, formatPlayTime } from '../../index'
import { eapiRequest } from './utils/index'
import settingState from '@/store/setting/state'
import musicDetailApi from './musicDetail'

const NETEASE_SONG_ID_RXP = /(?:https?:\/\/)?(?:y\.)?music\.163\.com\/(?:m\/)?song\?id=(\d+)/i

const safeDecode = value => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

const extractSongId = value => {
  if (!value) return null
  const text = safeDecode(value)
  const match = text.match(NETEASE_SONG_ID_RXP) || value.match(NETEASE_SONG_ID_RXP)
  return match ? match[1] : null
}

const getFirstSerpApiSongId = result => {
  const list = Array.isArray(result?.organic_results) ? result.organic_results : []
  for (const item of list) {
    const songId = extractSongId(item.link) || extractSongId(item.redirect_link)
    if (songId) return songId
  }
  return null
}

const uniqueListBySongId = list => {
  const ids = new Set()
  return list.filter(item => {
    const id = String(item.songmid || item.meta?.songId || item.id || '')
    if (!id || ids.has(id)) return false
    ids.add(id)
    return true
  })
}

export default {
  limit: 30,
  total: 0,
  page: 0,
  allPage: 1,

  musicSearch(str, page, limit) {
    const searchRequest = eapiRequest('/api/search/song/list/page', {
        keyword: str,
        needCorrect: '1',
        channel: 'typing',
        offset: limit * (page - 1),
        scene: 'normal',
        total: page == 1,
        limit,
    })
    return searchRequest.promise.then(({ body }) => body)
  },

  async searchBySerpApi(str) {
    const apiKey = settingState.setting['common.wy_serpapi_key']?.trim()
    if (!apiKey) return []

    try {
      const query = `${str} site:music.163.com`
      const requestObj = httpFetch(
        `https://serpapi.com/search.json?engine=google&google_domain=google.com&hl=zh-cn&num=10&q=${encodeURIComponent(query)}&api_key=${encodeURIComponent(apiKey)}`,
        { method: 'get', timeout: 20000 }
      )
      const { body, statusCode } = await requestObj.promise
      if (statusCode !== 200) throw new Error(`SerpApi status ${statusCode}`)

      const songId = getFirstSerpApiSongId(body)
      if (!songId) return []

      const detail = await musicDetailApi.getList([songId])
      return detail?.list || []
    } catch (error) {
      console.log('wy serpapi search failed:', error.message)
      return []
    }
  },

  getSinger(singers) {
    return singers.map((singer) => singer.name).join('、')
  },

  handleResult(rawList) {
    if (!rawList) return [];

    return rawList.map(item => {
      // console.log('[网易云原始数据]', JSON.stringify(item, null, 2))
      item = item.baseInfo.simpleSongData

      const types = [];
      const _types = {};
      let size;

      if (item.hr) {
        size = sizeFormate(item.hr.size);
        types.push({ type: 'hires', size });
        _types.hires = { size };
      }
      if (item.sq) {
        size = sizeFormate(item.sq.size);
        types.push({ type: 'flac', size });
        _types.flac = { size };
      }
      if (item.h) {
        size = sizeFormate(item.h.size);
        types.push({ type: '320k', size });
        _types['320k'] = { size };
      }
      if (item.m && !_types['128k']) {
        size = sizeFormate(item.m.size);
        types.push({ type: '128k', size });
        _types['128k'] = { size };
      }
      if (item.l && !_types['128k']) {
        size = sizeFormate(item.l.size);
        types.push({ type: '128k', size });
        _types['128k'] = { size };
      }
      types.reverse();

      return {
        singer: this.getSinger(item.ar),
        artists: item.ar,
        name: item.name,
        fee: item.fee,
        alias: item.alia && item.alia.length ? item.alia[0] : '',
        albumName: item.al.name,
        albumId: item.al.id,
        source: 'wy',
        interval: formatPlayTime(item.dt / 1000),
        songmid: item.id,
        img: item.al.picUrl,
        lrc: null,
        types,
        _types,
        typeUrl: {},
        meta: {
          songId: item.id,
          albumName: item.al.name,
          albumId: item.al.id,
          picUrl: item.al.picUrl,
          qualitys: types,
          _qualitys: _types,
          fee: item.fee,
          originCoverType: item.originCoverType,
          noCopyrightRcmd: item.noCopyrightRcmd,
          mv: item.mv,
        },
      }
    })
  },

  search(str, page = 1, limit, retryNum = 0, options = {}) {
    if (++retryNum > 3) return Promise.reject(new Error('try max num'))
    if (limit == null) limit = this.limit
    return this.musicSearch(str, page, limit).then(async(result) => {
      if (!result || result.code !== 200) {
        console.log('retry search:', retryNum)
        return this.search(str, page, limit, retryNum, options)
      }
      let list = this.handleResult(result.data.resources || [])
      if (!list) return this.search(str, page, limit, retryNum, options)
      if (page === 1 && options.enableSerpApi) {
        const serpList = await this.searchBySerpApi(str)
        if (serpList.length) list = uniqueListBySongId([...serpList, ...list])
      }

      this.total = Math.max(result.data.totalCount || 0, list.length)
      this.page = page
      this.allPage = this.total ? Math.ceil(this.total / this.limit) : 0

      return {
        list,
        allPage: this.allPage,
        limit: this.limit,
        total: this.total,
        source: 'wy',
      }
    }).catch(err => {
      console.log('搜索错误，准备重试:', err.message, '次数:', retryNum);
      return this.search(str, page, limit, retryNum, options)
    });
  },


  searchSinger(str, page = 1, limit = 20, retryNum = 0) {
    if (++retryNum > 3) return Promise.reject(new Error('try max num'))
    const searchRequest = eapiRequest('/api/cloudsearch/pc', {
      s: str,
      type: 100,
      limit,
      total: page === 1,
      offset: limit * (page - 1),
    })
    return searchRequest.promise.then(({ body: result }) => {
      if (!result || result.code !== 200) return this.searchSinger(str, page, limit, retryNum)
      const list = this.handleSingerResult(result.result.artists)
      return {
        list,
        total: result.result.artistCount || 0,
        allPage: Math.ceil((result.result.artistCount || 0) / limit),
        limit,
        source: 'wy',
      }
    })
  },

  searchAlbum(str, page = 1, limit = 20, retryNum = 0) {
    if (++retryNum > 3) return Promise.reject(new Error('try max num'))
    const searchRequest = eapiRequest('/api/cloudsearch/pc', {
      s: str,
      type: 10,
      limit,
      total: page === 1,
      offset: limit * (page - 1),
    })
    return searchRequest.promise.then(({ body: result }) => {
      if (!result || result.code !== 200) return this.searchAlbum(str, page, limit, retryNum)
      const list = this.handleAlbumResult(result.result.albums)
      return {
        list,
        total: result.result.albumCount || 0,
        allPage: Math.ceil((result.result.albumCount || 0) / limit),
        limit,
        source: 'wy',
      }
    })
  },
  handleSingerResult(rawList) {
    if (!rawList) return []
    return rawList.map(item => ({
      id: item.id,
      name: item.name,
      picUrl: item.picUrl,
      alias: item.alias,
      albumSize: item.albumSize,
      source: 'wy',
    }))
  },

  handleAlbumResult(rawList) {
    if (!rawList) return []
    return rawList.map(item => ({
      id: item.id,
      name: item.name,
      picUrl: item.picUrl,
      artistName: item.artist.name,
      artistId: item.artist.id,
      size: item.size,
      publishTime: item.publishTime,
      source: 'wy',
    }))
  },

}
