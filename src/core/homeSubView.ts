import { type ListInfoItem } from '@/store/songlist/state'
import { getViewSubView, saveViewSubView } from '@/utils/data'

/**
 * Home 内嵌「分界面」的记忆与恢复（目前只有歌单详情）。
 *
 * 需求：退出软件后再次进入，应继续显示退出前的界面——在推荐页打开了酷狗音乐、
 * 或在歌单页打开了某张歌单，下次进入要直接回到那张歌单；而停留在搜索 / 我的 / 设置
 * 时只恢复 Tab 主界面，不恢复里面的分界面。
 *
 * 实现：只有推荐（nav_discovery）与歌单（nav_songlist）两个 Tab 会调用
 * rememberHomeSubView 写入；启动时对应页面用 takeRestorableSubView(自己的 navId)
 * 取回——navId 不匹配就返回 null，所以其它 Tab 天然不会被恢复。
 */

/** 记住当前打开的分界面（歌单详情）。navId 默认取当前导航 id */
export const rememberHomeSubView = (info: ListInfoItem, navId?: string) => {
  saveViewSubView({ navId: navId ?? 'nav_discovery', info: info as unknown as Record<string, any> })
}

/** 关闭分界面时清掉记忆，避免下次进入又弹出来 */
export const clearHomeSubView = () => {
  saveViewSubView(null)
}

/** 取出属于该 navId 的分界面（不匹配或读取失败返回 null） */
export const takeRestorableSubView = async(navId: string): Promise<ListInfoItem | null> => {
  try {
    const sub = await getViewSubView()
    if (!sub?.info || sub.navId !== navId) return null
    return sub.info as unknown as ListInfoItem
  } catch {
    return null
  }
}
