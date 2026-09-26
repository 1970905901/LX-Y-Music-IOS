import { useMemo, useState, useEffect } from 'react'
import { View, ScrollView, Alert, Image, Platform, AppState } from 'react-native'
import { Navigation } from 'react-native-navigation'

import Button from '@/components/common/Button'
import { createStyle, openUrl, tipDialog } from '@/utils/tools'
import { useSettingValue } from '@/store/setting/hook'
import { useTheme } from '@/store/theme/hook'
import Text from '@/components/common/Text'
import ModalContent from './ModalContent'
import { exitApp } from '@/utils/nativeModules/utils'
import { updateSetting } from '@/core/common'
import { checkAnnouncement } from '@/core/announcement'
import { initDeeplink } from '@/core/init/deeplink'
import settingState from '@/store/setting/state'
import { designRadius, designSpacing, designTypography } from '@/theme/DesignTokens'

// 「本软件完全免费且开源」提示：同意协议后延后 2s 弹出（等 overlay 关闭动画走完）。
// 定时器与 AppState 监听都放在模块作用域——overlay 一经 dismiss，本组件立即卸载，
// 写在组件里的定时器会被清掉，提示就丢了。
// 应用不在前台时 iOS 无法呈现 Alert（会静默丢失），这种情况改为等下次回到前台再弹。
let freeTipTimer: ReturnType<typeof setTimeout> | null = null
let freeTipAppStateSub: { remove: () => void } | null = null

const disposeFreeTipWaiters = () => {
  if (freeTipTimer) {
    clearTimeout(freeTipTimer)
    freeTipTimer = null
  }
  if (freeTipAppStateSub) {
    freeTipAppStateSub.remove()
    freeTipAppStateSub = null
  }
}

// 首次签署协议后的公告检查。
// 放在免费开源提示的「好的」回调里（而不是签署瞬间）：让公告严格排在提示之后，
// 避免原生 Alert 与公告 overlay 同时出现、互相遮挡（overlay window 可能压在 Alert 上，
// 那样用户点不到提示上的按钮）。400ms 留给 Alert 的关闭动画。
// 万一这一步没走到（例如期间应用被杀），下次启动仍会在「已同意协议」分支再检查一次，
// 公告不会因此漏掉。
const scheduleAnnouncementCheckAfterPact = () => {
  setTimeout(() => {
    void checkAnnouncement(false)
  }, 400)
}

const showFreeOpenSourceTip = () => {
  disposeFreeTipWaiters()
  Alert.alert(
    '',
    Buffer.from(
      'e69cace8bdafe4bbb6e5ae8ce585a8e5858de8b4b9e4b894e5bc80e6ba90efbc8ce5a682e69e9ce4bda0e698afe88b1e992b1e4b9b0e79a84efbc8ce8afb7e79bb4e68ea5e7bb99e5b7aee8af84efbc810a0a5468697320736f667477617265206973206672656520616e64206f70656e20736f757263652e',
      'hex',
    ).toString(),
    [
      {
        text: Buffer.from('e5a5bde79a8420284f4b29', 'hex').toString(),
        onPress: () => {
          void initDeeplink()
          scheduleAnnouncementCheckAfterPact()
        },
      },
    ],
  )
}

const scheduleFreeOpenSourceTip = () => {
  disposeFreeTipWaiters()
  freeTipTimer = setTimeout(() => {
    freeTipTimer = null
    if (AppState.currentState === 'active') {
      showFreeOpenSourceTip()
      return
    }
    // 后台状态：等回到前台再弹，避免 Alert 静默丢失
    freeTipAppStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') showFreeOpenSourceTip()
    })
  }, 2000)
}

