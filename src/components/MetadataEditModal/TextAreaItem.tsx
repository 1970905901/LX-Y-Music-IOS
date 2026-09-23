import { memo, useCallback } from 'react'

import { StyleSheet, TouchableOpacity, View } from 'react-native'
import type { InputProps } from '@/components/common/Input'
import Input from '@/components/common/Input'
import { useTheme } from '@/store/theme/hook'
import Text from '@/components/common/Text'
import { createStyle } from '@/utils/tools'
import { designRadius, designSpacing } from '@/theme/DesignTokens'

export interface TextAreaItemProps extends InputProps {
  value: string
  label: string
  onOnlineMatch?: () => void
  onChanged?: (text: string) => void
}

export default memo(
  ({ value, label, onOnlineMatch, onChanged, style, ...props }: TextAreaItemProps) => {
    const theme = useTheme()
    const handleRemove = useCallback(() => {
      onChanged?.('')
    }, [onChanged])

    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.label} size={14}>
            {label}
          </Text>
          {onChanged ? (
            <View style={styles.btns}>
              <TouchableOpacity onPress={handleRemove}>
                <Text size={13} color={theme['c-button-font']}>
                  {global.i18n.t('metadata_edit_modal_form_remove_lyric')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={onOnlineMatch}>
                <Text size={13} color={theme['c-button-font']}>
                  {global.i18n.t('metadata_edit_modal_form_match_lyric')}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
        <Input
          value={value}
          onChangeText={onChanged}
          scrollEnabled={false}
          multiline
          style={StyleSheet.compose(
            { ...styles.textarea, backgroundColor: theme['c-primary-input-background'] },
            style
          )}
          {...props}
        />
      </View>
    )
  }
)

const styles = createStyle({
  container: {
    // paddingLeft: 25,
    marginBottom: designSpacing.sm,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 30,
  },
  label: {
    marginBottom: designSpacing.xs,
  },
  btns: {
    flexDirection: 'row',
    gap: designSpacing.sm,
  },
  textarea: {
    flexGrow: 1,
    flexShrink: 1,
    paddingTop: designSpacing.xs,
    paddingBottom: designSpacing.xs,
    borderRadius: designRadius.sm,
    height: 'auto',
    // height: 300,
    // maxWidth: 300,
  },
})
