declare namespace LX {
  namespace ConfigFile {
    interface MyListInfoPart {
      type: 'playListPart_v2'
      data: LX.List.MyDefaultListInfoFull | LX.List.MyLoveListInfoFull | LX.List.UserListInfoFull
    }
    interface AllDataV3 {
      type: 'allData_v3'
      data: {
        lists: LX.List.ListDataFull
        playHistory: LX.Player.PlayHistoryItem[]
        downloadTasks: LX.Download.DownloadTask[]
        settings: Partial<LX.AppSetting>
        userApis: {
          list: LX.UserApi.UserApiInfo[]
          scripts: Record<string, string>
        }
      }
    }
  }
}