const Content = () => {
  const theme = useTheme()

  const openHomePage = () => {
    void openUrl('https://github.com/WalnutBai/lx-lxwalnut-music-mobile#readme')
  }
  const openLicensePage = () => {
    void openUrl('http://www.apache.org/licenses/LICENSE-2.0')
  }

  const textLinkStyle = {
    ...styles.text,
    textDecorationLine: 'underline',
    color: theme['c-primary-font'],
    // fontSize: 15,
  } as const

  return (
    <View style={styles.main}>
      <Text style={styles.title} size={designTypography.title}>
        许可协议
      </Text>
      <ScrollView style={styles.content} keyboardShouldPersistTaps={'always'}>
        {!settingState.setting['common.isAgreePact'] && (
          <Text selectable style={styles.bold}>
            在使用本软件前，你（使用者）需签署本协议才可继续使用！{'\n'}
          </Text>
        )}
        <Text selectable style={styles.text}>
          本项目基于{' '}
          <Text onPress={openLicensePage} style={textLinkStyle}>
            Apache License 2.0
          </Text>{' '}
          许可证发行，以下协议是对于 Apache License 2.0 的补充，如有冲突，以以下协议为准。{'\n'}
        </Text>
        <Text selectable style={styles.text}>
          词语约定：本协议中的“本项目”指 LX-Y Music
          移动版项目；“使用者”指签署本协议的使用者；“官方音乐平台”指对本项目内置的包括酷我、酷狗、咪咕等音乐源的官方平台统称；“版权数据”指包括但不限于图像、音频、名字等在内的他人拥有所属版权的数据。
          {'\n'}
        </Text>
        <Text selectable style={styles.bold}>
          一、数据来源{'\n'}
        </Text>
        <Text selectable style={styles.text}>
          1.1 本项目的数据来源原理是从各官方音乐平台的公开服务器中拉取数据（与未登录状态在官方平台
          APP
          获取的数据相同），经过对数据简单地筛选与合并后进行展示，因此本项目不对数据的准确性负责。
          {'\n'}
        </Text>
        <Text selectable style={styles.text}>
          1.2
          本项目本身没有获取某个音频数据的能力，本项目使用的在线音频数据来源来自软件设置内“自定义源”设置所选择的“源”返回的在线链接。例如播放某首歌，本项目所做的只是将希望播放的歌曲名、艺术家等信息传递给“源”，若“源”返回了一个链接，则本项目将认为这就是该歌曲的音频数据而进行使用，至于这是不是正确的音频数据本项目无法校验其准确性，所以使用本项目的过程中可能会出现希望播放的音频与实际播放的音频不对应或者无法播放的问题。
          {'\n'}
        </Text>
        <Text selectable style={styles.text}>
          1.3
          本项目的非官方平台数据（例如“我的列表”内列表）来自使用者本地系统或者使用者连接的同步服务，本项目不对这些数据的合法性、准确性负责。
          {'\n'}
        </Text>
        <Text selectable style={styles.bold}>
          二、版权数据{'\n'}
        </Text>
        <Text selectable style={styles.text}>
          2.1
          使用本项目的过程中可能会产生版权数据。对于这些版权数据，本项目不拥有它们的所有权。为了避免侵权，使用者务必在{' '}
          <Text style={styles.bold}>24 小时内</Text> 清除使用本项目的过程中所产生的版权数据。{'\n'}
        </Text>
        <Text selectable style={styles.bold}>
          三、音乐平台别名{'\n'}
        </Text>
        <Text selectable style={styles.text}>
          3.1
          本项目内的官方音乐平台别名为本项目内对官方音乐平台的一个称呼，不包含恶意。如果官方音乐平台觉得不妥，可联系本项目更改或移除。
          {'\n'}
        </Text>
        <Text selectable style={styles.bold}>
          四、资源使用{'\n'}
        </Text>
        <Text selectable style={styles.text}>
          4.1
          本项目内使用的部分包括但不限于字体、图片等资源来源于互联网。如果出现侵权可联系本项目移除。
          {'\n'}
        </Text>
        <Text selectable style={styles.bold}>
          五、免责声明{'\n'}
        </Text>
        <Text selectable style={styles.text}>
          5.1
          由于使用本项目产生的包括由于本协议或由于使用或无法使用本项目而引起的任何性质的任何直接、间接、特殊、偶然或结果性损害（包括但不限于因商誉损失、停工、计算机故障或故障引起的损害赔偿，或任何及所有其他商业损害或损失）由使用者负责。
          {'\n'}
        </Text>
        <Text selectable style={styles.bold}>
          六、使用限制{'\n'}
        </Text>
        <Text selectable style={styles.text}>
          6.1 本项目完全免费，且开源发布于{' '}
          <Text onPress={openHomePage} style={textLinkStyle}>
            GitHub
          </Text>{' '}
          面向全世界人用作对技术的学习交流，本项目不对项目内的技术可能存在违反当地法律法规的行为作保证。
          {'\n'}
        </Text>
        <Text selectable style={styles.text}>
          6.2 <Text style={styles.bold}>禁止在违反当地法律法规的情况下使用本项目</Text>
          ，对于使用者在明知或不知当地法律法规不允许的情况下使用本项目所造成的任何违法违规行为由使用者承担，本项目不承担由此造成的任何直接、间接、特殊、偶然或结果性责任。
          {'\n'}
        </Text>
        <Text selectable style={styles.bold}>
          七、版权保护{'\n'}
        </Text>
        <Text selectable style={styles.text}>
          7.1 音乐平台不易，请尊重版权，支持正版。{'\n'}
        </Text>
        <Text selectable style={styles.bold}>
          八、非商业性质{'\n'}
        </Text>
        <Text selectable style={styles.text}>
          8.1 本项目仅用于对技术可行性的探索及研究，不接受任何商业（包括但不限于广告等）合作及捐赠。
          {'\n'}
        </Text>
        <Text selectable style={styles.bold}>
          九、接受协议{'\n'}
        </Text>
        <Text selectable style={styles.text}>
          9.1 若你使用了本项目，将代表你接受本协议。{'\n'}
        </Text>
        <Text selectable style={styles.text}>
          * 若协议更新，恕不另行通知，可到开源地址查看。
        </Text>
        <View style={styles.rewardWrap}>
          <Text selectable style={styles.bold}>
            赞赏支持{'\n'}
          </Text>
          <Text selectable style={styles.text}>
            若你觉得本软件不错，欢迎赞赏支持开发者：{'\n'}
          </Text>
          <Image
            source={require('@/resources/images/reward-qrcode.jpg')}
            style={styles.rewardImage}
            resizeMode="contain"
          />
        </View>
      </ScrollView>
    </View>
  )
}

