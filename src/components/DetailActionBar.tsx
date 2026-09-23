import { memo } from 'react'
import { StyleSheet, View } from 'react-native'
import Button from '@/components/common/Button'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { designRadius, designSpacing } from '@/theme/DesignTokens'

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
      <Button
        onPress={onPlayAll}
        style={StyleSheet.compose(styles.controlBtn, {
          flexGrow: 1.45,
          backgroundColor: theme['c-primary'],
        })}
      >
        <View style={styles.primaryContent}>
          <Icon name="play" size={15} color={theme['c-primary-light-1000']} />
          <Text style={{ ...styles.controlBtnText, color: theme['c-primary-light-1000'] }}>
            {t('play_all')}
          </Text>
        </View>
      </Button>
      <Button
        onPress={onBack}
        style={StyleSheet.compose(styles.controlBtn, {
          backgroundColor: theme['c-primary-background'],
        })}
      >
        <Text style={{ ...styles.controlBtnText, color: theme['c-primary-font'] }}>
          {t('back')}
        </Text>
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
    paddingHorizontal: designSpacing.md,
    gap: designSpacing.sm,
    paddingBottom: designSpacing.md,
  },
  controlBtn: {
    flexGrow: 1,
    flexShrink: 1,
    height: 44,
    borderRadius: designRadius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  controlBtnText: {
    marginLeft: 6,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
})
