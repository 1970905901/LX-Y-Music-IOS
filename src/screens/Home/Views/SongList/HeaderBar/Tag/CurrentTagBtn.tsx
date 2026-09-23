import Button from '@/components/common/Button'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import { designRadius, designSpacing } from '@/theme/DesignTokens'
import { forwardRef, useImperativeHandle, useState } from 'react'

export interface CurrentTagBtnProps {
  onShowList: () => void
}

export interface CurrentTagBtnType {
  setCurrentTagInfo: (name: string) => void
}

export default forwardRef<CurrentTagBtnType, CurrentTagBtnProps>(({ onShowList }, ref) => {
  const t = useI18n()
  const theme = useTheme()
  const [name, setName] = useState('')

  useImperativeHandle(ref, () => ({
    setCurrentTagInfo(name) {
      if (!name) name = t('songlist_tag_default')
      setName(name)
    },
  }))

  return (
    <Button style={{ ...styles.btn, backgroundColor: theme['c-primary-background'] }} onPress={onShowList}>
      <Text style={{ ...styles.sourceMenu, color: theme['c-primary-font'] }}>{name}</Text>
    </Button>
  )
})

const styles = createStyle({
  btn: {
    height: 32,
    paddingHorizontal: designSpacing.sm,
    borderRadius: designRadius.pill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sourceMenu: {
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
  },
})
