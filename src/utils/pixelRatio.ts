/**
 * Created by qianxin on 17/6/1.
 * Screen utility class
 * UI design baseline, iPhone 6
 * width:375
 * height:667
 */
import { PixelRatio } from 'react-native'
import { windowSizeTools } from './windowSizeTools'

const designWidth = 375.0
const designHeight = 667.0

// scaleSizeW/H 的真实放大倍率是 scale / pixelRatio（这两个函数里还会再除一次 pixelRatio）。
const MAX_EFFECTIVE_SCALE = 1.2

let screenW = 0
let screenH = 0
let fontScale = PixelRatio.getFontScale()
let pixelRatio = PixelRatio.get()
let screenPxW = 0
let screenPxH = 0
let scale = 1

const recalc = () => {
  const size = windowSizeTools.getSize()
  screenW = size.width
  screenH = size.height
  if (screenW > screenH) {
    const temp = screenW
    screenW = screenH
    screenH = temp
  }
  fontScale = PixelRatio.getFontScale()
  pixelRatio = PixelRatio.get()
  screenPxW = PixelRatio.getPixelSizeForLayoutSize(screenW)
  screenPxH = PixelRatio.getPixelSizeForLayoutSize(screenH)

  const scaleW = screenPxW / designWidth
  const scaleH = screenPxH / designHeight
  // 手机（含 Pro Max）的有效倍率落在 1.0~1.11，本来就在上限内；而平板 pixelRatio 多为 2，
  // 仅用 3.1 这个物理倍率上限会算出约 1.55 倍，导致 iPad/平板上间距、图标、高度整体偏大。
  // 补一个有效倍率上限：手机完全不受影响，平板（含 iPad 原生大屏）尺寸回归合理。
  scale = Math.min(scaleW, scaleH, 3.1, MAX_EFFECTIVE_SCALE * pixelRatio)
}

windowSizeTools.onSizeChanged(() => recalc())
recalc()

/**
 * 设置text
 * @param size  px
 * @returns dp
 */
export function getTextSize(size: number) {
  // console.log('screenW======' + screenW)
  // console.log('screenPxW======' + screenPxW)
  let scaleWidth = screenW / designWidth
  let scaleHeight = screenH / designHeight
  // console.log(scaleWidth, scaleHeight)
  let scale = Math.min(scaleWidth, scaleHeight, 1.3)
  size = Math.floor((size * scale) / fontScale)
  // console.log(size)
  return size
}
export function setSpText(size: number) {
  return getTextSize(size) * global.lx.fontSize
}

/**
 * 设置高度
 * @param size  px
 * @returns dp
 */
export function scaleSizeH(size: number) {
  // console.log(screenPxH / designHeight)
  // let scaleHeight = size * Math.min(screenPxH / designHeight, 3.1)
  let scaleHeight = size * scale
  size = Math.floor(scaleHeight / pixelRatio)
  return size * global.lx.fontSize
}

/**
 * 设置宽度
 * @param size  px
 * @returns dp
 */
export function scaleSizeW(size: number) {
  // console.log(screenPxW / designWidth)
  // let scaleWidth = size * Math.min(screenPxW / designWidth, 3.1)
  let scaleWidth = size * scale
  size = Math.floor(scaleWidth / pixelRatio)
  return size * global.lx.fontSize
}

export const scaleSizeWR = (size: number) => {
  return size * 2 - scaleSizeW(size)
}

export const scaleSizeHR = (size: number) => {
  return size * 2 - scaleSizeH(size)
}

export const scaleSizeAbsHR = (size: number) => {
  let scaleHeight = size * scale
  return size * 2 - Math.floor(scaleHeight / pixelRatio)
}
