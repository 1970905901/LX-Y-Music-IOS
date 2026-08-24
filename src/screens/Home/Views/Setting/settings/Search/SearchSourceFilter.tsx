import { memo, useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import SubTitle from '../../components/SubTitle'
import CheckBox from '@/components/common/CheckBox'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'

const SOURCE_LIST = [
  { id: 'kw', i18nKey: 'source_kw' },
  { id: 'kg', i18nKey: 'source_kg' },
  { id: 'tx', i18nKey: 'source_tx' },
  { id: 'wy', i18nKey: 'source_wy' },
  { id: 'mg', i18nKey: 'source_mg' },
  { id: 'bilibili', i18nKey: 'source_bilibili' },
  { id: 'git', i18nKey: 'source_git' },
  { id: 'all', i18nKey: 'source_all' },
]

const Item = ({ id, name }: { id: string; name: string }) => {
  const enabledSources = useSettingValue('search.enabledSources')
  const isActive = useMemo(() => enabledSources[id] !== false, [enabledSources, id])
  return (
    <View style={styles.item}>
      <CheckBox
        marginRight={8}
        check={isActive}
        label={name}
        onChange={() => {
          const updated = { ...enabledSources, [id]: !isActive }
          updateSetting({ 'search.enabledSources': updated })
        }}
      />
    </View>
  )
}

export default memo(() => {
  const t = useI18n()
  const mid = Math.ceil(SOURCE_LIST.length / 2)
  const leftCol = SOURCE_LIST.slice(0, mid)
  const rightCol = SOURCE_LIST.slice(mid)

  return (
    <SubTitle title={t('setting_search_source_toggle')}>
      <View style={styles.grid}>
        <View style={styles.column}>
          {leftCol.map((s) => (
            <Item id={s.id} name={t(s.i18nKey as any)} key={s.id} />
          ))}
        </View>
        <View style={styles.column}>
          {rightCol.map((s) => (
            <Item id={s.id} name={t(s.i18nKey as any)} key={s.id} />
          ))}
        </View>
      </View>
    </SubTitle>
  )
})

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  column: {
    flex: 1,
  },
  item: {
    paddingVertical: 4,
  },
})
