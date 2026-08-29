import { useEffect, useState, useCallback } from 'react'
import { windowSizeTools } from '../windowSizeTools'

export default () => {
  // 窗口尚未布局时 size 为 {0,0}，若用 `>=` 判断 portrait/landscape 会同时为 true；
  // 用严格 `>` 并在宽高为 0 时双双置 false，待首次尺寸回调再确定方向。
  const isOrientationPortrait = ({ width, height }) => width > 0 && height >= width
  const isOrientationLandscape = ({ width, height }) => height > 0 && width > height

  const size = windowSizeTools.getSize()
  const [orientation, setOrientation] = useState({
    portrait: isOrientationPortrait(size),
    landscape: isOrientationLandscape(size),
  })

  const onChange = useCallback((size) => {
    setOrientation({
      portrait: isOrientationPortrait(size),
      landscape: isOrientationLandscape(size),
    })
  }, [])

  useEffect(() => {
    const changeEvent = windowSizeTools.onSizeChanged(onChange)

    return () => {
      changeEvent.remove()
    }
  }, [onChange])

  return orientation
}
