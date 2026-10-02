export type SearchType = 'music' | 'songlist' | 'singer' | 'album'

export interface InitState {
  temp_source: 'kw'
  // temp_source: LX.OnlineSource
  searchType: SearchType
  searchText: string
  historyList: string[]
}

const state: InitState = {
  temp_source: 'kw',
  searchType: 'music',
  searchText: '',
  historyList: [],
}

export default state
