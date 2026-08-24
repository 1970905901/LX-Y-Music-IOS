import kw from './kw'
import kg from './kg'
import tx from './tx'
import wy from './wy'
import mg from './mg'
import bilibili from './bilibili'
import git from './git'
// import yt from './yt'
import { supportQuality } from './api-source'

const sources = {
  sources: [
    {
      name: '酷我音乐',
      id: 'kw',
    },
    {
      name: '酷狗音乐',
      id: 'kg',
    },
    {
      name: 'QQ音乐',
      id: 'tx',
    },
    {
      name: '网易音乐',
      id: 'wy',
    },
    {
      name: '咪咕音乐',
      id: 'mg',
    },
    {
      name: '哔哩哔哩',
      id: 'bilibili',
    },
    {
      name: 'Gitcode',
      id: 'git',
    },
    // {
    //   name: 'YouTube',
    //   id: 'yt',
    // },
  ],
  kw,
  kg,
  tx,
  wy,
  mg,
  bilibili,
  git,
  // yt,
}

const musicSdk = {
  ...sources,
  supportQuality,
}

export default musicSdk

export const init = () => {
  const tasks = []
  for (let source of sources.sources) {
    let sm = sources[source.id]
    sm && sm.init && tasks.push(sm.init())
  }
  return Promise.all(tasks)
}

export const searchMusic = async ({ name, singer, source: s, limit = 25 }) => {
  const trimStr = (str) => (typeof str == 'string' ? str.trim() : str)
  const musicName = trimStr(name)
  const tasks = []
  const excludeSource = ['xm', 'git', 'bilibili']
  for (const source of sources.sources) {
    if (!sources[source.id].musicSearch || source.id == s || excludeSource.includes(source.id))
      continue
    tasks.push(
      sources[source.id].musicSearch
        .search(`${musicName} ${singer || ''}`.trim(), 1, limit)
        .catch((_) => null)
    )
  }
  return (await Promise.all(tasks)).filter((s) => s)
}

