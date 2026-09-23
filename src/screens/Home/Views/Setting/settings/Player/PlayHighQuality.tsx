import { memo, useMemo } from 'react'

import { StyleSheet, View } from 'react-native'

import SubTitle from '../../components/SubTitle'
import CheckBox from '@/components/common/CheckBox'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import { QUALITY_RANK } from '@/core/music/utils'
import { getQualityName } from '@/utils/quality'

const useActive = (id: LX.Quality) => {
  const q = useSettingValue('player.playQuality')
  const isActive = useMemo(() => q == id, [q, id])
  return isActive
}

const Item = ({ id, name }: { id: LX.Quality; name: string }) => {
  const isActive = useActive(id)
  return (
    <CheckBox
      marginRight={8}
      check={isActive}
      label={name}
      onChange={() => {
        updateSetting({ 'player.playQuality': id })
      }}
      need
    />
  )
}

export default memo(() => {
  const t = useI18n()
  const playQualityList = useMemo(() => {
    return [...QUALITY_RANK] as LX.Quality[]
  }, [])

  return (
    <SubTitle title={t('setting_play_play_quality')}>
      <View style={styles.list}>
        {playQualityList.map((q) => (
          <Item name={getQualityName(q, t)} id={q} key={q} />
        ))}
      </View>
    </SubTitle>
  )
})

const styles = StyleSheet.create({
  list: {
    flexDirection: 'column',
    flexWrap: 'wrap',
  },
})
