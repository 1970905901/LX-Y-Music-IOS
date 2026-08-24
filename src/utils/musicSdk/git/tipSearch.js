import { loadDatabase, extractNameFromFile } from './util'

export default {
  requestObj: null,

  async tipSearchByKeyword(str) {
    this.cancelTipSearch()

    let canceled = false
    const promise = new Promise(async (resolve, reject) => {
      try {
        if (canceled) {
          reject(new Error('请求已取消'))
          return
        }

        const database = await loadDatabase()

        if (canceled) {
          reject(new Error('请求已取消'))
          return
        }

        if (!database || database.length === 0) {
          reject(new Error('数据库为空'))
          return
        }

        const filtered = str
          ? database.filter((item) => {
              const title = item.title || extractNameFromFile(item.filename)
              return title.toLowerCase().includes(str.toLowerCase())
            })
          : database

        const shuffled = [...filtered].sort(() => Math.random() - 0.5)
        const results = shuffled.slice(0, 5)

        resolve(results)
      } catch (error) {
        reject(error)
      }
    })

    this.requestObj = {
      promise,
      cancelHttp: () => {
        canceled = true
      },
    }

    return this.requestObj.promise
  },

  handleResult(rawData) {
    return rawData.map((item) => ({
      keyword: item.title || extractNameFromFile(item.filename),
      type: 'git',
    }))
  },

  cancelTipSearch() {
    if (this.requestObj && this.requestObj.cancelHttp) {
      this.requestObj.cancelHttp()
    }
  },

  async search(str) {
    return this.tipSearchByKeyword(str).then((result) => this.handleResult(result))
  },
}
