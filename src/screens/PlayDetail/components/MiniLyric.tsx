import { memo, useMemo } from 'react';
import { type StyleProp, type TextStyle, TouchableOpacity, View } from 'react-native';
import { useLrcPlay, useLrcSet } from '@/plugins/lyric';
import { createStyle } from '@/utils/tools';
import { useTheme } from '@/store/theme/hook';
import Text from '@/components/common/Text';
import { useSettingValue } from '@/store/setting/hook';

const MiniLyric = ({ onPress, style }: { onPress?: () => void, style?: any }) => {
  const theme = useTheme();
  const { line: activeLine } = useLrcPlay();
  const lyricLines = useLrcSet();
  const textAlign = useSettingValue('playDetail.style.miniLyricAlign');

  const { currentLine, translationLine } = useMemo(() => {
    if (activeLine < 0 || lyricLines.length <= activeLine) {
      return { currentLine: null, translationLine: null };
    }
    const line = lyricLines[activeLine];
    return {
      currentLine: line.text,
      translationLine: line.extendedLyrics.length > 0 ? line.extendedLyrics[0] : null,
    };
  }, [activeLine, lyricLines]);

  const activeColor = theme.isDark ? theme['c-font'] : theme['c-primary'];
  // 容器与行内样式用 useMemo 缓存，避免每次渲染生成新对象（对齐项目样式规范）。
  const contentStyle = useMemo<StyleProp<TextStyle>>(() => ({ textAlign }), [textAlign]);
  const translationStyle = useMemo<StyleProp<TextStyle>>(() => ({ textAlign, marginTop: 4 }), [textAlign]);

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[styles.container, style]}
      accessibilityRole="button"
      accessibilityLabel={currentLine ?? undefined}
    >
      {currentLine ? (
        <View>
          <Text
            size={13}
            color={activeColor}
            style={contentStyle}
            numberOfLines={1}
          >
            {currentLine}
          </Text>
          {translationLine && (
            <Text
              size={13}
              color={activeColor}
              style={translationStyle}
              numberOfLines={1}
            >
              {translationLine}
            </Text>
          )}
        </View>
      ) : (
        <Text size={13} color={theme['c-font-label']} style={contentStyle}>
          ...
        </Text>
      )}
    </TouchableOpacity>
  );
};

const styles = createStyle({
  container: {
    paddingVertical: 10,
    paddingLeft: 20,
    paddingRight: 20,
    alignItems: 'stretch',
  },
});

export default memo(MiniLyric);
