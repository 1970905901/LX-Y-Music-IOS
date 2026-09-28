/**
 * 复刻 src/core/songlist.ts 的 doGetListDetailLimit 分页切分逻辑，
 * 验证「首次进入歌单详情 → 加载失败；点重试 → 成功」的根因假设。
 *
 * 假设：当「源接口某页去重后的歌曲数 < LIST_LOAD_LIMIT(30)，且源还有更多页」时，
 * 旧实现把歌曲存进 tempList 后直接 break，**没有为当前 page 写任何缓存**，
 * 末尾 `listCache.get(pageKey).data` 读到 undefined → TypeError → Promise reject
 * → MusicList.loadList 的 .catch 里 setStatus('error') → 界面显示「加载失败」。
 *
 * 运行：node scripts/sim-songlist-detail-page-crash.js
 */

const LIST_LOAD_LIMIT = 30

// ---------------- 旧实现（复刻 src/core/songlist.ts 当前逻辑） ----------------
const makeOld = () => {
  const cache = new Map()
  return async function doGetListDetailLimit(source, id, page, fetchSourcePage) {
    const listKey = `sdetail__${source}__${id}`
    const prevPageKey = `sdetail__${source}__${id}__${page - 1}`
    const tempListKey = `sdetail__${source}__${id}__temp`

    let listCache = cache.get(listKey)
    if (!listCache) cache.set(listKey, (listCache = new Map()))
    let sourcePage = 0
    {
      const prevPageData = listCache.get(prevPageKey)
      if (prevPageData) sourcePage = prevPageData.sourcePage
    }

    const result = await fetchSourcePage(sourcePage + 1)
    const total = result.total
    const limit = result.limit
    let list = result.list

    if (listCache !== cache.get(listKey)) {
      cache.set(listKey, (listCache = new Map()))
    }

    let p = page
    const tempList = listCache.get(tempListKey)
    if (tempList) {
      listCache.delete(tempListKey)
      listCache.set(`sdetail__${source}__${id}__${p}`, {
        data: { list: [...tempList, ...list.splice(0, LIST_LOAD_LIMIT - tempList.length)], page: p, limit: LIST_LOAD_LIMIT, total, source },
        sourcePage,
      })
      p++
    }
    sourcePage++
    do {
      if (list.length < LIST_LOAD_LIMIT && sourcePage < Math.ceil(total / limit)) {
        listCache.set(tempListKey, list.splice(0, LIST_LOAD_LIMIT))
        break
      }
      listCache.set(`sdetail__${source}__${id}__${p}`, {
        data: { list: list.splice(0, LIST_LOAD_LIMIT), page: p, limit: LIST_LOAD_LIMIT, total, source },
        sourcePage,
      })
      p++
    } while (list.length > 0)

    // ← 旧实现：直接取，不判空
    return listCache.get(`sdetail__${source}__${id}__${page}`).data
  }
}

