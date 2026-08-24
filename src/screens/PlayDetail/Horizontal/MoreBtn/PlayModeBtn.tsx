import { memo } from 'react'
import { usePlayModeToggle } from '@/screens/PlayDetail/components/usePlayModeToggle'
import Btn from './Btn'

export default memo(() => {
  const { toggleNextPlayMode, playModeIcon } = usePlayModeToggle()
  return <Btn icon={playModeIcon} onPress={toggleNextPlayMode} />
})
