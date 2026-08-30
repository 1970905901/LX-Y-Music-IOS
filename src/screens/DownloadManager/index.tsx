import { memo, useCallback, useEffect, useMemo } from 'react';
import { View, FlatList } from 'react-native';
import PageContent from '@/components/PageContent';
import Header from './Header';
import ListItem from './ListItem';
import DownloadPathBar from './DownloadPathBar';
import { useDownloadTasks } from '@/store/download/hook';
import { createStyle, getRowInfo } from '@/utils/tools';
import { setComponentId } from '@/core/common';
import { removeTask } from '@/core/download';
import { COMPONENT_IDS } from '@/config/constant';
import LandscapeCentered from '@/components/LandscapeCentered';
import { useHorizontalMode } from '@/utils/hooks';

export default memo(({ componentId }: { componentId: string }) => {
  useEffect(() => {
    setComponentId(COMPONENT_IDS.DOWNLOAD_MANAGER, componentId);
  }, [componentId]);

  const tasks = useDownloadTasks();

  // 列数响应式（对齐 OnlineList）：iPad 横屏/分屏时双列，避免下载卡片在超宽屏
  // 上被拉成一行很长、左右大片留白；竖屏保持单列零回归。
  // numColumns 变更时 FlatList 必须重挂载（RN 不支持运行中改列数），故加 key。
  const isHorizontal = useHorizontalMode();
  const rowInfo = useMemo(() => getRowInfo(), [isHorizontal]);
  const numColumns = rowInfo.rowNum ?? 1;

  const handleRemove = useCallback((id: string) => {
    removeTask(id);
  }, []);

  const renderItem = useCallback(({ item }: { item: LX.Download.DownloadTask }) => (
    <ListItem
      task={item}
      rowWidth={rowInfo.rowWidth}
      onRemove={handleRemove}
    />
  ), [handleRemove, rowInfo.rowWidth]);

  return (
    <PageContent>
      <LandscapeCentered>
        <View style={styles.container}>
          <Header componentId={componentId} />
          <DownloadPathBar />
          <FlatList
            key={`cols-${numColumns}`}
            data={tasks}
            numColumns={numColumns}
            renderItem={renderItem}
            keyExtractor={item => item.id}
          />
        </View>
      </LandscapeCentered>
    </PageContent>
  );
});

const styles = createStyle({
  container: {
    flex: 1,
  },
});
