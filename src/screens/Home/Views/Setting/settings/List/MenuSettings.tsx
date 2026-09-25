import { memo } from 'react';
import { View } from 'react-native';
import SubTitle from '../../components/SubTitle';
import CheckBox from '@/components/common/CheckBox';
import { useI18n } from '@/lang';
import { useSettingValue } from '@/store/setting/hook';
import { updateSetting } from '@/core/common';
import { createStyle } from '@/utils/tools';
import { useTheme } from '@/store/theme/hook';
import { designRadius, designSpacing } from '@/theme/DesignTokens';

type MenuSettingKey =
  | 'menu.playLater'
  | 'menu.dislike'

const SettingItem = ({ settingKey, label }: { settingKey: MenuSettingKey; label: string }) => {
  const value = useSettingValue(settingKey);
  const handleChange = (newValue: boolean) => {
    updateSetting({ [settingKey]: newValue });
  };

  return (
    <CheckBox
      check={value}
      onChange={handleChange}
      label={label}
    />
  );
};

export default memo(() => {
  const t = useI18n();
  const theme = useTheme();

  return (
    <SubTitle title="菜单设置">
      <View style={{ ...styles.content, borderColor: theme['c-border-background'] }}>
        <SettingItem settingKey="menu.playLater" label={t('play_later')} />
        <SettingItem settingKey="menu.dislike" label={t('dislike')} />
      </View>
    </SubTitle>
  );
});

const styles = createStyle({
  content: {
    marginTop: designSpacing.xs,
    padding: designSpacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: designSpacing.xs,
    borderWidth: 1,
    borderRadius: designRadius.sm,
  },
});
