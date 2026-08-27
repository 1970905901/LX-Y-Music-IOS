import { memo, useCallback, useEffect } from 'react';
import { View, FlatList } from 'react-native';
import PageContent from '@/components/PageContent';
import Header from './Header';
import ListItem from './ListItem';
import DownloadPathBar from './DownloadPathBar';
import { useDownloadTasks } from '@/store/download/hook';
import { createStyle } from '@/utils/tools';
import { setComponentId } from '@/core/common';
import { removeTask } from '@/core/download';
import { COMPONENT_IDS } from '@/config/constant';

export default memo(({ componentId }: { componentId: string }) => {
  useEffect(() => {
    setComponentId(COMPONENT_IDS.DOWNLOAD_MANAGER, componentId);
  }, [componentId]);

  const tasks = useDownloadTasks();

  const handleRemove = useCallback((id: string) => {
    removeTask(id);
  }, []);

  return (
    <PageContent>
      <View style={styles.container}>
        <Header componentId={componentId} />
        <DownloadPathBar />
        <FlatList
          data={tasks}
          renderItem={({ item }) => (
            <ListItem
              task={item}
              onRemove={handleRemove}
            />
          )}
          keyExtractor={item => item.id}
        />
      </View>
    </PageContent>
  );
});

const styles = createStyle({
  container: {
    flex: 1,
  },
});
