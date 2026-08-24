import { memo } from 'react'
import { View, type StyleProp, type ViewStyle } from 'react-native'
import Svg, { Path, Rect, Line, Circle } from 'react-native-svg'
import { scaleSizeW } from '@/utils/pixelRatio'

interface SvgIconProps {
  name: string
  size?: number
  rawSize?: number
  color?: string
  style?: StyleProp<ViewStyle>
}


const CalendarIcon = ({ size, color }: { size: number; color: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    {/* 日历主体 */}
    <Rect x="2" y="3" width="20" height="19" rx="2" ry="2" stroke={color} strokeWidth="1.6" fill="none" />
    {/* 顶部横线（日历头部） */}
    <Line x1="2" y1="8" x2="22" y2="8" stroke={color} strokeWidth="1.6" />
    {/* 左侧挂钩 */}
    <Line x1="7" y1="1" x2="7" y2="5" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    {/* 右侧挂钩 */}
    <Line x1="17" y1="1" x2="17" y2="5" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    {/* 日期点 - 2x3 布局 */}
    <Circle cx="7" cy="12.5" r="1.2" fill={color} />
    <Circle cx="12" cy="12.5" r="1.2" fill={color} />
    <Circle cx="17" cy="12.5" r="1.2" fill={color} />
    <Circle cx="7" cy="17" r="1.2" fill={color} />
    <Circle cx="12" cy="17" r="1.2" fill={color} />
    <Circle cx="17" cy="17" r="1.2" fill={color} />
  </Svg>
)

const ArtistIcon = ({ size, color }: { size: number; color: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    {/* 头部 */}
    <Circle cx="12" cy="8.5" r="4.5" stroke={color} strokeWidth="1.6" fill="none" />
    {/* 身体 */}
    <Path
      d="M3.5 22c0-4.694 3.806-8.5 8.5-8.5s8.5 3.806 8.5 8.5"
      stroke={color}
      strokeWidth="1.6"
      strokeLinecap="round"
      fill="none"
    />
  </Svg>
)


const AlbumDiscIcon = ({ size, color }: { size: number; color: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    {/* 外圈 */}
    <Circle cx="12" cy="12" r="11" stroke={color} strokeWidth="1.6" fill="none" />
    {/* 内圈（唱片中心孔） */}
    <Circle cx="12" cy="12" r="3" stroke={color} strokeWidth="1.6" fill="none" />
    {/* 中心点 */}
    <Circle cx="12" cy="12" r="1" fill={color} />
  </Svg>
)

const OneDriveIcon = ({ size, color }: { size: number; color: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M6.6 19.35h11.2c2.62 0 4.7-2.04 4.7-4.62 0-2.24-1.6-4.11-3.72-4.52-.65-2.98-3.09-5.21-5.97-5.21-2.4 0-4.58 1.55-5.58 3.96a5.26 5.26 0 0 0-1.55-.24C3.05 8.72.9 11 .9 13.79c0 3.11 2.33 5.56 5.7 5.56z"
      stroke={color}
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  </Svg>
)

const HeartbeatIcon = ({ size, color }: { size: number; color: string }) => (
  <Svg width={size} height={size} viewBox="0 0 1165 1024" fill="none">
    <Path
      d="M582.103 1023.979c-0.017 0-0.037 0-0.057 0-9.91 0-19.135-2.929-26.858-7.969l0.189 0.116-0.366-0.236c-37.014-20.47-322.334-182.265-474.13-387.408-50.491-68.21-80.819-154.003-80.819-246.879 0-19.704 1.365-39.089 4.006-58.067l-0.25 2.192c14.344-104.705 67.037-196.32 148.366-258.045 92.559-70.283 201.609-86.225 315.345-45.86 43.791 16.083 81.683 36.31 116.21 60.947l-1.48-1.003c33.048-23.634 70.939-43.86 111.372-58.853l3.359-1.091c113.788-40.337 222.838-24.422 315.37 45.86 81.33 61.829 134.022 153.471 148.366 258.045 2.401 16.818 3.771 36.242 3.771 55.986 0 92.851-30.314 178.622-81.584 247.955l0.802-1.136c-152.712 206.19-440.415 368.797-474.783 387.643-7.598 4.895-16.869 7.819-26.821 7.853h-0.009zM347.59 105.694c-43.425 0-89.994 12.46-135.593 47.117-59.054 44.892-97.349 111.588-107.794 187.813-1.757 12.365-2.76 26.646-2.76 41.16 0 68.639 22.431 132.040 60.363 183.271l-0.591-0.835c123.421 166.664 348.143 304.769 421.071 347.018 73.005-42.169 297.65-180.354 421.071-347.018 37.342-50.393 59.773-113.792 59.773-182.429 0-14.517-1.004-28.801-2.945-42.783l0.184 1.616c-10.471-76.199-48.74-142.895-107.82-187.813-159.125-120.933-330.108 28.27-337.384 34.684-8.691 7.859-20.268 12.668-32.969 12.668s-24.278-4.809-33.012-12.706l0.043 0.038c-5.052-4.555-93.553-81.801-201.634-81.801z"
      fill={color}
      stroke={color}
    />
    <Path
      d="M380 430 L 480 300 L 680 530 L 780 400"
      stroke={color}
      strokeWidth="70"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
)

const MusicListIcon = ({ size, color }: { size: number; color: string }) => (
  <Svg width={size} height={size} viewBox="0 0 1024 1024" fill="none">
    <Path
      d="M128 256h768v64H128z m0 192h768v64H128z m0 192h448v64H128z m0 192h448v64H128z"
      fill={color}
    />
    <Path
      d="M704 608v192l160-96z"
      fill={color}
    />
  </Svg>
)

const ExportIcon = ({ size, color }: { size: number; color: string }) => (
  <Svg width={size} height={size} viewBox="0 0 1024 1024" fill="none">
    <Path
      d="M832.853333 975.530667H163.84c-68.266667 0-129.706667-54.613333-129.706667-129.706667V204.117333C34.133333 135.850667 95.573333 60.757333 170.666667 60.757333h368.64v95.573334h-341.333334c-34.133333 0-68.266667 27.306667-68.266666 81.92v580.266666c0 34.133333 27.306667 61.44 68.266666 61.44h628.053334c34.133333 0 47.786667-27.306667 47.786666-68.266666V484.010667h102.4V845.824c0 75.093333-75.093333 129.706667-143.36 129.706667"
      fill={color}
    />
    <Path
      d="M361.813333 669.013333c-13.653333 0-27.306667-6.826667-34.133333-13.653333-20.48-20.48-20.48-47.786667 0-68.266667l477.866667-436.906666H689.493333c-27.306667 0-47.786667-20.48-47.786666-47.786667 0-27.306667 20.48-47.786667 47.786666-47.786667H921.6c20.48 0 40.96 13.653333 47.786667 27.306667 6.826667 20.48 0 40.96-13.653334 54.613333L395.946667 655.36c-13.653333 13.653333-20.48 13.653333-34.133334 13.653333"
      fill={color}
    />
    <Path
      d="M921.6 382.293333c-27.306667 0-47.786667-20.48-47.786667-47.786666V102.4c0-27.306667 20.48-47.786667 47.786667-47.786667 27.306667 0 47.786667 20.48 47.786667 47.786667v232.106667c6.826667 27.306667-20.48 47.786667-47.786667 47.786666"
      fill={color}
    />
  </Svg>
)

const FolderIcon = ({ size, color }: { size: number; color: string }) => (
  <Svg width={size} height={size} viewBox="0 0 1024 1024" fill="none">
    <Path
      d="M800.6144 915.2512H227.8912a164.1984 164.1984 0 0 1-163.84-163.84V272.128a164.1984 164.1984 0 0 1 163.84-163.84H363.52a169.4208 169.4208 0 0 1 101.2224 33.536l76.3904 57.4464a107.52 107.52 0 0 0 64.2048 21.4528h195.2768a164.1984 164.1984 0 0 1 163.84 163.84v366.4384a164.1984 164.1984 0 0 1-163.84 164.2496zM227.8912 169.5232a102.7072 102.7072 0 0 0-102.4 102.4v479.0784a102.7072 102.7072 0 0 0 102.4 102.4h572.7232a102.7072 102.7072 0 0 0 102.4-102.4V384.768a102.7072 102.7072 0 0 0-102.4-102.4h-195.2768a169.3184 169.3184 0 0 1-101.12-33.792L427.8272 190.9248A107.52 107.52 0 0 0 363.52 169.5232z"
      fill={color}
    />
    <Path
      d="M763.6992 474.2656h-172.032a35.84 35.84 0 0 1 0-71.68h172.032a35.84 35.84 0 0 1 0 71.68z"
      fill={color}
    />
  </Svg>
)


const ExpandIcon = ({ size, color }: { size: number; color: string }) => (
  <Svg width={size} height={size} viewBox="0 0 1048 1024" fill="none">
    <Path
      d="M565.514 752.186c0.393-0.394 0.491-0.935 0.861-1.326l431.062-392.233c23.201-23.692 23.471-61.882 0.566-85.254-22.906-23.374-60.284-23.126-83.511 0.589l-390.168 355.025-390.933-355.739c-23.224-23.691-60.826-23.716-84.025-0.049-23.174 23.692-23.151 62.079 0.049 85.795l432.096 393.168c23.199 23.692 60.827 23.714 84.001 0.024z"
      fill={color}
    />
  </Svg>
)


const CollapseIcon = ({ size, color }: { size: number; color: string }) => (
  <Svg width={size} height={size} viewBox="0 0 1048 1024" fill="none">
    <Path
      d="M565.514 273.221c0.393 0.394 0.491 0.935 0.861 1.326l431.062 392.233c23.201 23.692 23.471 61.883 0.566 85.254-22.906 23.374-60.284 23.126-83.511-0.589l-390.168-355.025-390.933 355.739c-23.224 23.691-60.826 23.716-84.025 0.049-23.174-23.692-23.151-62.079 0.049-85.795l432.096-393.168c23.199-23.692 60.827-23.716 84.001-0.024z"
      fill={color}
    />
  </Svg>
)


const LyricIcon = ({ size, color }: { size: number; color: string }) => (
  <Svg width={size} height={size} viewBox="0 0 1024 1024" fill={color}>
    <Path
      d="M198.070857 73.142857l30.72 41.984a2919.862857 2919.862857 0 0 1 94.208 130.048l-90.112 62.464c-27.282286-42.349714-68.242286-99.693714-122.88-172.032L198.070857 73.142857z m174.08 41.984h569.344v754.688c0 34.157714-4.096 60.416-12.288 78.848a74.971429 74.971429 0 0 1-41.984 40.96c-19.748571 8.192-47.762286 12.288-83.968 12.288h-128l-21.504-99.328h111.616c19.090286 0 33.426286-2.048 43.008-6.144a30.573714 30.573714 0 0 0 18.432-19.456c3.437714-8.850286 5.12-22.162286 5.12-39.936V220.598857H372.150857V115.126857z m-23.552 299.008V313.782857h435.2v100.352h-435.2zM73.142857 391.606857h192.512v400.384l72.704-66.56 22.528 119.808-157.696 140.288-67.584-74.752c9.508571-11.629714 15.725714-23.552 18.432-35.84 3.437714-12.288 5.12-29.330286 5.12-51.2V502.198857H73.142857V391.606857z m312.32 453.632V503.222857h352.256v342.016H385.462857zM638.390857 600.502857H485.814857v148.48h152.576V600.502857z"
    />
  </Svg>
)

const FuzzySearchIcon = ({ size, color }: { size: number; color: string }) => (
  <Svg width={size} height={size} viewBox="0 0 1024 1024" fill="none">
    <Path
      d="M476.014 73.143c159.525-0.219 304.128 91.941 368.567 234.789a387.291 387.291 0 0 1-71.314 424.741l168.448 164.864a30.866 30.866 0 0 1 0 43.886 32.402 32.402 0 0 1-45.495 0L727.113 776.046a409.966 409.966 0 0 1-478.135 17.262C102.985 695.735 38.985 516.535 91.063 351.232 143.214 185.929 299.301 73.143 476.014 73.143z m0 62.683c-187.173 0-338.871 148.48-338.871 331.63 0 183.223 151.698 331.703 338.871 331.703a342.601 342.601 0 0 0 239.616-97.134A328.119 328.119 0 0 0 814.811 467.383c0-183.15-151.698-331.63-338.871-331.63zM475.429 256a219.429 219.429 0 0 1 219.429 219.429 36.571 36.571 0 0 1-73.143 0 146.286 146.286 0 0 0-146.286-146.286 36.571 36.571 0 0 1 0-73.143z"
      fill={color}
    />
  </Svg>
)

const MusicRecognitionIcon = ({ size, color }: { size: number; color: string }) => (
  <Svg width={size} height={size} viewBox="0 0 1024 1024" fill="none">
    <Path d="M907.9 406c-9.9 0-19.1-6.3-22.4-16.2C852 287.4 776.8 202.3 679.1 156.3c-11.8-5.5-16.8-19.6-11.3-31.4 5.6-11.8 19.6-16.8 31.4-11.3 109.4 51.5 193.7 146.8 231.2 261.5 4 12.4-2.7 25.7-15.1 29.7-2.5 0.8-4.9 1.2-7.4 1.2zM116.1 406c-2.4 0-4.9-0.4-7.3-1.2-12.4-4-19.1-17.4-15.1-29.7C153 193.8 321.1 72 512 72c35.3 0 70.4 4.2 104.4 12.5 12.6 3.1 20.4 15.8 17.3 28.5-3.1 12.6-15.8 20.4-28.5 17.3-30.4-7.4-61.7-11.1-93.2-11.1-170.5 0-320.6 108.8-373.5 270.7-3.3 9.8-12.5 16.1-22.4 16.1zM220 832.5c-6 0-11.9-2.2-16.5-6.8-50.1-49.2-88.1-110.3-109.8-176.7-4-12.4 2.7-25.7 15.1-29.7 12.4-4 25.7 2.7 29.7 15.1 19.4 59.3 53.3 113.9 98 157.9 9.3 9.1 9.4 24 0.3 33.3-4.6 4.6-10.7 6.9-16.8 6.9zM333.9 912.1c-3.4 0-6.8-0.7-10.1-2.3-20.2-9.6-39.9-20.8-58.6-33.5-10.8-7.3-13.6-22-6.3-32.7 7.3-10.8 22-13.6 32.7-6.3 16.7 11.3 34.2 21.3 52.3 29.9 11.8 5.6 16.8 19.6 11.2 31.4-3.9 8.5-12.4 13.5-21.2 13.5z" fill={color} />
    <Path d="M512 952c-33 0-65.8-3.7-97.7-10.9-31.2-7.1-61.6-17.6-90.6-31.3-11.8-5.6-16.8-19.6-11.2-31.4 5.6-11.8 19.6-16.7 31.4-11.2 25.8 12.2 53 21.6 80.8 27.9 28.4 6.4 57.8 9.7 87.2 9.7 170.5 0 320.6-108.8 373.5-270.7 4-12.4 17.4-19.1 29.7-15.1 12.4 4 19.1 17.4 15.1 29.7C871 830.2 702.9 952 512 952zM779.2 406c-8.7 0-17.1-4.9-21.2-13.3-46.1-95.1-140.4-154.1-246-154.1-37.3 0-73.5 7.4-107.5 21.9-12 5.2-25.8-0.4-30.9-12.4-5.1-12 0.4-25.8 12.4-30.9 39.9-17.1 82.3-25.7 126.1-25.7 121.9 0 235.1 70.9 288.4 180.6 5.7 11.7 0.8 25.8-10.9 31.5-3.4 1.7-6.9 2.4-10.4 2.4zM244.8 406c-3.5 0-7-0.8-10.3-2.4-11.7-5.7-16.6-19.8-10.9-31.5 21.4-44 53.1-83.1 91.8-113.2 10.2-8 25.1-6.2 33.1 4.1s6.2 25.1-4.1 33.1c-33 25.7-60.1 59.1-78.3 96.6-4.2 8.5-12.6 13.3-21.3 13.3z" fill={color} />
    <Path d="M512 832.5c-121.9 0-235.1-70.9-288.4-180.6-5.7-11.7-0.8-25.8 10.9-31.5 11.7-5.7 25.8-0.8 31.5 10.9 46.1 95.1 140.4 154.1 246 154.1 37.4 0 73.6-7.4 107.6-22 11.9-5.1 25.8 0.4 30.9 12.4 5.1 12-0.4 25.8-12.4 30.9-39.9 17.1-82.3 25.8-126.1 25.8zM706.3 760.1c-6.6 0-13.2-2.8-17.8-8.1-8.5-9.8-7.5-24.7 2.4-33.2 28.3-24.5 50.9-53.9 67.2-87.5 5.7-11.7 19.8-16.6 31.5-10.9 11.7 5.7 16.6 19.8 10.9 31.5-19.1 39.3-45.6 73.8-78.8 102.5-4.5 3.8-10 5.7-15.4 5.7zM555.9 558c-4.5 0-9.1-1.3-13.1-4-10.8-7.2-13.7-21.9-6.5-32.7L743.9 211c7.2-10.8 21.9-13.7 32.7-6.5 10.8 7.2 13.7 21.9 6.5 32.7L575.5 547.6c-4.5 6.8-12 10.4-19.6 10.4z" fill={color} />
    <Path d="M479.4 515.5m-98.8 0a98.8 98.8 0 1 0 197.6 0 98.8 98.8 0 1 0-197.6 0Z" fill={color} />
  </Svg>
)

const WebVisualizerIcon = ({ size, color }: { size: number; color: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Rect x="2" y="3" width="20" height="14" rx="2" stroke={color} strokeWidth="1.6" />
    <Line x1="8" y1="21" x2="16" y2="21" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    <Line x1="12" y1="17" x2="12" y2="21" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    <Path d="M6 10 L9 7 L12 10 L15 7 L18 10" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
)

export const SvgIcon = memo(({ name, size = 15, rawSize, color = '#000', style }: SvgIconProps) => {
  const finalSize = rawSize ?? scaleSizeW(size)

  const renderIcon = () => {
    switch (name) {
      case 'calendar':
        return <CalendarIcon size={finalSize} color={color} />
      case 'artist':
        return <ArtistIcon size={finalSize} color={color} />
      case 'album-disc':
        return <AlbumDiscIcon size={finalSize} color={color} />
      case 'onedrive':
        return <OneDriveIcon size={finalSize} color={color} />
      case 'heartbeat':
        return <HeartbeatIcon size={finalSize} color={color} />
      case 'folder':
        return <FolderIcon size={finalSize} color={color} />
      case 'music-list':
        return <MusicListIcon size={finalSize} color={color} />
      case 'export':
        return <ExportIcon size={finalSize} color={color} />
      case 'expand':
        return <ExpandIcon size={finalSize} color={color} />
      case 'collapse':
        return <CollapseIcon size={finalSize} color={color} />
      case 'lyric':
        return <LyricIcon size={finalSize} color={color} />
      case 'music-recognition':
        return <MusicRecognitionIcon size={finalSize} color={color} />
      case 'web-visualizer':
        return <WebVisualizerIcon size={finalSize} color={color} />
      case 'fuzzy-search':
        return <FuzzySearchIcon size={finalSize} color={color} />
      default:
        return null
    }
  }

  const icon = renderIcon()
  if (!icon) return null

  return style ? <View style={style}>{icon}</View> : icon
})

export {}
