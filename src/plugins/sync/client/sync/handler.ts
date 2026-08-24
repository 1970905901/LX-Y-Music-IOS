import { featureVersion } from '../modules'

const handler: Omit<LX.Sync.ClientSyncHandlerActions<LX.Sync.Socket>, 'finished'> = {
  async getEnabledFeatures(socket, serverType, supportedFeatures) {
    const features: LX.Sync.EnabledFeatures = {}
    switch (serverType) {
      case 'server':
        if (featureVersion.list == supportedFeatures.list) {
          features.list = { skipSnapshot: false }
        }
        if (featureVersion.dislike == supportedFeatures.dislike) {
          features.dislike = { skipSnapshot: false }
        }
        return features
      case 'desktop-app':
      default:
        if (featureVersion.list == supportedFeatures.list) {
          features.list = { skipSnapshot: false }
        }
        if (featureVersion.dislike == supportedFeatures.dislike) {
          features.dislike = { skipSnapshot: false }
        }
        return features
    }
  },
}

export default handler
