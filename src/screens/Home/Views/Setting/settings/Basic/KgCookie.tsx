import { useSettingValue } from '@/store/setting/hook';
import { updateSetting } from '@/core/common';
import InputItem from '../../components/InputItem';
import { createStyle, toast } from '@/utils/tools';
import { memo, useCallback, useEffect } from 'react';
import { View } from 'react-native';
import { useI18n } from '@/lang';

export default memo(() => {
  const t = useI18n();
  const kgCookie = useSettingValue('common.kg_cookie');

  const handleKgCookieChanged = useCallback(
    (text: string) => {
      updateSetting({ 'common.kg_cookie': text });
      if (text && text.length > 50) {
        toast(t('setting_basic_kg_cookie') + ' ' + t('saved'));
      }
    },
    [t],
  );

  useEffect(() => {
    const handleCookieSet = (cookie: string) => {
      updateSetting({ 'common.kg_cookie': cookie });
    };

    global.app_event.on('kg-cookie-set', handleCookieSet);
    return () => {
      global.app_event.off('kg-cookie-set', handleCookieSet);
    };
  }, []);

  return (
    <View style={styles.content}>
      <InputItem
        value={kgCookie}
        label={t('setting_basic_kg_cookie')}
        onChanged={handleKgCookieChanged}
        placeholder={t('setting_basic_kg_cookie_placeholder')}
      />
    </View>
  );
});

const styles = createStyle({
  content: {
    // marginTop: 10,
  },
});