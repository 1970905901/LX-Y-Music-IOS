import state, { type Source, type Board, type ListDetailInfo } from './state'

// 本地分页大小：界面按 30 条/页翻页，而源接口的分页大小（result.limit）各平台不一
// （如网易 100）。maxPage 必须用本地页单位计算，否则部分平台的榜单会提前判定
// "没有更多"，列表被截断（如 200 首只显示 60 首）。
export const LIST_LOAD_LIMIT = 30

export default {
  setBoard(board: Board, source: LX.OnlineSource) {
    state.boards[source] = board
  },
  setListDetailInfo(source: Source, id: string) {
    state.listDetailInfo.source = source
    state.listDetailInfo.id = id
  },
  setListDetail(result: ListDetailInfo, id: string, page: number) {
    state.listDetailInfo.list =
      page == 1 ? [...result.list] : [...state.listDetailInfo.list, ...result.list]
    state.listDetailInfo.id = id
    state.listDetailInfo.source = result.source
    if (page == 1 || (result.total && result.list.length)) state.listDetailInfo.total = result.total
    else state.listDetailInfo.total = result.limit * page
    state.listDetailInfo.limit = result.limit
    state.listDetailInfo.page = page
    // 用本地页单位（30 条/页）计算总页数：page/maxPage 均为本地页码，
    // 与源接口的 result.limit（分页大小各平台不一）无关。
    state.listDetailInfo.maxPage = Math.ceil(state.listDetailInfo.total / LIST_LOAD_LIMIT)

    return state.listDetailInfo
  },
  clearListDetail() {
    state.listDetailInfo.list = []
    state.listDetailInfo.id = ''
    state.listDetailInfo.source = null
    state.listDetailInfo.total = 0
    state.listDetailInfo.limit = 30
    state.listDetailInfo.page = 1
    state.listDetailInfo.maxPage = 1
    state.listDetailInfo.key = null
  },
}
