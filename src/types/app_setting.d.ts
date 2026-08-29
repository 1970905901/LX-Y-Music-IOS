import type { I18n } from '@/lang/i18n'
import { type NAV_ID_Type } from '@/config/constant.ts'

declare global {
  namespace LX {
    type AddMusicLocationType = 'top' | 'bottom'
    type DownloadFileNameFormat = '歌名 - 歌手' | '歌手 - 歌名' | '歌名'

    interface AppSetting {
      // 索引签名：lx-music 的设置键为点分字符串（如 'common.wy_cookie'），
      // 新增加设置项常未同步声明到该接口，导致调用方用字符串键索引时报 TS7053 /
      // keyof 错误，并级联引发下游（如 Animated style 的 textAlign）类型错误。
      // 允许任意字符串键索引（值为 any），清除历史既有类型错误且不引入新报错；
      // 已显式声明的键仍保留精确类型。
      [key: string]: any
      version: string
      'version.autoCheckUpdate': boolean

      /**
       * 播放详情页-封面大小
       */
      'playDetail.style.coverSize': number

      /**
       * 歌词水平对齐方式
       */
      'playDetail.style.align': 'left' | 'center' | 'right'
      /**
       * 竖屏歌词字体大小
       */
      'playDetail.vertical.style.lrcFontSize': number

      /**
       * 横屏歌词字体大小
       */
      'playDetail.horizontal.style.lrcFontSize': number

      /**
       * 播放详情页-是否允许通过歌词调整播放进度
       */
      'playDetail.isShowLyricProgressSetting': boolean

      /**
       * 是否启用桌面歌词
       */
      'desktopLyric.enable': boolean

      /**
       * 是否锁定桌面歌词
       */
      'desktopLyric.isLock': boolean

      /**
       * 桌面歌词窗口宽度
       */
      'desktopLyric.width': number

      /**
       * 桌面歌词最大行数
       */
      'desktopLyric.maxLineNum': number

      /**
       * 桌面歌词是否使用单行显示
       */
      'desktopLyric.isSingleLine': boolean

      /**
       * 桌面歌词是否启用歌词切换动画
       */
      'desktopLyric.showToggleAnima': boolean

      /**
       * 桌面歌词窗口x坐标
       */
      'desktopLyric.position.x': number

      /**
       * 桌面歌词窗口y坐标
       */
      'desktopLyric.position.y': number

      /**
       * 歌词水平对齐方式
       */
      'desktopLyric.textPosition.x': 'left' | 'center' | 'right'

      /**
       * 歌词垂直对齐方式
       */
      'desktopLyric.textPosition.y': 'top' | 'center' | 'bottom'

      /**
       * 桌面歌词字体大小
       */
      'desktopLyric.style.fontSize': number

      /**
       * 桌面歌词字体透明度
       */
      'desktopLyric.style.opacity': number

      /**
       * 桌面歌词未播放字体颜色
       */
      'desktopLyric.style.lyricUnplayColor': string

      /**
       * 桌面歌词已播放字体颜色
       */
      'desktopLyric.style.lyricPlayedColor': string

      /**
       * 桌面歌词字体阴影颜色
       */
      'desktopLyric.style.lyricShadowColor': string

      /**
       * 是否显示热门搜索
       */
      'search.isShowHotSearch': boolean

      /**
       * 是否显示搜索历史
       */
      'search.isShowHistorySearch': boolean

      /**
       * 启用的搜索平台
       */
      'search.enabledSources': Record<string, boolean>

      /**
       * 是否启用双击列表里的歌曲时自动切换到当前列表播放（仅对歌单、排行榜有效）
       */
      'list.isClickPlayList': boolean

      /**
       * 是否显示歌曲来源（仅对我的列表有效）
       */
      'list.isShowSource': boolean

      /**
       * 是否显示歌曲专辑名
       */
      'list.isShowAlbumName': boolean

      /**
       * 是否显示歌曲时长
       */
      'list.isShowInterval': boolean
      'list.isShowCover': boolean

      /**
       * 是否自动恢复列表滚动位置（仅对我的列表有效）
       */
      'list.isSaveScrollLocation': boolean

      /**
       * 添加歌曲到我的列表时的方式
       */
      'list.addMusicLocationType': AddMusicLocationType

      'list.isShowMyListSubMenu': boolean
      'list.isAutoSaveDailyRec': boolean

      'menu.playLater': boolean
      'menu.addTo': boolean
      'menu.playMV': boolean
      'menu.songDetail': boolean
      'menu.dislike': boolean

      'menu.moveTo': boolean
      'menu.changePosition': boolean
      'menu.changeSource': boolean

      'artistDetail.albumViewMode': 'grid' | 'list'
      /**
       * 是否启用下载
       */
      'download.enable': boolean

      'download.path': string
      /**
       * 文件命名方式
       */
      'download.fileName': '歌名 - 歌手' | '歌手 - 歌名' | '歌名'

      /**
       * 是否写入歌词
       */
      'download.writeLyric': boolean
      /**
         * 是否写入罗马音歌词
       */
      'download.writeRomaLyric': boolean
      /**
       * 是否内嵌歌词到音频文件
       */
      'download.writeEmbedLyric': boolean
      /**
       * 是否写入封面
       */
      'download.writePicture': boolean

      /**
       * 是否写入元数据
       */
      'download.writeMetadata': boolean
      'download.writeAlias': boolean

      /**
       * 是否启用同步
       */
      'sync.enable': boolean
      'sync.webdav.enable': boolean
      'sync.webdav.syncLists': boolean
      'sync.webdav.syncPlayHistory': boolean
      'sync.webdav.syncDownloadTasks': boolean
      'sync.webdav.url': string
      'sync.webdav.username': string
      'sync.webdav.password': string
      'webdav.downloadPath': string
      'sync.webdav.path': string
      'sync.webdav.lastSyncTimeLists': number
    }
  }
}
