declare namespace LX {
  namespace BaiduPan {
    interface DriveFile {
      fs_id: number
      path: string
      server_filename: string
      size?: number
      isdir?: 0 | 1
      server_mtime?: number
      server_ctime?: number
      local_mtime?: number
      local_ctime?: number
      md5?: string
    }

    interface DriveFolder {
      name: string
      path: string
    }

    interface MusicInfo extends LX.Music.MusicInfoLocal {
      meta: LX.Music.MusicInfoMeta_local & {
        baidupan: true
        fsId: number
        fileName: string
        size?: number
        lastModifiedTime: number
      }
    }
  }
}
