/**
 * musicSdk 类型声明（对应 src/utils/musicSdk/index.js）
 *
 * index.js 为纯 JS，TS 无法精确推断其结构（各平台模块 kw/kg/tx/wy/mg/bilibili/git/qs
 * 与 sources 元数据、supportQuality 混杂在同一个对象上），导致 musicSdk[source].musicSearch
 * 等动态访问被误报为「属性不存在」。这里显式声明：
 * - 静态元数据字段 sources / supportQuality 保持精确类型；
 * - 动态平台模块访问（musicSdk[source]）兜底为 any，由调用方保证字段存在。
 */

declare const musicSdk: {
  sources: Array<{ name: string; id: string }>
  supportQuality: Record<string, any>
  [source: string]: any
}

export default musicSdk

export const init: () => Promise<unknown[]>

export const searchMusic: (opts: {
  name: string
  singer?: string
  source?: string
  limit?: number
}) => Promise<any[]>

export const findMusic: (musicInfo: any) => Promise<any[]>
