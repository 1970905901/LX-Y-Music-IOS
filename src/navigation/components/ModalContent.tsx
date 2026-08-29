import { View } from 'react-native'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'
import { shadow } from '@/utils/shadow'
// import { useWindowSize } from '@/utils/hooks'
const HEADER_HEIGHT = 20

interface Props {
  children: React.ReactNode
}

export default ({ children }: Props) => {
  const theme = useTheme()

  return (
    <View style={{ ...styles.centeredView, backgroundColor: 'rgba(50,50,50,.3)' }}>
      <View style={{ ...styles.modalView, backgroundColor: theme['c-content-background'] }}>
        <View
          style={{ ...styles.header, backgroundColor: theme['c-primary-light-100-alpha-100'] }}
        ></View>
        {children}
      </View>
    </View>
  )
}

const styles = createStyle({
  centeredView: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalView: {
    maxWidth: '90%',
    // Slide Over 最窄窗口约 320pt：minWidth 320 会撑满并可能溢出，降到 260 允许收窄
    minWidth: 260,
    maxHeight: '78%',
    // backgroundColor: 'white',
    borderRadius: 4,
    // 跨平台阴影：iOS 用 shadow 系列，Android 用 elevation（原 shadow 属性曾被注释导致 iOS 无投影）
    ...shadow(3),
  },
  header: {
    flexGrow: 0,
    flexShrink: 0,
    flexDirection: 'row',
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    height: HEADER_HEIGHT,
  },
})
