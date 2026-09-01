import React, {forwardRef, useImperativeHandle, useRef, useEffect, useCallback, useState} from 'react';
import { Animated, View, StyleSheet, TouchableWithoutFeedback, BackHandler } from 'react-native';
import { useWindowSize, useHorizontalMode } from '@/utils/hooks';

export interface AnimatedSlideUpPanelType {
  setVisible: (visible: boolean) => void;
}

interface Props {
  children: React.ReactNode;
  onHide?: () => void;
}

const AnimatedSlideUpPanel = forwardRef<AnimatedSlideUpPanelType, Props>(({ children, onHide }, ref) => {
  const { height: windowHeight } = useWindowSize();
  const isHorizontal = useHorizontalMode();
  const [isVisible, setIsVisible] = useState(false);
  const animatedValue = useRef(new Animated.Value(windowHeight)).current;

  const show = useCallback(() => {
    setIsVisible(true);
    Animated.timing(animatedValue, {
      toValue: 0,
      duration: 0,
      useNativeDriver: true,
    }).start();
  }, [animatedValue]);

  const hide = useCallback(() => {
    Animated.timing(animatedValue, {
      toValue: windowHeight,
      duration: 0,
      useNativeDriver: true,
    }).start(() => {
      setIsVisible(false);
      onHide?.();
    });
  }, [animatedValue, windowHeight, onHide]);

  useImperativeHandle(ref, () => ({
    setVisible: (visible: boolean) => {
      if (visible) {
        show();
      } else {
        hide();
      }
    },
  }));

  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (isVisible) {
        hide();
        return true;
      }
      return false;
    });

    return () => backHandler.remove();
  }, [isVisible, hide]);

  useEffect(() => {
    // 窗口高度变化（iPad 旋转/分屏）时，隐藏态的动画值仍停留在旧窗口高，
    // 会导致下次 show 前 opacity 插值区间 [0, windowHeight] 与当前值错位；
    // 隐藏态直接对齐到新窗口高（显示态 translateY=0 无需处理）。
    if (!isVisible) animatedValue.setValue(windowHeight);
  }, [windowHeight, isVisible, animatedValue]);

  if (!isVisible) {
    return null;
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <TouchableWithoutFeedback onPress={hide}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: 'rgba(0, 0, 0, 0.3)',
              opacity: animatedValue.interpolate({
                inputRange: [0, windowHeight],
                outputRange: [1, 0],
              }),
            },
          ]}
        />
      </TouchableWithoutFeedback>
      <View style={[styles.panelContainer, isHorizontal && styles.panelContainerHorizontal]} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.panel,
            isHorizontal ? styles.panelHorizontal : null,
            {
              transform: [{ translateY: animatedValue }],
            },
          ]}
        >
          {children}
        </Animated.View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  panelContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  panelContainerHorizontal: {
    alignItems: 'center',
  },
  panel: {
    width: '100%',
    height: '50%',
  },
  panelHorizontal: {
    maxWidth: 760,
  },
});

export default AnimatedSlideUpPanel;
