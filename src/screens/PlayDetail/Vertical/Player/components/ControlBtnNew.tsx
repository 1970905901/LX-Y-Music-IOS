import { TouchableOpacity, View } from 'react-native'
import { Icon } from '@/components/common/Icon'
import { playNext, playPrev, togglePlay } from '@/core/player/player'
import { useIsPlay } from '@/store/player/hook'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'
import { useWindowSize } from '@/utils/hooks'
import { useMemo } from 'react'
import { SvgIcon } from '@/components/common/SvgIcon'
import { scaleSizeW } from '@/utils/pixelRatio'
import { usePlayModeToggle } from '@/screens/PlayDetail/components/usePlayModeToggle'
import { useI18n } from '@/lang'

const ControlBtnNew = () => {
  const theme = useTheme()
  const winSize = useWindowSize()
  const isPlay = useIsPlay()
  const t = useI18n()
  const iconColor = theme.isDark ? theme['c-font'] : theme['c-primary']

  const { toggleNextPlayMode, playModeIcon } = usePlayModeToggle()

  const { size, extraBtnSize, paddingV } = useMemo(() => {
    const containerWidth = winSize.width
    const maxPlayBtn = containerWidth * 0.18
    const minPlayBtn = scaleSizeW(36)
    const mainBtn = Math.min(Math.max(maxPlayBtn, minPlayBtn), scaleSizeW(72))
    const sideBtn = Math.round(mainBtn * 0.6)
    const pV = Math.round(winSize.height * 0.025)
    return { size: mainBtn, extraBtnSize: sideBtn, paddingV: Math.max(pV, 12) }
  }, [winSize.width, winSize.height])

  const iconSize = Math.round(size * 0.45)
  const sideIconSize = Math.round(extraBtnSize * 0.55)

  const handleShowPlaylist = () => {
    global.app_event.emit('showPlaylist')
  }

  return (
    <View style={[styles.newContainer, { paddingVertical: paddingV }]}>
      {/* 可访问性（2026-10 审计）：纯图标按钮必须自带可朗读名称，否则 VoiceOver
          只能报「按钮」。文案复用现有词条，图标层不再单独可聚焦。 */}
      <TouchableOpacity
        style={[styles.controlBtn, { width: extraBtnSize, height: extraBtnSize }]}
        activeOpacity={0.5}
        onPress={toggleNextPlayMode}
        accessibilityRole="button"
        accessibilityLabel={t('play_list_loop')}
      >
        {playModeIcon?.startsWith('svg:') ? (
          <SvgIcon name={playModeIcon.slice(4)} rawSize={sideIconSize} color={iconColor} />
        ) : (
          <Icon name={playModeIcon} color={iconColor} rawSize={sideIconSize} />
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.controlBtn, { width: size, height: size }]}
        activeOpacity={0.5}
        onPress={() => { void playPrev() }}
        accessibilityRole="button"
        accessibilityLabel={t('play_prev')}
      >
        <Icon name="prevMusic" color={iconColor} rawSize={iconSize} />
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.controlBtn, { width: size, height: size }]}
        activeOpacity={0.5}
        onPress={togglePlay}
        accessibilityRole="button"
        accessibilityLabel={isPlay ? t('pause') : t('play')}
      >
        <Icon name={isPlay ? 'pause' : 'play'} color={iconColor} rawSize={iconSize} />
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.controlBtn, { width: size, height: size }]}
        activeOpacity={0.5}
        onPress={() => { void playNext() }}
        accessibilityRole="button"
        accessibilityLabel={t('play_next')}
      >
        <Icon name="nextMusic" color={iconColor} rawSize={iconSize} />
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.controlBtn, { width: extraBtnSize, height: extraBtnSize }]}
        activeOpacity={0.5}
        onPress={handleShowPlaylist}
        accessibilityRole="button"
        accessibilityLabel={t('list_name_play')}
      >
        <Icon name="menu" color={iconColor} rawSize={sideIconSize} />
      </TouchableOpacity>
    </View>
  )
}

export default ControlBtnNew

const styles = createStyle({
  controlBtn: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  newContainer: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
    flexGrow: 1,
    flexShrink: 1,
    paddingHorizontal: '3%',
  },
})
