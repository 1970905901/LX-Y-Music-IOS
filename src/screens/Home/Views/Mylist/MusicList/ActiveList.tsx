import { forwardRef, useImperativeHandle, useMemo, useState } from 'react'
import { TouchableOpacity } from 'react-native'

import { Icon } from '@/components/common/Icon'
import { BorderWidths } from '@/theme'
import { useTheme } from '@/store/theme/hook'
import { useActiveListId, useListFetching } from '@/store/list/hook'
import listState from '@/store/list/state'
import { createStyle } from '@/utils/tools'
import Text from '@/components/common/Text'
import { LIST_IDS } from '@/config/constant'
import Loading from '@/components/common/Loading'

export interface ActiveListProps {
  onShowSearchBar: () => void
  onScrollToTop: () => void
  showCover: boolean
  onToggleView: () => void
  onBack?: () => void
}
export interface ActiveListType {
  setVisibleBar: (visible: boolean) => void
}

export default forwardRef<ActiveListType, ActiveListProps>(
  ({ onShowSearchBar, onScrollToTop, showCover, onToggleView, onBack }, ref) => {
    const theme = useTheme()
    const currentListId = useActiveListId()
    const fetching = useListFetching(currentListId)
    const currentListName = useMemo(() => {
      switch (currentListId) {
        case LIST_IDS.TEMP:
          return global.i18n.t('list_name_temp')
        case LIST_IDS.DEFAULT:
          return global.i18n.t('list_name_default')
        case LIST_IDS.LOVE:
          return global.i18n.t('list_name_love')
        default:
          return listState.allList.find((l) => l.id === currentListId)?.name ?? ''
      }
    }, [currentListId])
    const [visibleBar, setVisibleBar] = useState(true)

    useImperativeHandle(ref, () => ({
      setVisibleBar(visible) {
        setVisibleBar(visible)
      },
    }))

    const showList = () => {
      global.app_event.changeLoveListVisible(true)
    }

    // 这里【不能】再在挂载时全局写 setActiveList(getListPrevSelectId())：
    // 1) 它是全局副作用（listState + mylistToggled 广播），而本组件只是歌曲列表的
    //    头部条，每次进入详情都会挂载一次，会覆盖掉用户刚点选的那个列表；
    // 2) getListPrevSelectId() 是异步的，返回时用户可能已经按了「返回」（本组件已
    //    卸载），迟到回调仍会把 activeListId 改回上次的列表 —— 而 NewListUI 里
    //    「activeListId != default 就打开详情覆盖层」的 effect 会因此把用户刚关掉的
    //    详情页重新打开，表现为「返回后再次进入」状态错乱。
    // 当前列表由 NewListUI.handleItemPress 在打开前写入、列表数据由 List 挂载时按
    // getListPrevSelectId() 载入，此处无需也不应再写。

    return (
      <TouchableOpacity
        onPress={onBack || showList}
        onLongPress={onScrollToTop}
        style={{
          ...styles.currentList,
          opacity: visibleBar ? 1 : 0,
          borderBottomColor: theme['c-border-background'],
        }}
      >
        <Icon
          style={styles.currentListIcon}
          color={theme['c-button-font']}
          name={onBack ? 'chevron-left' : 'chevron-right'}
          size={onBack ? 18 : 12}
        />
        {fetching ? <Loading color={theme['c-button-font']} style={styles.loading} /> : null}
        <Text style={styles.currentListText} numberOfLines={1} color={theme['c-button-font']}>
          {onBack ? '返回' : currentListName}
        </Text>
        <TouchableOpacity style={styles.currentListBtns} onPress={onToggleView}>
          <Icon color={theme['c-button-font']} name={showCover ? 'menu' : 'album'} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.currentListBtns} onPress={onShowSearchBar}>
          <Icon color={theme['c-button-font']} name="search-2" />
        </TouchableOpacity>
      </TouchableOpacity>
    )
  },
)

const styles = createStyle({
  currentList: {
    flexDirection: 'row',
    paddingRight: 2,
    height: 36,
    alignItems: 'center',
    borderBottomWidth: BorderWidths.normal,
    // backgroundColor: 'rgba(0,0,0,0.2)',
  },
  currentListIcon: {
    paddingLeft: 15,
    paddingRight: 10,
    // paddingTop: 10,
    // paddingBottom: 0,
  },
  currentListText: {
    flex: 1,
    // minWidth: 70,
    // paddingLeft: 10,
    paddingRight: 10,
    // paddingTop: 10,
    // paddingBottom: 10,
  },
  loading: {
    marginRight: 5,
  },
  currentListBtns: {
    width: 46,
    justifyContent: 'center',
    alignItems: 'center',
    height: '100%',
    // backgroundColor: 'rgba(0,0,0,0.2)',
  },
})
