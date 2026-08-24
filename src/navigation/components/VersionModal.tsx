import { useMemo, useState, useEffect, useCallback, useRef, memo } from 'react'
import { View, ScrollView, Image, TouchableOpacity } from 'react-native'
import Clipboard from '@react-native-clipboard/clipboard'
import Video, { type VideoRef } from 'react-native-video'

import { compareVer, sizeFormate } from '@/utils'

import Button from '@/components/common/Button'
import { updateApp } from '@/utils/version'
import { createStyle } from '@/utils/tools'
import { openUrl, toast } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { type VersionInfo } from '@/store/version/state'
import Text from '@/components/common/Text'
import { useI18n } from '@/lang'
import {
  useVersionDownloadProgressUpdated,
  useVersionInfo,
  useVersionInfoIgnoreVersionUpdated,
} from '@/store/version/hook'
import ModalContent from './ModalContent'
import { checkUpdate, downloadUpdate, hideModal, setIgnoreVersion } from '@/core/version'

const VideoPlayer = ({ url }: { url: string }) => {
  const videoRef = useRef<VideoRef>(null)
  const pausedRef = useRef(true)

  useEffect(() => {
    return () => {
      // 组件卸载时暂停并重置视频
      pausedRef.current = true
      videoRef.current?.seek(0)
    }
  }, [])

  return (
    <View style={styles.markdownVideoContainer}>
      <Video
        ref={videoRef}
        source={{ uri: url }}
        style={styles.markdownVideo}
        resizeMode="contain"
        paused={pausedRef.current}
        controls={true}
      />
    </View>
  )
}

const parseInlineMarkdown = (text: string, theme: any): React.ReactNode[] => {
  const parts: React.ReactNode[] = []
  // 支持: 链接、行内代码、粗体、斜体、彩色字体
  const regex = /\[([^\]]+)\]\(([^)]+)\)|`(.+?)`|\*\*(.+?)\*\*|\*(.+?)\*|<color=(.+?)>(.+?)<\/color>/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const beforeText = text.slice(lastIndex, match.index)
      if (beforeText) parts.push(beforeText)
    }
    if (match[1] && match[2]) {
      // 链接: [text](url)
      const linkText = match[1]
      const linkUrl = match[2]
      parts.push(
        <Text
          key={match.index}
          style={{ color: theme['c-primary'], textDecorationLine: 'underline' }}
          onPress={() => openUrl(linkUrl)}
        >
          {linkText}
        </Text>
      )
    } else if (match[3]) {
      // 行内代码: `code`
      parts.push(
        <Text key={match.index} style={[styles.markdownInlineCode, { color: theme['c-primary'] }]}>
          {match[3]}
        </Text>
      )
    } else if (match[4]) {
      // 粗体: **text**
      parts.push(
        <Text key={match.index} style={{ fontWeight: 'bold', color: theme['c-font'] }}>
          {match[4]}
        </Text>
      )
    } else if (match[5]) {
      // 斜体: *text*
      parts.push(
        <Text key={match.index} style={{ fontStyle: 'italic', color: theme['c-font'] }}>
          {match[5]}
        </Text>
      )
    } else if (match[6] && match[7]) {
      // 彩色字体: <color=#FF0000>text</color>
      parts.push(
        <Text key={match.index} style={{ color: match[6] }}>
          {match[7]}
        </Text>
      )
    }
    lastIndex = regex.lastIndex
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts.length > 0 ? parts : [text]
}

const CodeBlock = ({ code, theme }: { code: string; theme: any }) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    Clipboard.setString(code)
    setCopied(true)
    toast('已复制')
    setTimeout(() => setCopied(false), 2000)
  }, [code])

  return (
    <View style={[styles.markdownCodeBlock, { backgroundColor: theme['c-content-background'] }]}>
      <TouchableOpacity style={styles.copyBtn} onPress={handleCopy}>
        <Text style={[styles.copyBtnText, { color: copied ? theme['c-primary'] : theme['c-font-label'] }]}>
          {copied ? '已复制' : '复制'}
        </Text>
      </TouchableOpacity>
      <Text style={[styles.markdownCodeText, { color: theme['c-font'] }]} selectable>
        {code}
      </Text>
    </View>
  )
}

