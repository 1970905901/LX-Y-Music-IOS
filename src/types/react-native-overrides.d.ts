/* eslint-disable @typescript-eslint/no-unused-vars */
import type { FlatListProps, ScrollViewProps } from 'react-native'
import type { Options } from 'react-native-navigation'

declare module 'react-native' {
  interface FlatListProps<ItemT> {
    delaysContentTouches?: boolean
  }

  interface ScrollViewProps {
    delaysContentTouches?: boolean
  }
}

declare module 'react-native-navigation' {
  interface Options {
    gestureEnabled?: boolean
  }
}
