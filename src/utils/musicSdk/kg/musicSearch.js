import { httpFetch } from '../../request'
import { decodeName, formatPlayTime } from '../../index'
import { formatSingerName } from '../utils'
import { getBatchMusicQualityInfo } from './quality_detail'
import artist from './artist'
import albumApi from './album'

export default {
  limit: 30,
  total: 0,
  page: 0,
  allPage: 1,
  musicSearch(str, page, limit) {
    const searchRequest = httpFetch(
      `https://songsearch.kugou.com/song_search_v2?keyword=${encodeURIComponent(
        str
      )}&page=${page}&pagesize=${limit}&userid=0&clientver=&platform=WebFilter&filter=2&iscorrection=1&privilege_filter=0&area_code=1`
    )
    return searchRequest.promise.then(({ body }) => body)
  },
  async handleResult(rawData) {
    let ids = new Set()
    const items = []

    rawData.forEach((item) => {
      const key = item.Audioid + item.FileHash
      if (!ids.has(key)) {
        ids.add(key)
        items.push(item)
      }

      for (const childItem of item.Grp || []) {
        const childKey = childItem.Audioid + childItem.FileHash
        if (!ids.has(childKey)) {
          ids.add(childKey)
          items.push(childItem)
        }
      }
    })

    const hashList = items.map((item) => item.FileHash)

    let qualityInfoMap = {}
    try {
      const qualityInfoRequest = getBatchMusicQualityInfo(hashList)
      qualityInfoMap = await qualityInfoRequest.promise
    } catch (error) {
      console.error('Failed to fetch quality info:', error)
    }

    return items.map((item) => {
      const { types = [], _types = {} } = qualityInfoMap[item.FileHash] || {}

      return {
        id: `${item.Audioid}_${item.FileHash}`,
        singer: decodeName(formatSingerName(item.Singers, 'name')),
        name: decodeName(item.SongName),
        albumName: decodeName(item.AlbumName),
        albumId: item.AlbumID,
        songmid: item.Audioid,
        songId: item.Audioid,
        source: 'kg',
        interval: formatPlayTime(item.Duration),
        _interval: item.Duration,
        img: item.Image ? item.Image.replace('{size}', '480') : null,
        lrc: null,
        otherSource: null,
        hash: item.FileHash,
        mixSongId: item.MixSongID || 0,
        types,
        _types,
        typeUrl: {},
        meta: {
          songId: item.Audioid,
          albumName: decodeName(item.AlbumName),
          albumId: item.AlbumID,
          picUrl: item.Image ? item.Image.replace('{size}', '480') : null,
          qualitys: types,
          _qualitys: _types,
          hash: item.FileHash,
        },
      }
    })
  },
  search(str, page = 1, limit, retryNum = 0) {
    if (++retryNum > 3) return Promise.reject(new Error('try max num'))
    if (limit == null) limit = this.limit

    return this.musicSearch(str, page, limit).then(async (result) => {
      if (!result || result.error_code !== 0) return this.search(str, page, limit, retryNum)

      let list = await this.handleResult(result.data.lists)

      if (list == null) return this.search(str, page, limit, retryNum)

      this.total = result.data.total
      this.page = page
      this.allPage = Math.ceil(this.total / limit)

      return Promise.resolve({
        list,
        allPage: this.allPage,
        limit,
        total: this.total,
        source: 'kg',
      })
    })
  },
  async searchSinger(keyword, page = 1, limit = 10) {
    try {
      const requestObj = httpFetch(
        `https://songsearch.kugou.com/song_search_v2?keyword=${encodeURIComponent(keyword)}&page=${page}&pagesize=30&userid=0&platform=WebFilter&filter=2&iscorrection=1&area_code=1`
      )
      const { body } = await requestObj.promise

      if (!body || body.error_code !== 0 || !body.data || !body.data.lists) {
        return { list: [] }
      }

      const singerIds = new Set()
      for (const song of body.data.lists) {
        if (song.Singers && song.Singers.length > 0) {
          for (const s of song.Singers) {
            if (s.id) singerIds.add(s.id)
          }
        }
      }

      const idsToFetch = [...singerIds].slice(0, limit)
      const detailPromises = idsToFetch.map(id => artist.getDetail(id).then(r => r.artist).catch(() => null))
      const results = await Promise.all(detailPromises)

      const list = results.filter(item => item !== null && item.name)
      
      return { list }
    } catch (err) {
      console.error('[KuGou] searchSinger error:', err)
      return { list: [] }
    }
  },
  async searchAlbum(keyword, page = 1, limit = 30) {
    try {
      const requestObj = httpFetch(
        `https://songsearch.kugou.com/song_search_v2?keyword=${encodeURIComponent(keyword)}&page=${page}&pagesize=${limit}&userid=0&platform=WebFilter&filter=4&iscorrection=1&area_code=1`
      )
      const { body } = await requestObj.promise
      if (!body || body.error_code !== 0 || !body.data || !body.data.lists) {
        return { list: [], total: 0, allPage: 0 }
      }

      const albumMap = new Map()
      for (const item of body.data.lists) {
        const id = String(item.AlbumID || item.albumid || '')
        if (!id || id === '0' || albumMap.has(id)) continue
        
        const img = (item.Image || item.img || item.AlbumImage || item.album_sizable_cover || '').replace('{size}', '480')
        albumMap.set(id, {
          id,
          name: item.AlbumName || item.albumname || item.album_name || '',
          picUrl: img,
          img,
          artist: item.SingerName || item.singername || item.author_name || '',
          publishTime: item.PublishDate || item.publish_date || '',
          size: 0,
          source: 'kg',
        })
      }
      const albums = [...albumMap.values()].filter(item => item.name)

      const albumsToFetch = albums.slice(0, 30)
      const detailPromises = albumsToFetch.map(a => albumApi.getAlbumDetail(a.id, 1, 1).then(r => ({ id: a.id, size: r.total })).catch(() => null))
      const details = await Promise.all(detailPromises)
      
      const detailMap = new Map()
      for (const detail of details) {
        if (detail) detailMap.set(detail.id, detail.size)
      }
      for (const album of albums) {
        if (detailMap.has(album.id)) {
          album.size = detailMap.get(album.id)
        }
      }
      
      return {
        list: albums,
        total: body.data.total || albums.length,
        allPage: Math.ceil((body.data.total || albums.length) / limit),
      }
    } catch (err) {
      console.error('[KuGou] searchAlbum error:', err)
      return { list: [], total: 0, allPage: 0 }
    }
  },
}
