import { downloadNewVersion, isInternalUpdateSupported, openReleasePage } from '@/utils/version'
import versionActions from '@/store/version/action'
import versionState, { type InitState } from '@/store/version/state'
import { saveIgnoreVersion } from '@/utils/data'
import { showVersionModal } from '@/navigation'
import { Navigation } from 'react-native-navigation'

export const showModal = () => {
  if (versionState.showModal) return
  versionActions.setVisibleModal(true)
  showVersionModal()
}

export const hideModal = (componentId: string) => {
  if (!versionState.showModal) return
  versionActions.setVisibleModal(false)
  void Navigation.dismissOverlay(componentId)
}

export const checkUpdate = async() => {
  const version = versionState.versionInfo.version
  versionActions.setVersionInfo({
    status: 'idle',
    isLatest: true,
    isUnknown: false,
    newVersion: {
      version,
      desc: '',
      history: [],
    },
  })
}

export const downloadUpdate = () => {
  if (!isInternalUpdateSupported) {
    void openReleasePage(versionState.versionInfo.newVersion?.version)
    return
  }
  versionActions.setVersionInfo({ status: 'downloading' })
  versionActions.setProgress({ total: 0, current: 0 })

  downloadNewVersion(versionState.versionInfo.newVersion!.version, (total: number, current: number) => {
    // console.log(total, current)
    versionActions.setProgress({ total, current })
  }).then(() => {
    versionActions.setVersionInfo({ status: 'downloaded' })
  }).catch(() => {
    versionActions.setVersionInfo({ status: 'error' })
    // console.log(err)
  })
}


export const setIgnoreVersion = (version: InitState['ignoreVersion']) => {
  versionActions.setIgnoreVersion(version)
  saveIgnoreVersion(version)
}
