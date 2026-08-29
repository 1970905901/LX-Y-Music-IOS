import { useEffect, useRef, useState } from 'react'

import { type Source } from '@/store/songlist/state'
import { useHorizontalMode } from '@/utils/hooks'
import List, { type ListProps, type ListType } from './List'

export default () => {
  const isHorizontal = useHorizontalMode()
  // 横屏下标签列表常驻左栏，挂载即显示（内容由 showSonglistTagList 事件加载）
  const [visible, setVisible] = useState(isHorizontal)
  const listRef = useRef<ListType>(null)
  // const [info, setInfo] = useState({ souce: 'kw', activeId: '' })

  useEffect(() => {
    let isInited = false
    const handleShow = (source: Source, id: string) => {
      if (isInited) {
        listRef.current?.loadTag(source, id)
      } else {
        requestAnimationFrame(() => {
          setVisible(true)
          requestAnimationFrame(() => {
            listRef.current?.loadTag(source, id)
          })
        })
        isInited = true
      }
    }
    global.app_event.on('showSonglistTagList', handleShow)

    return () => {
      global.app_event.off('showSonglistTagList', handleShow)
    }
  }, [])

  const handleTagChange: ListProps['onTagChange'] = (name, id) => {
    // 横屏下标签列表常驻左栏，选中后无需关闭抽屉
    if (!isHorizontal) {
      global.app_event.hideSonglistTagList()
    }
    requestAnimationFrame(() => {
      global.app_event.songlistTagInfoChange(name, id)
    })
  }

  return visible ? <List ref={listRef} onTagChange={handleTagChange} /> : null
}
