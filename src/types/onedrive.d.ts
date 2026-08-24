declare namespace LX {
  namespace OneDrive {
    interface AccountInfo {
      id: string
      displayName?: string
      userPrincipalName?: string
      mail?: string
    }

    interface AuthInfo {
      clientId: string
      accessToken: string
      refreshToken: string
      expiresAt: number
      account?: AccountInfo
    }

    interface PendingAuth {
      clientId: string
      codeVerifier: string
      state: string
      createdAt: number
    }

    interface DeviceCodeInfo {
      clientId: string
      deviceCode: string
      userCode: string
      verificationUri: string
      verificationUriComplete?: string
      message?: string
      expiresAt: number
      interval: number
    }

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
      webUrl?: string
      downloadUrl?: string
      '@microsoft.graph.downloadUrl'?: string
      lastModifiedDateTime?: string
      thumbnails?: Array<{
        medium?: {
          url?: string
        }
        small?: {
          url?: string
        }
        large?: {
          url?: string
        }
      }>
    }

    interface Config {
      selectedFolder?: DriveFolder | null
      songs: MusicInfo[]
      scannedAt?: number
    }

    interface MusicInfo extends LX.Music.MusicInfoLocal {
      meta: LX.Music.MusicInfoMeta_local & {
        oneDrive: true
        itemId: string
        driveId?: string
        fileName: string
        size?: number
        webUrl?: string
        downloadUrl?: string
        lastModifiedTime: number
      }
    }
  }
}
