import { useTheme } from '@/store/theme/hook'
import { BorderRadius } from '@/theme'
import { createStyle } from '@/utils/tools'
import { memo, useCallback, useEffect, useMemo, useState, useRef } from 'react'
import { View, type ViewProps, Image as _Image, Text as NativeText, StyleSheet, AppState, type ImageResizeMode } from 'react-native'
import { useLayout } from '@/utils/hooks'

export interface ImageProps extends ViewProps {
  style: _Image['props']['style']
  url?: string | number | null
  cache?: boolean
  resizeMode?: ImageResizeMode
  onError?: (url: string | number) => void
}


export const defaultHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36',
}

const EmptyPic = memo(({ style, nativeID }: { style: ImageProps['style'], nativeID: ImageProps['nativeID'] }) => {
  const theme = useTheme()
  const { onLayout, width } = useLayout()
  const size = width * 0.36

  return (
    <View style={StyleSheet.compose({ ...styles.emptyPic, backgroundColor: theme['c-primary-light-900-alpha-200'], gap: size * 0.1 }, style)} onLayout={onLayout} nativeID={nativeID}>
      <NativeText style={{ fontSize: size, color: theme['c-primary-light-400-alpha-200'] }}>L</NativeText>
      <NativeText style={{ fontSize: size, color: theme['c-primary-light-400-alpha-200'], paddingLeft: 2 }}>X</NativeText>
    </View>
  )
})

const Image = memo(({ url, resizeMode = 'cover', style, onError, nativeID }: ImageProps) => {
  const [isError, setError] = useState(false)
  const urlRef = useRef(url)
  urlRef.current = url

  const handleError = useCallback(() => {
    setError(true)
    onError?.(urlRef.current!)
  }, [onError])

  useEffect(() => {
    setError(false)
  }, [url])

  // 当应用从后台返回前台时，重置错误状态以重试加载图片
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && isError) {
        setError(false)
      }
    })
    return () => subscription.remove()
  }, [isError])

  let uri = typeof url == 'number'
    ? _Image.resolveAssetSource(url).uri
    : url?.startsWith('/')
      ? 'file://' + url
      : url
  const showDefault = useMemo(() => !uri || isError, [isError, uri])
  return (
    showDefault ? <EmptyPic style={style} nativeID={nativeID} />
      : (
        <_Image
          style={style}
          source={{
            uri: uri!,
            headers: defaultHeaders,
          }}
          onError={handleError}
          resizeMode={resizeMode}
          nativeID={nativeID}
        />
      )
  )
}, (prevProps, nextProps) => {
  return prevProps.url == nextProps.url &&
    prevProps.style == nextProps.style &&
    prevProps.nativeID == nextProps.nativeID
})

export const getSize = (uri: string, success: (width: number, height: number) => void, failure?: (error: any) => void) => {
  _Image.getSize(uri, success, failure)
}
export default Image

const styles = createStyle({
  emptyPic: {
    borderRadius: BorderRadius.normal,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    paddingLeft: 2,
  },
})