const MarkdownText = ({ content }: { content: string }) => {
  const theme = useTheme()

  const elements = useMemo(() => {
    const result: React.ReactNode[] = []
    const lines = content.split('\n')
    let i = 0

    while (i < lines.length) {
      const line = lines[i]

      // 代码块: ```
      if (line.trim().startsWith('```')) {
        const codeLines: string[] = []
        i++
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          codeLines.push(lines[i])
          i++
        }
        i++ // 跳过结束的 ```
        result.push(
          <CodeBlock key={`code-${i}`} code={codeLines.join('\n')} theme={theme} />
        )
        continue
      }

      // 视频: [video](url)
      const videoMatch = line.match(/^\[video\]\((.*?)\)$/)
      if (videoMatch) {
        const [, url] = videoMatch
        if (url && url.trim() !== '') {
          result.push(<VideoPlayer key={`video-${i}`} url={url} />)
        }
        i++
        continue
      }

      // 图片: ![alt](url)
      const imageMatch = line.match(/^!\[(.*?)\]\((.*?)\)$/)
      if (imageMatch) {
        const [, alt, url] = imageMatch
        if (url && url.trim() !== '') {
          result.push(
            <Image
              key={`img-${i}`}
              source={{ uri: url }}
              style={styles.markdownImage}
              resizeMode="contain"
              accessibilityLabel={alt}
            />
          )
        }
        i++
        continue
      }

      if (line.startsWith('# ')) {
        result.push(<Text key={i} style={[styles.markdownH1, { color: theme['c-font'] }]}>{line.slice(2)}</Text>)
      } else if (line.startsWith('## ')) {
        result.push(<Text key={i} style={[styles.markdownH2, { color: theme['c-font'] }]}>{line.slice(3)}</Text>)
      } else if (line.startsWith('### ')) {
        result.push(<Text key={i} style={[styles.markdownH3, { color: theme['c-font'] }]}>{line.slice(4)}</Text>)
      } else if (line.startsWith('- ') || line.startsWith('* ')) {
        const content = line.slice(2)
        const parsed = parseInlineMarkdown(content, theme)
        result.push(<Text key={i} style={[styles.markdownListItem, { color: theme['c-font'] }]}>• {parsed}</Text>)
      } else if (line.match(/^\d+\.\s/)) {
        const parsed = parseInlineMarkdown(line, theme)
        result.push(<Text key={i} style={[styles.markdownListItem, { color: theme['c-font'] }]}>{parsed}</Text>)
      } else if (line.startsWith('> ')) {
        result.push(<Text key={i} style={[styles.markdownQuote, { color: theme['c-font-label'] }]}>{line.slice(2)}</Text>)
      } else if (line.startsWith('---') || line.startsWith('***')) {
        result.push(<View key={i} style={[styles.markdownDivider, { backgroundColor: theme['c-border-background'] }]} />)
      } else if (line.trim() === '') {
        result.push(<View key={i} style={styles.markdownEmptyLine} />)
      } else {
        const parsed = parseInlineMarkdown(line, theme)
        result.push(<Text key={i} style={[styles.markdownParagraph, { color: theme['c-font'] }]}>{parsed}</Text>)
      }
      i++
    }

    return result
  }, [content, theme])

  return <View>{elements}</View>
}

const VersionItem = ({ version, desc }: VersionInfo) => {
  const theme = useTheme()
  return (
    <View style={styles.versionItem}>
      <Text style={styles.label}>v{version}</Text>
      <View style={{ paddingLeft: 10, marginTop: 2 }}>
        <MarkdownText content={desc || ''} />
      </View>
    </View>
  )
}

const Content = memo(
  ({ title, newVersionInfo }: { title: string; newVersionInfo: VersionInfo | null }) => {
    const t = useI18n()

    const history = useMemo(() => {
      if (!newVersionInfo?.history) return []
      let arr = []
      for (const ver of newVersionInfo?.history) {
        if (compareVer(currentVer, ver.version) < 0) arr.push(ver)
      }
      return arr
    }, [newVersionInfo])

    return (
      <View style={styles.main}>
        <Text style={styles.title}>{title}</Text>
        <ScrollView style={styles.content} keyboardShouldPersistTaps={'always'}>
          <Text style={styles.label}>
            {t('version_label_latest_ver')}
            {newVersionInfo?.version}
          </Text>
          <Text style={styles.label}>
            {t('version_label_current_ver')}
            {currentVer}
          </Text>
          {newVersionInfo?.desc ? (
            <View>
              <Text style={styles.label}>{t('version_label_change_log')}</Text>
              <View style={{ paddingLeft: 10, marginTop: 5 }}>
                <MarkdownText content={newVersionInfo.desc} />
              </View>
            </View>
          ) : null}
          {history.length ? (
            <View style={styles.history}>
              <Text style={styles.label}>{t('version_label_history')}</Text>
              <View style={{ paddingLeft: 10, marginTop: 5 }}>
                {history.map((item, index) => (
                  <VersionItem key={index} version={item.version} desc={item.desc} />
                ))}
              </View>
            </View>
          ) : null}
        </ScrollView>
      </View>
    )
  }
)

