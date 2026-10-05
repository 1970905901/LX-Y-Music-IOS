/**
 * sim-storage-atomic-write.js
 *
 * 本地存储的覆盖写必须"先写新值、再回收旧值"：
 *   - 任何一次写入失败（setItem / multiSet）后，getData 仍必须读到完整的旧值；
 *   - 写入成功后旧分片必须被回收，不能留孤儿。
 *
 * 背景（2026-10 全仓审查 P1）：storage.ts 的 saveData / saveDataMultiple 旧实现是
 *   buildData → removeData(旧键+旧分片) → multiSet(新数据)
 * 即"先删后写"：multiSet 抛错（磁盘满/存储异常）或进程被杀时，旧数据已删除且无回滚，
 * 用户歌单/设置直接丢失。
 *
 * 本脚本用 TypeScript 编译真实的 src/plugins/storage.ts，注入一个可控制"第 n 次写入
 * 失败"的假 AsyncStorage，对真实实现做行为断言（不是源码文本匹配）。
 *
 * 运行：node scripts/sim-storage-atomic-write.js
 * 退出码：全部通过 0，否则 1。
 */

const fs = require('fs')
const path = require('path')
const Module = require('module')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..')
const STORAGE_PATH = path.join(ROOT, 'src/plugins/storage.ts')
const PART_LIMIT = 500000

const logStub = { log: { info() {}, warn() {}, error() {} } }

const createFakeAsyncStorage = () => {
  const map = new Map()
  let writeCount = 0
  let failAt = 0
  const beforeWrite = () => {
    writeCount += 1
    if (failAt > 0 && writeCount === failAt) {
      failAt = 0
      throw new Error('simulated storage write failure')
    }
  }
  const AS = {
    getItem: async(key) => (map.has(key) ? map.get(key) : null),
    setItem: async(key, value) => {
      beforeWrite()
      map.set(key, value)
    },
    multiSet: async(pairs) => {
      beforeWrite()
      for (const [k, v] of pairs) map.set(k, v)
    },
    removeItem: async(key) => { map.delete(key) },
    multiRemove: async(keys) => { for (const k of keys) map.delete(k) },
    multiGet: async(keys) => keys.map((k) => [k, map.has(k) ? map.get(k) : null]),
    getAllKeys: async() => [...map.keys()],
    clear: async() => { map.clear() },
  }
  return {
    AS,
    map,
    // 让接下来的第 n 次写入（setItem / multiSet 任一）失败
    failWriteAt: (n) => { failAt = writeCount + n },
    writeCount: () => writeCount,
  }
}

const loadStorage = (fake) => {
  const source = fs.readFileSync(STORAGE_PATH, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
      esModuleInterop: true,
    },
    fileName: STORAGE_PATH,
  }).outputText

  const mod = new Module(STORAGE_PATH, null)
  mod.filename = STORAGE_PATH
  mod.paths = Module._nodeModulePaths(path.dirname(STORAGE_PATH))

  const originalLoad = Module._load
  Module._load = function(request, parent, isMain) {
    if (request.includes('async-storage')) return fake.AS
    if (request.includes('utils/log') || request === '@/utils/log') return logStub
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    mod._compile(output, STORAGE_PATH)
  } finally {
    Module._load = originalLoad
  }
  return mod.exports
}

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const bigValue = (tag) => ({ tag, pad: `${tag}:${'x'.repeat(PART_LIMIT + 32)}` })

// 不变量：'k' 的指针列出的分片必须齐全，且 map 里不允许出现未列出的分片
const assertNoOrphans = (fake, key, label) => {
  const raw = fake.map.get(key)
  const others = [...fake.map.keys()].filter((k) => k !== key)
  if (raw == null) {
    if (others.length) throw new Error(`${label}: key 缺失但存在 ${others.length} 个孤儿分片`)
    return
  }
  const listed = raw.startsWith('@___PART_A___')
    ? JSON.parse(raw.slice('@___PART_A___'.length))
    : []
  for (const part of listed) {
    if (!fake.map.has(part)) throw new Error(`${label}: 指针列出的分片缺失 ${part}`)
  }
  const orphans = others.filter((k) => !listed.includes(k))
  if (orphans.length) throw new Error(`${label}: 存在 ${orphans.length} 个孤儿分片`)
}

