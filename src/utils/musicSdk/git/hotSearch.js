import { loadDatabase, extractNameFromFile } from './util'

export default {
  _requestObj: null,
  _cacheData: null,
  _cacheTime: 0,

  async getList(retryNum = 0) {
    if (retryNum > 2) {
      return Promise.reject(new Error('获取热搜失败，请稍后重试'))
    }

    try {
      const now = Date.now()
      if (this._cacheData && now - this._cacheTime < 5 * 60 * 1000) {
        return this._cacheData
      }

      const database = await loadDatabase()
      if (!database || database.length === 0) {
        console.log('[Hotword] 数据库为空')
        return { source: 'git', list: [] }
      }

      const hotWords = new Set()

      const shuffled = [...database].sort(() => Math.random() - 0.5)
      const selectedSongs = shuffled.slice(0, 15)

      selectedSongs.forEach((item) => {
        const title = item.title || extractNameFromFile(item.filename)
        if (title && title.length > 1) {
          hotWords.add(title)
        }

        if (item.artist && item.artist !== '未知歌手' && item.artist.length > 1) {
          hotWords.add(item.artist)
        }
      })

      const hotWordsList = Array.from(hotWords).slice(0, 20)

      console.log(`[Hotword] 生成 ${hotWordsList.length} 个热搜词`)

      const result = {
        source: 'git',
        list: hotWordsList,
      }

      this._cacheData = result
      this._cacheTime = now

      return result
    } catch (error) {
      console.error('[Hotword] 获取热搜出错:', error)

      if (
        error.message &&
        (error.message.includes('ECONNREFUSED') || error.message.includes('ETIMEDOUT'))
      ) {
        console.log(`[Hotword] 网络错误，重试 ${retryNum + 1}/3`)
        return this.getList(retryNum + 1)
      }

      return { source: 'git', list: [] }
    }
  },

  filterList(rawList) {
    return rawList.map((item) => item.key || item)
  },
}