// ---------------- 新实现（收紧：本页必须写入，未凑满则把已有数据交付为本页） ----------------
const makeNew = () => {
  const cache = new Map()
  return async function doGetListDetailLimit(source, id, page, fetchSourcePage) {
    const listKey = `sdetail__${source}__${id}`
    const prevPageKey = `sdetail__${source}__${id}__${page - 1}`
    const tempListKey = `sdetail__${source}__${id}__temp`

    let listCache = cache.get(listKey)
    if (!listCache) cache.set(listKey, (listCache = new Map()))
    let sourcePage = 0
    {
      const prevPageData = listCache.get(prevPageKey)
      if (prevPageData) sourcePage = prevPageData.sourcePage
    }

    const result = await fetchSourcePage(sourcePage + 1)
    const total = result.total
    const limit = result.limit
    let list = result.list

    if (listCache !== cache.get(listKey)) {
      cache.set(listKey, (listCache = new Map()))
    }

    // 把上一轮遗留的不足一页的歌曲接在本源页结果前面（先删 key 再合并，避免重复）
    let pendingList = list
    const tempList = listCache.get(tempListKey)
    if (tempList) {
      listCache.delete(tempListKey)
      pendingList = [...tempList, ...list]
    }

    sourcePage++
    const totalSourcePages = Math.ceil(total / limit)

    let p = page
    while (pendingList.length > 0) {
      if (pendingList.length < LIST_LOAD_LIMIT && sourcePage < totalSourcePages) {
        listCache.set(tempListKey, pendingList.splice(0, LIST_LOAD_LIMIT))
        break
      }
      listCache.set(`sdetail__${source}__${id}__${p}`, {
        data: { list: pendingList.splice(0, LIST_LOAD_LIMIT), page: p, limit: LIST_LOAD_LIMIT, total, source },
        sourcePage,
      })
      p++
    }

    // 兜底：本页仍没有缓存（已有数据全被留在 tempList 等下一源页），
    // 直接把待定余数提升为本页交付，绝不能返回 undefined。
    let pageCache = listCache.get(`sdetail__${source}__${id}__${page}`)
    if (!pageCache) {
      const pending = listCache.get(tempListKey) ?? []
      listCache.delete(tempListKey)
      pageCache = {
        data: { list: pending, page, limit: LIST_LOAD_LIMIT, total, source },
        sourcePage,
      }
      listCache.set(`sdetail__${source}__${id}__${page}`, pageCache)
    }
    return pageCache.data
  }
}
// ---------------- 场景定义 ----------------
// fetchSourcePage(sourcePage) → { list, total, limit }
// 用 fake 源：按 song_begin=(sourcePage-1)*pageSize 从「可播放歌单」切片。
// 可播放歌单 = 全量歌单里被源侧过滤后剩下的（模拟下架/重复）
const makeFetcher = ({ total, pageSize, playableCountPerPage }) => {
  const allIds = Array.from({ length: total }, (_, i) => `s${i + 1}`)
  // playableCountPerPage 指定每个源页「去重后实际返回」多少首（模拟下架/重复过滤）
  return async (sourcePage) => {
    const begin = (sourcePage - 1) * pageSize
    if (begin >= total) return { list: [], total, limit: pageSize, source: 'tx' }
    const raw = allIds.slice(begin, begin + pageSize)
    const n = Math.min(playableCountPerPage, raw.length)
    return { list: raw.slice(0, n), total, limit: pageSize, source: 'tx' }
  }
}

let pass = 0
let fail = 0
const check = (name, cond, extra = '') => {
  if (cond) {
    pass++
    console.log(`  ✅ ${name}`)
  } else {
    fail++
    console.log(`  ❌ ${name} ${extra}`)
  }
}

const runScenario = async (Impl, label, { total, pageSize, playableCountPerPage, pages, simulateRetry }) => {
  console.log(`\n[${label}] total=${total} pageSize=${pageSize} 每源页实际返回=${playableCountPerPage}`)
  const fn = Impl()
  const fetchSourcePage = makeFetcher({ total, pageSize, playableCountPerPage })

  // 首次进入：page = 1
  let firstOk = true
  let firstErr = ''
  try {
    await fn('tx', 'PL1', 1, fetchSourcePage)
  } catch (e) {
    firstOk = false
    firstErr = e.message
  }

  if (!simulateRetry) {
    return { firstOk, firstErr }
  }

  // 点「重试」：Footer → onLoadMore → handleLoadMore，page 仍为 1，且 isRefresh=false
  let retryOk = true
  let retryErr = ''
  let retryList = []
  try {
    const r = await fn('tx', 'PL1', 1, fetchSourcePage)
    retryList = r.list
  } catch (e) {
    retryOk = false
    retryErr = e.message
  }
  return { firstOk, firstErr, retryOk, retryErr, retryList }
}

