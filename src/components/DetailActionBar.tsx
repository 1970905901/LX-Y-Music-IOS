import { memo } from 'react'
import { View } from 'react-native'
import Button from '@/components/common/Button'
import Text from '@/components/common/Text'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'

/**
 * 详情类页面（歌手详情 / 专辑详情等）通用操作栏：播放全部 + 返回。
 * iPhone 上可依赖系统左滑手势返回，但 iPad 上该手势不可用，
 * 独立 push 的详情页必须提供显式返回入口，否则无法返回上一级。
 * 样式与歌单详情页（SonglistDetail/ActionBar）保持一致。
 */
export default memo(({ onPlayAll, onBack }: { onPlayAll: () => void, onBack: () => void }) => {
  const theme = useTheme()
  const t = useI18n()

  return (
    <View style={styles.container}>
      <Button onPress={onPlayAll} style={styles.controlBtn}>
        <Text style={{ ...styles.controlBtnText, color: theme['c-button-font'] }}>
          {t('play_all')}
        </Text>
      </Button>
      <Button onPress={onBack} style={styles.controlBtn}>
        <Text style={{ ...styles.controlBtnText, color: theme['c-button-font'] }}>{t('back')}</Text>
      </Button>
    </View>
  )
})

const styles = createStyle({
  container: {
    flexDirection: 'row',
    width: '100%',
    flexGrow: 0,
    flexShrink: 0,
  },
  controlBtn: {
    flexGrow: 1,
    flexShrink: 1,
    width: '50%',
    paddingTop: 12,
    paddingBottom: 12,
    paddingLeft: 10,
    paddingRight: 10,
  },
  controlBtnText: {
    fontSize: 13,
    textAlign: 'center',
  },
})
