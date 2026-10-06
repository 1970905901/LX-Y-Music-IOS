import { View } from 'react-native'
import { usePlayerMusicInfo } from '@/store/player/hook'
import { useSettingValue } from '@/store/setting/hook'
import Text from '@/components/common/Text'
import { createStyle, formatMusicName } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'

export default () => {
  const musicInfo = usePlayerMusicInfo()
  const downloadFileName = useSettingValue('download.fileName')
  const theme = useTheme()

  const title = musicInfo.id
    ? musicInfo.singer
      ? formatMusicName(downloadFileName, musicInfo.name, musicInfo.singer)
      : musicInfo.name
    : ''

  return (
    <View style={styles.container}>
      <Text color={theme['c-font']} numberOfLines={1} style={{ fontWeight: '700' }}>
        {title}
      </Text>
    </View>
  )
}

const styles = createStyle({
  container: {
    width: '100%',
    paddingHorizontal: 2,
    // paddingBottom: 4,
    // height: '50%',
    // backgroundColor: 'rgba(0, 0, 0, .1)',
  },
})