;(async () => {
  console.log('='.repeat(72))
  console.log('场景 A：歌单 100 首，源每页返回 20 首（有下架歌）')
  console.log('='.repeat(72))
  const a = await runScenario(makeOld, '旧实现', { total: 100, pageSize: 30, playableCountPerPage: 20, simulateRetry: true })
  check('旧实现 首次进入 失败（复现用户问题）', !a.firstOk, `实际 firstOk=${a.firstOk}`)
  if (!a.firstOk) console.log(`     抛错信息: ${a.firstErr}`)
  check('旧实现 重试 成功（复现“点重试能加载”）', a.retryOk, `实际 retryOk=${a.retryOk}`)
  if (a.retryOk) console.log(`     重试拿到 ${a.retryList.length} 首`)

  const a2 = await runScenario(makeNew, '新实现', { total: 100, pageSize: 30, playableCountPerPage: 20, simulateRetry: true })
  check('新实现 首次进入 成功（修复生效）', a2.firstOk, `实际 firstOk=${a2.firstOk} err=${a2.firstErr}`)
  if (a2.firstOk) console.log(`     首次拿到 ${a2.retryList.length} 首`)

  console.log('\n' + '='.repeat(72))
  console.log('场景 B：歌单 60 首，第 1 页源返回 30 首但去重后 29 首（有重复歌）')
  console.log('='.repeat(72))
  const b = await runScenario(makeOld, '旧实现', { total: 60, pageSize: 30, playableCountPerPage: 29, simulateRetry: true })
  check('旧实现 首次进入 失败', !b.firstOk)
  if (!b.firstOk) console.log(`     抛错信息: ${b.firstErr}`)
  check('旧实现 重试 成功', b.retryOk)

  console.log('\n' + '='.repeat(72))
  console.log('场景 C：歌单 300 首，源每页正常返回 30 首（无下架、无重复）')
  console.log('='.repeat(72))
  const c = await runScenario(makeOld, '旧实现', { total: 300, pageSize: 30, playableCountPerPage: 30, simulateRetry: false })
  check('旧实现 首次进入 成功（无过滤时本就不该失败）', c.firstOk)

  console.log('\n' + '='.repeat(72))
  console.log('场景 D：新实现 连续翻页不丢页、不崩溃（100 首 / 每源页 20 首）')
  console.log('='.repeat(72))
  {
    const fn = makeNew()
    const fetchSourcePage = makeFetcher({ total: 100, pageSize: 30, playableCountPerPage: 20 })
    const seen = []
    let crashed = false
    for (let p = 1; p <= 5; p++) {
      try {
        const r = await fn('tx', 'PL1', p, fetchSourcePage)
        seen.push({ p, len: r.list.length })
      } catch (e) {
        crashed = true
        console.log(`     page=${p} 抛错: ${e.message}`)
        break
      }
    }
    check('新实现 连续翻 5 页均不崩溃', !crashed)
    console.log(`     各页歌曲数: ${seen.map(s => `p${s.p}=${s.len}`).join(', ')}`)
    const allEmpty = seen.every(s => s.len === 0)
    check('新实现 至少拿到歌曲', seen.some(s => s.len > 0))
    check('新实现 无空页夹在中间', !seen.some((s, i) => i < seen.length - 1 && s.len === 0))
  }

  console.log('\n' + '='.repeat(72))
  console.log('场景 E：旧实现 连续翻页暴露周期性失败（100 首 / 每源页 20 首）')
  console.log('='.repeat(72))
  {
    const fn = makeOld()
    const fetchSourcePage = makeFetcher({ total: 100, pageSize: 30, playableCountPerPage: 20 })
    const results = []
    for (let p = 1; p <= 4; p++) {
      try {
        const r = await fn('tx', 'PL1', p, fetchSourcePage)
        results.push({ p, ok: true, len: r.list.length })
      } catch (e) {
        results.push({ p, ok: false, err: e.message })
      }
    }
    console.log(`     ${results.map(r => `p${r.p}:${r.ok ? r.len + '首' : '失败'}`).join(' | ')}`)
    check('旧实现 第 1 页失败（首次进入即用户看到的现象）', results[0] && !results[0].ok)
  }

  console.log('\n' + '='.repeat(72))
  console.log(`结果：${pass} 通过 / ${fail} 失败`)
  console.log('='.repeat(72))
  process.exit(fail ? 1 : 0)
})()