const currentVer = process.versions.app
const VersionModal = ({ componentId }: { componentId: string }) => {
  const theme = useTheme()
  const t = useI18n()
  const versionInfo = useVersionInfo()
  const progress = useVersionDownloadProgressUpdated()
  const ignoreVersion = useVersionInfoIgnoreVersionUpdated()
  const [ignoreBtn, setIgnoreBtn] = useState({
    text: t('version_btn_ignore'),
    show: true,
    disabled: false,
  })
  const [closeBtnText, setCloseBtnText] = useState(t('version_btn_close'))
  const [confirmBtn, setConfirmBtn] = useState({ text: '', show: true, disabled: false })
  const [manualUpdateBtn, setManualUpdateBtn] = useState({ show: true })
  const [title, setTitle] = useState('')
  const [tip, setTip] = useState('')
  const MANUAL_UPDATE_URL = 'https://1813811951.share.123pan.cn/123pan/XINlVv-II4TH'

  useEffect(() => {
    let ignoreBtnConfig = { ...ignoreBtn }
    if (versionInfo.isLatest) {
      setTitle(t('version_title_latest'))
      setTip('')
      ignoreBtnConfig.show = false
      setConfirmBtn({ text: t('version_btn_new'), show: false, disabled: true })
      setCloseBtnText(t('version_btn_close'))
    } else if (versionInfo.isUnknown) {
      setTitle(t('version_title_unknown'))
      setTip(t('version_tip_unknown'))
      ignoreBtnConfig.show = false
      setConfirmBtn({ text: t('version_btn_failed'), show: true, disabled: false })
      setCloseBtnText(t('version_btn_close'))
    } else {
      switch (versionInfo.status) {
        case 'downloading':
          setTitle(t('version_title_new'))
          setTip(
            t('version_btn_downloading', {
              total: sizeFormate(progress.total),
              current: sizeFormate(progress.current),
              progress: progress.total
                ? ((progress.current / progress.total) * 100).toFixed(2)
                : '0',
            })
          )
          if (ignoreBtnConfig.show) ignoreBtnConfig.show = false
          if (!confirmBtn.disabled)
            setConfirmBtn({ text: t('version_btn_update'), show: true, disabled: true })
          setCloseBtnText(t('version_btn_min'))
          break
        case 'downloaded':
          setTitle(t('version_title_update'))
          setTip('')
          if (ignoreBtnConfig.show) ignoreBtnConfig.show = false
          setConfirmBtn({ text: t('version_btn_update'), show: true, disabled: false })
          setCloseBtnText(t('version_btn_close'))
          break
        case 'checking':
          setTitle(t('version_title_checking'))
          setTip('')
          ignoreBtnConfig.show = false
          setConfirmBtn({ text: t('version_btn_new'), show: false, disabled: true })
          setCloseBtnText(t('version_btn_close'))
          break
        case 'error':
          setTitle(t('version_title_failed'))
          setTip(t('version_tip_failed'))
          ignoreBtnConfig.show = true
          ignoreBtnConfig.disabled = false
          setConfirmBtn({ text: t('version_btn_failed'), show: true, disabled: false })
          setCloseBtnText(t('version_btn_close'))
          break
        // case 'idle':
        //   break
        default:
          setTitle(t('version_title_new'))
          setTip('')
          ignoreBtnConfig.show = true
          ignoreBtnConfig.disabled = false
          setConfirmBtn({ text: t('version_btn_new'), show: true, disabled: false })
          // setTip(t('version_btn_new'))
          setCloseBtnText(t('version_btn_close'))
          break
      }
    }
    ignoreBtnConfig.text = t(
      ignoreVersion == versionInfo.newVersion?.version
        ? 'version_btn_ignore_cancel'
        : 'version_btn_ignore'
    )
    setIgnoreBtn(ignoreBtnConfig)

    if (versionInfo.isLatest) {
      setManualUpdateBtn({ show: false })
    } else if (versionInfo.isUnknown) {
      setManualUpdateBtn({ show: true })
    } else if (versionInfo.status === 'downloading' || versionInfo.status === 'downloaded') {
      setManualUpdateBtn({ show: false })
    } else {
      setManualUpdateBtn({ show: true })
    }
  }, [t, versionInfo, ignoreVersion, progress])

  const handleCancel = () => {
    hideModal(componentId)
  }
  const handleIgnore = () => {
    setIgnoreVersion(
      ignoreVersion != versionInfo.newVersion!.version ? versionInfo.newVersion!.version : null
    )
    // handleCancel()
  }

  const handleManualUpdate = () => {
    void openUrl(MANUAL_UPDATE_URL)
  }

  const handleConfirm = () => {
    if (versionInfo.isLatest || versionInfo.isUnknown) {
      void checkUpdate()
    } else if (versionInfo.status == 'downloaded') {
      void updateApp()
    } else if (versionInfo.status == 'idle' || versionInfo.status == 'error') {
      downloadUpdate()
    }
  }

  return (
    <ModalContent>
      <Content title={title} newVersionInfo={versionInfo.newVersion} />
      {tip.length ? (
        <Text style={styles.tip} color={theme['c-primary-font']}>
          {tip}
        </Text>
      ) : null}
      <View style={styles.btns}>
        <View style={styles.btnRow}>
          {ignoreBtn.show ? (
            <Button
              disabled={ignoreBtn.disabled}
              style={{ ...styles.btn, backgroundColor: theme['c-button-background'] }}
              onPress={handleIgnore}
            >
              <Text color={theme['c-button-font']}>{ignoreBtn.text}</Text>
            </Button>
          ) : null}
          <Button
            style={{ ...styles.btn, backgroundColor: theme['c-button-background'] }}
            onPress={handleCancel}
          >
            <Text color={theme['c-button-font']}>{closeBtnText}</Text>
          </Button>
        </View>
        <View style={styles.btnRow}>
          {manualUpdateBtn.show ? (
            <Button
              style={{ ...styles.btn, backgroundColor: theme['c-button-background'] }}
              onPress={handleManualUpdate}
            >
              <Text color={theme['c-button-font']}>{t('version_btn_manual_update')}</Text>
            </Button>
          ) : null}
          {confirmBtn.show ? (
            <Button
              disabled={confirmBtn.disabled}
              style={{ ...styles.btn, backgroundColor: theme['c-button-background'] }}
              onPress={handleConfirm}
            >
              <Text color={theme['c-button-font']}>{confirmBtn.text}</Text>
            </Button>
          ) : null}
        </View>
      </View>
    </ModalContent>
  )
}

