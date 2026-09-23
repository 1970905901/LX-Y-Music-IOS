import { memo, useMemo, useState, useCallback, useRef, useEffect } from 'react'
import { StyleSheet, View, Text, Animated, PanResponder } from 'react-native'
import SubTitle from '../../components/SubTitle'
import CheckBox from '@/components/common/CheckBox'
import { useSettingValue } from '@/store/setting/hook'
import { useI18n } from '@/lang'
import { updateSetting } from '@/core/common'
import { NAV_MENUS, type NAV_ID_Type, getEffectiveFlatOrder } from '@/config/constant'
import { useTheme } from '@/store/theme/hook'
import { Icon } from '@/components/common/Icon'
import { acquireScrollLock, releaseScrollLock } from '@/utils/scrollLock'

const LONG_PRESS_MS = 350

// RN 的 Text 组件类型不包含 size/color 等扩展 prop，这里仅为通过类型检查，运行时行为不变
const TextAny = Text as any

interface MenuItemData {
  id: string
  name: string
}

interface DragAnim {
  translateY: Animated.Value
  scale: Animated.Value
  opacity: Animated.Value
}

const createAnim = (): DragAnim => ({
  translateY: new Animated.Value(0),
  scale: new Animated.Value(1),
  opacity: new Animated.Value(1),
})

const SortableList = ({ items: initialItems, onReorder, dragHint }: {
  items: MenuItemData[]
  onReorder: (from: number, to: number) => void
  dragHint?: string
}) => {
  const subContainerOpacity = useSettingValue('theme.subContainerOpacity')
  const navStatus = useSettingValue('common.navStatus')

  const itemsRef = useRef(initialItems)
  const [displayItems, setDisplayItems] = useState(initialItems)
  const heightsRef = useRef<number[]>([])
  const animsRef = useRef<DragAnim[]>([])
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const draggingIndexRef = useRef<number | null>(null)
  const targetIndexRef = useRef<number | null>(null)
  const lastTargetRef = useRef<number | null>(null)

  useEffect(() => {
    if (!draggingIndexRef.current && draggingIndex === null) {
      itemsRef.current = initialItems
      setDisplayItems(initialItems)
    }
  }, [initialItems])

  const count = displayItems.length
  while (animsRef.current.length < count) animsRef.current.push(createAnim())
  if (animsRef.current.length > count) animsRef.current.length = count
  heightsRef.current.length = count

  const handleLayoutHeight = useCallback((index: number, height: number) => { heightsRef.current[index] = height }, [])

  const resetAllAnims = useCallback(() => {
    for (const anim of animsRef.current) {
      anim.translateY.stopAnimation(); anim.scale.stopAnimation(); anim.opacity.stopAnimation()
      anim.translateY.setValue(0); anim.scale.setValue(1); anim.opacity.setValue(1)
    }
  }, [])

  const handleLongPressStart = useCallback((index: number) => {
    draggingIndexRef.current = index; targetIndexRef.current = index; lastTargetRef.current = index
    setDraggingIndex(index)
    const anim = animsRef.current[index]
    if (!anim) return
    Animated.parallel([
      Animated.spring(anim.scale, { toValue: 1.03, useNativeDriver: true, friction: 7 }),
      Animated.timing(anim.opacity, { toValue: 0.92, duration: 120, useNativeDriver: true }),
    ]).start()
  }, [])

  const computeTargetIndex = useCallback((from: number, dy: number) => {
    const heights = heightsRef.current; const n = heights.length; if (n === 0) return from
    const cumulative: number[] = []; let acc = 0
    for (let i = 0; i < n; i++) { cumulative.push(acc); acc += heights[i] ?? 0 }
    const draggedHeight = heights[from] ?? 0
    const newCenter = (cumulative[from] ?? 0) + dy + draggedHeight / 2
    let target = from; let minDist = Infinity
    for (let i = 0; i < n; i++) {
      const dist = Math.abs(((cumulative[i] ?? 0) + (heights[i] ?? 0) / 2) - newCenter)
      if (dist < minDist) { minDist = dist; target = i }
    }
    return target
  }, [])

  const animateLayout = useCallback((from: number, to: number) => {
    const draggedHeight = heightsRef.current[from] ?? 0; if (draggedHeight <= 0) return
    for (let i = 0; i < animsRef.current.length; i++) {
      if (i === from) continue
      let target = 0
      if (from < to && i > from && i <= to) target = -draggedHeight
      else if (from > to && i >= to && i < from) target = draggedHeight
      Animated.spring(animsRef.current[i].translateY, { toValue: target, useNativeDriver: true, friction: 9, tension: 70 }).start()
    }
  }, [])

  const handleDragMove = useCallback((dy: number) => {
    const from = draggingIndexRef.current; if (from == null) return
    const anim = animsRef.current[from]; if (anim) anim.translateY.setValue(dy)
    const target = computeTargetIndex(from, dy); targetIndexRef.current = target
    if (target !== lastTargetRef.current) { lastTargetRef.current = target; animateLayout(from, target) }
  }, [computeTargetIndex, animateLayout])

  const handleDragRelease = useCallback(() => {
    const from = draggingIndexRef.current; const to = targetIndexRef.current ?? from
    draggingIndexRef.current = null; targetIndexRef.current = null; lastTargetRef.current = null
    if (from == null) return
    if (to != null && to !== from) {
      const next = [...displayItems]; const [moved] = next.splice(from, 1)
      if (moved) { next.splice(to, 0, moved); setDisplayItems(next); itemsRef.current = next; onReorder(from, to) }
    }
    setTimeout(resetAllAnims, 100); setDraggingIndex(null)
  }, [displayItems, onReorder, resetAllAnims])

  const handleDragCancel = useCallback(() => {
    draggingIndexRef.current = null; targetIndexRef.current = null; lastTargetRef.current = null
    setDraggingIndex(null); resetAllAnims()
  }, [resetAllAnims])

  // 兜底：组件卸载时若仍处于拖拽锁定状态，释放之，避免滚动被永久禁用。
  useEffect(() => () => { releaseScrollLock() }, [])

  return (
    <View style={{ overflow: 'hidden', borderRadius: 8, backgroundColor: `rgba(255, 255, 255, ${(subContainerOpacity ?? 100) / 100})` }}>
      <View style={styles.menuList}>
        {displayItems.map((item, idx) => {
          const anim = animsRef.current[idx] ?? createAnim()
          const isDragSource = draggingIndex === idx
          return (
            <DraggableItem key={item.id + idx} item={item} index={idx}
              isChecked={navStatus[item.id as NAV_ID_Type] ?? true}
              isDragging={draggingIndex != null} isDragSource={isDragSource}
              translateY={anim.translateY} scale={anim.scale} opacity={anim.opacity}
              zIndex={isDragSource ? 10 : 1}
              onLayoutHeight={handleLayoutHeight} onLongPressStart={handleLongPressStart}
              onDragMove={handleDragMove} onDragRelease={handleDragRelease} onDragCancel={handleDragCancel}
              onToggle={(id: string, check: boolean) => { updateSetting({ 'common.navStatus': { ...navStatus, [id as NAV_ID_Type]: check } }) }}
              dragHandleHint={dragHint || ''} />
          )
        })}
      </View>
    </View>
  )
}

