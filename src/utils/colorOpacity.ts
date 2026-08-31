/**
 * 在已有颜色值上叠加透明度（0-100），返回带 alpha 的颜色。
 * 主题色多为 rgb()/rgba() 字符串（如 'rgb(255,255,255)'），直接拼接十六进制
 * alpha 会得到无效颜色，因此这里做格式解析后再合成。
 */
export const applyOpacity = (color: string, opacity: number): string => {
  const ratio = Math.min(Math.max(opacity, 0), 100) / 100

  const rgbaMatch = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/)
  if (rgbaMatch) {
    const baseAlpha = rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1
    return `rgba(${rgbaMatch[1]}, ${rgbaMatch[2]}, ${rgbaMatch[3]}, ${(baseAlpha * ratio).toFixed(2)})`
  }

  if (color.startsWith('#')) {
    let hex = color.slice(1)
    if (hex.length === 3 || hex.length === 4) {
      hex = hex.split('').map(c => c + c).join('')
    }
    const baseAlpha = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
    const alphaHex = Math.round(baseAlpha * ratio * 255).toString(16).padStart(2, '0')
    return `#${hex.slice(0, 6)}${alphaHex}`
  }

  return color
}
