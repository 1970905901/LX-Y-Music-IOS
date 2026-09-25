import { bootLog } from '@/utils/bootLog'

export const withTimeout = async <T,>(
  promise: Promise<T>,
  label: string,
  fallback: T,
  timeoutMs = 3000,
): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      bootLog(`${label} timeout, using fallback.`)
      resolve(fallback)
    }, timeoutMs)
    promise.then(
      value => {
        clearTimeout(timeoutId)
        resolve(value)
      },
      error => {
        clearTimeout(timeoutId)
        reject(error)
      },
    )
  })
}
