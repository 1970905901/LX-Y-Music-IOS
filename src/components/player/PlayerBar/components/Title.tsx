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
      {/* 迷你播放器文字颜色随明暗模式变化：浅色模式黑色，深色模式白色 */}
      <Text color={theme.isDark ? '#ffffff' : '#000000'} numberOfLines={1} style={{ fontWeight: '700' }}>
        {title}
      </Text>
    </View>
  )
}
// const Singer = () => {
//   const playMusicInfo = useGetter('player', 'playMusicInfo')
//   return (
//     <View style={{ flexGrow: 0, flexShrink: 0 }}>
//       <Text style={{ width: '100%', color: AppColors.normal }} numberOfLines={1}>
//         {playMusicInfo ? playMusicInfo.musicInfo.singer : ''}
//       </Text>
//     </View>
//   )
// }
// const MusicName = () => {
//   const playMusicInfo = useGetter('player', 'playMusicInfo')
//   return (
//     <View style={{ flexGrow: 0, flexShrink: 1 }}>
//       <Text style={{ width: '100%', color: AppColors.normal }} numberOfLines={1}>
//         {playMusicInfo ? playMusicInfo.musicInfo.name : '^-^'}
//       </Text>
//     </View>
//   )
// }

const styles = createStyle({
  container: {
    width: '100%',
    paddingHorizontal: 2,
    // paddingBottom: 4,
    // height: '50%',
    // backgroundColor: 'rgba(0, 0, 0, .1)',
  },
})
