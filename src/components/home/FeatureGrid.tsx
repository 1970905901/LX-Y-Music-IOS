import { memo, useMemo } from 'react'
import { Pressable, View } from 'react-native'

import { NAV_MENUS, type NAV_ID_Type } from '@/config/constant'
import { confirmDialog, createStyle, exitApp as backHome } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import { useI18n } from '@/lang'
import { useHorizontalMode } from '@/utils/hooks'
import { exitApp, setNavActiveId } from '@/core/common'
import { designRadius, designSpacing, designTypography } from '@/theme/DesignTokens'
import { Icon } from '@/components/common/Icon'
import { SvgIcon } from '@/components/common/SvgIcon'
import Text from '@/components/common/Text'

type FeatureId = NAV_ID_Type | 'back_home' | 'nav_exit'

interface FeatureItem {
  id: FeatureId
  icon: string
}

const TAB_IDS = new Set<NAV_ID_Type>([
  'nav_discovery',
  'nav_songlist',
  'nav_search',
  'nav_love',
  'nav_setting',
])

// 三大平台每日推荐已并入推荐页顶部的「每日推荐」卡片（跟随平台切换 + Cookie 登录校验），
// 更多功能网格里不再单独展示。
const DAILY_REC_IDS = new Set<NAV_ID_Type>([
  'nav_daily_rec',
  'nav_kg_daily_rec',
  'nav_tx_daily_rec',
])

// 播放历史在推荐页右上角已有时钟入口，更多功能网格不再重复展示。
const HISTORY_IDS = new Set<NAV_ID_Type>([
  'nav_play_history',
])

const renderIcon = (icon: string, color: string) => {
  if (icon.startsWith('svg:')) {
    return <SvgIcon name={icon.slice(4)} size={21} color={color} />
  }
  return <Icon name={icon} size={21} color={color} />
}

const FeatureGrid = memo(() => {
  const theme = useTheme()
  const t = useI18n()
  const navStatus = useSettingValue('common.navStatus')
  const isHorizontal = useHorizontalMode()
  const showBackBtn = useSettingValue('common.showBackBtn')
  const showExitBtn = useSettingValue('common.showExitBtn')

  const features = useMemo(
    () => {
      const items: FeatureItem[] = NAV_MENUS.filter(
        menu => !TAB_IDS.has(menu.id) && !DAILY_REC_IDS.has(menu.id) && !HISTORY_IDS.has(menu.id) && (navStatus[menu.id] ?? true),
      ).map(({ id, icon }) => ({ id, icon }))

      if (!global.lx.isCarMode) return items
      if (showBackBtn) items.push({ id: 'back_home', icon: 'home' })
      if (showExitBtn) items.push({ id: 'nav_exit', icon: 'exit2' })
      return items
    },
    [navStatus, showBackBtn, showExitBtn],
  )

  const rows = useMemo(() => {
    const size = isHorizontal ? 6 : 3
    return features.reduce<Array<typeof features>>((result, item, index) => {
      if (index % size === 0) result.push([])
      result[result.length - 1].push(item)
      return result
    }, [])
  }, [features, isHorizontal])

  const cardStyle = useMemo(
    () => ({
      backgroundColor: theme['c-primary-light-900-alpha-200'],
      borderColor: theme['c-border-background'],
    }),
    [theme],
  )

  return (
    <View style={styles.container}>
      <Text
        style={styles.title}
        size={designTypography.title}
        color={theme['c-font']}
      >
        {t('discovery_features_title')}
      </Text>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.row}>
          {row.map(item => (
            <Pressable
              key={item.id}
              style={[styles.card, cardStyle]}
              onPress={() => {
                if (item.id === 'back_home') {
                  backHome()
                  return
                }
                if (item.id === 'nav_exit') {
                  void confirmDialog({
                    message: global.i18n.t('exit_app_tip'),
                    confirmButtonText: global.i18n.t('list_remove_tip_button'),
                  }).then((isExit) => {
                    if (!isExit) return
                    exitApp('Feature Grid')
                  })
                  return
                }
                setNavActiveId(item.id)
              }}
            >
              {renderIcon(item.icon, theme['c-primary'])}
              <Text
                style={styles.label}
                size={designTypography.caption}
                color={theme['c-font']}
                numberOfLines={1}
              >
                {t(item.id)}
              </Text>
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  )
})

const styles = createStyle({
  container: {
    marginTop: designSpacing.lg,
    paddingHorizontal: designSpacing.lg,
  },
  title: {
    fontWeight: '800',
    marginBottom: designSpacing.sm,
  },
  row: {
    flexDirection: 'row',
    marginBottom: designSpacing.sm,
  },
  card: {
    flex: 1,
    minHeight: 78,
    marginRight: designSpacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: designRadius.lg,
    borderWidth: 1,
    paddingHorizontal: designSpacing.xs,
  },
  label: {
    marginTop: designSpacing.xs,
    textAlign: 'center',
    fontWeight: '600',
  },
})

FeatureGrid.displayName = 'HomeFeatureGrid'
export default FeatureGrid
