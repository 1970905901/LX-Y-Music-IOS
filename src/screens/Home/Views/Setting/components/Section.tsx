import { useCallback, useState, useEffect, useRef, useMemo } from 'react'
import { View, TouchableOpacity, Animated } from 'react-native'

import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import settingAction from '@/store/setting/action'
import Text from '@/components/common/Text'
import { scaleSizeH } from '@/utils/pixelRatio'
import { SvgIcon } from '@/components/common/SvgIcon'

interface Props {
  title: string
  children: React.ReactNode | React.ReactNode[]
  sectionId: keyof LX.AppSetting['common.sectionExpandedStatus']
}

const adjustColorOpacity = (color: string, opacity: number) => {
  const rgbaMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/)
  if (rgbaMatch) {
    const r = parseInt(rgbaMatch[1])
    const g = parseInt(rgbaMatch[2])
    const b = parseInt(rgbaMatch[3])
    return `rgba(${r}, ${g}, ${b}, ${opacity / 100})`
  }
  
  const rgbMatch = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1])
    const g = parseInt(rgbMatch[2])
    const b = parseInt(rgbMatch[3])
    return `rgba(${r}, ${g}, ${b}, ${opacity / 100})`
  }
  
  const hexMatch = color.match(/#([0-9a-fA-F]{6})/)
  if (hexMatch) {
    const r = parseInt(hexMatch[1].slice(0, 2), 16)
    const g = parseInt(hexMatch[1].slice(2, 4), 16)
    const b = parseInt(hexMatch[1].slice(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${opacity / 100})`
  }
  
  const hexMatch3 = color.match(/#([0-9a-fA-F]{3})/)
  if (hexMatch3) {
    const r = parseInt(hexMatch3[1][0] + hexMatch3[1][0], 16)
    const g = parseInt(hexMatch3[1][1] + hexMatch3[1][1], 16)
    const b = parseInt(hexMatch3[1][2] + hexMatch3[1][2], 16)
    return `rgba(${r}, ${g}, ${b}, ${opacity / 100})`
  }
  
  return color
}

export default ({ title, children, sectionId }: Props) => {
  const theme = useTheme()
  const sectionOpacity = useSettingValue('theme.sectionOpacity')
  const expandedStatus = useSettingValue('common.sectionExpandedStatus')
  
  const initialExpanded = expandedStatus[sectionId] ?? true
  
  const rotateAnimRef = useRef(new Animated.Value(initialExpanded ? 0 : 1))
  const rotateInterpolate = useMemo(() => 
    rotateAnimRef.current.interpolate({
      inputRange: [0, 1],
      outputRange: ['0deg', '180deg'],
    }),
  []
  )
  
  const isInitializedRef = useRef(false)
  
  const [expanded, setExpanded] = useState(initialExpanded)
  
  useEffect(() => {
    if (isInitializedRef.current) return
    isInitializedRef.current = true
    const storedValue = expandedStatus[sectionId] ?? true
    if (storedValue !== expanded) {
      setExpanded(storedValue)
    }
  }, [])

  useEffect(() => {
    Animated.spring(rotateAnimRef.current, {
      toValue: expanded ? 0 : 1,
      useNativeDriver: true,
      friction: 7,
      tension: 40,
    }).start()
  }, [expanded])

  const toggleExpanded = useCallback(() => {
    const newExpanded = !expanded
    setExpanded(newExpanded)
    const newStatus = { ...expandedStatus, [sectionId]: newExpanded }
    settingAction.updateSetting({ 'common.sectionExpandedStatus': newStatus })
  }, [expandedStatus, sectionId, expanded])

  return (
    <View style={styles.container}>
      <View style={{ ...styles.contentContainer, backgroundColor: adjustColorOpacity(theme['c-main-background'], sectionOpacity) }}>
        <TouchableOpacity style={styles.titleContainer} onPress={toggleExpanded} activeOpacity={0.7}>
          <Text style={{ ...styles.title, borderLeftColor: theme['c-primary'] }} size={16}>
            {title}
          </Text>
          <View style={styles.iconContainer}>
            <Animated.View style={{ transform: [{ rotate: rotateInterpolate }] }}>
              <SvgIcon 
                name="collapse" 
                size={18} 
                color={theme['c-font-label']} 
              />
            </Animated.View>
          </View>
        </TouchableOpacity>
        {expanded ? <View>{children}</View> : null}
      </View>
    </View>
  )
}

const styles = createStyle({
  container: {
    marginBottom: scaleSizeH(12),
  },
  contentContainer: {
    borderRadius: scaleSizeH(16),
    paddingHorizontal: scaleSizeH(12),
    paddingVertical: scaleSizeH(14),
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.6)',
    shadowColor: 'rgba(0, 0, 0, 0.15)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  titleContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  title: {
    borderLeftWidth: 5,
    paddingLeft: 12,
    fontWeight: '600',
    flex: 1,
  },
  iconContainer: {
    paddingHorizontal: 8,
  },
})