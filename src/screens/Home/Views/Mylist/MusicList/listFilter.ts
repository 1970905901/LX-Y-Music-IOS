/**
 * listFilter.ts
 *
 * 「我的收藏 / 自建列表」**就地搜索**的匹配函数。
 *
 * 背景（2026-10-03）：这两处的搜索一度被整体删除（旧链路：页头放大镜 → 独立输入条
 * 盖住页头 → 结果另开一个浮层列表 → 点结果再把原列表滚到那首歌），用户反馈
 * 「太割裂」，要求重做。重做的核心是：**搜索不再是另一个界面，而是当前列表自己**——
 * 输入关键字 → 过滤同一个 FlatList 的数据源 → 清空即还原。
 *
 * 与旧 `listAction.searchListMusic` 的两点本质区别（也是本文件存在的理由）：
 * 1. **不重排**：返回结果保持原列表顺序。旧实现把结果按「命中字段 + 相似度」重排成
 *    一份新数组，行号与播放序号都跟着变；就地过滤必须保持原顺序，行号（index + 1）、
 *    播放态高亮、`playList(listId, index)` 才仍然指向原列表里的同一首歌。
 * 2. **不做第二份结果列表**：调用方直接把它当 FlatList 的 data 用，别再叠一层 UI。
 *
 * 匹配规则沿用旧实现里用户已经习惯的宽松度（大小写不敏感）：
 *   ① 歌名 / 歌手 / 专辑名 直接包含关键字 → 命中；
 *   ② 关键字按顺序逐字出现在「歌名 + 歌手 + 专辑名」里（旧实现的「模糊」档，
 *      例如打乱序的简写也能命中）→ 命中。
 *
 * 纯函数、无依赖，便于被 scripts/sim-mylist-search-inplace.js 复刻验证。
 */

/** 关键字是否按顺序逐字出现在目标串里（模糊档；text 已小写） */
const isOrderedMatch = (text: string, target: string) => {
  if (!text) return true
  let ti = 0
  for (let i = 0; i < target.length && ti < text.length; i++) {
    if (target[i] === text[ti]) ti++
  }
  return ti === text.length
}

/**
 * 过滤歌曲列表。关键字为空（或只有空白）时**原样返回入参数组**——
 * 调用方据此判断「非过滤态」（引用相等即未过滤），避免白建一份数组触发列表重算。
 */
export const filterListMusic = (
  list: LX.Music.MusicInfo[],
  keyword: string,
): LX.Music.MusicInfo[] => {
  const text = keyword.trim().toLowerCase()
  if (!text) return list
  return list.filter((info) => {
    // 汽水(qs) 等音源构造出来的歌曲可能不带 meta（见 ListItem 的同类兜底），
    // 这里全部按「可能缺失」取，避免一行数据异常把整次搜索打断。
    const name = String(info.name ?? '').toLowerCase()
    const singer = String(info.singer ?? '').toLowerCase()
    const albumName = String(
      (info.meta as { albumName?: string } | undefined)?.albumName ?? '',
    ).toLowerCase()
    if (name.includes(text) || singer.includes(text) || albumName.includes(text)) return true
    return isOrderedMatch(text, name + singer + albumName)
  })
}
