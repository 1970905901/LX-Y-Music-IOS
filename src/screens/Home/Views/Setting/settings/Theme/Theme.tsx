import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { View, TouchableOpacity, type ImageSourcePropType } from 'react-native'
import { setTheme } from '@/core/theme'
import { useI18n } from '@/lang'
import { useSettingValue } from '@/store/setting/hook'
import { useTheme } from '@/store/theme/hook'

import SubTitle from '../../components/SubTitle'
import { BG_IMAGES, getAllThemes, type LocalTheme } from '@/theme/themes'
import Text from '@/components/common/Text'
import { createStyle } from '@/utils/tools'
import { scaleSizeH } from '@/utils/pixelRatio'
import { designRadius, designSpacing, designTypography } from '@/theme/DesignTokens'
import { Icon } from '@/components/common/Icon'
import ImageBackground from '@/components/common/ImageBackground'

const useActive = (id: string) => {
  const activeThemeId = useSettingValue('theme.id')
  const isActive = useMemo(() => activeThemeId == id, [activeThemeId, id])
  return isActive
}

const ThemeItem = ({
  id,
  name,
  color,
  image,
  setTheme,
  showAll,
}: {
  id: string
  name: string
  color: string
  showAll: boolean
  image?: ImageSourcePropType
  setTheme: (id: string) => void
}) => {
  const theme = useTheme()
  const isActive = useActive(id)

  return showAll || isActive ? (
    <TouchableOpacity
      style={{ ...styles.item, width: scaleSizeH(ITEM_HEIGHT) }}
      activeOpacity={0.5}
      onPress={() => {
        setTheme(id)
      }}
    >
      <View
        style={{
          ...styles.colorContent,
          width: scaleSizeH(COLOR_ITEM_HEIGHT),
          borderColor: isActive ? color : 'transparent',
        }}
      >
        {image ? (
          <ImageBackground
            style={{
              ...styles.imageContent,
              width: scaleSizeH(IMAGE_HEIGHT),
              backgroundColor: color,
            }}
            imageStyle={{ borderRadius: designRadius.pill }}
            source={image}
          />
        ) : (
          <View
            style={{
              ...styles.imageContent,
              width: scaleSizeH(IMAGE_HEIGHT),
              backgroundColor: color,
            }}
          ></View>
        )}
      </View>
      <Text
        style={styles.name}
        size={designTypography.caption}
        color={isActive ? color : theme['c-font']}
        numberOfLines={1}
      >
        {name}
      </Text>
    </TouchableOpacity>
  ) : null
}

const MoreBtn = ({
  showAll,
  setShowAll,
}: {
  showAll: boolean
  setShowAll: (showAll: boolean) => void
}) => {
  const theme = useTheme()
  const t = useI18n()

  return showAll ? null : (
    <TouchableOpacity
      style={{ ...styles.moreBtn, backgroundColor: theme['c-primary-background-active'] }}
      activeOpacity={0.5}
      onPress={() => {
        setShowAll(!showAll)
      }}
    >
      <Text size={designTypography.caption} color={theme['c-primary-font']} numberOfLines={1}>
        {t('setting_basic_theme_more_btn_show')}
      </Text>
      <Icon name="chevron-right" size={12} color={theme['c-primary-font']} />
    </TouchableOpacity>
  )
}

interface ThemeInfo {
  themes: Readonly<LocalTheme[]>
  userThemes: LX.Theme[]
  dataPath: string
}
const initInfo: ThemeInfo = { themes: [], userThemes: [], dataPath: '' }
export default memo(() => {
  const [showAll, setShowAll] = useState(false)
  const t = useI18n()
  const [themeInfo, setThemeInfo] = useState(initInfo)
  const setThemeId = useCallback((id: string) => {
    requestAnimationFrame(() => {
      setTheme(id)
    })
  }, [])

  useEffect(() => {
    void getAllThemes().then(setThemeInfo)
  }, [])

  return (
    <SubTitle title={t('setting_basic_theme')}>
      <View style={styles.list}>
        {themeInfo.themes.map(({ id, config }) => {
          return (
            <ThemeItem
              key={id}
              color={config.themeColors['c-theme']}
              image={config.extInfo['bg-image'] ? BG_IMAGES[config.extInfo['bg-image']] : undefined}
              showAll={showAll}
              id={id}
              name={t(`theme_${id}`)}
              setTheme={setThemeId}
            />
          )
        })}
        {themeInfo.userThemes.map(({ id, name, config }) => {
          return (
            <ThemeItem
              key={id}
              color={config.themeColors['c-theme']}
              // image={undefined}
              showAll={showAll}
              id={id}
              name={name}
              setTheme={setThemeId}
            />
          )
        })}
        <MoreBtn showAll={showAll} setShowAll={setShowAll} />
      </View>
    </SubTitle>
  )
})

const ITEM_HEIGHT = 64
const COLOR_ITEM_HEIGHT = 38
const IMAGE_HEIGHT = 30
const styles = createStyle({
  list: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: designSpacing.sm,
    marginTop: designSpacing.xs,
  },
  item: {
    // marginRight: 15,
    alignItems: 'center',
    // marginTop: 5,
    // backgroundColor: 'rgba(0,0,0,0.2)',
  },
  colorContent: {
    height: COLOR_ITEM_HEIGHT,
    borderRadius: designRadius.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    // backgroundColor: 'rgba(0,0,0,0.2)',
  },
  imageContent: {
    height: IMAGE_HEIGHT,
    borderRadius: designRadius.pill,
    // elevation: 1,
  },
  name: {
    marginTop: 4,
  },
  moreBtn: {
    height: 32,
    marginLeft: designSpacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: designSpacing.sm,
    gap: 6,
    borderRadius: designRadius.pill,
  },
})
