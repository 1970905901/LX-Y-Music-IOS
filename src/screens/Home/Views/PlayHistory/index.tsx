import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TouchableOpacity, View } from 'react-native'
import PagerView, { type PagerViewOnPageSelectedEvent } from 'react-native-pager-view'
import OnlineList, { type OnlineListType } from '@/components/OnlineList'
import Text from '@/components/common/Text'
import Popup, { type PopupType } from '@/components/common/Popup'
import { Icon } from '@/components/common/Icon'
import { playOnlineList } from '@/core/list'
import { getPlayHistoryByRange } from '@/core/player/playHistory'
import { usePlayerMusicInfo } from '@/store/player/hook'
import { useTheme } from '@/store/theme/hook'
import { createStyle, toast } from '@/utils/tools'

type HistoryMusicInfo = LX.Music.MusicInfoOnline & {
  playHistoryId: string
  playHistorySource: LX.Player.PlayHistorySource
}

const DAY = 24 * 60 * 60 * 1000
const WEEK_DAYS = ['日', '一', '二', '三', '四', '五', '六']

const toDateText = (date: Date) => {
  const y = date.getFullYear()
  const m = `${date.getMonth() + 1}`.padStart(2, '0')
  const d = `${date.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${d}`
}

const parseDateText = (text: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  const [y, m, d] = text.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null
  return date
}

const getDayStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()

const getTodayText = () => toDateText(new Date())

const getNextDateText = (dateText: string, offset: number) => {
  const date = parseDateText(dateText) ?? new Date()
  date.setDate(date.getDate() + offset)
  return toDateText(date)
}

const getMonthText = (date: Date) => `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}`

const getMonthDays = (monthDate: Date) => {
  const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1)
  const startDate = new Date(firstDay)
  startDate.setDate(firstDay.getDate() - firstDay.getDay())

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(startDate)
    date.setDate(startDate.getDate() + index)
    return {
      date,
      dateText: toDateText(date),
      isCurrentMonth: date.getMonth() === monthDate.getMonth(),
    }
  })
}

const changeMonth = (date: Date, offset: number) => new Date(date.getFullYear(), date.getMonth() + offset, 1)

const normalizeHistoryMusic = (item: LX.Player.PlayHistoryItem): HistoryMusicInfo => {
  const musicInfo = item.musicInfo
  return {
    ...musicInfo,
    source: musicInfo.source as LX.OnlineSource,
    meta: {
      ...musicInfo.meta,
      qualitys: (musicInfo as LX.Music.MusicInfoOnline).meta.qualitys ?? [],
      _qualitys: (musicInfo as LX.Music.MusicInfoOnline).meta._qualitys ?? {},
      fee: (musicInfo as LX.Music.MusicInfoOnline).meta.fee ?? 0,
      originCoverType: (musicInfo as LX.Music.MusicInfoOnline).meta.originCoverType ?? 0,
    },
    playHistoryId: item.id,
    playHistorySource: item.source,
  } as HistoryMusicInfo
}

