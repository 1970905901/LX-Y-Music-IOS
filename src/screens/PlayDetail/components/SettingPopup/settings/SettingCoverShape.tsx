import { View } from 'react-native'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import CheckBox from '@/components/common/CheckBox'
import styles from './style'

/**
 * 方形封面开关（2026-09-30 新增）。
 *
 * 语义：开 = 方形封面 **且不旋转**；关 = 圆形封面（是否旋转由「封面旋转效果」单独决定）。
 *
 * 为什么方形必须强制不旋转，而不是两个开关各自独立：
 * 方形绕中心旋转时四角会扫出 2√2 倍的外接范围，即使容器裁切也只见抖动残角、
 * 看不到完整封面 —— 没有观感自洽的实现方式（只有圆形旋转后才与自身重合）。
 * 故方形与旋转互斥：本开关打开时 `isCoverSpin` 的取值被忽略。
 *
 * 实现取「各开关读自己的值、不联动写值」（避免互改用户设置），
 * 「方形时忽略旋转」这一分支落在封面组件内判断，说明文案用 CheckBox 的 help 气泡。
 * 文案、开关语义、封面组件的分支条件三者的对应关系由
 * scripts/sim-cover-shape.js 守卫（含反例）。
 */
export default () => {
  const t = useI18n()
  const coverShape = useSettingValue('playDetail.style.coverShape')
  const setCoverShape = (isOn: boolean) => {
    updateSetting({ 'playDetail.style.coverShape': isOn ? 'square' : 'circle' })
  }

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <CheckBox
          check={coverShape === 'square'}
          variant="plain"
          label={t('play_detail_setting_cover_shape')}
          helpTitle={t('play_detail_setting_cover_shape')}
          helpDesc={t('play_detail_setting_cover_shape_desc')}
          onChange={setCoverShape}
        />
      </View>
    </View>
  )
}
