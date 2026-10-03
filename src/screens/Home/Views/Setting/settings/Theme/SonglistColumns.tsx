import { memo } from 'react'
import SubTitle from '../../components/SubTitle'
import CheckBoxItem from '../../components/CheckBoxItem'
import Text from '@/components/common/Text'
import { createStyle } from '@/utils/tools'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import { designSpacing } from '@/theme/DesignTokens'

/**
 * 「歌单封面列数」：歌单页封面网格 2 个一排 / 3 个一排。
 *
 * 历史：宽屏手机（Plus / Pro Max / 16 Pro）按宽度公式会算出 3 列，封面缩到约 115pt、
 * 两行标题被截断，用户反馈后一度把手机竖屏上限钉成 2 列（5f3ffa0）。现在把 2 / 3
 * 交给用户在这里选（默认 2，保持当时的观感）。
 *
 * 只作用于**手机竖屏**：iPad 与大屏（可用宽 ≥ 600pt）仍按可用宽度自适应多列，
 * 大屏固定 2~3 列会浪费横向空间。设置项写在默认设置 `theme.songlistColumns`，
 * 消费点：`SongList/components/Songlist/List.tsx`（歌单页 + 搜索页的歌单结果共用）。
 */
export default memo(() => {
  const t = useI18n()
  const theme = useTheme()
  const columns = useSettingValue('theme.songlistColumns') ?? 2

  return (
    <SubTitle title={t('setting_basic_theme_songlist_columns')}>
      <Text style={styles.tip} size={12} color={theme['c-font-label']}>
        {t('setting_basic_theme_songlist_columns_desc')}
      </Text>
      <CheckBoxItem
        check={columns === 2}
        label={t('setting_basic_theme_songlist_columns_2')}
        onChange={() => { updateSetting({ 'theme.songlistColumns': 2 }) }}
      />
      <CheckBoxItem
        check={columns === 3}
        label={t('setting_basic_theme_songlist_columns_3')}
        onChange={() => { updateSetting({ 'theme.songlistColumns': 3 }) }}
      />
    </SubTitle>
  )
})

const styles = createStyle({
  tip: {
    marginBottom: designSpacing.sm,
  },
})
