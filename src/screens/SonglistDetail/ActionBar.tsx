import { memo } from 'react'
import { StyleSheet, View } from 'react-native'
import Button from '@/components/common/Button'

import { createStyle, toast } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import { designRadius, designSpacing } from '@/theme/DesignTokens'
import { handleCollect, handlePlay } from './listAction'
import songlistState from '@/store/songlist/state'
import { useI18n } from '@/lang'
import { useListInfo } from './state'

export default memo(({ onBack }: { onBack?: () => void }) => {
  const theme = useTheme()
  const t = useI18n()
  const info = useListInfo()

  const handlePlayAll = () => {
    if (!songlistState.listDetailInfo.list.length) {
      toast('歌单加载失败，请返回重试')
      return
    }
    void handlePlay(info.id, info.source, songlistState.listDetailInfo.list)
  }

  const handleCollection = () => {
    const name = songlistState.listDetailInfo.info?.name || info.name || '未命名歌单'
    void handleCollect(info.id, info.source, name)
  }

  return (
    <View style={styles.container}>
      <Button
        onPress={handlePlayAll}
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
        onPress={handleCollection}
        style={StyleSheet.compose(styles.controlBtn, {
          backgroundColor: theme['c-primary-background'],
        })}
      >
        <Text style={{ ...styles.controlBtnText, color: theme['c-primary-font'] }}>
          {t('collect_songlist')}
        </Text>
      </Button>
      <Button
        onPress={onBack}
        style={StyleSheet.compose(styles.controlBtn, {
          backgroundColor: theme['c-button-background'],
        })}
      >
        <Text style={{ ...styles.controlBtnText, color: theme['c-primary-font'] }}>{t('back')}</Text>
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
    marginTop: designSpacing.sm,
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
