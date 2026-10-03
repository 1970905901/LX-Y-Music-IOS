/**
 * sim-cover-download.js
 *
 * 「封面长按菜单 / 下载封面 / 保存图片」契约（2026-10-03）。
 *
 * 用户现象：播放详情页长按封面 → 点「下载封面」无效；横屏封面更是完全没有入口。
 *
 * 根因（静默失败，tsc/eslint 完全无感）：
 *   ① iOS 兼容层 `src/utils/rnFetchBlob.ts` 的 `config({path}).fetch('GET', url)` 是**占位实现**
 *      —— 不请求网络、不落盘，却正常 resolve。于是调用方以为下载成功、接着 toast「已保存」。
 *   ② 保存目标选的是 App 沙盒里的 Pictures 目录：相册与「文件」App 里都看不到，等于无效。
 *   ③ 菜单逻辑内联在竖屏 Pic 里，横屏 Pic 没有入口（两份必然漂移）。
 *
 * 修法：
 *   - shim 走真实下载（项目已有 `@/utils/fs` 的 downloadFile；file:// 走 copyFile）；
 *   - 封面/图片统一写入**系统相册**：原生 `PHPhotoLibrary`（仅新增权限，
 *     Info.plist 的 `NSPhotoLibraryAddUsageDescription`；缺这条会直接崩溃）；
 *   - 菜单抽成唯一实现 `PlayDetail/components/CoverLongPressMenu.tsx`，竖屏/横屏都接它。
 *
 * 运行：node scripts/sim-cover-download.js
 * 退出码：不变量全过、且全部反例被拦下时为 0，否则 1。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const FILES = {
  shim: 'src/utils/rnFetchBlob.ts',
  delegate: 'ios/LxMusicMobile/AppDelegate.mm',
  plist: 'ios/LxMusicMobile/Info.plist',
  utils: 'src/utils/nativeModules/utils.ts',
  coverMenu: 'src/screens/PlayDetail/components/CoverLongPressMenu.tsx',
  verticalPic: 'src/screens/PlayDetail/Vertical/Pic.tsx',
  horizontalPic: 'src/screens/PlayDetail/Horizontal/Pic.tsx',
  image: 'src/utils/image.ts',
}
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')

const REAL = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, read(p)]))

const invariants = (files) => {
  const reasons = []

  // ① shim 必须是真实下载，且不能再出现「占位实现」
  if (/真实下载由调用方通过 react-native-fs 完成/.test(files.shim) ||
      /base64: async\(\) => Promise\.resolve\(''\)/.test(files.shim)) {
    reasons.push('rnFetchBlob shim 仍是占位实现（不下载却 resolve = 静默失败）')
  }
  if (!/async fetch\(_method: string, url: string\): Promise<FetchResult> \{/.test(files.shim)) {
    reasons.push('rnFetchBlob shim 的 fetch 未使用 url（旧占位实现把 url 命名为 _url）')
  }
  if (!/fsDownloadFile\(url, target, \{ headers: opts\.headers \}\)/.test(files.shim)) {
    reasons.push('rnFetchBlob shim 的 http(s) 分支未走项目下载器 downloadFile')
  }
  if (!/fsCopyFile\(source, target\)/.test(files.shim)) {
    reasons.push('rnFetchBlob shim 缺 file:// 本地复制分支（本地封面会失败）')
  }
  if (!/await fsUnlink\(target\)\.catch\(\(\) => \{\}\)/.test(files.shim)) {
    reasons.push('rnFetchBlob shim 下载前未清理已存在目标文件（moveItemAtURL 会失败）')
  }

  // ② 原生：Photos 框架 + 保存到相册方法
  if (!/#import <Photos\/Photos\.h>/.test(files.delegate)) {
    reasons.push('AppDelegate 未导入 Photos 框架')
  }
  if (!/RCT_EXPORT_METHOD\(saveImageToPhotosLibrary:\(NSString \*\)path/.test(files.delegate)) {
    reasons.push('AppDelegate 缺 saveImageToPhotosLibrary 原生方法')
  }
  if (!/PHAssetChangeRequest creationRequestForAssetFromImage:/.test(files.delegate)) {
    reasons.push('原生保存未走 PHAssetChangeRequest（写不进相册）')
  }
  if (!/reject\(@"image_not_found"/.test(files.delegate)) {
    reasons.push('原生保存缺「图片读取失败」reject 分支（失败会被吞成成功）')
  }

  // ③ Info.plist：仅新增权限文案（缺失 = 首次保存直接崩溃）
  if (!/NSPhotoLibraryAddUsageDescription/.test(files.plist)) {
    reasons.push('Info.plist 缺 NSPhotoLibraryAddUsageDescription（保存到相册会崩）')
  }

  // ④ JS 包装导出
  if (!/export const saveImageToPhotosLibrary = async\(imagePath: string\): Promise<boolean>/.test(files.utils)) {
    reasons.push('nativeModules/utils.ts 未导出 saveImageToPhotosLibrary 包装')
  }

  // ⑤ 唯一实现：长按菜单本体（下载歌曲 / 下载封面）
  if (!/TouchableWithoutFeedback onLongPress=\{handleLongPress\}/.test(files.coverMenu)) {
    reasons.push('CoverLongPressMenu 未挂 onLongPress（长按不触发）')
  }
  if (!/\{ action: 'download_song', label: '下载歌曲' \}/.test(files.coverMenu) ||
      !/\{ action: 'download_pic', label: '下载封面' \}/.test(files.coverMenu)) {
    reasons.push('CoverLongPressMenu 菜单项缺失（下载歌曲 / 下载封面）')
  }
  if (!/await saveImageToPhotosLibrary\(tempPath\)/.test(files.coverMenu)) {
    reasons.push('下载封面未写入系统相册（仍是沙盒，用户看不到）')
  }
  if (!/toast\('封面已保存到相册'/.test(files.coverMenu)) {
    reasons.push('下载封面未提示「已保存到相册」')
  }
  if (!/picUrl \|\|= coverUrl/.test(files.coverMenu)) {
    reasons.push('下载封面缺当前封面兜底（本地歌曲取不到在线 URL 时会失败）')
  }
  if (/PictureDir|downloadDir/.test(files.coverMenu)) {
    reasons.push('下载封面仍写沙盒 Pictures 目录')
  }

  // ⑥ 两侧封面都必须挂这套菜单（横屏曾整块缺失）
  if (!/import CoverLongPressMenu from '\.\.\/components\/CoverLongPressMenu'/.test(files.verticalPic) ||
      !/<CoverLongPressMenu[\s\S]{0,300}?musicInfo=\{menuMusicInfo\}/.test(files.verticalPic)) {
    reasons.push('竖屏 Pic 未接入 CoverLongPressMenu')
  }
  if (!/import CoverLongPressMenu from '\.\.\/components\/CoverLongPressMenu'/.test(files.horizontalPic) ||
      !/<CoverLongPressMenu[\s\S]{0,300}?musicInfo=\{/.test(files.horizontalPic)) {
    reasons.push('横屏 Pic 未接入 CoverLongPressMenu（横屏封面没有下载入口）')
  }

  // ⑦ 通用「保存图片」同源修复：同样写相册
  if (!/await saveImageToPhotosLibrary\(tempPath\)/.test(files.image)) {
    reasons.push('utils/image.ts 的 saveImageToPictures 未写入系统相册')
  }

  return reasons
}

const tamper = (src, find, replace) => {
  if (!src.includes(find)) throw new Error(`tamper 锚点未命中: ${find}`)
  return src.split(find).join(replace)
}

const counterExamples = () => {
  const results = []
  const check = (name, mutated, expectSubstr) => {
    let reasons = []
    try {
      reasons = invariants({ ...REAL, ...mutated })
    } catch (e) {
      results.push({ name, ok: false, detail: `抛异常: ${e.message}` })
      return
    }
    const hit = reasons.some((r) => r.includes(expectSubstr))
    results.push({ name, ok: hit, detail: hit ? '已拦下' : `未拦下（reasons=${JSON.stringify(reasons)}）` })
  }

  check('R1 shim 退回占位实现', {
    shim: tamper(REAL.shim, 'if (/^https?:/i.test(url)) {', '// 占位实现\n    if (false) {')
      .replace('const { promise } = fsDownloadFile(url, target, { headers: opts.headers })', 'const { promise } = { promise: Promise.resolve({ statusCode: 200 }) }'),
  }, '未走项目下载器')

  check('R2 下载封面回到写沙盒', {
    coverMenu: tamper(REAL.coverMenu, 'await saveImageToPhotosLibrary(tempPath)', '// removed'),
  }, '未写入系统相册')

  check('R3 去掉 Info.plist 仅新增权限文案', {
    plist: tamper(REAL.plist, 'NSPhotoLibraryAddUsageDescription', 'NSPhotoLibraryFooUsageDescription'),
  }, '缺 NSPhotoLibraryAddUsageDescription')

  check('R4 原生不再导入 Photos 框架', {
    delegate: tamper(REAL.delegate, '#import <Photos/Photos.h>', '// no photos'),
  }, '未导入 Photos 框架')

  check('R5 通用保存图片回到沙盒路径', {
    image: tamper(REAL.image, 'await saveImageToPhotosLibrary(tempPath)', '// removed'),
  }, 'saveImageToPictures 未写入系统相册')

  check('R6 横屏封面去掉长按菜单', {
    horizontalPic: tamper(REAL.horizontalPic, 'import CoverLongPressMenu from \'../components/CoverLongPressMenu\'', '// removed'),
  }, '横屏 Pic 未接入 CoverLongPressMenu')

  check('R7 长按菜单不再触发', {
    coverMenu: tamper(REAL.coverMenu, 'TouchableWithoutFeedback onLongPress={handleLongPress}', 'TouchableWithoutFeedback'),
  }, '未挂 onLongPress')

  return results
}

const realReasons = invariants(REAL)
const counterResults = counterExamples()
const missed = counterResults.filter((r) => !r.ok)

for (const r of counterResults) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  反例：${r.name} —— ${r.detail}`)
}
console.log()

if (realReasons.length) {
  console.error(`FAIL  封面下载契约不变量未通过（${realReasons.length} 项）：`)
  for (const r of realReasons) console.error(`        - ${r}`)
}
if (missed.length) {
  console.error(`FAIL  反例未被拦下（${missed.length} 项，断言无区分力）`)
}
if (!realReasons.length && !missed.length) {
  console.log('PASS  封面长按菜单/下载封面契约全部通过（7 组不变量 + 7 例反例）')
  process.exit(0)
}
process.exit(1)
