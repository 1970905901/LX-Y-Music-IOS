/**
 * 「听歌识曲」移植的契约测试（移植自 EchoMusic / KuGouMusicApi）。
 *
 * 需求：把 EchoMusic 的听歌识曲搬到本项目，按钮放在搜索框内最右侧。
 *
 * 这条链路跨越 原生(ObjC) + 桥 + 签名 + 请求 + 映射 + UI 六层，
 * tsc/eslint 全无感（原生代码不参与 TS 检查、签名顺序错了也只是服务端返回空结果），
 * 所以用本脚本把关键不变量与「错法」绑死：
 *
 *  ① Info.plist 必须声明麦克风用途，否则首次请求录音直接崩溃；
 *  ② 原生按上游要求的 8000Hz / 单声道 / 16bit LE PCM 采集；
 *  ③ 签名必须把**原始 PCM 字节**参与 MD5（salt + 参数串 + bytes + salt），
 *     不能用 stringMd5（会把二进制当 UTF-8 破坏 → 服务端验签失败）；
 *  ④ 请求地址/参数与上游一致；
 *  ⑤ 映射结果必须是本项目可直接播放的 kg MusicInfo（带 hash/_qualitys）；
 *  ⑥ 按钮确实渲染在搜索框（searchBar）内部、SearchInput 之后。
 *
 * 运行：node scripts/sim-recognize-search.js
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')

const FILES = {
  plist: 'ios/LxMusicMobile/Info.plist',
  native: 'ios/LxMusicMobile/AppDelegate.mm',
  wrapper: 'src/utils/nativeModules/recognize.ts',
  audioMatch: 'src/utils/musicSdk/kg/audioMatch.ts',
  core: 'src/core/recognize/index.ts',
  headerBar: 'src/screens/Home/Views/Search/HeaderBar/index.tsx',
  button: 'src/screens/Home/Views/Search/HeaderBar/RecognizeButton.tsx',
  svg: 'src/components/common/SvgIcon.tsx',
}

const real = {}
for (const [key, file] of Object.entries(FILES)) real[key] = read(file)

// ---------------------------------------------------------------------------
// 源码不变量
// ---------------------------------------------------------------------------

const invariants = (f) => {
  const reasons = []

  // ① Info.plist 麦克风用途说明
  if (!/<key>NSMicrophoneUsageDescription<\/key>\s*<string>[^<]+<\/string>/.test(f.plist)) {
    reasons.push('Info.plist 缺少 NSMicrophoneUsageDescription（首次请求录音会直接崩溃）')
  }

  // ② 原生采集格式：8000Hz / 单声道 / 16bit / little-endian
  if (!/AVSampleRateKey:\s*@8000/.test(f.native)) reasons.push('原生未按 8000Hz 采集（上游指纹接口要求 8000Hz）')
  if (!/AVNumberOfChannelsKey:\s*@1\b/.test(f.native)) reasons.push('原生未按单声道采集')
  if (!/AVLinearPCMBitDepthKey:\s*@16\b/.test(f.native)) reasons.push('原生未按 16bit 采集')
  if (!/AVLinearPCMIsBigEndianKey:\s*@NO/.test(f.native)) reasons.push('原生未声明 little-endian（s16le）')
  if (!/recognizeStartWithResolver/.test(f.native) || !/recognizeStopWithResolver/.test(f.native)) {
    reasons.push('原生未导出 recognizeStart/recognizeStop 供 JS 调用')
  }
  // 录音结束后必须释放音频会话，否则播放器拿不回输出
  if (!/lxDeactivateRecognizeSession/.test(f.native) || !/setActive:NO withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation/.test(f.native)) {
    reasons.push('录音结束后未恢复/释放音频会话（会导致播放无声）')
  }

  // ③ 二进制签名：MD5 hasher 逐段 update，且必须包含原始字节
  const hasBinaryHasher =
    /CryptoJS\.algo\.MD5\.create\(\)/.test(f.audioMatch) &&
    /hasher\.update\(\s*wordArrayFromBytes\(\s*bytes\s*\)\s*\)/.test(f.audioMatch)
  if (!hasBinaryHasher) reasons.push('签名未把原始 PCM 字节交给 MD5（二进制被当字符串会验签失败）')
  if (/stringMd5\(/.test(f.audioMatch)) reasons.push('签名不得使用 stringMd5（按字符串处理会破坏二进制 PCM）')
  const updates = [...f.audioMatch.matchAll(/hasher\.update\(([^\n]*)\)/g)].map((m) => m[1].trim())
  const expectedOrder = [
    'CryptoJS.enc.Utf8.parse(SIGN_SALT)',
    'CryptoJS.enc.Utf8.parse(paramsString)',
    'wordArrayFromBytes(bytes)',
    'CryptoJS.enc.Utf8.parse(SIGN_SALT)',
  ]
  if (JSON.stringify(updates) !== JSON.stringify(expectedOrder)) {
    reasons.push(`签名拼接顺序不对：期望 salt→params→bytes→salt，实际 [${updates.join(' | ')}]`)
  }

  // ④ 请求地址与参数
  if (!/fingerprint\.service\/v1\/music_trackid_mulit/.test(f.audioMatch)) reasons.push('指纹接口地址与上游不一致')
  if (!/application\/octet-stream/.test(f.audioMatch)) reasons.push('指纹接口需以 application/octet-stream 提交二进制')
  for (const key of ['fpid', 'area_code', 'include_unpublish', 'useid', 'multi_result']) {
    if (!new RegExp(`\\b${key}\\b`).test(f.audioMatch)) reasons.push(`指纹接口缺少上游要求参数 ${key}`)
  }

  // ⑤ 映射成可播放的 kg MusicInfo
  if (!/source:\s*'kg'/.test(f.audioMatch)) reasons.push('识别结果未标记为 kg 音源')
  if (!/_qualitys:\s*_types/.test(f.audioMatch) || !/hash,\s*\n\s*mixSongId/.test(f.audioMatch)) {
    reasons.push('识别结果缺少 hash/_qualitys（播放器无法据此取播放地址）')
  }
  if (!/export (async )?function matchPcm/.test(f.audioMatch)) reasons.push('未导出 matchPcm')

  // ⑥ 搜索框内渲染按钮
  const searchBarAt = f.headerBar.indexOf('<SearchInput')
  const micAt = f.headerBar.indexOf('<RecognizeButton />')
  if (micAt < 0) {
    reasons.push('HeaderBar 未渲染 <RecognizeButton />（搜索框内最右侧的按钮缺失）')
  } else if (searchBarAt < 0 || micAt < searchBarAt) {
    reasons.push('<RecognizeButton /> 不在 SearchInput 之后（不在搜索框内最右侧）')
  }

  // 桥与编排层
  if (!/export const isRecognizeSupported/.test(f.wrapper)) reasons.push('原生桥未做平台/可用性守卫')
  if (!/Buffer\.from\(captured\.data, 'base64'\)/.test(f.core)) reasons.push('编排层未把原生 base64 PCM 还原为字节')

  return reasons
}

// ---------------------------------------------------------------------------
// 行为模型：验证签名算法的拼接顺序（用 node crypto 独立复算 MD5）
// ---------------------------------------------------------------------------

const crypto = require('crypto')

const referenceSign = (salt, params, bytes) => {
  const paramsString = Object.keys(params)
    .sort()
    .map((key) => `${key}=${typeof params[key] === 'object' ? JSON.stringify(params[key]) : params[key]}`)
    .join('')
  const hash = crypto.createHash('md5')
  hash.update(Buffer.from(salt, 'utf8'))
  hash.update(Buffer.from(paramsString, 'utf8'))
  hash.update(Buffer.from(bytes))
  hash.update(Buffer.from(salt, 'utf8'))
  return hash.digest('hex')
}

// 从源码里还原 update 序列，按同一顺序用 node crypto 复算，与参考实现对齐
const modelSignature = (audioMatchSrc, salt, params, bytes) => {
  const paramsString = Object.keys(params)
    .sort()
    .map((key) => `${key}=${typeof params[key] === 'object' ? JSON.stringify(params[key]) : params[key]}`)
    .join('')
  const steps = [...audioMatchSrc.matchAll(/hasher\.update\(([^\n]*)\)/g)].map((m) => m[1].trim())
  const hash = crypto.createHash('md5')
  for (const step of steps) {
    if (/Utf8\.parse\(SIGN_SALT\)/.test(step)) hash.update(Buffer.from(salt, 'utf8'))
    else if (/Utf8\.parse\(paramsString\)/.test(step)) hash.update(Buffer.from(paramsString, 'utf8'))
    else if (/wordArrayFromBytes\(bytes\)/.test(step)) hash.update(Buffer.from(bytes))
    else throw new Error(`未知的 update 步骤: ${step}`)
  }
  return hash.digest('hex')
}

const modelChecks = () => {
  const results = []
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail })

  const salt = 'OIlwieks28dk2k092lksi2UIkp'
  const params = { fpid: 1700000000000, area_code: 1, include_unpublish: 1, useid: 0, multi_result: 1 }
  // 伪造一段含 0x00/0xff 的二进制，正是「当字符串会被破坏」的样本
  const bytes = Uint8Array.from([0x00, 0x01, 0x7f, 0x80, 0xff, 0x00, 0x12, 0x34])

  const expected = referenceSign(salt, params, bytes)
  const actual = modelSignature(real.audioMatch, salt, params, bytes)
  check('签名 = md5(salt + paramsString + rawBytes + salt)', actual === expected, `${actual.slice(0, 12)}…`)

  // 反例：把二进制当 utf8 字符串（旧错法）必须算出不同结果
  const wrong = crypto.createHash('md5')
  wrong.update(Buffer.from(salt, 'utf8'))
  wrong.update(Buffer.from(Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join(''), 'utf8'))
  wrong.update(Buffer.from(Buffer.from(bytes).toString('utf8'), 'utf8'))
  wrong.update(Buffer.from(salt, 'utf8'))
  check('反例：把 PCM 当 UTF-8 字符串会得到不同签名（说明必须走字节）', wrong.digest('hex') !== expected, '')

  return results
}

// ---------------------------------------------------------------------------
// 反例自检：篡改源码后必须被拦下
// ---------------------------------------------------------------------------

const tamper = (src, find, replace) => {
  if (!src.includes(find)) throw new Error(`tamper 锚点未命中: ${find}`)
  return src.replace(find, replace)
}

const runCounterExamples = () => {
  const results = []
  const check = (name, files, expectSubstr) => {
    let reasons = []
    try {
      reasons = invariants(files)
    } catch (e) {
      results.push({ name, ok: false, detail: `抛异常: ${e.message}` })
      return
    }
    const hit = reasons.some((r) => r.includes(expectSubstr))
    results.push({ name, ok: hit, detail: hit ? '已拦下' : `未拦下（reasons=${JSON.stringify(reasons)}）` })
  }
  const clone = () => Object.assign({}, real)

  check('R1 去掉麦克风用途声明', (() => { const c = clone(); c.plist = c.plist.replace(/<key>NSMicrophoneUsageDescription<\/key>\s*<string>[^<]+<\/string>/, ''); return c })(), 'NSMicrophoneUsageDescription')

  check('R2 原生改成 44100Hz', (() => { const c = clone(); c.native = c.native.replace(/AVSampleRateKey:\s*@8000/, 'AVSampleRateKey: @44100'); return c })(), '8000Hz')

  check('R3 签名改用 stringMd5（二进制被当字符串）', (() => {
    const c = clone()
    c.audioMatch = c.audioMatch.replace(/hasher\.update\(\s*wordArrayFromBytes\(\s*bytes\s*\)\s*\)/, 'stringMd5(bytes)')
    return c
  })(), '原始 PCM 字节')

  check('R4 签名顺序颠倒（bytes 在 params 之前）', (() => {
    const c = clone()
    const a = 'hasher.update(CryptoJS.enc.Utf8.parse(SIGN_SALT))\n  hasher.update(CryptoJS.enc.Utf8.parse(paramsString))\n  hasher.update(wordArrayFromBytes(bytes))'
    const b = 'hasher.update(CryptoJS.enc.Utf8.parse(SIGN_SALT))\n  hasher.update(wordArrayFromBytes(bytes))\n  hasher.update(CryptoJS.enc.Utf8.parse(paramsString))'
    c.audioMatch = tamper(c.audioMatch, a, b)
    return c
  })(), '签名拼接顺序')

  check('R5 请求头改回 application/json', (() => {
    const c = clone()
    c.audioMatch = c.audioMatch.replace(/'Content-Type': 'application\/octet-stream'/, "'Content-Type': 'application/json'")
    return c
  })(), 'octet-stream')

  check('R6 结果不标 kg 音源', (() => {
    const c = clone()
    c.audioMatch = c.audioMatch.replace(/source:\s*'kg'/, "source: 'wy'")
    return c
  })(), 'kg 音源')

  check('R7 按钮移出搜索框（删掉渲染）', (() => {
    const c = clone()
    c.headerBar = c.headerBar.replace(/\s*\{\/\* 听歌识曲[\s\S]*?<RecognizeButton \/>/, '')
    return c
  })(), 'RecognizeButton')

  check('R8 录音后不释放音频会话', (() => {
    const c = clone()
    c.native = c.native.split('lxDeactivateRecognizeSession').join('lxNoopRecognizeSession')
    c.native = c.native.replace(/setActive:NO withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation/g, 'setActive:YES')
    return c
  })(), '音频会话')

  return results
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

const realReasons = invariants(real)
const model = modelChecks()
const ce = runCounterExamples()

console.log('=== sim-recognize-search ===\n')
console.log('[源码不变量]')
if (realReasons.length === 0) console.log('  PASS 听歌识曲链路（权限/采集/签名/请求/映射/UI）齐备')
else realReasons.forEach((r) => console.log('  FAIL ' + r))

console.log('\n[行为模型：二进制签名]')
model.forEach((r) => console.log(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? '   [' + r.detail + ']' : ''}`))

console.log('\n[反例自检]')
ce.forEach((r) => console.log(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.name} —— ${r.detail}`))

const failed = realReasons.length + model.filter((r) => !r.ok).length + ce.filter((r) => !r.ok).length
console.log(`\n结果：${failed ? `有 ${failed} 项失败` : 'ALL PASS'}（不变量 ${realReasons.length === 0 ? '1/1' : '有失败'}；行为模型 ${model.filter((r) => r.ok).length}/${model.length}；反例 ${ce.filter((r) => r.ok).length}/${ce.length}）`)
process.exit(failed ? 1 : 0)
