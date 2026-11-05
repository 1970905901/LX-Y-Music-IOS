import { TouchableOpacity } from 'react-native'
import { Icon } from '@/components/common/Icon'
import { useIsPlay } from '@/store/player/hook'
import { useTheme } from '@/store/theme/hook'
import { playNext, playPrev, togglePlay } from '@/core/player/player'
import { createStyle } from '@/utils/tools'
import { useHorizontalMode } from '@/utils/hooks'
import { useI18n } from '@/lang'

const BTN_SIZE = 24
const handlePlayPrev = () => {
  void playPrev()
}
const handlePlayNext = () => {
  void playNext()
}

// 可访问性（2026-10 审计）：这些按钮只有字体图标，VoiceOver 读不出任何名称，
// 用户只能盲点。补 accessibilityRole / accessibilityLabel，并把图标层设为
// 不可访问，避免「图标字形 + 按钮标签」被重复朗读。
// 文案复用现有词条（play_prev / play_next / play / pause），不新增翻译。

const PlayPrevBtn = () => {
  const theme = useTheme()
  const t = useI18n()

  return (
    <TouchableOpacity
      style={styles.cotrolBtn}
      activeOpacity={0.5}
      onPress={handlePlayPrev}
      accessibilityRole="button"
      accessibilityLabel={t('play_prev')}
    >
      <Icon name="prevMusic" color={theme['c-font']} size={BTN_SIZE} />
    </TouchableOpacity>
  )
}

const PlayNextBtn = () => {
  const theme = useTheme()
  const t = useI18n()

  return (
    <TouchableOpacity
      style={styles.cotrolBtn}
      activeOpacity={0.5}
      onPress={handlePlayNext}
      accessibilityRole="button"
      accessibilityLabel={t('play_next')}
    >
      <Icon name="nextMusic" color={theme['c-font']} size={BTN_SIZE} />
    </TouchableOpacity>
  )
}

const TogglePlayBtn = () => {
  const isPlay = useIsPlay()
  const theme = useTheme()
  const t = useI18n()

  return (
    <TouchableOpacity
      style={{ ...styles.cotrolBtn, ...styles.playButton, backgroundColor: theme['c-primary'] }}
      activeOpacity={0.5}
      onPress={togglePlay}
      accessibilityRole="button"
      // 标签随播放态变化：VoiceOver 用户听到的就是「按下去会发生什么」
      accessibilityLabel={isPlay ? t('pause') : t('play')}
    >
      <Icon
        name={isPlay ? 'pause' : 'play'}
        color={theme['c-primary-light-1000']}
        size={18}
      />
    </TouchableOpacity>
  )
}

export default () => {
  const isHorizontalMode = useHorizontalMode()
  return (
    <>
      {/* <TouchableOpacity activeOpacity={0.5} onPress={toggleNextPlayMode}>
        <Text style={{ ...styles.cotrolBtn }}>
          <Icon name={playModeIcon} style={{ color: theme.secondary10 }} size={18} />
        </Text>
      </TouchableOpacity>
    */}
      {/* {btnPrev} */}
      {isHorizontalMode ? <PlayPrevBtn /> : null}
      <TogglePlayBtn />
      <PlayNextBtn />
    </>
  )
}

const styles = createStyle({
  cotrolBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButton: {
    borderRadius: 999,
    // 播放/暂停与下一首的 40×40 热区留出空隙防误触；播放列表按钮移除后右侧
    // 空间变宽，间距放宽到 8（图标视觉间距 = 8 + 两侧热区留白 16 = 24pt）
    marginRight: 8,
  },
})