const main = async() => {
  const results = []
  const run = async(name, fn) => {
    try {
      await fn()
      results.push([name, null])
    } catch (err) {
      results.push([name, err])
    }
  }

  // C1：大值正常写入 / 读回（sanity）
  await run('C1 大值写入→读回一致', async() => {
    const fake = createFakeAsyncStorage()
    const storage = loadStorage(fake)
    const value = bigValue('a')
    await storage.saveData('k', value)
    const got = await storage.getData('k')
    if (!equal(got, value)) throw new Error('读回内容与写入不一致')
    assertNoOrphans(fake, 'k', 'C1')
  })

  // C2：覆盖大值，第一次写失败 → 旧值必须完好（旧实现必失败）
  await run('C2 覆盖大值·首次写失败→旧值完好', async() => {
    const fake = createFakeAsyncStorage()
    const storage = loadStorage(fake)
    const oldValue = bigValue('old')
    const newValue = bigValue('new')
    await storage.saveData('k', oldValue)
    fake.failWriteAt(1)
    let threw = false
    try {
      await storage.saveData('k', newValue)
    } catch {
      threw = true
    }
    if (!threw) throw new Error('注入的写失败没有触发（实现没有走预期写入路径）')
    const got = await storage.getData('k')
    if (!equal(got, oldValue)) throw new Error(`旧值丢失/损坏：${got === null ? '读回 null' : '内容不一致'}`)
    assertNoOrphans(fake, 'k', 'C2')
  })

  // C3：覆盖小值，写失败 → 旧值必须完好（旧实现必失败）
  await run('C3 覆盖小值·写失败→旧值完好', async() => {
    const fake = createFakeAsyncStorage()
    const storage = loadStorage(fake)
    await storage.saveData('k', { a: 1 })
    fake.failWriteAt(1)
    let threw = false
    try {
      await storage.saveData('k', { a: 2 })
    } catch {
      threw = true
    }
    if (!threw) throw new Error('注入的写失败没有触发')
    const got = await storage.getData('k')
    if (!equal(got, { a: 1 })) throw new Error(`旧值丢失/损坏：${got === null ? '读回 null' : '内容不一致'}`)
  })

  // C4：覆盖大值，第二次写失败 → 读回必须是完整旧值或完整新值（不允许 null/损坏）
  await run('C4 覆盖大值·第二次写失败→读到完整旧值或完整新值', async() => {
    const fake = createFakeAsyncStorage()
    const storage = loadStorage(fake)
    const oldValue = bigValue('old')
    const newValue = bigValue('new')
    await storage.saveData('k', oldValue)
    fake.failWriteAt(2)
    let threw = false
    try {
      await storage.saveData('k', newValue)
    } catch {
      threw = true
    }
    const got = await storage.getData('k')
    const ok = threw ? equal(got, oldValue) : equal(got, newValue)
    if (!ok) throw new Error(`覆盖写结果不是完整旧值/新值：${got === null ? '读回 null' : '内容不一致'}`)
    assertNoOrphans(fake, 'k', 'C4')
  })

  // C5：覆盖成功后读回新值，且不允许留下未列出的孤儿分片（回收不变量）
  await run('C5 覆盖成功→读到新值且无孤儿分片', async() => {
    const fake = createFakeAsyncStorage()
    const storage = loadStorage(fake)
    const oldValue = bigValue('old')
    const newValue = bigValue('new')
    await storage.saveData('k', oldValue)
    if (![...fake.map.keys()].some((k) => k !== 'k')) throw new Error('前置条件失败：大值未产生分片')
    await storage.saveData('k', newValue)
    const got = await storage.getData('k')
    if (!equal(got, newValue)) throw new Error('覆盖后读回不一致')
    assertNoOrphans(fake, 'k', 'C5')
  })

  // C6：反例自检——旧"先删后写"顺序在写失败时必然丢数据（证明本测试有区分力）
  await run('C6 反例自检：先删后写在写失败时丢数据', async() => {
    const fake = createFakeAsyncStorage()
    await fake.AS.setItem('k', JSON.stringify({ a: 1 }))
    fake.failWriteAt(1)
    // 旧实现顺序：先删旧值（removeData），再写新值（multiSet）
    await fake.AS.removeItem('k')
    let threw = false
    try {
      await fake.AS.multiSet([['k', JSON.stringify({ a: 2 })]])
    } catch {
      threw = true
    }
    if (!threw) throw new Error('注入失败未触发')
    const got = await fake.AS.getItem('k')
    if (got !== null) throw new Error('反例失效：先删后写竟然保住了数据')
  })

  const failed = results.filter(([, err]) => err !== null)
  for (const [name, err] of results) {
    console.log(`${err ? 'FAIL' : 'PASS'}  ${name}${err ? '  —— ' + err.message : ''}`)
  }
  if (failed.length) {
    console.error(`\nFAIL  存储原子写契约未通过（${failed.length}/${results.length}）`)
    process.exit(1)
  }
  console.log(`\nPASS  存储覆盖写在失败时保留旧值、成功后回收旧分片（${results.length} 例）`)
  process.exit(0)
}

void main()
