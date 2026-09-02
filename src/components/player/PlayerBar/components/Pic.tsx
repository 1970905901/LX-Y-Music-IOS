import { StyleSheet, View } from 'react-native'
import { usePlayerMusicInfo } from '@/store/player/hook'
import { scaleSizeH } from '@/utils/pixelRatio'
import Image from '@/components/common/Image'
import { useCallback } from 'react'
import { setLoadErrorPicUrl, setMusicInfo } from '@/core/player/playInfo'

const PIC_HEIGHT = scaleSizeH(46)

const styles = StyleSheet.create({
  image: {
    width: PIC_HEIGHT,
    height: PIC_HEIGHT,
    borderRadius: 2,
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