const styles = createStyle({
  main: {
    // flexGrow: 0,
    flexShrink: 1,
    marginTop: 15,
    marginLeft: 15,
    marginRight: 15,
    marginBottom: 20,
  },
  content: {
    flexGrow: 0,
  },
  title: {
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 15,
  },
  history: {
    marginTop: 15,
  },
  versionItem: {
    marginBottom: 10,
  },
  label: {
    fontSize: 14,
    marginBottom: 2,
  },
  desc: {
    fontSize: 13,
    lineHeight: 18,
  },
  tip: {
    paddingLeft: 15,
    paddingRight: 15,
    paddingBottom: 10,
  },
  btns: {
    paddingBottom: 15,
    paddingLeft: 15,
    paddingRight: 15,
  },
  btnRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 10,
  },
  btn: {
    flex: 1,
    paddingTop: 10,
    paddingBottom: 10,
    paddingLeft: 10,
    paddingRight: 10,
    alignItems: 'center',
    borderRadius: 4,
    marginRight: 15,
  },
  markdownH1: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 10,
    marginTop: 10,
  },
  markdownH2: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
    marginTop: 8,
  },
  markdownH3: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 6,
    marginTop: 6,
  },
  markdownParagraph: {
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 4,
  },
  markdownListItem: {
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 2,
    paddingLeft: 10,
  },
  markdownQuote: {
    fontSize: 12,
    lineHeight: 18,
    paddingLeft: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#ccc',
    marginBottom: 4,
  },
  markdownDivider: {
    height: 1,
    marginVertical: 10,
  },
  markdownEmptyLine: {
    height: 6,
  },
  markdownImage: {
    width: '100%',
    height: 150,
    maxHeight: 150,
    marginVertical: 8,
    borderRadius: 4,
  },
  markdownVideoContainer: {
    width: '100%',
    height: 220,
    marginVertical: 8,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  markdownVideo: {
    width: '100%',
    height: '100%',
  },
  markdownInlineCode: {
    fontFamily: 'monospace',
    backgroundColor: 'rgba(128, 128, 128, 0.15)',
    paddingHorizontal: 4,
    borderRadius: 3,
    fontSize: 12,
  },
  markdownCodeBlock: {
    padding: 10,
    marginVertical: 6,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(128, 128, 128, 0.3)',
  },
  markdownCodeText: {
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
  },
  copyBtn: {
    alignSelf: 'flex-end',
    marginBottom: 6,
  },
  copyBtnText: {
    fontSize: 11,
  },
})

export default VersionModal
