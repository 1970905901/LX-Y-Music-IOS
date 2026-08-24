import { View } from 'react-native'
import { useState, useEffect, useRef, useImperativeHandle, forwardRef, useMemo } from 'react'
import ConfirmAlert, { type ConfirmAlertType } from '@/components/common/ConfirmAlert'
import Text from '@/components/common/Text'
import { createStyle } from '@/utils/tools'
import CheckBox from '@/components/common/CheckBox'
import { handleDownload } from './listAction'
import { getLastSelectQuality, saveLastSelectQuality } from '@/utils/data'
import { addTask as addDownloadTask } from '@/core/download';
import {fetchAndApplyDetailedQuality} from "@/utils/musicSdk/wy/musicDetail.js";

interface TitleType {
  updateTitle: (musicInfo: LX.Music.MusicInfo) => void
}
const Title = forwardRef<TitleType, {}>((props, ref) => {
  const [title, setTitle] = useState('')
  useImperativeHandle(ref, () => ({
    updateTitle(musicInfo) {
      setTitle(
        global.i18n.t('download_music_title', { name: musicInfo.name, artist: musicInfo.singer })
      )
    },
  }))

  return <Text style={{ marginBottom: 5 }}>{title}</Text>
})

interface PositionInputType {
  getText: () => string
  setText: (text: string) => void
  focus: () => void
}

export interface SelectInfo {
  musicInfo: LX.Music.MusicInfo
  selectedList: LX.Music.MusicInfo[]
  index: number
  listId: string
  single: boolean
}
const initSelectInfo = {}

interface MusicDownloadModalProps {
  onDownloadInfo: (info: LX.Music.MusicInfo) => void
}

export interface MusicDownloadModalType {
  show: (info: LX.Music.MusicInfo) => void
}


export default forwardRef<MusicDownloadModalType, MusicDownloadModalProps>(
  ({ onDownloadInfo }, ref) => {
    const alertRef = useRef<ConfirmAlertType>(null)
    const titleRef = useRef<TitleType>(null)
    const selectedInfo = useRef<LX.Music.MusicInfo>(initSelectInfo as LX.Music.MusicInfo)
    const [selectedQuality, setSelectedQuality] = useState<LX.Quality>('128k')
    const [playQualityList, setPlayQualityList] = useState<MusicOption[]>([])
    const [visible, setVisible] = useState(false)

    interface QualityMap {
      [key: string]: MusicOption
    }

    useEffect(() => {
      if (!visible || !playQualityList.length) return

      const applyLastQuality = async() => {
          if (selectedInfo.current.source === 'bilibili') {
          const quality192k = playQualityList.find(q => q.id === '192k')
          if (quality192k) {
            setSelectedQuality('192k')
            return
          }
        }
        
        const lastQuality = await getLastSelectQuality()
        const qualityExists = playQualityList.some(q => q.id === lastQuality)
        if (qualityExists) {
          setSelectedQuality(lastQuality)
        } else {
          setSelectedQuality(playQualityList[0].id)
        }
      }

      void applyLastQuality()
    }, [visible, playQualityList])

    const calcQualitys = (musicInfo: LX.Music.MusicInfo) => {
      const map = new Map()

      map.set('128k', global.i18n.t('128k'))
      map.set('192k', '192k')
      map.set('320k', global.i18n.t('320k'))
      map.set('flac', global.i18n.t('flac'))
      map.set('hires', global.i18n.t('hires'))
      map.set('atmos', global.i18n.t('atmos'))
      map.set('atmos_plus', global.i18n.t('atmos_plus'))
      map.set('master', global.i18n.t('master'))

      // @ts-ignore
      const qualitys = musicInfo.meta.qualitys

      const qualityMap: QualityMap = {}
      for (const element of qualitys) {
        const temp: MusicOption = {
          id: element.type,
          name: map.has(element.type) ? map.get(element.type) : '未知',
          size: element.size,
          key: element.type,
        }
        qualityMap[element.type] = temp
      }
      setPlayQualityList(Object.values(qualityMap))
    }

    useImperativeHandle(ref, () => ({
      async show(info) {
        selectedInfo.current = info
        titleRef.current?.updateTitle(info)
        calcQualitys(info)

        if (visible) {
          alertRef.current?.setVisible(true)
        } else {
          setVisible(true)
        }

        if (info.source === 'wy' && !info.meta._full) {
          const detailedInfo = await fetchAndApplyDetailedQuality(info as LX.Music.MusicInfoOnline, 0, true);

          if (detailedInfo.meta._full) {
            selectedInfo.current = detailedInfo;
            calcQualitys(detailedInfo);
          }
        }
      },
    }))

    useEffect(() => {
      if (visible) {
        alertRef.current?.setVisible(true)
      }
    }, [visible])

    const handleDownloadMusic = () => {
      void saveLastSelectQuality(selectedQuality)
      alertRef.current?.setVisible(false)
      addDownloadTask(selectedInfo.current, selectedQuality);
      setTimeout(() => {
        setSelectedQuality(selectedInfo.current.source === 'bilibili' ? '192k' : '128k');
      }, 300)
    }

    interface MusicOption {
      id: LX.Quality
      name: string
      size?: string | null
      key?: string
    }

    const useActive = (id: LX.Quality) => {
      return useMemo(() => selectedQuality === id, [selectedQuality, id])
    }

    const Item = ({ id, name }: { id: LX.Quality; name: string }) => {
      const isActive = useActive(id)
      return (
        <CheckBox
          marginRight={8}
          check={isActive}
          label={name}
          onChange={() => {
            setSelectedQuality(id)
          }}
          need
        />
      )
    }

    return visible ? (
      <ConfirmAlert
        ref={alertRef}
        onConfirm={handleDownloadMusic}
        onHide={() => setVisible(false) }
      >
        <View style={styles.content}>
          <Title ref={titleRef} />
          <View style={styles.list}>
            {playQualityList.map((item) => (
              <Item name={item.name + (item.size ? ` (${item.size})` : '')} id={item.id} key={item.key} />
            ))}
          </View>
        </View>
      </ConfirmAlert>
    ) : null
  }
)

const styles = createStyle({
  content: {
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: 'column',
  },
  input: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 260,
    borderRadius: 4,
  },
  list: {
    flexDirection: 'column',
    flexWrap: 'nowrap',
  },
})