export default memo(() => {
  const listRef = useRef<OnlineListType>(null)
  const pagerRef = useRef<PagerView>(null)
  const popupRef = useRef<PopupType>(null)
  const [startDate, setStartDate] = useState(getTodayText())
  const [endDate, setEndDate] = useState('')
  const [pickerMode, setPickerMode] = useState<'single' | 'range'>('single')
  const [pickerStartDate, setPickerStartDate] = useState(startDate)
  const [pickerEndDate, setPickerEndDate] = useState(endDate)
  const [pickerMonth, setPickerMonth] = useState(parseDateText(startDate) ?? new Date())
  const [list, setList] = useState<HistoryMusicInfo[]>([])
  const playerMusicInfo = usePlayerMusicInfo()
  const theme = useTheme()

  const isRange = !!endDate && endDate !== startDate
  const title = isRange ? `${startDate} ~ ${endDate}` : startDate

  const loadHistory = useCallback(() => {
    const start = parseDateText(startDate)
    const end = parseDateText(isRange ? endDate : startDate)
    if (!start || !end) return

    const startDay = getDayStart(start)
    const endDay = getDayStart(end)
    const startTime = Math.min(startDay, endDay)
    const endTime = Math.max(startDay, endDay) + DAY - 1
    listRef.current?.setStatus('loading')
    void getPlayHistoryByRange(startTime, endTime)
      .then((history) => {
        const nextList = history.map(normalizeHistoryMusic)
        setList(nextList)
        listRef.current?.setList(nextList, false, true)
        listRef.current?.setStatus('idle')
      })
      .catch((err: any) => {
        console.log(err)
        toast(err.message || '播放历史加载失败')
        listRef.current?.setStatus('error')
      })
  }, [endDate, isRange, startDate])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  useEffect(() => {
    const handleUpdate = () => loadHistory()
    global.app_event.on('playHistoryUpdated', handleUpdate)
    return () => {
      global.app_event.off('playHistoryUpdated', handleUpdate)
    }
  }, [loadHistory])

  const applyDate = useCallback((nextStart: string, nextEnd = '') => {
    const start = parseDateText(nextStart)
    const end = nextEnd ? parseDateText(nextEnd) : null
    if (!start || (nextEnd && !end)) {
      toast('日期格式：YYYY-MM-DD')
      return
    }
    setStartDate(toDateText(start))
    setEndDate(end ? toDateText(end) : '')
    popupRef.current?.setVisible(false)
  }, [])

  const changeDay = useCallback((offset: number) => {
    if (isRange) return
    const next = getNextDateText(startDate, offset)
    if (offset > 0 && next > getTodayText()) return
    setStartDate(next)
    setEndDate('')
  }, [isRange, startDate])

  const openDateSelector = useCallback(() => {
    setPickerMode(isRange ? 'range' : 'single')
    setPickerStartDate(startDate)
    setPickerEndDate(endDate)
    setPickerMonth(parseDateText(startDate) ?? new Date())
    popupRef.current?.setVisible(true)
  }, [endDate, isRange, startDate])

  const handlePickDate = useCallback((dateText: string) => {
    if (pickerMode === 'single') {
      setPickerStartDate(dateText)
      setPickerEndDate('')
      return
    }

    if (!pickerStartDate || pickerEndDate) {
      setPickerStartDate(dateText)
      setPickerEndDate('')
      return
    }

    if (dateText < pickerStartDate) {
      setPickerEndDate(pickerStartDate)
      setPickerStartDate(dateText)
    } else {
      setPickerEndDate(dateText)
    }
  }, [pickerEndDate, pickerMode, pickerStartDate])

  const handleApplyPicker = useCallback(() => {
    if (pickerMode === 'single') {
      applyDate(pickerStartDate)
    } else {
      applyDate(pickerStartDate, pickerEndDate || pickerStartDate)
    }
  }, [applyDate, pickerEndDate, pickerMode, pickerStartDate])

  const monthDays = useMemo(() => getMonthDays(pickerMonth), [pickerMonth])

  const handlePlayList = useCallback((index: number) => {
    void playOnlineList('play_history', list, index)
  }, [list])

  const handlePageSelected = useCallback(({ nativeEvent }: PagerViewOnPageSelectedEvent) => {
    const position = nativeEvent.position
    if (position === 1) return

    if (!isRange) changeDay(position === 2 ? 1 : -1)
    requestAnimationFrame(() => {
      pagerRef.current?.setPageWithoutAnimation(1)
    })
  }, [changeDay, isRange])

  return (
    <View style={styles.container}>
      <View style={{ ...styles.header, borderBottomColor: theme['c-border-background'] }}>
        <TouchableOpacity style={styles.iconBtn} disabled={isRange} onPress={() => changeDay(-1)}>
          <Icon name="chevron-left" size={18} color={isRange ? theme['c-300'] : theme['c-font']} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.titleBtn} onPress={openDateSelector}>
          <Text numberOfLines={1} style={styles.title}>{title}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconBtn} disabled={isRange || startDate >= getTodayText()} onPress={() => changeDay(1)}>
          <Icon name="chevron-right" size={18} color={isRange || startDate >= getTodayText() ? theme['c-300'] : theme['c-font']} />
        </TouchableOpacity>
      </View>

      <PagerView
        ref={pagerRef}
        style={styles.historyPager}
        initialPage={1}
        scrollEnabled={!isRange}
        onPageSelected={handlePageSelected}
      >
        <View key="prev-day" collapsable={false} style={styles.historyPage}>
          <View style={styles.swipePlaceholder}>
            <Text color={theme['c-500']}>{getNextDateText(startDate, -1)}</Text>
          </View>
        </View>
        <View key="current-day" collapsable={false} style={styles.historyPage}>
          <OnlineList
            ref={listRef}
            listId="play_history"
            forcePlayList
            playingId={playerMusicInfo.id}
            onPlayList={handlePlayList}
            onRefresh={loadHistory}
            onLoadMore={() => {}}
            checkHomePagerIdle
          />
        </View>
        <View key="next-day" collapsable={false} style={styles.historyPage}>
          <View style={styles.swipePlaceholder}>
            <Text color={theme['c-500']}>{startDate >= getTodayText() ? startDate : getNextDateText(startDate, 1)}</Text>
          </View>
        </View>
      </PagerView>

      <Popup ref={popupRef} title="播放历史">
        <View style={styles.popupContent}>
          <View style={styles.modeRow}>
            <TouchableOpacity
              style={{
                ...styles.modeBtn,
                backgroundColor: pickerMode === 'single' ? theme['c-primary-background-hover'] : 'transparent',
              }}
              onPress={() => {
                setPickerMode('single')
                setPickerEndDate('')
              }}
            >
              <Text color={pickerMode === 'single' ? theme['c-primary-font'] : theme['c-font']}>单日</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{
                ...styles.modeBtn,
                backgroundColor: pickerMode === 'range' ? theme['c-primary-background-hover'] : 'transparent',
              }}
              onPress={() => setPickerMode('range')}
            >
              <Text color={pickerMode === 'range' ? theme['c-primary-font'] : theme['c-font']}>范围</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.calendarHeader}>
            <TouchableOpacity style={styles.monthBtn} onPress={() => setPickerMonth(month => changeMonth(month, -1))}>
              <Icon name="chevron-left" size={16} color={theme['c-font']} />
            </TouchableOpacity>
            <Text style={styles.monthTitle}>{getMonthText(pickerMonth)}</Text>
            <TouchableOpacity style={styles.monthBtn} onPress={() => setPickerMonth(month => changeMonth(month, 1))}>
              <Icon name="chevron-right" size={16} color={theme['c-font']} />
            </TouchableOpacity>
          </View>

          <View style={styles.weekRow}>
            {WEEK_DAYS.map(day => (
              <Text key={day} style={styles.weekText} color={theme['c-500']}>{day}</Text>
            ))}
          </View>

          <View style={styles.dayGrid}>
            {monthDays.map(({ date, dateText, isCurrentMonth }) => {
              const isStart = dateText === pickerStartDate
              const isEnd = dateText === pickerEndDate
              const isInRange = pickerMode === 'range' && pickerEndDate && dateText > pickerStartDate && dateText < pickerEndDate
              const active = isStart || isEnd
              return (
                <TouchableOpacity
                  key={dateText}
                  style={{
                    ...styles.dayCell,
                    backgroundColor: active
                      ? theme['c-primary-background-hover']
                      : isInRange
                        ? theme['c-primary-light-100-alpha-300']
                        : 'transparent',
                  }}
                  onPress={() => handlePickDate(dateText)}
                >
                  <Text
                    color={
                      active
                        ? theme['c-primary-font']
                        : isCurrentMonth
                          ? theme['c-font']
                          : theme['c-300']
                    }
                  >
                    {date.getDate().toString()}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>

          <Text style={styles.rangeText} color={theme['c-500']}>
            {pickerMode === 'range' ? `${pickerStartDate}${pickerEndDate ? ` ~ ${pickerEndDate}` : ''}` : pickerStartDate}
          </Text>

          <View style={styles.popupActions}>
            <TouchableOpacity style={styles.actionBtn} onPress={() => applyDate(getTodayText())}>
              <Text color={theme['c-primary-font']}>今天</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} onPress={handleApplyPicker}>
              <Text color={theme['c-primary-font']}>确定</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Popup>
    </View>
  )
})

const styles = createStyle({
  container: {
    flex: 1,
  },
  header: {
    height: 46,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
  },
  iconBtn: {
    width: 48,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBtn: {
    flex: 1,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 14,
  },
  historyPager: {
    flex: 1,
  },
  historyPage: {
    flex: 1,
  },
  swipePlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  popupContent: {
    paddingHorizontal: 16,
    paddingBottom: 18,
  },
  modeRow: {
    flexDirection: 'row',
    paddingVertical: 8,
  },
  modeBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    borderRadius: 6,
  },
  calendarHeader: {
    height: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  monthBtn: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthTitle: {
    fontSize: 15,
  },
  weekRow: {
    flexDirection: 'row',
    paddingTop: 4,
    paddingBottom: 6,
  },
  weekText: {
    flex: 1,
    textAlign: 'center',
  },
  dayGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: `${100 / 7}%`,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  rangeText: {
    paddingTop: 10,
    textAlign: 'center',
  },
  popupActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingTop: 14,
  },
  actionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
})
