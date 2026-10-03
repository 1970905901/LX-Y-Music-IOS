import { httpFetch } from '../../request'
import { decodeName, formatPlayTime, dateFormat, formatPlayCount } from '../../index'
import { formatSingerName } from '../utils'
import { getBatchMusicQualityInfo } from './quality_detail'
import { log } from '@/utils/log'
import settingState from '@/store/setting/state'
import musicSearchApi from './musicSearch'

// 歌单基础信息（名称 / 封面 / 简介 / 作者 / 播放量 / 总曲目数）内存缓存。
//
// 旧详情接口 fcg_ucc_getcdinfo_byids_cp **忽略分页参数**，一次就返回整张歌单
// （2026-10 实测：1270 首的歌单单次响应约 1.9MB、约 0.5s；加 num / song_begin / onlysong 都一样）。
// 旧实现每翻一页都请求它一次 —— 2000 首的歌单 = 约 20 次 x 2MB，JSON 解析与网络把 JS
// 线程占满，进歌单卡顿、点击与返回都迟钝（用户实锤）。歌单信息在一次全量翻页里不会变，
// 这里按歌单 id 缓存一次（TTL 10 分钟），后续分页只走 musicu.fcg 的 100 首/页。
const LIST_META_TTL = 10 * 60 * 1000
const listMetaCache = new Map()

