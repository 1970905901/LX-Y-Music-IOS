import { memo, useCallback, useRef, useState } from 'react'
import { TouchableWithoutFeedback, View, type StyleProp, type ViewStyle } from 'react-native'

import Menu, { type MenuType, type Menus } from '@/components/common/Menu'
import { toast } from '@/utils/tools'
import { downloadMusicWithQuality } from '@/core/download'
import RNFetchBlob from '@/utils/rnFetchBlob'
import { getPicUrl } from '@/core/music/online'
import { getFileExtensionFromUrl } from '@/screens/Home/Views/Mylist/MusicList/download/utils'
import { saveImageToPhotosLibrary } from '@/utils/nativeModules/utils'
import { defaultHeaders } from '@/components/common/Image'
import settingState from '@/store/setting/state'

/**
 * 封面长按菜单（下载歌曲 / 下载封面）——竖屏与横屏播放详情页共用。
 *
 * 为什么抽出来：竖屏 `Vertical/Pic.tsx` 原本内联了这一整套逻辑，横屏 `Horizontal/Pic.tsx`
 * 完全没有入口（用户 2026-10-03 反馈「横屏封面没有下载入口」）。两份各写一遍必然会漂移，
 * 所以这里作为唯一实现，两侧只负责把自己的封面节点塞进来。
 *
 * 下载封面必须写**系统相册**：iOS 沙盒里的 Pictures 目录用户与「文件」App 都看不到，
 * 写沙盒等于功能无效（详见 scripts/sim-cover-download.js 的契约）。
 */
const COVER_MENUS: Menus = [
  { action: 'download_song', label: '下载歌曲' },
  { action: 'download_pic', label: '下载封面' },
]

interface Props {
  // 与 playerState.playMusicInfo.musicInfo 同型（在线歌曲或下载列表项）
  musicInfo?: LX.Player.PlayMusicInfo['musicInfo'] | null
  /** 当前展示的封面地址：在线接口取不到时作为兜底（本地/沙盒文件同样支持） */
  coverUrl?: string
  /** 长按热区（用于菜单定位）的外层样式，一般与封面容器同尺寸 */
  style?: StyleProp<ViewStyle>
  children: React.ReactNode
}

export default memo(({ musicInfo, coverUrl, style, children }: Props) => {
  const menuRef = useRef<MenuType>(null)
  const anchorRef = useRef<View>(null)
  const [menuVisible, setMenuVisible] = useState(false)

  const handleLongPress = useCallback(() => {
    if (!anchorRef.current) return
    anchorRef.current.measure((x, y, w, h, px, py) => {
      setMenuVisible(true)
      requestAnimationFrame(() => {
        menuRef.current?.show({ x: px, y: py, w, h })
      })
    })
  }, [])

  const handleMenuPress = useCallback(({ action }: typeof COVER_MENUS[number]) => {
    if (!musicInfo) return
    switch (action) {
      case 'download_song': {
        // 立即提示「已加入下载 + 音质」，不再让点击看起来毫无反馈
        downloadMusicWithQuality(musicInfo as LX.Music.MusicInfo, settingState.setting['player.playQuality'])
        break
      }
      case 'download_pic': {
        void (async() => {
          try {
            toast('正在下载封面...', 'short')
            // 优先取在线接口的最新封面 URL（可能比缓存里那张更清晰）；接口失败或本地歌曲
            // 就回退到当前正在显示的那张封面（本地/沙盒文件同样支持：shim 内部走 copyFile）。
            let picUrl = ''
            try {
              picUrl = await getPicUrl({ musicInfo: musicInfo as LX.Music.MusicInfoOnline, isRefresh: true })
            } catch {}
            picUrl ||= coverUrl ?? ''
            if (!picUrl) {
              toast('没有可下载的封面', 'short')
              return
            }
            const extension = getFileExtensionFromUrl(picUrl) || 'jpg'
            const tempPath = `${RNFetchBlob.fs.dirs.CacheDir}/lx_cover_${Date.now()}.${extension}`
            await RNFetchBlob.config({
              path: tempPath,
              headers: defaultHeaders,
            }).fetch('GET', picUrl)
            // 沙盒路径用户看不到：必须写进系统相册（PHPhotoLibrary 仅新增权限）
            await saveImageToPhotosLibrary(tempPath)
            void RNFetchBlob.fs.unlink(tempPath).catch(() => {})
            toast('封面已保存到相册', 'long')
          } catch (err: any) {
            toast(`下载封面失败: ${err.message}`, 'long')
          }
        })()
        break
      }
    }
  }, [musicInfo, coverUrl])

  return (
    <>
      <TouchableWithoutFeedback onLongPress={handleLongPress}>
        <View ref={anchorRef} collapsable={false} style={style}>
          {children}
        </View>
      </TouchableWithoutFeedback>
      {menuVisible ? (
        <Menu
          ref={menuRef}
          menus={COVER_MENUS}
          onPress={handleMenuPress}
          onHide={() => { setMenuVisible(false) }}
        />
      ) : null}
    </>
  )
})
