import { StyleSheet, View } from 'react-native'
import { usePlayerMusicInfo } from '@/store/player/hook'
import { scaleSizeH } from '@/utils/pixelRatio'
import Image from '@/components/common/Image'
import { useCallback } from 'react'
import { setLoadErrorPicUrl, setMusicInfo } from '@/core/player/playInfo'

// 胶囊瘦身：封面从 46 收到 40，配合容器 paddingVertical 7 把胶囊整体高度
// 从 ~64 降到 ~54（封面仍略大于 40pt 控制钮热区，视觉主体不变）
const PIC_HEIGHT = scaleSizeH(40)

const styles = StyleSheet.create({
  image: {
    width: PIC_HEIGHT,
    height: PIC_HEIGHT,
    borderRadius: 12,
  },
})

export default () => {
  const musicInfo = usePlayerMusicInfo()

  const handleError = useCallback((url: string | number) => {
    setLoadErrorPicUrl(url as string)
    setMusicInfo({
      pic: null,
    })
  }, [])

  return (
    <View>
      <Image
        url={musicInfo.pic}
        style={styles.image}
        onError={handleError}
      />
    </View>
  )
}

// const styles = StyleSheet.create({
//   playInfoImg: {

//   },
// })
