import { memo } from 'react'
import { View, StyleSheet } from 'react-native'
import Button from '@/components/common/Button'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { shadow } from '@/utils/shadow'

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

    return (
      <View style={{ ...styles.footer, backgroundColor: theme['c-content-background'] }}>
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
  }
)

const styles = StyleSheet.create({
  footer: {
    flexGrow: 0,
    flexShrink: 0,
    flexDirection: 'row',
    // borderTopWidth: BorderWidths.normal,
    // 跨平台阴影：iOS 用 shadow 系列，Android 用 elevation
    ...shadow(8),
  },
  footerBtn: {
    width: '50%',
    paddingTop: 16,
    paddingBottom: 16,
    alignItems: 'center',
  },
})
