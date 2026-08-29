import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Modal, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native'
import FastImage from '@d11/react-native-fast-image'
import Image, { getSize } from './Image'
import { useWindowSize } from '@/utils/hooks'
import { createStyle, toast } from '@/utils/tools'
import { saveImageToPictures } from '@/utils/image'
import Text from './Text'
import { useTheme } from '@/store/theme/hook'

interface Props {
  visible: boolean
  url?: string | null
  name?: string
  onClose: () => void
}

export default memo(({ visible, url, name = 'image', onClose }: Props) => {
  const windowSize = useWindowSize()
  const theme = useTheme()
  const [isActionVisible, setActionVisible] = useState(false)
  const imageUrl = typeof url == 'string' && url.startsWith('/') ? `file://${url}` : url
  const maxImageSize = useMemo(() => ({
    width: windowSize.width * 0.92,
    height: windowSize.height * 0.78,
  }), [windowSize.height, windowSize.width])
  const [imageSize, setImageSize] = useState(maxImageSize)

  useEffect(() => {
    setImageSize(maxImageSize)
    if (!imageUrl) return

    getSize(imageUrl, (width, height) => {
      if (!width || !height) return
      const scale = Math.min(maxImageSize.width / width, maxImageSize.height / height)
      setImageSize({
        width: width * scale,
        height: height * scale,
      })
    })
  }, [imageUrl, maxImageSize])

  const handleSave = useCallback(() => {
    if (!url) return
    setActionVisible(false)
    void (async () => {
      try {
        toast('正在保存图片...', 'short')
        const targetPath = await saveImageToPictures(url, name)
        if (targetPath) toast(`图片已保存到: ${targetPath}`, 'long')
      } catch (err: any) {
        toast(`保存图片失败: ${err.message}`, 'long')
      }
    })()
  }, [name, url])

  const handleClose = useCallback(() => {
    setActionVisible(false)
    onClose()
  }, [onClose])

  return (
    <Modal
      animationType="fade"
      transparent={true}
      hardwareAccelerated={true}
      statusBarTranslucent={true}
      visible={visible}
      onRequestClose={handleClose}
    >
      <TouchableWithoutFeedback onPress={handleClose}>
        <View style={styles.container}>
          <TouchableWithoutFeedback onPress={() => {}} onLongPress={() => setActionVisible(true)}>
            <View style={{ ...styles.imageWrapper, ...imageSize }}>
              <Image
                url={url}
                resizeMode={FastImage.resizeMode.contain}
                style={imageSize}
              />
            </View>
          </TouchableWithoutFeedback>
          {isActionVisible
            ? (
                <TouchableWithoutFeedback onPress={() => {}}>
                  {/* iPad 宽屏下操作面板限宽 760 居中，不再被 left/right 40 拉满整屏 */}
                  <View
                    style={{
                      ...styles.actionPanel,
                      width: Math.min(windowSize.width - 80, 760),
                      left: (windowSize.width - Math.min(windowSize.width - 80, 760)) / 2,
                      backgroundColor: theme['c-content-background'],
                    }}
                  >
                    <TouchableOpacity style={styles.saveButton} activeOpacity={0.75} onPress={handleSave}>
                      <Text size={15}>保存图片</Text>
                    </TouchableOpacity>
                  </View>
                </TouchableWithoutFeedback>
              )
            : null}
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  )
})

const styles = createStyle({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.92)',
  },
  imageWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPanel: {
    position: 'absolute',
    bottom: 60,
    padding: 8,
    borderRadius: 8,
    // iOS 浮层阴影（仅 iPhone/iPad）
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  saveButton: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
