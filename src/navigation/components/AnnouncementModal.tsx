import { useMemo, useState, useCallback, useEffect, useRef } from 'react'
import { View, ScrollView, Image, TouchableOpacity } from 'react-native'
import Clipboard from '@react-native-clipboard/clipboard'
import Video, { type VideoRef } from 'react-native-video'

import { createStyle, openUrl, toast } from '@/utils/tools'

import { useTheme } from '@/store/theme/hook'
import Text from '@/components/common/Text'
import { useAnnouncementInfo } from '@/store/announcement/hook'
import ModalContent from './ModalContent'
import { hideModal, dismissAnnouncement } from '@/core/announcement'
import announcementActions from '@/store/announcement/action'
import { designRadius, designSpacing, designTypography } from '@/theme/DesignTokens'

const VideoPlayer = ({ url }: { url: string }) => {
  const videoRef = useRef<VideoRef>(null)
  const pausedRef = useRef(true)

  useEffect(() => {
    const video = videoRef.current
    return () => {
      // 组件卸载时暂停并重置视频
      pausedRef.current = true
      video?.seek(0)
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
          onPress={async() => openUrl(linkUrl)}
        >
          {linkText}
        </Text>,
      )
    } else if (match[3]) {
      // 行内代码: `code`
      parts.push(
        <Text key={match.index} style={[styles.markdownInlineCode, { color: theme['c-primary'] }]}>
          {match[3]}
        </Text>,
      )
    } else if (match[4]) {
      // 粗体: **text**
      parts.push(
        <Text key={match.index} style={{ fontWeight: 'bold', color: theme['c-font'] }}>
          {match[4]}
        </Text>,
      )
    } else if (match[5]) {
      // 斜体: *text*
      parts.push(
        <Text key={match.index} style={{ fontStyle: 'italic', color: theme['c-font'] }}>
          {match[5]}
        </Text>,
      )
    } else if (match[6] && match[7]) {
      // 彩色字体: <color=#FF0000>text</color>
      parts.push(
        <Text key={match.index} style={{ color: match[6] }}>
          {match[7]}
        </Text>,
      )
    }
    lastIndex = regex.lastIndex
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts.length > 0 ? parts : [text]
}

const CodeBlock = ({ code, theme }: { code: string, theme: any }) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    Clipboard.setString(code)
    setCopied(true)
    toast('已复制')
    setTimeout(() => { setCopied(false) }, 2000)
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
          <CodeBlock key={`code-${i}`} code={codeLines.join('\n')} theme={theme} />,
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
            />,
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

const AnnouncementModal = ({ componentId }: { componentId: string }) => {
  const theme = useTheme()
  const { announcementInfo } = useAnnouncementInfo()
  const [isVisible, setIsVisible] = useState(true)

  useEffect(() => {
    return () => {
      // 组件卸载时：保存 ID 并重置 showModal 状态
      dismissAnnouncement()
      announcementActions.setShowModal(false)
    }
  }, [])

  const enabledButtons = useMemo(() => {
    if (!announcementInfo?.buttons) return []
    return announcementInfo.buttons.filter(btn => btn.enabled)
  }, [announcementInfo])

  const handleClose = async() => {
    // 先保存 ID，再隐藏内容，最后关闭弹窗
    await dismissAnnouncement()
    setIsVisible(false)
    setTimeout(() => {
      hideModal(componentId)
    }, 100)
  }

  const handleButtonPress = (url: string) => {
    if (url && url.trim() !== '') {
      // 特殊协议：复制 QQ 群号
      if (url.startsWith('qq-group:')) {
        const groupId = url.replace('qq-group:', '')
        Clipboard.setString(groupId)
        toast(`已复制 QQ 群号：${groupId}`)
      } else {
        // 有链接：打开链接
        void openUrl(url)
      }
    }
    // 无论是否有链接，都关闭弹窗
    void handleClose()
  }

  if (!announcementInfo || !isVisible) return null

  return (
    <ModalContent>
      <View style={styles.main}>
        <Text style={[styles.title, { color: theme['c-font'] }]}>
          {announcementInfo.title}
        </Text>
        {announcementInfo.image ? (
          <Image
            source={{ uri: announcementInfo.image }}
            style={styles.image}
            resizeMode="contain"
          />
        ) : null}
        <ScrollView style={styles.content} keyboardShouldPersistTaps={'always'}>
          <MarkdownText content={announcementInfo.content} />
        </ScrollView>
      </View>
      <View style={styles.btns}>
        {enabledButtons.length > 0 ? (
          <View style={[styles.btnRow, { justifyContent: 'space-between' }]}>
            {enabledButtons.map((btn, index) => (
              <TouchableOpacity
                key={index}
                style={[styles.actionBtn, { backgroundColor: theme['c-button-background'] }]}
                onPress={() => { handleButtonPress(btn.url) }}
              >
                <Text color={theme['c-button-font']}>{btn.text}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
      </View>
    </ModalContent>
  )
}

const styles = createStyle({
  main: {
    flexShrink: 1,
    marginTop: designSpacing.sm,
    marginLeft: designSpacing.sm,
    marginRight: designSpacing.sm,
    marginBottom: designSpacing.xs,
  },
  image: {
    width: '100%',
    height: 120,
    maxHeight: 120,
    marginBottom: designSpacing.xs,
    borderRadius: designRadius.sm,
  },
  content: {
    flexGrow: 0,
    maxHeight: 250,
  },
  title: {
    fontSize: designTypography.title,
    textAlign: 'center',
    marginBottom: designSpacing.sm,
    fontWeight: 'bold',
  },
  btns: {
    paddingBottom: designSpacing.sm,
    paddingLeft: designSpacing.sm,
    paddingRight: designSpacing.sm,
  },
  btnRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: designSpacing.xs,
  },
  actionBtn: {
    flex: 1,
    minWidth: 88,
    height: 36,
    paddingHorizontal: designSpacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: designRadius.pill,
    marginHorizontal: designSpacing.xs,
  },
  markdownH1: {
    fontSize: designTypography.title,
    fontWeight: 'bold',
    marginBottom: designSpacing.xs,
    marginTop: designSpacing.xs,
  },
  markdownH2: {
    fontSize: designTypography.title,
    fontWeight: 'bold',
    marginBottom: designSpacing.xs,
    marginTop: designSpacing.xs,
  },
  markdownH3: {
    fontSize: designTypography.body,
    fontWeight: 'bold',
    marginBottom: 6,
    marginTop: 6,
  },
  markdownParagraph: {
    fontSize: designTypography.body,
    lineHeight: 22,
    marginBottom: 6,
  },
  markdownListItem: {
    fontSize: designTypography.body,
    lineHeight: 22,
    marginBottom: 2,
    paddingLeft: designSpacing.xs,
  },
  markdownQuote: {
    fontSize: designTypography.caption,
    lineHeight: 20,
    paddingLeft: designSpacing.xs,
    borderLeftWidth: 3,
    borderLeftColor: '#ccc',
    marginBottom: 6,
  },
  markdownDivider: {
    height: 1,
    marginVertical: designSpacing.xs,
  },
  markdownEmptyLine: {
    height: designSpacing.xs,
  },
  markdownImage: {
    width: '100%',
    height: 150,
    maxHeight: 150,
    marginVertical: designSpacing.xs,
    borderRadius: designRadius.sm,
  },
  markdownVideoContainer: {
    width: '100%',
    height: 220,
    marginVertical: designSpacing.xs,
    borderRadius: designRadius.sm,
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
    paddingHorizontal: 6,
    borderRadius: 6,
    fontSize: designTypography.caption,
  },
  markdownCodeBlock: {
    padding: designSpacing.sm,
    marginVertical: 6,
    borderRadius: designRadius.sm,
    borderWidth: 1,
    borderColor: 'rgba(128, 128, 128, 0.3)',
  },
  markdownCodeText: {
    fontFamily: 'monospace',
    fontSize: designTypography.caption,
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

export default AnnouncementModal
