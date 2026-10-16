import { memo, useCallback, useState, useEffect, useRef, useMemo } from 'react'
import { View } from 'react-native'

import CheckBoxItem from '../../components/CheckBoxItem'
import ConfirmAlert, { type ConfirmAlertType } from '@/components/common/ConfirmAlert'
import Input from '@/components/common/Input'
import { connectServer, disconnectServer, normalizeSyncHost } from '@/plugins/sync'
import InputItem from '../../components/InputItem'
import { getWIFIIPV4Address } from '@/utils/nativeModules/utils'
import { createStyle, toast } from '@/utils/tools'
import { useI18n } from '@/lang'
import { updateSetting } from '@/core/common'
import { addSyncHostHistory, getSyncHost, setSyncHost } from '@/utils/data'
import { setSyncMessage } from '@/core/sync'
import { useSettingValue } from '@/store/setting/hook'
import { useTheme } from '@/store/theme/hook'
import { useStatus } from '@/store/sync/hook'
import Text from '@/components/common/Text'
import { designRadius, designSpacing } from '@/theme/DesignTokens'
import { SYNC_CODE } from '@/plugins/sync/constants'

const HostInput = memo(
  ({
    setHost,
    host,
    disabled,
  }: {
    setHost: (host: string) => void
    host: string
    disabled?: boolean
  }) => {
    const t = useI18n()

    // 显示也走规范化：旧版本存下来的 `Http://…` / 缺协议地址在这里被纠正成规范形态
    const hostAddress = useMemo(() => (host ? normalizeSyncHost(host) : ''), [host])

    const setHostAddress = useCallback(
      (value: string, applyValue: (host: string) => void) => {
        // 规范化：自动补 http://、协议小写、全角标点转半角（详见 plugins/sync/client/utils.ts）
        const hostAddress = normalizeSyncHost(value)
        if (!hostAddress) {
          if (!value.trim()) {
            // 用户主动清空：跟着清掉已保存的地址
            applyValue('')
            if (host) setHost('')
          } else {
            // 不可用的输入保留在输入框里让用户改，而不是清空（旧行为会直接抹掉刚填的地址）
            toast(t('setting_sync_host_value_error_tip'), 'long')
          }
          return
        }
        applyValue(hostAddress)
        if (host == hostAddress) return
        setHost(hostAddress)
      },
      [host, setHost, t],
    )

    return (
      <InputItem
        editable={!disabled}
        value={hostAddress}
        label={t('setting_sync_host_label')}
        onChanged={setHostAddress}
        inputMode="url"
        // 地址是 ASCII：关掉首字母自动大写/自动纠错，否则 iOS 会把 http 写成 Http（旧解析大小写敏感，直接连不上）
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={t('setting_sync_host_value_tip')}
      />
    )
  },
)

