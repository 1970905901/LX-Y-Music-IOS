import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Animated,
  TouchableOpacity,
  View,
} from 'react-native'
import { type Lines } from 'lrc-file-parser'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import { createStyle } from '@/utils/tools'
import { formatPlayTime2 } from '@/utils'
import { useTheme } from '@/store/theme/hook'
import { BorderWidths } from '@/theme'

export interface PlayLineType {
  updateScrollInfo: (
    scrollInfo: NativeSyntheticEvent<NativeScrollEvent>['nativeEvent'] | null
  ) => void
  updateLayoutInfo: (listLayoutInfo: {
    spaceHeight: number
    lineHeights: number[]
  }) => void
  updateLyricLines: (lyricLines: Lines) => void
  setVisible: (visible: boolean) => void
}

interface PlayLineProps {
  onPlayLine: (time: number) => void
}

const ANIMATION_DURATION = 300

export default forwardRef<PlayLineType, PlayLineProps>(({ onPlayLine }, ref) => {
  const theme = useTheme()
  const [scrollInfo, setScrollInfo] = useState<
    NativeSyntheticEvent<NativeScrollEvent>['nativeEvent'] | null
  >(null)
  const [listLayoutInfo, setListLayoutInfo] = useState<{
    spaceHeight: number
    lineHeights: number[]
  }>({ spaceHeight: 0, lineHeights: [] })
  const [lyricLines, setLyricLines] = useState<Lines>([])
  const [visible, setVisible] = useState(false)
  const opacity = useRef(new Animated.Value(0)).current

  const setShow = (nextVisible: boolean) => {
    Animated.timing(opacity, {
      toValue: nextVisible ? 1 : 0,
      duration: ANIMATION_DURATION,
      useNativeDriver: true,
    }).start(() => {
      if (!nextVisible) setVisible(false)
    })
  }

  useImperativeHandle(ref, () => ({
    updateScrollInfo: (nextScrollInfo) => setScrollInfo(nextScrollInfo),
    updateLayoutInfo: (nextLayoutInfo) => setListLayoutInfo(nextLayoutInfo),
    updateLyricLines: (nextLyricLines) => setLyricLines(nextLyricLines),
    setVisible: (nextVisible) => {
      if (nextVisible) setVisible(true)
      requestAnimationFrame(() => setShow(nextVisible))
    },
  }))

  if (!scrollInfo || !visible) return null
  const targetOffset =
    scrollInfo.contentOffset.y + scrollInfo.layoutMeasurement.height * 0.4
  let lineOffset = listLayoutInfo.spaceHeight
  let targetLineNum = -1
  for (let line = 0; line < listLayoutInfo.lineHeights.length; line++) {
    lineOffset += listLayoutInfo.lineHeights[line]
    if (lineOffset < targetOffset) continue
    targetLineNum = line
    break
  }
  if (targetLineNum == -1) {
    targetLineNum = listLayoutInfo.lineHeights.length - 1
  }
  const time = lyricLines[targetLineNum]?.time ?? 0

  const handlePlayLine = () => {
    if (targetLineNum < 0) return
    onPlayLine(time / 1000)
  }

  return (
    <Animated.View style={{ ...styles.playLine, opacity }}>
      <Text style={styles.label} color={theme['c-primary-font']} size={13}>
        {formatPlayTime2(time / 1000)}
      </Text>
      <View style={styles.lineContent}>
        <View
          style={{
            ...styles.line,
            borderBottomColor: theme['c-primary-alpha-700'],
          }}
        />
        <TouchableOpacity style={styles.button} onPress={handlePlayLine}>
          <Icon name="play" color={theme['c-button-font']} size={18} />
        </TouchableOpacity>
      </View>
    </Animated.View>
  )
})

const styles = createStyle({
  playLine: {
    position: 'absolute',
    width: '100%',
    top: '40%',
    left: 0,
    height: 2,
  },
  label: {
    position: 'absolute',
    right: 45,
    bottom: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  lineContent: {
    position: 'absolute',
    width: '100%',
    height: 20,
    top: -10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  line: {
    marginLeft: 30,
    borderBottomWidth: BorderWidths.normal2,
    borderStyle: 'dashed',
    flex: 1,
  },
  button: {
    flex: 0,
    paddingLeft: 5,
    paddingRight: 15,
  },
})
