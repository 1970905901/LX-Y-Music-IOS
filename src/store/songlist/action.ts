import type { TagInfo, ListDetailInfo, ListInfo, Source } from './state'
import state from './state'

// 本地分页大小：界面按 30 条/页翻页，而源接口的分页大小（result.limit）各平台不一。
// maxPage 必须用本地页单位计算，否则部分平台的歌单会提前判定"没有更多"，
// 列表被截断。
export const LIST_LOAD_LIMIT = 30

export default {
  setTags(tagInfo: TagInfo, source: LX.OnlineSource) {
    state.tags[source] = tagInfo
  },
  setListInfo(source: Source, tagId: string, sortId: string) {
    state.listInfo.source = source
    state.listInfo.tagId = tagId
    state.listInfo.sortId = sortId
  },
  setList(result: ListInfo, tagId: string, sortId: string, page: number) {
    state.listInfo.list = page == 1 ? [...result.list] : [...state.listInfo.list, ...result.list]
    if (page == 1 || (result.total && result.list.length)) state.listInfo.total = result.total
    else state.listInfo.total = result.limit * page
    state.listInfo.limit = result.limit
    state.listInfo.page = page
    state.listInfo.source = result.source
    state.listInfo.tagId = tagId
    state.listInfo.sortId = sortId
    state.listInfo.maxPage = Math.ceil(state.listInfo.total / LIST_LOAD_LIMIT)

    return state.listInfo
  },
  clearList() {
    state.listInfo.list = []
    state.listInfo.total = 0
    state.listInfo.page = 1
    state.listInfo.key = ''
    state.listInfo.maxPage = 1
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
    state.listDetailInfo.info = { ...result.info }
    state.listDetailInfo.maxPage = Math.ceil(state.listDetailInfo.total / LIST_LOAD_LIMIT)

    return state.listDetailInfo
  },
  clearListDetail() {
    state.listDetailInfo.list = []
    state.listDetailInfo.id = ''
    state.listDetailInfo.source = 'kw'
    state.listDetailInfo.total = 0
    state.listDetailInfo.limit = 30
    state.listDetailInfo.page = 1
    state.listDetailInfo.key = null
    state.listDetailInfo.info = {}
    state.listDetailInfo.maxPage = 1
  },
}
