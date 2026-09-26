import { memo, useState, useCallback, useMemo, useEffect } from 'react'
import { View } from 'react-native'
import Section from '../../components/Section'
import SubTitle from '../../components/SubTitle'
import InputItem from '../../components/InputItem'
import Button from '../../components/Button'
import CheckBoxItem from '../../components/CheckBoxItem'
import History from './History'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import { createStyle, toast } from '@/utils/tools'
import { dateFormat } from '@/utils/common'
import { useTheme } from '@/store/theme/hook'
import Text from '@/components/common/Text'
import { designSpacing } from '@/theme/DesignTokens'
import { getSyncHost } from '@/utils/data'
import { testConnection, resetClient } from '@/utils/webdav'
import {
  triggerWebDAVSync,
  manualUploadSettingsAndApis,
  manualDownloadSettingsAndApis,
  manualUploadLists,
  manualDownloadLists,
} from '@/core/sync/webdavSync'
import IsEnable from '@/screens/Home/Views/Setting/settings/Sync/IsEnable.tsx'

export default memo(() => {
  const theme = useTheme()
  const isEnableWebdav = useSettingValue('sync.webdav.enable')
  const isSyncLists = useSettingValue('sync.webdav.syncLists')
  const isSyncPlayHistory = useSettingValue('sync.webdav.syncPlayHistory')
  const isSyncDownloadTasks = useSettingValue('sync.webdav.syncDownloadTasks')
  const webdavUrl = useSettingValue('sync.webdav.url')
  const webdavUsername = useSettingValue('sync.webdav.username')
  const webdavPassword = useSettingValue('sync.webdav.password')
  const webdavPath = useSettingValue('sync.webdav.path')

  const lastSyncTimeLists = useSettingValue('sync.webdav.lastSyncTimeLists')

  const [isTesting, setIsTesting] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [isUploadingLists, setIsUploadingLists] = useState(false)
  const [isDownloadingLists, setIsDownloadingLists] = useState(false)
  const [host, setHost] = useState('')

  useEffect(() => {
    void getSyncHost().then(setHost)
  }, [])

  const lastSyncTimeListsStr = useMemo(() => {
    return lastSyncTimeLists ? dateFormat(lastSyncTimeLists, 'Y-M-D h:m:s') : '从未'
  }, [lastSyncTimeLists])


  const handleEnableWebDAV = (enable: boolean) => {
    // 启用 WebDAV 同步时，自动开启“同步歌单”，避免仅连接而不同步歌单导致列表为空
    if (enable) {
      updateSetting({ 'sync.webdav.enable': enable, 'sync.webdav.syncLists': true })
    } else {
      updateSetting({ 'sync.webdav.enable': enable })
    }
    resetClient()
  }

  const handleEnableListSync = (enable: boolean) => {
    updateSetting({ 'sync.webdav.syncLists': enable })
  }

  const handleEnablePlayHistorySync = (enable: boolean) => {
    updateSetting({ 'sync.webdav.syncPlayHistory': enable })
  }

  const handleEnableDownloadTasksSync = (enable: boolean) => {
    updateSetting({ 'sync.webdav.syncDownloadTasks': enable })
  }

  const handleTestConnection = useCallback(async() => {
    if (isTesting) return
    setIsTesting(true)
    toast('正在测试连接...')
    try {
      await testConnection()
      toast('连接成功！')
    } catch (error: any) {
      toast(`连接失败: ${error.message}`, 'long')
    } finally {
      setIsTesting(false)
    }
  }, [isTesting])

  const handleSyncNow = useCallback(async() => {
    if (isSyncing) return
    setIsSyncing(true)
    try {
      await triggerWebDAVSync(true)
    } finally {
      setIsSyncing(false)
    }
  }, [isSyncing])

  const handleUpload = useCallback(async() => {
    if (isUploading) return
    setIsUploading(true)
    await manualUploadSettingsAndApis()
    setIsUploading(false)
  }, [isUploading])

  const handleDownload = useCallback(async() => {
    if (isDownloading) return
    setIsDownloading(true)
    await manualDownloadSettingsAndApis()
    setIsDownloading(false)
  }, [isDownloading])

  const handleUploadLists = useCallback(async() => {
    if (isUploadingLists) return
    setIsUploadingLists(true)
    await manualUploadLists()
    setIsUploadingLists(false)
  }, [isUploadingLists])

  const handleDownloadLists = useCallback(async() => {
    if (isDownloadingLists) return
    setIsDownloadingLists(true)
    await manualDownloadLists()
    setIsDownloadingLists(false)
  }, [isDownloadingLists])


  const handleWebdavSettingChanged = (key: keyof LX.AppSetting) => (text: string, callback: (value: string) => void) => {
    updateSetting({ [key]: text })
    resetClient()
    callback(text)
  }

  return (
    <Section sectionId="setting_sync">
      <SubTitle title="WebDAV 同步">
        <CheckBoxItem
          check={isEnableWebdav}
          label="启用 WebDAV 同步"
          onChange={handleEnableWebDAV}
        />
        <View style={{ opacity: isEnableWebdav ? 1 : 0.5 }}>
          <CheckBoxItem
            check={isSyncLists}
            label="自动同步歌单"
            helpDesc="自动同步歌单会同步歌单、播放历史及下载任务，如果有不需要的可以自行关闭"
            onChange={handleEnableListSync}
            disabled={!isEnableWebdav}
          />
          <View style={styles.btnRow}>
            <CheckBoxItem
              check={isSyncPlayHistory}
              label="播放历史"
              onChange={handleEnablePlayHistorySync}
              disabled={!isEnableWebdav}
            />
            <CheckBoxItem
              check={isSyncDownloadTasks}
              label="下载任务"
              onChange={handleEnableDownloadTasksSync}
              disabled={!isEnableWebdav}
            />
          </View>
        </View>

        {/* WebDAV 凭据字段始终可编辑（去掉 editable={isEnableWebdav} 门控）：
            用户必须先填好地址/账号/密码才能「测试连接」、也才能把同步打开；而 editable={false} 时
            iOS 的 TextInput 会直接忽略点击，键盘根本唤不起来，表现为“填写栏点不动、无法使用”。
            该区块同时不再套 opacity:0.5——半透明会被误读成“已禁用”，进一步让人以为不能填。 */}
        <InputItem
          label="服务器地址"
          value={webdavUrl}
          onChanged={handleWebdavSettingChanged('sync.webdav.url')}
          placeholder="https://example.com/webdav"
        />
        <InputItem
          label="用户名"
          value={webdavUsername}
          onChanged={handleWebdavSettingChanged('sync.webdav.username')}
          placeholder="请输入用户名"
        />
        <InputItem
          label="密码"
          value={webdavPassword}
          onChanged={handleWebdavSettingChanged('sync.webdav.password')}
          placeholder="请输入密码"
        />
        {/* 同步路径仅在同步进行中锁定，避免写入与同步任务并发；空闲时始终可改 */}
        <InputItem
          label="同步路径"
          value={webdavPath}
          onChanged={handleWebdavSettingChanged('sync.webdav.path')}
          placeholder="例如: /LX_Music/"
          editable={!isSyncing}
        />

        <View style={{ opacity: isEnableWebdav ? 1 : 0.5 }}>
          <View style={styles.btnRow}>
            <Button onPress={handleTestConnection} disabled={!isEnableWebdav || isTesting}>
              {isTesting ? '测试中...' : '测试连接'}
            </Button>
            <Button onPress={handleSyncNow} disabled={!isEnableWebdav || isSyncing}>
              {isSyncing ? '同步中...' : '立即同步歌单'}
            </Button>
          </View>

          <View style={styles.btnRow}>
            <Button onPress={handleUpload} disabled={!isEnableWebdav || isUploading}>
              {isUploading ? '上传中...' : '上传设置与音源'}
            </Button>
            <Button onPress={handleDownload} disabled={!isEnableWebdav || isDownloading}>
              {isDownloading ? '下载中...' : '下载设置与音源'}
            </Button>
          </View>

          <View style={styles.btnRow}>
            <Button onPress={handleUploadLists} disabled={!isEnableWebdav || isUploadingLists}>
              {isUploadingLists ? '上传中...' : '上传歌单'}
            </Button>
            <Button onPress={handleDownloadLists} disabled={!isEnableWebdav || isDownloadingLists}>
              {isDownloadingLists ? '下载中...' : '下载歌单'}
            </Button>
          </View>

          <Text style={styles.lastSyncText} size={12} color={theme['c-font-label']}>
            上次歌单同步时间: {lastSyncTimeListsStr}
          </Text>
        </View>
      </SubTitle>

      <IsEnable host={host} setHost={setHost} />
      <History setHost={setHost} />
    </Section>
  )
})

const styles = createStyle({
  btnRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingLeft: designSpacing.md,
    marginTop: designSpacing.xs,
    marginBottom: designSpacing.sm,
  },
  lastSyncText: {
    paddingLeft: designSpacing.md,
    marginTop: designSpacing.xs,
  },
})