export const findMusic = async (musicInfo) => {
  const { name, singer, albumName, interval, source: s } = musicInfo
  console.log(`[在线匹配] ========== 开始匹配 ==========`)
  console.log(`[在线匹配] 输入信息: 歌名="${name}", 歌手="${singer}", 专辑="${albumName}", 时长="${interval}", 来源="${s}"`)

  const lists = await searchMusic({ name, singer, source: s, limit: 25 })
  console.log(`[在线匹配] 搜索返回 ${lists.length} 个平台的结果`)
  
  // 显示搜索结果详情
  lists.forEach(source => {
    console.log(`[在线匹配] [${source.source}] 返回 ${source.list.length} 条结果`)
    source.list.slice(0, 5).forEach((item, i) => {
      console.log(`[在线匹配]   ${i+1}. "${item.name}" - "${item.singer}" (${item.interval || '未知'})`)
    })
  })

  const singersRxp = /、|&|;|；|\/|,|，|\|/
  const sortSingle = (singer) =>
    singersRxp.test(singer)
      ? singer
          .split(singersRxp)
          .sort((a, b) => a.localeCompare(b))
          .join('、')
      : singer || ''
  const sortMusic = (arr, callback) => {
    const tempResult = []
    for (let i = arr.length - 1; i > -1; i--) {
      const item = arr[i]
      if (callback(item)) {
        delete item.fSinger
        delete item.fMusicName
        delete item.fAlbumName
        delete item.fInterval
        tempResult.push(item)
        arr.splice(i, 1)
      }
    }
    tempResult.reverse()
    return tempResult
  }
  const getIntv = (interval) => {
    if (!interval) return 0
    let intvArr = interval.split(':')
    let intv = 0
    let unit = 1
    while (intvArr.length) {
      intv += parseInt(intvArr.pop()) * unit
      unit *= 60
    }
    return intv
  }
  const trimStr = (str) => (typeof str == 'string' ? str.trim() : str || '')
  const filterStr = (str) =>
    typeof str == 'string'
      ? str.replace(/\s|'|\.|,|，|&|"|、|\(|\)|（|）|`|~|-|<|>|\||\/|\]|\[|!|！/g, '')
      : String(str || '')
  const fMusicName = filterStr(name).toLowerCase()
  const fSinger = filterStr(sortSingle(singer)).toLowerCase()
  const fAlbumName = filterStr(albumName).toLowerCase()
  const fInterval = getIntv(interval)
  console.log(`[在线匹配] 清理后: 歌名="${fMusicName}", 歌手="${fSinger}", 专辑="${fAlbumName}", 时长=${fInterval}`)

  const isEqualsInterval = (intv) => {
    // 如果本地时长为0（如WebDAV文件），跳过时长匹配
    if (!fInterval || !intv) return true
    return Math.abs(fInterval - intv) < 5
  }
  const isIncludesName = (name) => fMusicName.includes(name) || name.includes(fMusicName)
  const isIncludesSinger = (singer) =>
    fSinger ? fSinger.includes(singer) || singer.includes(fSinger) : true
  const isEqualsAlbum = (album) => (fAlbumName ? fAlbumName == album : true)

  const result = lists
    .map((source) => {
      // 优先级1：歌名完全相等 + 歌手包含
      for (const item of source.list) {
        item.name = trimStr(item.name)
        item.singer = trimStr(item.singer)
        item.fSinger = filterStr(sortSingle(item.singer).toLowerCase())
        item.fMusicName = filterStr(String(item.name ?? '').toLowerCase())
        item.fAlbumName = filterStr(String(item.albumName ?? '').toLowerCase())
        item.fInterval = getIntv(item.interval)
        
        if (!isEqualsInterval(item.fInterval)) {
          item.name = null
          continue
        }
        if (item.fMusicName == fMusicName && isIncludesSinger(item.fSinger)) {
          return item
        }
      }
      // 优先级2：歌手完全相等 + 歌名包含
      for (const item of source.list) {
        if (item.name == null) continue
        if (item.fSinger == fSinger && isIncludesName(item.fMusicName)) {
          return item
        }
      }
      // 优先级3：专辑相等 + 歌手包含 + 歌名包含
      for (const item of source.list) {
        if (item.name == null) continue
        if (
          isEqualsAlbum(item.fAlbumName) &&
          isIncludesSinger(item.fSinger) &&
          isIncludesName(item.fMusicName)
        ) {
          return item
        }
      }
      // 优先级4：歌名完全相等（不考虑歌手专辑）
      for (const item of source.list) {
        if (item.name == null) continue
        if (item.fMusicName == fMusicName) {
          return item
        }
      }
      // 优先级5：歌名包含（不考虑歌手专辑）
      for (const item of source.list) {
        if (item.name == null) continue
        if (isIncludesName(item.fMusicName)) {
          return item
        }
      }
      // 优先级6：返回第一个结果作为近似值
      const firstValidItem = source.list.find(item => item.name != null)
      if (firstValidItem) {
        console.log(`[在线匹配] [${source.source}] 使用第一个结果作为近似值`)
        return firstValidItem
      }
      return null
    })
    .filter((s) => s)
  
  // 输出匹配结果日志
  console.log(`[在线匹配] ========== 匹配结果 ==========`)
  if (result.length > 0) {
    console.log(`[在线匹配] 找到 ${result.length} 个匹配结果`)
    result.forEach((item, i) => {
      console.log(`[在线匹配]   ${i + 1}. ${item.source} - "${item.name}" - "${item.singer}" (${item.interval || '未知'})`)
    })
  } else {
    console.log(`[在线匹配] 未找到匹配结果`)
    console.log(`[在线匹配] 失败原因分析:`)
    console.log(`[在线匹配]   - 本地歌名: "${name}"`)
    console.log(`[在线匹配]   - 本地歌手: "${singer || '空'}"`)
    console.log(`[在线匹配]   - 本地专辑: "${albumName || '空'}"`)
    console.log(`[在线匹配]   - 本地时长: "${interval || '空'}"`)
    console.log(`[在线匹配]   - 搜索结果中没有完全匹配的歌曲`)
  }

  const newResult = []
  if (result.length) {
    newResult.push(
      ...sortMusic(
        result,
        (item) =>
          item.fSinger == fSinger && item.fMusicName == fMusicName && item.interval == interval
      )
    )
    newResult.push(
      ...sortMusic(
        result,
        (item) =>
          item.fMusicName == fMusicName && item.fSinger == fSinger && item.fAlbumName == fAlbumName
      )
    )
    newResult.push(
      ...sortMusic(result, (item) => item.fSinger == fSinger && item.fMusicName == fMusicName)
    )
    newResult.push(
      ...sortMusic(result, (item) => item.fMusicName == fMusicName && item.interval == interval)
    )
    newResult.push(
      ...sortMusic(result, (item) => item.fSinger == fSinger && item.interval == interval)
    )
    newResult.push(...sortMusic(result, (item) => item.interval == interval))
    newResult.push(...sortMusic(result, (item) => item.fMusicName == fMusicName))
    newResult.push(...sortMusic(result, (item) => item.fSinger == fSinger))
    newResult.push(...sortMusic(result, (item) => item.fAlbumName == fAlbumName))
    for (const item of result) {
      delete item.fSinger
      delete item.fMusicName
      delete item.fAlbumName
      delete item.fInterval
    }
    newResult.push(...result)
  }
  // log.info(newResult)
  return newResult
}