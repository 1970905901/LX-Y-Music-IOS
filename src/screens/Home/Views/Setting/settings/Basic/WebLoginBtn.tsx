import { memo } from 'react';
import { View } from 'react-native';
import { createStyle } from '@/utils/tools';
import Button from '../../components/Button';

export default memo(() => {
  const handleShowWyLoginModal = () => {
    global.app_event.emit('showWebLogin');
  };

  const handleShowTxLoginModal = () => {
    global.app_event.emit('showTxWebLogin');
  };

  const handleShowKgLoginModal = () => {
    global.app_event.emit('showKgWebLogin');
  };

  return (
    <View style={styles.content}>
      <Button onPress={handleShowWyLoginModal}>网易登录</Button>
      <Button onPress={handleShowTxLoginModal}>QQ登录</Button>
      <Button onPress={handleShowKgLoginModal}>酷狗登录</Button>
    </View>
  );
});

const styles = createStyle({
  content: {
    marginBottom: 5,
    paddingLeft: 20,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
});
