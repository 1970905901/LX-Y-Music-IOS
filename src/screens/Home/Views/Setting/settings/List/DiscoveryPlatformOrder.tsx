import { memo, useCallback, useMemo } from 'react'
import { Pressable, View } from 'react-native'

import SubTitle from '../../components/SubTitle'
import Text from '@/components/common/Text'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import { createStyle } from '@/utils/tools'
import { designRadius, designSpacing } from '@/theme/DesignTokens'
import songlistState, { type Source } from '@/store/songlist/state'
import { getDiscoveryPlatformOrder } from '@/config/constant'

export default memo(() => {
  const t = useI18n()
  const theme = useTheme()
  const sourceNameType = useSettingValue('common.sourceNameType')
  const platformOrder = useSettingValue('common.discoveryPlatformOrder')

  // 与推荐页同一数据源：只有支持歌单/榜单的平台才会出现在推荐页按钮里
  const supportedSources = useMemo(
    () => songlistState.sources.filter(
      (source): source is Source => !!songlistState.sortList[source]?.length,
    ),
    [],
  )
  const orderedSources = useMemo(
    () => getDiscoveryPlatformOrder(supportedSources, platformOrder),
    [supportedSources, platformOrder],
  )
  // 平台文案与推荐页一致（source_${sourceNameType}_${source}）
  const sourceLabel = useCallback(
    (source: string) => t(`source_${sourceNameType}_${source}`),
    [sourceNameType, t],
  )

  const moveSource = useCallback((from: number, to: number) => {
    if (to < 0 || to >= orderedSources.length) return
    const next = [...orderedSources]
    next.splice(to, 0, ...next.splice(from, 1))
    updateSetting({ 'common.discoveryPlatformOrder': next })
  }, [orderedSources])

  return (
    <SubTitle title={t('setting_list_discovery_platform_order')}>
      <Text style={styles.tip} size={12} color={theme['c-font-label']}>
        {t('setting_list_discovery_platform_order_tip')}
      </Text>
      <View style={{ ...styles.content, borderColor: theme['c-border-background'] }}>
        {orderedSources.map((source, index) => {
          const isLast = index === orderedSources.length - 1
          return (
            <View key={source} style={styles.row}>
              <View
                style={[
                  styles.badge,
                  { backgroundColor: index === 0 ? theme['c-primary'] : theme['c-primary-background'] },
                ]}
              >
                <Text
                  size={12}
                  color={index === 0 ? theme['c-primary-light-1000'] : theme['c-font-label']}
                >
                  {index + 1}
                </Text>
              </View>
              <View style={styles.labelRow}>
                <Text style={styles.label} size={15} color={theme['c-font']} numberOfLines={1}>
                  {sourceLabel(source)}
                </Text>
                {index === 0 ? (
                  <Text size={11} color={theme['c-primary']}>
                    {t('setting_list_discovery_platform_order_default_badge')}
                  </Text>
                ) : null}
              </View>
              <Pressable
                hitSlop={6}
                style={[styles.actionBtn, { borderColor: theme['c-border-background'] }, index === 0 ? styles.actionDisabled : null]}
                disabled={index === 0}
                onPress={() => { moveSource(index, index - 1) }}
                accessibilityRole="button"
                accessibilityLabel={t('setting_list_discovery_platform_order_up')}
              >
                <Text size={14} color={index === 0 ? theme['c-350'] : theme['c-font']}>↑</Text>
              </Pressable>
              <Pressable
                hitSlop={6}
                style={[styles.actionBtn, { borderColor: theme['c-border-background'] }, isLast ? styles.actionDisabled : null]}
                disabled={isLast}
                onPress={() => { moveSource(index, index + 1) }}
                accessibilityRole="button"
                accessibilityLabel={t('setting_list_discovery_platform_order_down')}
              >
                <Text size={14} color={isLast ? theme['c-350'] : theme['c-font']}>↓</Text>
              </Pressable>
            </View>
          )
        })}
      </View>
    </SubTitle>
  )
})

const styles = createStyle({
  tip: {
    marginBottom: designSpacing.sm,
  },
  content: {
    borderWidth: 1,
    borderRadius: designRadius.sm,
    padding: designSpacing.sm,
    gap: designSpacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: designSpacing.sm,
  },
  badge: {
    minWidth: 26,
    height: 26,
    borderRadius: designRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  labelRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: designSpacing.xs,
  },
  label: {
    flexShrink: 1,
    fontWeight: '600',
  },
  actionBtn: {
    width: 30,
    height: 30,
    borderRadius: designRadius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionDisabled: {
    opacity: 0.4,
  },
})
