declare namespace LX {
  namespace WebDAV {
    interface DriveFolder {
      id: string
      name: string
      parentId?: string
      path?: string
    }

    interface DriveFile {
      id: string
      name: string
      size?: number
      lastModified?: number
    }

    interface Config {
      selectedFolder?: DriveFolder | null
      songs: MusicInfo[]
      scannedAt?: number
      filterPath?: string | null
    }

    interface MusicInfo extends LX.Music.MusicInfoLocal {
      meta: LX.Music.MusicInfoMeta_local & {
        webdav: true
        filePath: string
        remotePath?: string
        fileName: string
        ext: string
        size?: number
        lastModifiedTime: number
      }
    }
  }
}