const Footer = ({ componentId }: { componentId: string }) => {
  const theme = useTheme()
  const isAgreePact = useSettingValue('common.isAgreePact')
  // const checkUpdate = useDispatch('common', 'checkUpdate')
  const [time, setTime] = useState(5)

  const handleRejct = () => {
    // 不接受协议就等于不能使用本软件。Android 上 exitApp 会真正结束进程；
    // iOS 上 BackHandler.exitApp() 是空实现（RN 未提供，App Store 规范也不允许应用自行退出），
    // 旧代码直接调用它使「不接受」成了死按钮——既不退出也不关弹窗，用户会以为卡死。
    // iOS 改为明确告知：需要用户自己关闭应用并删除数据。
    if (Platform.OS === 'ios') {
      void tipDialog({
        title: '无法继续使用',
        message: '你选择了不接受本协议，本软件将无法继续使用。\n请从后台任务列表上滑关闭本应用（或重启设备），并在系统设置中删除本应用以清除数据。',
        btnText: '我知道了',
      })
      return
    }
    exitApp()
    // Navigation.dismissOverlay(componentId)
  }

  const handleConfirm = () => {
    const wasAgreed = !!isAgreePact
    if (!wasAgreed) updateSetting({ 'common.isAgreePact': true })
    void Navigation.dismissOverlay(componentId)
    // 首次签署才提示“本软件免费开源”，延后 2s 等 overlay 关闭动画走完
    if (!wasAgreed) scheduleFreeOpenSourceTip()
  }

  const confirmBtn = useMemo(() => {
    if (isAgreePact) return { disabled: false, text: '关闭' }
    return time ? { disabled: true, text: `接受（${time}）` } : { disabled: false, text: '接受' }
  }, [isAgreePact, time])

  useEffect(() => {
    if (isAgreePact) return
    // 倒计时用 interval 递减。旧实现把「排下一个 timeout」写在 setTime 的 updater 里，
    // 而 updater 必须是纯函数：React 在并发渲染/严格模式下可能重复调用它，
    // 会导致倒计时双倍速或重复排期（当前老架构且未使用 StrictMode 才没暴露）。
    const timer = setInterval(() => {
      setTime(t => (t > 0 ? t - 1 : 0))
    }, 1000)
    return () => { clearInterval(timer) }
  }, [isAgreePact])

  return (
    <>
      {isAgreePact ? null : (
        <Text selectable style={styles.tip} size={designTypography.caption}>
          若你（使用者）接受以上协议，请点击下面的「接受」按钮签署本协议；若不接受，请点击「不接受」并手动退出软件、清除本软件的所有数据。
        </Text>
      )}
      <View style={styles.btns}>
        {isAgreePact ? null : (
          <Button
            style={{ ...styles.btn, backgroundColor: theme['c-button-background'] }}
            onPress={handleRejct}
          >
            <Text color={theme['c-button-font']}>不接受</Text>
          </Button>
        )}
        <Button
          disabled={confirmBtn.disabled}
          style={{ ...styles.btn, backgroundColor: theme['c-button-background'] }}
          onPress={handleConfirm}
        >
          <Text color={theme['c-button-font']}>{confirmBtn.text}</Text>
        </Button>
      </View>
    </>
  )
}

