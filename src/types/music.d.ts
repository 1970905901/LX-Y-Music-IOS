declare namespace LX {
  namespace Music {
    interface MusicQualityType {
      // {"type": "128k", size: "3.56M"}
      type: LX.Quality
      size: string | null
    }
    interface MusicQualityTypeKg {
      // {"type": "128k", size: "3.56M"}
      type: LX.Quality
      size: string | null
      hash: string
    }
    type _MusicQualityType = Partial<
      Record<
        Quality,
        {
          size: string | null
        }
      >
    >
    type _MusicQualityTypeKg = Partial<
      Record<
        Quality,
        {
          size: string | null
          hash: string
        }
      >
    >

    interface MusicInfoMetaBase {
      songId: string | number
      albumName: string
      picUrl?: string | null
      toggleMusicInfo?: MusicInfoOnline | null
      fileName?: string
      filePath?: string
      _qualitys?: _MusicQualityType
    }

    interface MusicInfoMeta_online extends MusicInfoMetaBase {
      fee?: number
      qualitys: MusicQualityType[]
      _qualitys: _MusicQualityType
      albumId?: string | number
      originCoverType?: number
      noCopyrightRcmd?: {
        songId?: string | number
        id?: string | number
        type?: number
        typeDesc?: string
      } | null
      _full?: boolean
      mv?: number
    }

    interface MusicInfoMeta_local extends MusicInfoMetaBase {
      filePath: string
      ext: string
    }

    interface MusicInfoBase<S = LX.Source> {
      id: string
      name: string
      alias?: string
      singer: string
      artists?: Array<{ id: string | number; name: string }>
      source: S
      interval: string | null
      releaseDate?: string | null
      // 运行时各 sdk 返回的 MusicInfo 为扁平结构，以下字段在 meta 与顶层均可能存在
      albumId?: string | number
      albumName?: string
      albumMid?: string
      mixSongId?: string
      songmid?: string
      pic?: string
      _types?: Record<string, { size?: string | null }>
      meta: MusicInfoMetaBase
    }

    interface MusicInfoLocal extends MusicInfoBase<'local'> {
      meta: MusicInfoMeta_local
    }

    interface MusicInfo_online_common extends MusicInfoBase<'kw' | 'wy' | 'git'> {
      meta: MusicInfoMeta_online
    }

    interface MusicInfo_bilibili extends MusicInfoBase<'bilibili'> {
      meta: MusicInfoMeta_online
    }

    interface MusicInfoMeta_kg extends MusicInfoMeta_online {
      qualitys: MusicQualityTypeKg[]
      _qualitys: _MusicQualityTypeKg
      hash: string
      mixSongId?: string
    }
    interface MusicInfo_kg extends MusicInfoBase<'kg'> {
      meta: MusicInfoMeta_kg
    }

    interface MusicInfoMeta_tx extends MusicInfoMeta_online {
      strMediaMid: string
      songmid?: string
      id?: number
      albumMid?: string
      vid?: string
    }
    interface MusicInfo_tx extends MusicInfoBase<'tx'> {
      meta: MusicInfoMeta_tx
    }

    interface MusicInfoMeta_mg extends MusicInfoMeta_online {
      copyrightId: string
      lrcUrl?: string
      mrcUrl?: string
      trcUrl?: string
    }
    interface MusicInfo_mg extends MusicInfoBase<'mg'> {
      meta: MusicInfoMeta_mg
    }

    type MusicInfoOnline = MusicInfo_online_common | MusicInfo_kg | MusicInfo_tx | MusicInfo_mg | MusicInfo_bilibili
    type MusicInfo = MusicInfoOnline | MusicInfoLocal

    interface LyricInfo {
      lyric: string
      tlyric?: string | null
      rlyric?: string | null
      lxlyric?: string | null
    }

    interface LyricInfoSave {
      id: string
      lyrics: LyricInfo
    }

    interface MusicUrlInfo {
      id: string
      url: string
    }

    interface MusicInfoOtherSourceSave {
      id: string
      list: MusicInfoOnline[]
    }
  }
}
