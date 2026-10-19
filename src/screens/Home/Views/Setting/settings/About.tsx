import { memo, useEffect, useState } from 'react'
import { View, TouchableOpacity, Image } from 'react-native'

import { createStyle, openUrl } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { designRadius, designSpacing, designTypography } from '@/theme/DesignTokens'
import Text from '@/components/common/Text'
import { getVersionInfo } from '@/utils/nativeModules/utils'

import Section from '../components/Section'

// package.json 里的 version 只是打包时的快照，可能与实际安装包不一致，仅作原生读取失败时的兜底
const getFallbackVersion = (): string => {
  try {
    // RN 环境的 process 由 metro polyfill，globalData 启动时已写入 versions.app。
    // （@types/node 的 ProcessVersions 带 string 索引签名，这里已无需 @ts-expect-error 压制。）
    return process.versions?.app ?? ''
  } catch {
    return ''
  }
}

export default memo(() => {
  const theme = useTheme()
  // 当前安装包的版本号：优先读运行中的主包（CI 构建时按日期注入，如 20260926）
  const [version, setVersion] = useState(getFallbackVersion())
  useEffect(() => {
    void getVersionInfo().then((v) => {
      if (v) setVersion(v)
    })
  }, [])
  const openHomePage = () => {
    void openUrl('https://github.com/1970905901/LX-Y-Music-IOS#readme')
  }
  const openTelegramGroup = () => {
    void openUrl('https://t.me/YPlayerGroup')
  }
  const openUpstreamIos = () => {
    void openUrl('https://github.com/Q-1515/lx-music-mobile/tree/ios-adaptation')
  }
  const openUpstreamDebug = () => {
    void openUrl('https://github.com/WalnutBai/lx-lxwalnut-music-mobile/tree/main-debug')
  }

  const textLinkStyle = {
    ...styles.link,
    textDecorationLine: 'underline',
    color: theme['c-primary-font'],
  } as const

  return (
    <Section>
      <View style={styles.part}>
        <Text style={{ ...styles.text, color: theme['c-font'] }}>
          当前版本：<Text style={styles.boldText}>{version || '未知'}</Text>
        </Text>
      </View>
      <View style={styles.part}>
        <Text style={{ ...styles.text, color: theme['c-font'] }}>本软件(LX-Y Music)完全免费，代码已开源。开源地址：</Text>
        <TouchableOpacity onPress={openHomePage}>
          <Text style={textLinkStyle}>https://github.com/1970905901/LX-Y-Music-IOS</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.part}>
        <Text style={styles.boldText}>致谢</Text>
        <Text style={{ ...styles.text, color: theme['c-font'] }}>
          本软件基于以下上游项目构建，在此致以诚挚的感谢：
        </Text>
        <TouchableOpacity onPress={openUpstreamIos}>
          <Text style={textLinkStyle}>Q-1515/lx-music-mobile (ios-adaptation)</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={openUpstreamDebug}>
          <Text style={textLinkStyle}>WalnutBai/lx-lxwalnut-music-mobile (main-debug)</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.part}>
        <Text style={{ ...styles.text, color: theme['c-font'] }}>Telegram 群组：</Text>
        <TouchableOpacity onPress={openTelegramGroup}>
          <Text style={textLinkStyle}>https://t.me/YPlayerGroup</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.part}>
        <Text style={styles.boldText}>赞赏支持</Text>
        <Text style={{ ...styles.text, color: theme['c-font'] }}>
          若你觉得本软件不错，欢迎赞赏支持开发者：
        </Text>
        <Image
          source={require('@/resources/images/reward-qrcode.jpg')}
          style={styles.rewardImage}
          resizeMode="contain"
        />
      </View>
    </Section>
  )
})

const styles = createStyle({
  part: {
    marginBottom: designSpacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  text: {
    fontSize: designTypography.body,
    lineHeight: 24,
  },
  link: {
    fontSize: designTypography.body,
    lineHeight: 24,
  },
  boldText: {
    fontSize: designTypography.body,
    fontWeight: 'bold',
    lineHeight: 24,
  },
  rewardImage: {
    width: 200,
    height: 200,
    marginTop: designSpacing.xs,
    borderRadius: designRadius.md,
    alignSelf: 'center',
  },
})
