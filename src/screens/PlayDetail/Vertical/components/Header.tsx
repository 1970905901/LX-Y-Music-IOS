import { scaleSizeH } from '@/utils/pixelRatio'
import { HEADER_HEIGHT as _HEADER_HEIGHT } from '@/config/constant'
import HeaderNew from './HeaderNew'

export const HEADER_HEIGHT = scaleSizeH(_HEADER_HEIGHT)

export default ({ pageIndex }: { pageIndex?: number }) => <HeaderNew pageIndex={pageIndex} />