const DraggableItem = memo(({
  item, index, isChecked, isDragging, isDragSource, translateY, scale, opacity, zIndex,
  onLayoutHeight, onLongPressStart, onDragMove, onDragRelease, onDragCancel, onToggle, dragHandleHint,
}: any) => {
  const theme = useTheme()
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isActivatedRef = useRef(false)
  const currentDyRef = useRef(0)
  const activationDyRef = useRef(0)

  const clearLongPressTimer = () => { if (longPressTimer.current != null) { clearTimeout(longPressTimer.current); longPressTimer.current = null } }
  useEffect(() => () => { clearLongPressTimer() }, [])

  const panResponder = useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      // 关键修复：长按时立即接管手势，避免父级 ScrollView 抢占导致整页随拖动滚动。
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderGrant: () => {
        clearLongPressTimer(); isActivatedRef.current = false
        currentDyRef.current = 0
        // 手指放上 dragHandle 瞬间即锁定祖先滚动，避免 iOS 原生 UIScrollView 在长按激活前就开始滚动整页。
        acquireScrollLock()
        longPressTimer.current = setTimeout(() => { longPressTimer.current = null; isActivatedRef.current = true; activationDyRef.current = currentDyRef.current; onLongPressStart(index) }, LONG_PRESS_MS)
      },
      onPanResponderMove: (_e: any, gs: any) => { currentDyRef.current = gs.dy; if (!isActivatedRef.current) { return } onDragMove(gs.dy - activationDyRef.current) },
      onPanResponderRelease: () => {
        clearLongPressTimer()
        releaseScrollLock()
        if (isActivatedRef.current) { isActivatedRef.current = false; onDragRelease() }
      },
      onPanResponderTerminate: () => {
        clearLongPressTimer()
        releaseScrollLock()
        if (isActivatedRef.current) { isActivatedRef.current = false; onDragCancel() }
      },
      // 一旦接管手势就不再释放给 ScrollView，避免整页被滚动。
      onPanResponderTerminationRequest: () => false,
    }),
    [index, onLongPressStart, onDragMove, onDragRelease, onDragCancel],
  )

  const transform = isDragSource ? [{ translateY }, { scale }] : [{ translateY }]

  return (
    <Animated.View onLayout={(e) => onLayoutHeight(index, e.nativeEvent.layout.height)}
      style={[styles.menuItem, {
        backgroundColor: isDragSource ? theme['c-primary-background-active'] : 'transparent',
        opacity,
        transform,
        zIndex,
        shadowOpacity: isDragSource ? 0.25 : 0,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowRadius: 4,
      }]}>
      <View style={styles.menuInfo}>
        <View style={styles.dragHandle} {...panResponder.panHandlers}>
          <Icon name="menu" color={theme['c-font-label']} size={16} />
        </View>
        <Text style={[styles.menuName, { color: theme['c-font'] }]}>{item.name}</Text>
        {isChecked !== undefined && (
          <CheckBox check={isChecked} label="" disabled={item.id === 'nav_setting'}
            onChange={(check) => onToggle(item.id, check)} />
        )}
      </View>
      {isDragSource ? <TextAny size={11} color={theme['c-font-label']} style={styles.dragHint}>{dragHandleHint}</TextAny> : null}
    </Animated.View>
  )
})