export default {
  _requestObj_tags: null,
  _requestObj_hotTags: null,
  _requestObj_list: null,
  limit_list: 36,
  limit_song: 100000,
  successCode: 0,
  sortList: [
    {
      name: '最热',
      id: 5,
    },
    {
      name: '最新',
      id: 2,
    },
  ],
  regExps: {
    hotTagHtml: /class="c_bg_link js_tag_item" data-id="\w+">.+?<\/a>/g,
    hotTag: /data-id="(\w+)">(.+?)<\/a>/,
    listDetailLink: /\/playlist\/(\d+)/,
    listDetailLink2: /id=(\d+)/,
  },
  tagsUrl:
    'https://u.y.qq.com/cgi-bin/musicu.fcg?loginUin=0&hostUin=0&format=json&inCharset=utf-8&outCharset=utf-8&notice=0&platform=wk_v15.json&needNewCode=0&data=%7B%22tags%22%3A%7B%22method%22%3A%22get_all_categories%22%2C%22param%22%3A%7B%22qq%22%3A%22%22%7D%2C%22module%22%3A%22playlist.PlaylistAllCategoriesServer%22%7D%7D',
  hotTagUrl: 'https://c.y.qq.com/node/pc/wk_v15/category_playlist.html',
  getListUrl(sortId, id, page) {
    if (id) {
      id = parseInt(id)
      return `https://u.y.qq.com/cgi-bin/musicu.fcg?loginUin=0&hostUin=0&format=json&inCharset=utf-8&outCharset=utf-8&notice=0&platform=wk_v15.json&needNewCode=0&data=${encodeURIComponent(
        JSON.stringify({
          comm: { cv: 1602, ct: 20 },
          playlist: {
            method: 'get_category_content',
            param: {
              titleid: id,
              caller: '0',
              category_id: id,
              size: this.limit_list,
              page: page - 1,
              use_page: 1,
            },
            module: 'playlist.PlayListCategoryServer',
          },
        }),
      )}`
    }
    return `https://u.y.qq.com/cgi-bin/musicu.fcg?loginUin=0&hostUin=0&format=json&inCharset=utf-8&outCharset=utf-8&notice=0&platform=wk_v15.json&needNewCode=0&data=${encodeURIComponent(
      JSON.stringify({
        comm: { cv: 1602, ct: 20 },
        playlist: {
          method: 'get_playlist_by_tag',
          param: {
            id: 10000000,
            sin: this.limit_list * (page - 1),
            size: this.limit_list,
            order: sortId,
            cur_page: page,
          },
          module: 'playlist.PlayListPlazaServer',
        },
      }),
    )}`
  },
  getListDetailUrl(id) {
    return `https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&new_format=1&disstid=${id}&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0`
  },

  // http://nplserver.kuwo.cn/pl.svc?op=getlistinfo&pid=2849349915&pn=0&rn=100&encode=utf8&keyset=pl2012&identity=kuwo&pcmp4=1&vipver=MUSIC_9.0.5.0_W1&newver=1
  getTag(tryNum = 0) {
    if (this._requestObj_tags) this._requestObj_tags.cancelHttp()
    if (tryNum > 2) return Promise.reject(new Error('try max num'))
    this._requestObj_tags = httpFetch(this.tagsUrl)
    return this._requestObj_tags.promise.then(({ body }) => {
      if (body.code !== this.successCode) return this.getTag(++tryNum)
      return this.filterTagInfo(body.tags.data.v_group)
    })
  },
  getHotTag(tryNum = 0) {
    if (this._requestObj_hotTags) this._requestObj_hotTags.cancelHttp()
    if (tryNum > 2) return Promise.reject(new Error('try max num'))
    this._requestObj_hotTags = httpFetch(this.hotTagUrl)
    return this._requestObj_hotTags.promise.then(({ statusCode, body }) => {
      if (statusCode !== 200) return this.getHotTag(++tryNum)
      return this.filterInfoHotTag(body)
    })
  },
  filterInfoHotTag(html) {
    let hotTag = html.match(this.regExps.hotTagHtml)
    const hotTags = []
    if (!hotTag) return hotTags

    hotTag.forEach((tagHtml) => {
      let result = tagHtml.match(this.regExps.hotTag)
      if (!result) return
      hotTags.push({
        id: parseInt(result[1]),
        name: result[2],
        source: 'tx',
      })
    })
    return hotTags
  },
  filterTagInfo(rawList) {
    return rawList.map((type) => ({
      name: type.group_name,
      list: type.v_item.map((item) => ({
        parent_id: type.group_id,
        parent_name: type.group_name,
        id: item.id,
        name: item.name,
        source: 'tx',
      })),
    }))
  },

  getList(sortId, tagId, page, tryNum = 0) {
    if (this._requestObj_list) this._requestObj_list.cancelHttp()
    if (tryNum > 2) return Promise.reject(new Error('try max num'))
    this._requestObj_list = httpFetch(this.getListUrl(sortId, tagId, page))
    // console.log(this.getListUrl(sortId, tagId, page))
    return this._requestObj_list.promise.then(({ body }) => {
      if (body.code !== this.successCode) {
        return this.getList(sortId, tagId, page, ++tryNum)
      }
      return tagId
        ? this.filterList2(body.playlist.data, page)
        : this.filterList(body.playlist.data, page)
    })
  },

  filterList(data, page) {
    return {
      list: data.v_playlist.map((item) => ({
        play_count: formatPlayCount(item.access_num),
        id: String(item.tid),
        author: item.creator_info.nick,
        name: item.title,
        time: item.modify_time ? dateFormat(item.modify_time * 1000, 'Y-M-D') : '',
        img: item.cover_url_medium,
        // grade: item.favorcnt / 10,
        total: item.song_ids?.length,
        desc: decodeName(item.desc).replace(/<br>/g, '\n'),
        source: 'tx',
      })),
      total: data.total,
      page,
      limit: this.limit_list,
      source: 'tx',
    }
  },
  filterList2({ content }, page) {
    // console.log(content.v_item)
    return {
      list: content.v_item.map(({ basic }) => ({
        play_count: formatPlayCount(basic.play_cnt),
        id: String(basic.tid),
        author: basic.creator.nick,
        name: basic.title,
        // time: basic.publish_time,
        img: basic.cover.medium_url || basic.cover.default_url,
        // grade: basic.favorcnt / 10,
        desc: decodeName(basic.desc).replace(/<br>/g, '\n'),
        source: 'tx',
      })),
      total: content.total_cnt,
      page,
      limit: this.limit_list,
      source: 'tx',
    }
  },

  async handleParseId(link, retryNum = 0) {
    if (retryNum > 2) return Promise.reject(new Error('link try max num'))

    const requestObj_listDetailLink = httpFetch(link)
    const {
      headers: { location },
      statusCode,
    } = await requestObj_listDetailLink.promise
    // console.log(headers)
    if (statusCode > 400) return this.handleParseId(link, ++retryNum)
    return location == null ? link : location
  },

  async getListId(id) {
    if (/[?&:/]/.test(id)) {
      if (!this.regExps.listDetailLink.test(id)) {
        id = await this.handleParseId(id)
      }
      let result = this.regExps.listDetailLink.exec(id)
      if (!result) {
        result = this.regExps.listDetailLink2.exec(id)
        if (!result) throw new Error('failed')
      }
      id = result[1]
      // console.log(id)
    }
    return id
  },
  /**
   * 歌单基础信息 + 平台侧总曲目数（带缓存，详见文件顶部 listMetaCache 注释）。
   * 命中缓存时**不发任何请求**；失败 / 空结果不写缓存，避免把坏数据固化 10 分钟。
   */
  async getListMeta(id, data) {
    const cacheKey = String(id)
    const cached = listMetaCache.get(cacheKey)
    if (cached && Date.now() - cached.at < LIST_META_TTL) {
      log.info('[TX SongList] 歌单信息命中缓存，跳过旧接口', { id: cacheKey })
      return cached.meta
    }

    const meta = {
      name: '',
      img: '',
      desc: '',
      author: '',
      play_count: '',
      total: 0,
    }

    try {
      const oldUrl = this.getListDetailUrl(id)
      log.info('[TX SongList] 请求歌单信息接口（整单响应，仅每张歌单一次）', { oldUrl })
      const referer = 'https://y.qq.com/n/yqq/playsquare/' + id + '.html'
      const { body: oldBody, statusCode } = await httpFetch(oldUrl, {
        headers: { Origin: 'https://y.qq.com', Referer: referer },
      }).promise
      log.info('[TX SongList] 歌单信息接口响应', { statusCode, bodyCode: oldBody?.code, cdlistLength: oldBody?.cdlist?.length })

      const cdlist = oldBody?.cdlist?.[0]
      if (cdlist) {
        meta.name = cdlist.dissname || ''
        meta.img = cdlist.logo || ''
        meta.desc = cdlist.desc ? decodeName(cdlist.desc).replace(/<br>/g, '\n') : ''
        meta.author = cdlist.nickname || ''
        meta.total = cdlist.songnum || 0
        meta.play_count = cdlist.visitnum ? formatPlayCount(cdlist.visitnum) : ''
      } else {
        log.warn('[TX SongList] 歌单信息接口未返回 cdlist[0]，降级使用新接口 dissinfo')
      }
    } catch (e) {
      log.error('[TX SongList] 歌单信息接口请求异常', { error: e.message })
    }

    // 新接口（带 cookie 时）可能自带 dissinfo，作为缺字段的兜底
    const dissinfo = data?.dissinfo
    if (dissinfo) {
      meta.name = meta.name || dissinfo.dissname || ''
      meta.img = meta.img || dissinfo.logo || ''
      meta.desc = meta.desc || (dissinfo.desc ? decodeName(dissinfo.desc).replace(/<br>/g, '\n') : '')
      meta.author = meta.author || dissinfo.nickname || ''
      meta.total = meta.total || dissinfo.songnum || 0
      if (!meta.play_count && dissinfo.visitnum) meta.play_count = formatPlayCount(dissinfo.visitnum)
    }

    if (meta.name || meta.img || meta.total) listMetaCache.set(cacheKey, { at: Date.now(), meta })
    return meta
  },
  async getListDetailNew(id, page = 1, tryNum = 0) {
    log.info('[TX SongList] getListDetailNew 开始', { id, page, tryNum })

    if (tryNum > 2) {
      log.error('[TX SongList] getListDetailNew 重试次数超限', { id, page, tryNum })
      return Promise.reject(new Error('try max num'))
    }

    id = await this.getListId(id)

    // 单页请求量：旧值 30 —— 两千首的歌单要 67 次串行请求（每次还带一轮音质批量查询），
    // 进歌单要等十几秒、列表被反复重渲染（用户实锤：「我喜欢」两千首卡顿）。
    // 这套 CgiGetDiss 接口与 user.getFavSongs 同族，song_num=100 稳定可用
    // （dataInit 里的喜欢歌曲全量拉取就是用 100/页），请求数降到约 1/3。
    const pageSize = 100
    const songBegin = (page - 1) * pageSize
    const payload = {
      comm: { ct: 24, cv: 1800 },
      req_0: {
        module: 'music.srfDissInfo.DissInfo',
        method: 'CgiGetDiss',
        param: {
          disstid: parseInt(id),
          dirid: 0,
          tag: true,
          song_begin: songBegin,
          song_num: pageSize,
          userinfo: true,
          orderlist: true,
          onlysonglist: false,
        },
      },
    }

    log.info('[TX SongList] getListDetailNew 构建payload完成', { disstid: payload.req_0.param.disstid })

    const url = `https://u.y.qq.com/cgi-bin/musicu.fcg?loginUin=0&hostUin=0&format=json&inCharset=utf-8&outCharset=utf-8&notice=0&platform=wk_v15.json&needNewCode=0&data=${encodeURIComponent(JSON.stringify(payload))}`

    log.info('[TX SongList] getListDetailNew URL:', url.substring(0, 200))

    const cookie = settingState.setting['common.tx_cookie']
    log.info('[TX SongList] getListDetailNew Cookie状态:', cookie ? `已设置 (长度:${cookie.length})` : '未设置')

    const requestObj_listDetail = httpFetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: 'https://y.qq.com/',
        Cookie: cookie || '',
      },
    })

    const { body, statusCode } = await requestObj_listDetail.promise
    log.info('[TX SongList] getListDetailNew 响应', { statusCode, bodyCode: body?.code, req0Code: body?.req_0?.code })

    if (!body || !body.req_0) {
      log.error('[TX SongList] getListDetailNew 响应体无效', { body: JSON.stringify(body)?.substring(0, 200) })
      return this.getListDetailNew(id, page, ++tryNum)
    }

    const retCode = body.req_0.data?.retCode
    log.info('[TX SongList] getListDetailNew retCode', { retCode })

    if (retCode !== undefined && retCode !== 0 && tryNum < 2) {
      log.warn('[TX SongList] getListDetailNew retCode非0，重试', { retCode, tryNum })
      return this.getListDetailNew(id, page, ++tryNum)
    }

    const data = body.req_0.data
    if (!data || !data.songlist) {
      log.error('[TX SongList] getListDetailNew 没有歌曲列表', { dataKeys: data ? Object.keys(data) : [] })
      return Promise.reject(new Error('获取歌单详情失败'))
    }

    log.info('[TX SongList] getListDetailNew 成功', { songCount: data.songlist.length, dissname: data.dissinfo?.dissname })

    if (data.songlist.length > 0) {
      const firstSong = data.songlist[0]
      log.info('[TX SongList] 第一条歌曲结构', {
        keys: Object.keys(firstSong),
        title: firstSong.title,
        name: firstSong.name,
        id: firstSong.id,
        mid: firstSong.mid,
        hasSinger: !!firstSong.singer,
        hasAlbum: !!firstSong.album,
        hasFile: !!firstSong.file,
      })
    }

    log.info('[TX SongList] 新接口 dissinfo 完整数据', {
      dissinfoKeys: data.dissinfo ? Object.keys(data.dissinfo) : [],
      dissinfo: data.dissinfo,
    })

    // 歌单信息（名称 / 封面 / 简介 / 作者 / 播放量）整单只请求一次，命中缓存则完全跳过旧接口。
    // 旧实现每翻一页都打一次整单接口（约 2MB），2000 首的歌单光这一项就白跑约 20 次。
    const meta = await this.getListMeta(id, data)

    log.info('[TX SongList] getListDetailNew 最终返回歌单信息', { dissname: meta.name, logo: meta.img, playCount: meta.play_count, descLen: meta.desc?.length, nickname: meta.author })

    const totalSongNum = data.dissinfo?.songnum || data.songnum || data.total_song_num || meta.total || data.songlist.length
    log.info('[TX SongList] getListDetailNew 分页信息', { page, pageSize, returned: data.songlist.length, total: totalSongNum })

    return {
      list: await this.filterListDetailNew(data.songlist),
      page,
      limit: pageSize,
      total: totalSongNum,
      source: 'tx',
      info: {
        name: meta.name,
        img: meta.img,
        desc: meta.desc,
        author: meta.author,
        play_count: meta.play_count,
      },
    }
  },

  async filterListDetailNew(rawList) {
    log.info('[TX SongList] filterListDetailNew 输入', { count: rawList.length })
    const qualityInfoRequest = getBatchMusicQualityInfo(rawList)
    let qualityInfoMap = {}

    try {
      qualityInfoMap = await qualityInfoRequest.promise
      log.info('[TX SongList] filterListDetailNew 质量信息获取成功', { count: Object.keys(qualityInfoMap).length })
    } catch (error) {
      log.error('[TX SongList] filterListDetailNew 质量信息获取失败', { error: error.message })
    }

    const result = rawList
      .filter((item) => item.mid)
      .map((item) => {
        const { types = [], _types = {} } = qualityInfoMap[item.id] || {}

        return {
          singer: formatSingerName(item.singer, 'name'),
          name: item.title || item.name,
          albumName: item.album?.name ?? '',
          albumId: item.album?.mid ?? '',
          source: 'tx',
          interval: formatPlayTime(item.interval),
          songId: item.id,
          albumMid: item.album.mid,
          strMediaMid: item.file?.media_mid || '',
          songmid: item.mid,
          img:
          !item.album?.name || item.album.name === '空'
            ? item.singer?.length
              ? `https://y.gtimg.cn/music/photo_new/T001R500x500M000${item.singer[0].mid}.jpg`
              : ''
            : `https://y.gtimg.cn/music/photo_new/T002R500x500M000${item.album.mid}.jpg`,
          lrc: null,
          otherSource: null,
          types,
          _types,
          typeUrl: {},
        }
      })
    log.info('[TX SongList] filterListDetailNew 输出', { count: result.length, firstSong: result.length > 0 ? result[0].name : 'none' })
    return result
  },

  async getListDetail(id, page = 1, tryNum = 0) {
    log.info('[TX SongList] getListDetail 开始', { id, page, tryNum })

    if (tryNum > 2) {
      log.error('[TX SongList] getListDetail 重试次数超限', { id, page, tryNum })
      return Promise.reject(new Error('try max num'))
    }

    id = await this.getListId(id)
    log.info('[TX SongList] getListDetail 获取到真实ID', { id })

    if (id === '99') {
      log.info('[TX SongList] getListDetail 检测到猜你喜欢，使用特殊接口')
      try {
        const cookie = settingState.setting['common.tx_cookie']
        const payload = {
          comm: { cv: 1602, ct: 20 },
          req_0: {
            module: 'music.radioProxy.MbTrackRadioSvr',
            method: 'get_radio_track',
            param: { id: 99, num: 5, from: 0, scene: 0, song_ids: [] },
          },
        }
        const url = `https://u.y.qq.com/cgi-bin/musicu.fcg?loginUin=0&hostUin=0&format=json&inCharset=utf-8&outCharset=utf-8&notice=0&platform=wk_v15.json&needNewCode=0&data=${encodeURIComponent(JSON.stringify(payload))}`

        const { body } = await httpFetch(url, {
          headers: {
            Cookie: cookie || '',
          },
        }).promise

        const tracks = body?.req_0?.data?.tracks || []
        log.info('[TX SongList] getListDetail 猜你喜欢获取到tracks', { count: tracks.length })

        if (tracks.length === 0) {
          throw new Error('猜你喜欢返回歌曲列表为空')
        }

        const list = await this.filterListDetailNew(tracks)
        log.info('[TX SongList] getListDetail 猜你喜欢格式化完成', { songCount: list.length })

        return {
          list,
          page: 1,
          limit: list.length + 1,
          total: list.length,
          source: 'tx',
          info: {
            name: '猜你喜欢',
            img: 'https://y.gtimg.cn/mediastyle/y/img/cover_qzone_130.jpg',
            desc: '根据你的喜好推荐的歌曲',
            author: '',
            play_count: '',
          },
        }
      } catch (error) {
        log.error('[TX SongList] getListDetail 猜你喜欢获取失败', { error: error.message })
        throw error
      }
    }

    log.info('[TX SongList] getListDetail 使用 musicu.fcg 接口')
    try {
      const result = await this.getListDetailNew(id, page)
      log.info('[TX SongList] getListDetail 获取成功', { songCount: result.list.length })
      return result
    } catch (error) {
      log.error('[TX SongList] getListDetail 获取失败', { error: error.message })
      return this.getListDetail(id, page, ++tryNum)
    }
  },
  async filterListDetail(rawList) {
    const qualityInfoRequest = getBatchMusicQualityInfo(rawList)
    let qualityInfoMap = {}

    try {
      qualityInfoMap = await qualityInfoRequest.promise
    } catch (error) {
      console.error('Failed to fetch quality info:', error)
    }

    return rawList
      .filter((item) => item.mid)
      .map((item) => {
        const { types = [], _types = {} } = qualityInfoMap[item.id] || {}

        return {
          singer: formatSingerName(item.singer, 'name'),
          name: item.title,
          albumName: item.album?.name ?? '',
          albumId: item.album?.mid ?? '',
          source: 'tx',
          interval: formatPlayTime(item.interval),
          songId: item.id,
          albumMid: item.album.mid,
          strMediaMid: item.file.media_mid,
          songmid: item.mid,
          img:
          !item.album?.name || item.album.name === '空'
            ? item.singer?.length
              ? `https://y.gtimg.cn/music/photo_new/T001R500x500M000${item.singer[0].mid}.jpg`
              : ''
            : `https://y.gtimg.cn/music/photo_new/T002R500x500M000${item.album.mid}.jpg`,
          lrc: null,
          otherSource: null,
          types,
          _types,
          typeUrl: {},
        }
      })
  },
  getTags() {
    return Promise.all([this.getTag(), this.getHotTag()]).then(([tags, hotTag]) => ({
      tags,
      hotTag,
      source: 'tx',
    }))
  },

  async getDetailPageUrl(id) {
    id = await this.getListId(id)

    return `https://y.qq.com/n/ryqq/playlist/${id}`
  },

  handleSearchResult(rawList) {
    if (!rawList || !Array.isArray(rawList)) return []
    // 兼容两种歌单来源：
    //  - SearchCgiService(search_type=3)：item_songlist，字段 nickname/logo/songnum/description
    //  - 老接口 client_music_search_songlist：字段 creator.name/imgurl/song_count/introduction
    const stripEm = (str) => (str || '').replace(/<[^>]+>/g, '')
    return rawList.map((item) => {
      const creator = item.creator || item.creator_info || {}
      return {
        play_count: formatPlayCount(item.listennum ?? item.playnum ?? item.play_count ?? item.access_num ?? 0),
        id: String(item.dissid ?? item.tid ?? item.id ?? ''),
        author: decodeName(item.nickname ?? creator.name ?? creator.nick ?? ''),
        name: decodeName(stripEm(item.dissname ?? item.title ?? '')),
        time: dateFormat(item.createtime ?? item.create_time, 'Y-M-D'),
        img: item.logo ?? item.imgurl ?? item.cover_url_medium ?? item.cover_url ?? item.cover ?? '',
        total: item.songnum ?? item.song_count ?? item.total ?? 0,
        desc: decodeName(stripEm(item.description ?? item.introduction ?? item.desc ?? '')).replace(/<br>/g, '\n'),
        source: 'tx',
      }
    }).filter(item => item.id)
  },

  searchOld(text, page, limit = 20, retryNum = 0) {
    if (retryNum > 5) throw new Error('max retry')
    return httpFetch(
      `http://c.y.qq.com/soso/fcgi-bin/client_music_search_songlist?page_no=${
        page - 1
      }&num_per_page=${limit}&format=json&query=${encodeURIComponent(
        text,
      )}&remoteplace=txt.yqq.playlist&inCharset=utf8&outCharset=utf-8`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; WOW64; Trident/5.0)',
          Referer: 'http://y.qq.com/portal/search.html',
        },
      },
    ).promise.then(({ body }) => {
      if (body.code != 0) return this.searchOld(text, page, limit, ++retryNum)
      return {
        list: this.handleSearchResult(body.data.list),
        limit,
        total: body.data.sum,
        source: 'tx',
      }
    })
  },

  // 企鹅音乐歌单搜索：走 SearchCgiService(search_type=3)，与歌曲/歌手/专辑搜索同源，
  // 由 signRequest(musics.fcg) 签名请求。已用真实接口验证返回结构：
  //   musicSearch(...,3) 返回 body.req.data，歌单列表位于 data.body.item_songlist，
  //   meta 位于 data.meta（含 estimate_sum）。失败则兜底 searchOld（老接口）。
  search(text, page, limit = 20) {
    return musicSearchApi.musicSearch(text, page, limit, 3).then((data) => {
      const rawList = data?.body?.item_songlist || []
      const list = this.handleSearchResult(rawList)
      return {
        list,
        limit,
        total: data?.meta?.estimate_sum ?? data?.meta?.sum ?? list.length,
        source: 'tx',
      }
    }).catch(() => this.searchOld(text, page, limit))
  },
}
