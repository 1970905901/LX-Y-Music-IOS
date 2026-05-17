import { version } from '../../../package.json'

export interface ProgressInfo {
  total: number
  current: number
}

export interface VersionInfo {
  version: string
  desc: string
  history?: LX.VersionInfo[]
}

export interface InitState {
  showModal: boolean
  versionInfo: {
    version: string
    newVersion: VersionInfo | null
    showModal: boolean
    isUnknown: boolean
    isLatest: boolean
    reCheck: boolean
    status: LX.UpdateStatus
  }
  ignoreVersion: string | null
  progress: ProgressInfo
}

const state: InitState = {
  showModal: false,
  versionInfo: {
    version,
    newVersion: {
      version,
      desc: '',
      history: [],
    },
    showModal: false,
    reCheck: false,
    isUnknown: false,
    isLatest: true,
    status: 'idle',
  },
  ignoreVersion: null,
  progress: {
    total: 0,
    current: 0,
  },
}


export default state