export default memo(() => {
  const t = useI18n()
  const navOrder = useSettingValue('common.navOrder')
  const navFlatOrder = useSettingValue('common.navFlatOrder')

  const effectiveFlatOrder = useMemo(() => {
    return getEffectiveFlatOrder(navFlatOrder, navOrder)
  }, [navFlatOrder, navOrder])

  const topLevelItems = useMemo((): MenuItemData[] => {
    return effectiveFlatOrder
      .map(id => {
        const menu = NAV_MENUS.find(m => m.id === id)
        if (!menu) return null
        return { id, name: t(id as any) }
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
  }, [effectiveFlatOrder, t])

  const topLevelItemsWithSetting = useMemo((): MenuItemData[] => {
    const items = [...topLevelItems]
    if (!items.some(i => i.id === 'nav_setting')) {
      items.push({ id: 'nav_setting', name: t('nav_setting') })
    }
    return items
  }, [topLevelItems, t])

  const handleTopLevelReorder = useCallback((from: number, to: number) => {
    const items = [...topLevelItems]
    const [moved] = items.splice(from, 1)
    if (!moved) return
    items.splice(to, 0, moved)
    updateSetting({ 'common.navFlatOrder': items.map(i => i.id as NAV_ID_Type) })
  }, [topLevelItems])

  return (
    <SubTitle title={t('setting_basic_nav_menu')} collapsible sectionId="setting_basic_nav_menu">
      <View style={styles.container}>
        <SortableList key="flat" items={topLevelItemsWithSetting} onReorder={handleTopLevelReorder} dragHint={t('setting_basic_nav_menu_reorder_tip')} />
      </View>
    </SubTitle>
  )
})

const styles = StyleSheet.create({
  container: { flex: 1 },
  toggleRow: { marginBottom: 8 },
  menuList: { overflow: 'hidden' },
  menuItem: { paddingVertical: 12, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(128, 128, 128, 0.2)', borderRadius: 8 },
  menuInfo: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  menuName: { fontSize: 16, flex: 1, paddingLeft: 10 },
  dragHandle: { paddingHorizontal: 6, paddingVertical: 6, alignItems: 'center', justifyContent: 'center' },
  dragHint: { marginTop: 2, textAlign: 'center' },
  tabBar: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(128, 128, 128, 0.3)', marginBottom: 12 },
  tab: { paddingVertical: 10, paddingHorizontal: 16, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: '#999' },
  backBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, marginBottom: 8 },
})
