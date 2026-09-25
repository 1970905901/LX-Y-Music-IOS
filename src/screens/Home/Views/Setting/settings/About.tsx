import { memo } from 'react'
import { View, TouchableOpacity, Image } from 'react-native'

import Section from '../components/Section'

import { createStyle, openUrl } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { designRadius, designSpacing, designTypography } from '@/theme/DesignTokens'
import Text from '@/components/common/Text'

export default memo(() => {
  const theme = useTheme()
  const openHomePage = () => {
    void openUrl('https://github.com/1970905901/LX-Y-Music-IOS#readme')
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
    <Section sectionId="setting_about">
      <View style={styles.part}>
        <Text style={{ ...styles.text, color: theme['c-font'] }}>本软件(LX-Y Music)完全免费，代码已开源。开源地址：</Text>
        <TouchableOpacity onPress={openHomePage}>
          <Text style={textLinkStyle}>https://github.com/1970905901/LX-Y-Music-IOS</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.part}>
        <Text style={{ ...styles.text, color: theme['c-font'] }}>
          由于软件开发的初衷仅是为了对新技术的学习与研究，因此软件直至停止维护都将会一直保持纯净。
        </Text>
      </View>
      <View style={styles.part}>
        <Text style={{ ...styles.text, color: theme['c-font'] }}>
          目前本项目的原始发布地址<Text style={styles.boldText}>只有 GitHub</Text>
          ，其他渠道均为第三方转载发布，可信度请自行鉴别。
        </Text>
      </View>
      <View style={styles.part}>
        <Text style={{ ...styles.text, color: theme['c-font'] }}>
          <Text style={styles.boldText}>
            本项目没有微信公众号之类的所谓「官方账号」，也未在小米、华为、vivo
            等应用商店发布同名应用，谨防被骗！
          </Text>
        </Text>
      </View>
      <View style={styles.part}>
        <Text style={{ ...styles.text, color: theme['c-font'] }}>
          若你使用过程中遇到<Text style={styles.boldText}>广告</Text>或者
          <Text style={styles.boldText}>引流</Text>
          （如需要加群、关注公众号之类才能使用或者升级）的信息，则表明你当前运行的软件是「第三方修改版」。
        </Text>
      </View>
      <View style={styles.part}>
        <Text style={{ ...styles.text, color: theme['c-font'] }}>
          若在升级新版本时提示「<Text style={styles.boldText}>签名不一致</Text>
          」，则表明你手机上的旧版本或者将要安装的新版本中
          <Text style={styles.boldText}>有一方</Text>是「
          <Text style={styles.boldText}>第三方修改版</Text>」。
        </Text>
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
        <Text style={{ ...styles.text, color: theme['c-font'] }}>
          QQ交流群：<Text style={styles.boldText}>1013518794</Text>
        </Text>
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
