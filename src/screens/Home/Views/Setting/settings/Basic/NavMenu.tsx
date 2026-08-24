import { memo, useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { StyleSheet, View, Text, Animated, PanResponder, ScrollView, TouchableOpacity } from 'react-native';
import SubTitle from '../../components/SubTitle';
import CheckBox from '@/components/common/CheckBox';
import { useSettingValue } from '@/store/setting/hook';
import { useI18n } from '@/lang';
import { updateSetting } from '@/core/common';
import { NAV_MENUS, NAV_GROUPS, NAV_ID_Type } from '@/config/constant';
import { useTheme } from '@/store/theme/hook';
import { Icon } from '@/components/common/Icon';

const LONG_PRESS_MS = 350;
const DRAG_CANCEL_THRESHOLD = 6;

interface MenuItemData {
  id: string;
  name: string;
  isGroup?: boolean;
}

interface DragAnim {
  translateY: Animated.Value;
  scale: Animated.Value;
  opacity: Animated.Value;
}

const createAnim = (): DragAnim => ({
  translateY: new Animated.Value(0),
  scale: new Animated.Value(1),
  opacity: new Animated.Value(1),
});

const SortableList = ({ items: initialItems, onReorder, dragHint, navGroupVisible }: {
  items: MenuItemData[];
  onReorder: (from: number, to: number) => void;
  dragHint?: string;
  navGroupVisible?: Record<string, boolean>;
}) => {
  const theme = useTheme();
  const subContainerOpacity = useSettingValue('theme.subContainerOpacity');
  const navStatus = useSettingValue('common.navStatus');

  const itemsRef = useRef(initialItems);
  const [displayItems, setDisplayItems] = useState(initialItems);
  const heightsRef = useRef<number[]>([]);
  const animsRef = useRef<DragAnim[]>([]);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const draggingIndexRef = useRef<number | null>(null);
  const targetIndexRef = useRef<number | null>(null);
  const lastTargetRef = useRef<number | null>(null);

  useEffect(() => {
    if (!draggingIndexRef.current && draggingIndex === null) {
      itemsRef.current = initialItems;
      setDisplayItems(initialItems);
    }
  }, [initialItems]);

  const count = displayItems.length;
  while (animsRef.current.length < count) animsRef.current.push(createAnim());
  if (animsRef.current.length > count) animsRef.current.length = count;
  heightsRef.current.length = count;

  const handleLayoutHeight = useCallback((index: number, height: number) => { heightsRef.current[index] = height; }, []);

  const resetAllAnims = useCallback(() => {
    for (const anim of animsRef.current) {
      anim.translateY.stopAnimation(); anim.scale.stopAnimation(); anim.opacity.stopAnimation();
      anim.translateY.setValue(0); anim.scale.setValue(1); anim.opacity.setValue(1);
    }
  }, []);

  const handleLongPressStart = useCallback((index: number) => {
    draggingIndexRef.current = index; targetIndexRef.current = index; lastTargetRef.current = index;
    setDraggingIndex(index);
    const anim = animsRef.current[index];
    if (!anim) return;
    Animated.parallel([
      Animated.spring(anim.scale, { toValue: 1.03, useNativeDriver: true, friction: 7 }),
      Animated.timing(anim.opacity, { toValue: 0.92, duration: 120, useNativeDriver: true }),
    ]).start();
  }, []);

  const computeTargetIndex = useCallback((from: number, dy: number) => {
    const heights = heightsRef.current; const n = heights.length; if (n === 0) return from;
    const cumulative: number[] = []; let acc = 0;
    for (let i = 0; i < n; i++) { cumulative.push(acc); acc += heights[i] ?? 0; }
    const draggedHeight = heights[from] ?? 0;
    const newCenter = (cumulative[from] ?? 0) + dy + draggedHeight / 2;
    let target = from; let minDist = Infinity;
    for (let i = 0; i < n; i++) {
      const dist = Math.abs(((cumulative[i] ?? 0) + (heights[i] ?? 0) / 2) - newCenter);
      if (dist < minDist) { minDist = dist; target = i; }
    }
    return target;
  }, []);

  const animateLayout = useCallback((from: number, to: number) => {
    const draggedHeight = heightsRef.current[from] ?? 0; if (draggedHeight <= 0) return;
    for (let i = 0; i < animsRef.current.length; i++) {
      if (i === from) continue;
      let target = 0;
      if (from < to && i > from && i <= to) target = -draggedHeight;
      else if (from > to && i >= to && i < from) target = draggedHeight;
      Animated.spring(animsRef.current[i].translateY, { toValue: target, useNativeDriver: true, friction: 9, tension: 70 }).start();
    }
  }, []);

  const handleDragMove = useCallback((dy: number) => {
    const from = draggingIndexRef.current; if (from == null) return;
    const anim = animsRef.current[from]; if (anim) anim.translateY.setValue(dy);
    const target = computeTargetIndex(from, dy); targetIndexRef.current = target;
    if (target !== lastTargetRef.current) { lastTargetRef.current = target; animateLayout(from, target); }
  }, [computeTargetIndex, animateLayout]);

  const handleDragRelease = useCallback(() => {
    const from = draggingIndexRef.current; const to = targetIndexRef.current ?? from;
    draggingIndexRef.current = null; targetIndexRef.current = null; lastTargetRef.current = null;
    if (from == null) return;
    if (to != null && to !== from) {
      const next = [...displayItems]; const [moved] = next.splice(from, 1);
      if (moved) { next.splice(to, 0, moved); setDisplayItems(next); itemsRef.current = next; onReorder(from, to); }
    }
    setTimeout(resetAllAnims, 100); setDraggingIndex(null);
  }, [displayItems, onReorder, resetAllAnims]);

  const handleDragCancel = useCallback(() => {
    draggingIndexRef.current = null; targetIndexRef.current = null; lastTargetRef.current = null;
    setDraggingIndex(null); resetAllAnims();
  }, [resetAllAnims]);

  return (
    <View style={{ overflow: 'hidden', borderRadius: 8, backgroundColor: `rgba(255, 255, 255, ${(subContainerOpacity ?? 100) / 100})` }}>
      <View style={styles.menuList}>
        {displayItems.map((item, idx) => {
          const anim = animsRef.current[idx] ?? createAnim();
          const isDragSource = draggingIndex === idx;
          const groupChecked = item.isGroup ? ((navGroupVisible ?? {})[item.id] ?? true) : undefined;
          const groupToggle = item.isGroup ? (_id: string, check: boolean) => {
            updateSetting({ 'common.navGroupVisible': { ...(navGroupVisible ?? {}), [item.id]: check } });
          } : undefined;
          return (
            <DraggableItem key={item.id + idx} item={item} index={idx}
              isChecked={item.isGroup ? groupChecked : (navStatus[item.id as NAV_ID_Type] ?? true)}
              isDragging={draggingIndex != null} isDragSource={isDragSource}
              translateY={anim.translateY} scale={anim.scale} opacity={anim.opacity}
              zIndex={isDragSource ? 10 : 1}
              onLayoutHeight={handleLayoutHeight} onLongPressStart={handleLongPressStart}
              onDragMove={handleDragMove} onDragRelease={handleDragRelease} onDragCancel={handleDragCancel}
              onToggle={groupToggle || ((id: string, check: boolean) => updateSetting({ 'common.navStatus': { ...navStatus, [id as NAV_ID_Type]: check } }))}
              dragHandleHint={dragHint || ''} />
          );
        })}
      </View>
    </View>
  );
};

const DraggableItem = memo(({ item, index, isChecked, isDragging, isDragSource, translateY, scale, opacity, zIndex,
  onLayoutHeight, onLongPressStart, onDragMove, onDragRelease, onDragCancel, onToggle, dragHandleHint }: any) => {
  const theme = useTheme();
  const t = useI18n();
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isActivatedRef = useRef(false);

  const clearLongPressTimer = () => { if (longPressTimer.current != null) { clearTimeout(longPressTimer.current); longPressTimer.current = null; } };
  useEffect(() => () => { clearLongPressTimer(); }, []);

  const panResponder = useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: (_e: any, gs: any) => { if (!isActivatedRef.current) return false; return Math.abs(gs.dy) > 1 || Math.abs(gs.dx) > 1; },
      onMoveShouldSetPanResponderCapture: (_e: any, gs: any) => { if (!isActivatedRef.current) return false; return Math.abs(gs.dy) > 2; },
      onPanResponderGrant: () => {
        clearLongPressTimer(); isActivatedRef.current = false;
        longPressTimer.current = setTimeout(() => { longPressTimer.current = null; isActivatedRef.current = true; onLongPressStart(index); }, LONG_PRESS_MS);
      },
      onPanResponderMove: (_e: any, gs: any) => { if (!isActivatedRef.current) { if (Math.abs(gs.dy) > DRAG_CANCEL_THRESHOLD || Math.abs(gs.dx) > DRAG_CANCEL_THRESHOLD) clearLongPressTimer(); return; } onDragMove(gs.dy); },
      onPanResponderRelease: () => { clearLongPressTimer(); if (isActivatedRef.current) { isActivatedRef.current = false; onDragRelease(); } },
      onPanResponderTerminate: () => { clearLongPressTimer(); if (isActivatedRef.current) { isActivatedRef.current = false; onDragCancel(); } },
      onPanResponderTerminationRequest: () => !isActivatedRef.current,
    }),
    [index, onLongPressStart, onDragMove, onDragRelease, onDragCancel]
  );

  const transform = isDragSource ? [{ translateY }, { scale }] : [{ translateY }];

  return (
    <Animated.View onLayout={(e) => onLayoutHeight(index, e.nativeEvent.layout.height)}
      style={[styles.menuItem, {
        backgroundColor: isDragSource ? theme['c-primary-background-active'] : 'transparent',
        opacity, transform, zIndex, elevation: isDragSource ? 8 : 0,
        shadowOpacity: isDragSource ? 0.25 : 0, shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 }, shadowRadius: 4,
      }]}>
      <View style={styles.menuInfo}>
        <View style={styles.dragHandle} {...panResponder.panHandlers}>
          <Icon name="menu" color={theme['c-font-label']} size={16} />
        </View>
        <Text style={[styles.menuName, { color: item.isGroup ? theme['c-primary-font'] : theme['c-font'] }]}>{item.name}</Text>
        {isChecked !== undefined && (
          <CheckBox check={isChecked} label="" disabled={item.id === 'nav_setting'}
            onChange={(check) => onToggle(item.id, check)} />
        )}
      </View>
      {isDragSource ? <Text size={11} color={theme['c-font-label']} style={styles.dragHint}>{dragHandleHint}</Text> : null}
    </Animated.View>
  );
});