export default memo(({ host, setHost }: { host: string, setHost: (host: string) => void }) => {
  const t = useI18n()
  const setIsEnableSync = useCallback((enable: boolean) => {
    updateSetting({ 'sync.enable': enable })
  }, [])
  const syncStatus = useStatus()
  const isEnableSync = useSettingValue('sync.enable')
  const isUnmountedRef = useRef(true)
  const theme = useTheme()
  const [address, setAddress] = useState('')
  const [authCode, setAuthCode] = useState('')
  const confirmAlertRef = useRef<ConfirmAlertType>(null)

  useEffect(() => {
    isUnmountedRef.current = false
    void getSyncHost().then((host) => {
      if (isUnmountedRef.current) return
      setHost(host)
    })
    void getWIFIIPV4Address().then((address) => {
      if (isUnmountedRef.current) return
      setAddress(address)
    })

    return () => {
      isUnmountedRef.current = true
    }
  }, [setHost])

  useEffect(() => {
    switch (syncStatus.message) {
      case SYNC_CODE.authFailed:
        toast(t('setting_sync_code_fail'))
      case SYNC_CODE.missingAuthCode:
        confirmAlertRef.current?.setVisible(true)
        break
      case SYNC_CODE.msgBlockedIp:
        toast(t('setting_sync_code_blocked_ip'))
        break
      default:
        break
    }
  }, [syncStatus.message, t])

  const handleSetEnableSync = useCallback(
    (enable: boolean) => {
      // 地址为空时给出明确提示，而不是把复选框置灰（置灰状态下点它没有任何反馈，
      // 加上地址要失焦才落盘，用户很容易以为「填了地址却连不上」）
      if (enable && !host) {
        toast(t('setting_sync_host_required_tip'), 'long')
        return
      }
      setIsEnableSync(enable)

      if (enable) void addSyncHostHistory(host)

      void (enable ? connectServer(host) : disconnectServer())
    },
    [host, setIsEnableSync, t],
  )

  const handleUpdateHost = useCallback(
    (h: string) => {
      if (h == host) return
      void setSyncHost(h)
      setHost(h)
    },
    [host, setHost],
  )

  const status = useMemo(() => {
    let status
    switch (syncStatus.message) {
      case SYNC_CODE.msgBlockedIp:
        status = t('setting_sync_code_blocked_ip')
        break
      case SYNC_CODE.authFailed:
        status = t('setting_sync_code_fail')
        break
      case SYNC_CODE.connecting:
        status = t('setting_sync_status_connecting')
        break
      case SYNC_CODE.connectServiceFailed:
        status = t('setting_sync_code_unreachable')
        break
      case SYNC_CODE.wrongService:
        status = t('setting_sync_code_wrong_service')
        break
      case SYNC_CODE.getServiceIdFailed:
        status = t('setting_sync_code_wrong_service')
        break
      case SYNC_CODE.lowServiceVersion:
        status = t('setting_sync_code_low_version')
        break
      case SYNC_CODE.highServiceVersion:
        status = t('setting_sync_code_high_version')
        break
      case SYNC_CODE.unknownServiceAddress:
        status = t('setting_sync_host_value_error_tip')
        break
      default:
        status = syncStatus.message
          ? syncStatus.message
          : syncStatus.status
            ? t('setting_sync_status_enabled')
            : t('sync_status_disabled')
        break
    }
    return status
  }, [syncStatus.message, syncStatus.status, t])

  const handleCancelSetCode = useCallback(() => {
    setSyncMessage('')
    confirmAlertRef.current?.setVisible(false)
  }, [])
  const handleSetCode = useCallback(() => {
    // const code = authCode.trim()
    // if (code.length != 6) return
    void connectServer(host, authCode)
    setAuthCode('')
    confirmAlertRef.current?.setVisible(false)
  }, [host, authCode])

  return (
    <>
      <View style={styles.infoContent}>
        <CheckBoxItem
          check={isEnableSync}
          label={t('setting_sync_enable')}
          onChange={handleSetEnableSync}
        />
        <Text style={styles.textAddr} size={13}>
          {t('setting_sync_address', { address })}
        </Text>
        <Text style={styles.text} size={13}>
          {t('setting_sync_status', { status })}
        </Text>
      </View>
      <View style={styles.inputContent}>
        <HostInput setHost={handleUpdateHost} host={host} disabled={isEnableSync} />
      </View>
      <ConfirmAlert onCancel={handleCancelSetCode} onConfirm={handleSetCode} ref={confirmAlertRef}>
        <View style={styles.authCodeContent}>
          <Text style={styles.authCodeLabel}>{t('setting_sync_code_label')}</Text>
          <Input
            placeholder={t('setting_sync_code_input_tip')}
            value={authCode}
            onChangeText={setAuthCode}
            style={{ ...styles.authCodeInput, backgroundColor: theme['c-primary-background'] }}
          />
        </View>
      </ConfirmAlert>
    </>
  )
})

const styles = createStyle({
  infoContent: {
    marginTop: designSpacing.xs,
  },
  textAddr: {
    marginLeft: designSpacing.md,
    marginTop: designSpacing.xs,
  },
  text: {
    marginLeft: designSpacing.md,
  },
  inputContent: {
    marginTop: designSpacing.xs,
  },
  authCodeContent: {
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: 'column',
  },
  authCodeLabel: {
    marginBottom: designSpacing.xs,
  },
  authCodeInput: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 260,
    borderRadius: designRadius.sm,
    // paddingTop: 2,
    // paddingBottom: 2,
    // fontSize: 14,
  },

  // tagTypeList: {
  //   flexDirection: 'row',
  //   flexWrap: 'wrap',
  // },
  // tagButton: {
  //   // marginRight: 10,
  //   borderRadius: 4,
  //   marginRight: 10,
  //   marginBottom: 10,
  // },
  // tagButtonText: {
  //   paddingLeft: 12,
  //   paddingRight: 12,
  //   paddingTop: 8,
  //   paddingBottom: 8,
  // },
})
