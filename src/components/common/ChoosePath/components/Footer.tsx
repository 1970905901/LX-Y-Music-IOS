import { memo } from 'react'
import { View, StyleSheet } from 'react-native'
import Button from '@/components/common/Button'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { shadow } from '@/utils/shadow'
import { useSafeAreaBottom } from '@/store/common/hook'

export default memo(
  ({
    onConfirm,
    onHide,
    dirOnly,
  }: {
    onConfirm: () => void
    onHide: () => void
    dirOnly: boolean
  }) => {
    const t = useI18n()
    const theme = useTheme()
    // 安全区避让：本页是全屏 Modal（statusBarPadding={false}），底部按钮直接贴屏幕底边，
    // 在带 Home 指示器的设备上会被遮住/误触到系统手势区。复用项目已有的
    // useSafeAreaBottom（底部安全区随 iPad 旋转变化，hook 内部会重新同步）。
    const safeAreaBottom = useSafeAreaBottom()

    return (
      <View
        style={{
          ...styles.footer,
          backgroundColor: theme['c-content-background'],
          paddingBottom: safeAreaBottom,
        }}
      >
        <Button style={{ ...styles.footerBtn, width: dirOnly ? '50%' : '100%' }} onPress={onHide}>
          <Text color={theme['c-button-font']}>{t('cancel')}</Text>
        </Button>
        {dirOnly ? (
          <Button style={styles.footerBtn} onPress={onConfirm}>
            <Text color={theme['c-button-font']}>{t('confirm')}</Text>
          </Button>
        ) : null}
      </View>
    )
  },
)

const styles = StyleSheet.create({
  footer: {
    flexGrow: 0,
    flexShrink: 0,
    flexDirection: 'row',
    // borderTopWidth: BorderWidths.normal,
    // iOS 浮层阴影（仅 iPhone/iPad）
    ...shadow(8),
  },
  footerBtn: {
    width: '50%',
    paddingTop: 16,
    paddingBottom: 16,
    alignItems: 'center',
  },
})
