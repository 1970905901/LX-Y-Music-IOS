import { useState, useEffect } from 'react'
import state, { type InitState } from './state'

export const useAnnouncementInfo = () => {
  const [info, setInfo] = useState<InitState>({ ...state })
  useEffect(() => {
    const callback = (newState: InitState) => {
      setInfo({ ...newState })
    }
    global.state_event.on('announcementUpdated', callback)
    return () => {
      global.state_event.off('announcementUpdated', callback)
    }
  }, [])
  return info
}