const PactModal = ({ componentId }: { componentId: string }) => {
  return (
    <ModalContent>
      <Content />
      <Footer componentId={componentId} />
    </ModalContent>
  )
}

const styles = createStyle({
  main: {
    // flexGrow: 0,
    flexShrink: 1,
    marginTop: designSpacing.sm,
    marginBottom: designSpacing.xs,
  },
  content: {
    flexGrow: 0,
    marginLeft: designSpacing.xs,
    marginRight: designSpacing.xs,
    paddingLeft: designSpacing.sm,
    paddingRight: designSpacing.sm,
  },
  title: {
    textAlign: 'center',
    marginBottom: designSpacing.sm,
  },
  part: {
    marginBottom: designSpacing.xs,
  },
  text: {
    fontSize: designTypography.body,
    lineHeight: 22,
    marginBottom: designSpacing.xs,
  },
  bold: {
    fontSize: designTypography.body,
    lineHeight: 22,
    fontWeight: 'bold',
  },
  tip: {
    fontWeight: 'bold',
    paddingLeft: designSpacing.sm,
    paddingRight: designSpacing.sm,
    paddingBottom: designSpacing.sm,
  },
  rewardWrap: {
    marginTop: designSpacing.sm,
    paddingLeft: designSpacing.sm,
    paddingRight: designSpacing.sm,
    paddingBottom: designSpacing.sm,
  },
  rewardImage: {
    width: 200,
    height: 200,
    marginTop: designSpacing.xs,
    borderRadius: designRadius.md,
    alignSelf: 'center',
  },
  btns: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingBottom: designSpacing.sm,
    paddingLeft: designSpacing.sm,
    // paddingRight: 15,
  },
  btn: {
    flex: 1,
    height: 36,
    paddingHorizontal: designSpacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: designRadius.pill,
    marginRight: designSpacing.sm,
  },
})

export default PactModal
