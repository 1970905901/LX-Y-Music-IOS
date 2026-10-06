import { useHorizontalMode } from '@/utils/hooks'
import Vertical from './Vertical'
import Horizontal from './Horizontal'

export default () => {
  const isHorizontalMode = useHorizontalMode()

  return isHorizontalMode ? <Horizontal /> : <Vertical />
}
