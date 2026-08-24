import { useCallback } from 'react'
import Text from '@/components/common/Text'
import { View, TouchableOpacity, ScrollView } from 'react-native'
import { confirmDialog, createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { useUserApiList, state as userApiState } from '@/store/userApi'
import { useSettingValue } from '@/store/setting/hook'
import { removeUserApi, setUserApiAllowShowUpdateAlert } from '@/core/userApi'
import { BorderRadius } from '@/theme'
import CheckBox from '@/components/common/CheckBox'
import { Icon } from '@/components/common/Icon'
import { SvgIcon } from '@/components/common/SvgIcon'
import settingState from '@/store/setting/state'
import apiSourceInfo from '@/utils/musicSdk/api-source-info'
import { setApiSource } from '@/core/apiSource'

const formatVersionName = (version: string) => {
  return /^\d/.test(version) ? `v${version}` : version
}
const ListItem = ({
  item,
  activeId,
  onRemove,
  onChangeAllowShowUpdateAlert,
  onExport,
}: {
  item: LX.UserApi.UserApiInfo
  activeId: string
  onRemove: (id: string, name: string) => void
  onChangeAllowShowUpdateAlert: (id: string, enabled: boolean) => void
  onExport: (id: string) => void
}) => {
  const theme = useTheme()
  const t = useI18n()
  const changeAllowShowUpdateAlert = (check: boolean) => {
    onChangeAllowShowUpdateAlert(item.id, check)
  }
  const handleRemove = () => {
    onRemove(item.id, item.name)
  }
  const handleExport = () => {
    onExport(item.id)
  }

  return (
    <View
      style={{
        ...styles.listItem,
        backgroundColor: activeId == item.id ? theme['c-primary-background-active'] : 'transparent',
      }}
    >
      <View style={styles.listItemLeft}>
        <Text size={14}>
          {item.name}
          {item.version ? (
            <Text size={12} color={theme['c-font-label']}>
              {'   ' + formatVersionName(item.version)}
            </Text>
          ) : null}
          {item.author ? (
            <Text size={12} color={theme['c-font-label']}>
              {'   ' + item.author}
            </Text>
          ) : null}
        </Text>
        {item.description ? (
          <Text size={12} color={theme['c-font-label']}>
            {item.description}
          </Text>
        ) : null}
        <CheckBox
          check={item.allowShowUpdateAlert}
          label={t('user_api_allow_show_update_alert')}
          onChange={changeAllowShowUpdateAlert}
          size={0.86}
        />
      </View>
      <View style={styles.listItemRight}>
        <TouchableOpacity style={styles.btn} onPress={handleExport}>
          <SvgIcon name="export" color={theme['c-button-font']} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={handleRemove}>
          <Icon name="close" color={theme['c-button-font']} />
        </TouchableOpacity>
      </View>
    </View>
  )
}

export interface UserApiEditModalProps {
  onSave: (rules: string) => void
  onExport: (id: string) => void
}

export default ({ onExport }: UserApiEditModalProps) => {
  const userApiList = useUserApiList()
  const apiSource = useSettingValue('common.apiSource')
  const theme = useTheme()
  const t = useI18n()

  const handleRemove = useCallback(async (id: string, name: string) => {
    const confirm = await confirmDialog({
      message: global.i18n.t('user_api_remove_tip', { name }),
      cancelButtonText: global.i18n.t('cancel_button_text_2'),
      confirmButtonText: global.i18n.t('confirm_button_text'),
      bgClose: false,
    })
    if (!confirm) return
    void removeUserApi([id]).finally(() => {
      if (settingState.setting['common.apiSource'] == id) {
        let backApiId = apiSourceInfo.find((api) => !api.disabled)?.id
        if (!backApiId) backApiId = userApiState.list[0]?.id
        setApiSource(backApiId ?? '')
      }
    })
  }, [])
  const handleChangeAllowShowUpdateAlert = useCallback((id: string, enabled: boolean) => {
    void setUserApiAllowShowUpdateAlert(id, enabled)
  }, [])

  return (
    <ScrollView style={styles.scrollView} keyboardShouldPersistTaps={'always'}>
      <View onStartShouldSetResponder={() => true}>
        {userApiList.length ? (
          userApiList.map((item) => {
            return (
              <ListItem
                key={item.id}
                item={item}
                activeId={apiSource}
                onRemove={handleRemove}
                onChangeAllowShowUpdateAlert={handleChangeAllowShowUpdateAlert}
                onExport={onExport}
              />
            )
          })
        ) : (
          <Text style={styles.tipText} color={theme['c-font-label']}>
            {t('user_api_empty')}
          </Text>
        )}
      </View>
    </ScrollView>
  )
}

const styles = createStyle({
  scrollView: {
    paddingHorizontal: 7,
    flexGrow: 0,
  },
  list: {
    paddingBottom: 15,
    flexDirection: 'column',
  },
  listItem: {
    padding: 10,
    borderRadius: BorderRadius.normal,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  listItemLeft: {
    paddingRight: 10,
    flex: 1,
    gap: 2,
  },
  listItemRight: {
    flex: 0,
  },
  btn: {
    padding: 10,
  },
  tipText: {
    textAlign: 'center',
    marginTop: 25,
    marginBottom: 15,
  },
})
