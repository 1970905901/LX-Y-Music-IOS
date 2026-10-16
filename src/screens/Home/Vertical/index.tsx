import { View } from 'react-native'
import Content from './Content'
import PlayerBar from '@/components/player/PlayerBar'

export default ({ componentId }: { componentId: string }) => {
  // 省电门（暂停玻璃 Metal 渲染）必须传「本屏自己的 componentId」，与 Home/Horizontal 同口径：
  // 曾误传 commonState.componentIds 的栈顶 id —— 本屏在「被压栈页覆盖」期间重渲染
  // （iPad 旋转切布局 / 语言切换等）时会把当时栈顶页的 id 缓存进 PlayerBar，返回首页后
  // useScreenCovered 判定恒为「被覆盖」→ 迷你播放器玻璃永久停在暂停态（液态玻璃卡住不刷新）。
  return (
    // 外层 flex:1 容器作为 PlayerBar 绝对定位的参照系，
    // 让胶囊能稳定浮在屏幕底部、不挤压 Content 高度。
    <View style={{ flex: 1 }}>
      <Content />
      <PlayerBar componentId={componentId} isHome />
    </View>
  )
}