export default memo(() => {
  const t = useI18n();
  const navGroupEnabled = useSettingValue('common.navGroupEnabled');
  const navGroupOrder = useSettingValue('common.navGroupOrder');
  const navStatus = useSettingValue('common.navStatus');
  const navOrder = useSettingValue('common.navOrder');
  const navFlatOrder = useSettingValue('common.navFlatOrder');
  const navGroupVisible = useSettingValue('common.navGroupVisible');
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);

  const effectiveFlatOrder = useMemo(() => {
    if (navFlatOrder && navFlatOrder.length > 0) return navFlatOrder;
    return navOrder || NAV_MENUS.map(m => m.id);
  }, [navFlatOrder, navOrder]);

  const topLevelItems = useMemo((): MenuItemData[] => {
    const order = navGroupEnabled ? (navOrder || NAV_MENUS.map(m => m.id)) : effectiveFlatOrder;
    if (!navGroupEnabled) {
      return order
        .filter(id => id !== 'nav_play_history')
        .map(id => {
          const menu = NAV_MENUS.find(m => m.id === id);
          if (!menu) return null;
          return { id, name: t(id as any), isGroup: false };
        })
        .filter((item): item is MenuItemData => item !== null);
    }
    const groupChildIds = new Set(NAV_GROUPS.flatMap(g => g.children));
    const items: MenuItemData[] = [];
    const insertedGroupIds = new Set<string>();
    for (const id of order) {
      if (id === 'nav_play_history') continue;
      if (groupChildIds.has(id as NAV_ID_Type)) {
        const group = NAV_GROUPS.find(g => g.children.includes(id as NAV_ID_Type));
        if (group && !insertedGroupIds.has(group.id)) {
          items.push({ id: group.id, name: t(group.label as any), isGroup: true });
          insertedGroupIds.add(group.id);
        }
        continue;
      }
      const menu = NAV_MENUS.find(m => m.id === id);
      if (menu) {
        items.push({ id, name: t(id as any), isGroup: false });
      }
    }
    for (const group of NAV_GROUPS) {
      if (!insertedGroupIds.has(group.id)) {
        const firstChildIdx = order.findIndex(id => group.children.includes(id as NAV_ID_Type))
        let insertIdx = items.length
        if (firstChildIdx >= 0) {
          for (let i = 0; i < items.length; i++) {
            const item = items[i]
            const itemOrderIdx = order.indexOf(item.isGroup ? (NAV_GROUPS.find(g => g.id === item.id)?.children[0] as NAV_ID_Type) : item.id as NAV_ID_Type)
            if (itemOrderIdx > firstChildIdx) { insertIdx = i; break }
          }
        }
        items.splice(insertIdx, 0, { id: group.id, name: t(group.label as any), isGroup: true });
      }
    }
    if (!items.some(i => i.id === 'nav_setting')) {
      items.push({ id: 'nav_setting', name: t('nav_setting'), isGroup: false });
    }
    return items;
  }, [navGroupEnabled, navOrder, navStatus, t]);

  const groupItems = useMemo((): MenuItemData[] => {
    if (!selectedGroup) return [];
    const group = NAV_GROUPS.find(g => g.id === selectedGroup);
    if (!group) return [];
    const savedOrder = navGroupOrder[group.id];
    const childIds = savedOrder && savedOrder.length > 0
      ? savedOrder.filter(id => group.children.includes(id as NAV_ID_Type))
      : group.children;
    return childIds
      .map(id => ({ id, name: t(id as any), isGroup: false }));
  }, [selectedGroup, navGroupOrder, navStatus, t]);

  const handleTopLevelReorder = useCallback((from: number, to: number) => {
    const items = [...topLevelItems];
    const [moved] = items.splice(from, 1);
    if (!moved) return;
    items.splice(to, 0, moved);
    if (navGroupEnabled) {
      const newNavOrder: NAV_ID_Type[] = [];
      for (const item of items) {
        if (item.isGroup) {
          const group = NAV_GROUPS.find(g => g.id === item.id);
          if (group) group.children.forEach(c => newNavOrder.push(c as NAV_ID_Type));
        } else {
          newNavOrder.push(item.id as NAV_ID_Type);
        }
      }
      updateSetting({ 'common.navOrder': newNavOrder });
    } else {
      updateSetting({ 'common.navFlatOrder': items.map(i => i.id as NAV_ID_Type) });
    }
  }, [topLevelItems, navGroupEnabled]);

  const handleGroupReorder = useCallback((from: number, to: number) => {
    if (!selectedGroup) return;
    const items = [...groupItems];
    const [moved] = items.splice(from, 1);
    if (!moved) return;
    items.splice(to, 0, moved);
    updateSetting({ 'common.navGroupOrder': { ...navGroupOrder, [selectedGroup]: items.map(i => i.id) } });
  }, [selectedGroup, groupItems, navGroupOrder]);

  const handleGroupPress = useCallback((groupId: string) => {
    setSelectedGroup(prev => prev === groupId ? null : groupId);
  }, []);

  return (
    <SubTitle title={t('setting_basic_nav_menu')} collapsible sectionId="setting_basic_nav_menu">
      <View style={styles.container}>
        <View style={styles.toggleRow}>
          <CheckBox marginRight={8} check={navGroupEnabled} label={t('setting_basic_nav_menu_group_toggle')}
            onChange={() => { updateSetting({ 'common.navGroupEnabled': !navGroupEnabled }); setSelectedGroup(null); }} />
        </View>

        {navGroupEnabled && (
          <View style={styles.tabBar}>
            {NAV_GROUPS.map(g => (
              <TouchableOpacity key={g.id} style={[styles.tab, selectedGroup === g.id && styles.tabActive]}
                onPress={() => handleGroupPress(g.id)}>
                <Text size={13} color={selectedGroup === g.id ? '#1677ff' : '#666'}>{t(g.label as any)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {navGroupEnabled && selectedGroup ? (
          <View>
            <TouchableOpacity style={styles.backBtn} onPress={() => setSelectedGroup(null)}>
              <Icon name="chevron-left" size={14} color="#666" />
              <Text size={13} color="#666" style={{ marginLeft: 4 }}>{t('setting_basic_nav_menu_back_top')}</Text>
            </TouchableOpacity>
            <ScrollView keyboardShouldPersistTaps="always">
              <SortableList key={`group-${selectedGroup}`} items={groupItems} onReorder={handleGroupReorder} dragHint={t('setting_basic_nav_menu_reorder_tip')} navGroupVisible={navGroupVisible} />
            </ScrollView>
          </View>
        ) : (
          <ScrollView keyboardShouldPersistTaps="always">
            <SortableList key={`top-${navGroupEnabled}`} items={topLevelItems} onReorder={handleTopLevelReorder} dragHint={t('setting_basic_nav_menu_reorder_tip')} navGroupVisible={navGroupVisible} />
          </ScrollView>
        )}
      </View>
    </SubTitle>
  );
});

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
});
