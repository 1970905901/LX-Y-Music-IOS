import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import { memo } from 'react'
import { View } from 'react-native'
import { useSettingValue } from '@/store/setting/hook'

import CheckBoxItem from '../../components/CheckBoxItem'
import { applyBluetoothLyricSetting } from '@/core/init/player/lyric'

/**
 * 显示蓝牙歌词。
 *
 * 开：把当前歌词行推送到系统媒体信息（MPNowPlayingInfoCenter 的 artist 字段），
 * 控制中心 / 锁屏 / 车机 / 蓝牙音箱读的都是同一份系统媒体信息，故一处开关同时
 * 覆盖「车机歌词」与「音箱歌词」。
 * 关：媒体信息只显示「歌名 · 歌手」，不推送歌词行。
 *
 * 设置值落库后立即调用 applyBluetoothLyricSetting 让开关当场生效（不必等下一首），
 * 该函数会同时对齐 JS 逐行通路与原生歌词时间轴（两条独立通路，见其文档注释）。
 */
export default memo(() => {
  const t = useI18n()
  const isShowBluetoothLyric = useSettingValue('player.isShowBluetoothLyric')
  const setShowBluetoothLyric = (isShowBluetoothLyric: boolean) => {
    updateSetting({ 'player.isShowBluetoothLyric': isShowBluetoothLyric })
    applyBluetoothLyricSetting()
  }

  return (
    <View style={styles.content}>
      <CheckBoxItem
        check={isShowBluetoothLyric}
        onChange={setShowBluetoothLyric}
        label={t('setting_play_show_bluetooth_lyric')}
      />
    </View>
  )
})

const styles = createStyle({
  content: {
    marginTop: 5,
  },
})
