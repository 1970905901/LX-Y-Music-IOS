import { bootLog } from '@/utils/bootLog'

export const withTimeout = <T,>(
  promise: Promise<T>,
  label: string,
  fallback: T,
  timeoutMs = 3000,
): Promise<T> => {
  const startTime = Date.now()
  const guardedPromise = promise.catch(error => {
    if (Date.now() - startTime < timeoutMs) throw error
    return fallback
  })
  const timeoutPromise = new Promise<T>(resolve => {
    setTimeout(() => {
      bootLog(`${label} timeout, using fallback.`)
      resolve(fallback)
    }, timeoutMs)
  })
  return Promise.race([guardedPromise, timeoutPromise])
}
