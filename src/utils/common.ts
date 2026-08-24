/**
 * Get a random integer between two numbers, greater than or equal to min, less than max
 * @param {*} min
 * @param {*} max
 */
export const getRandom = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min)) + min

export const sizeFormate = (size: number): string => {
  // https://gist.github.com/thomseddon/3511330
  if (!size) return '0 B'
  let units = ['B', 'KB', 'MB', 'GB', 'TB']
  let number = Math.floor(Math.log(size) / Math.log(1024))
  return `${(size / Math.pow(1024, Math.floor(number))).toFixed(2)} ${units[number]}`
}

/**
 * Convert string, timestamp, etc. to date object
 * @param date Date
 * @returns Date object or empty string
 */
export const toDateObj = (date?: number | string | Date): Date | '' => {
  if (!date) return ''
  let result: Date
  switch (typeof date) {
    case 'string':
      const cleanDate = date.split('.')[0]
      if (!cleanDate.includes('T')) {
        result = new Date(cleanDate.replace(/-/g, '/'))
      } else {
        result = new Date(cleanDate)
      }
      break
    case 'number':
      result = new Date(date)
      break
    case 'object':
      result = date as Date
      break
    default:
      return ''
  }
  return isNaN(result.getTime()) ? '' : result
}

const numFix = (n: number): string => (n < 10 ? `0${n}` : n.toString())
/**
 * Date formatting
 * @param _date Date
 * @param format Y-M-D h:m:s
 */
export const dateFormat = (_date: number | string | Date, format = 'Y-M-D h:m:s') => {
  // console.log(date)
  const date = toDateObj(_date)
  if (!date) return ''
  return format
    .replace('Y', date.getFullYear().toString())
    .replace('M', numFix(date.getMonth() + 1))
    .replace('D', numFix(date.getDate()))
    .replace('h', numFix(date.getHours()))
    .replace('m', numFix(date.getMinutes()))
    .replace('s', numFix(date.getSeconds()))
}

export const formatPlayTime = (time: number) => {
  let m = Math.trunc(time / 60)
  let s = Math.trunc(time % 60)
  return m == 0 && s == 0 ? '--/--' : numFix(m) + ':' + numFix(s)
}

export const formatPlayTime2 = (time: number) => {
  let m = Math.trunc(time / 60)
  let s = Math.trunc(time % 60)
  return numFix(m) + ':' + numFix(s)
}

export const isUrl = (path: string) => /https?:\/\//.test(path)

export const parseUrlParams = (str: string): Record<string, string> => {
  const params: Record<string, string> = {}
  if (typeof str !== 'string') return params
  const paramsArr = str.split('&')
  for (const param of paramsArr) {
    let [key, value] = param.split('=')
    params[key] = value
  }
  return params
}

/**
 * Generate a throttle function
 * @param fn Callback
 * @param delay Delay
 * @returns
 */
export function throttle<Args extends any[]>(
  fn: (...args: Args) => void | Promise<void>,
  delay = 100
) {
  let timer: NodeJS.Timeout | null = null
  let _args: Args
  return (...args: Args) => {
    _args = args
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      void fn(..._args)
    }, delay)
  }
}

/**
 * Generate a debounce function
 * @param fn Callback
 * @param delay Delay
 * @returns
 */
export function debounce<Args extends any[]>(
  fn: (...args: Args) => void | Promise<void>,
  delay = 100
) {
  let timer: NodeJS.Timeout | null = null
  let _args: Args
  return (...args: Args) => {
    _args = args
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void fn(..._args)
    }, delay)
  }
}

const fileNameRxp = /[\\/:*?#"<>|]/g
export const filterFileName = (name: string): string => name.replace(fileNameRxp, '')

// https://blog.csdn.net/xcxy2015/article/details/77164126#comments
/**
 *
 * @param a
 * @param b
 */
export const similar = (a: string, b: string) => {
  if (!a || !b) return 0
  if (a.length > b.length) {
    let t = b
    b = a
    a = t
  }
  let al = a.length
  let bl = b.length
  let mp = []
  let i, j, ai, lt, tmp
  for (i = 0; i <= bl; i++) mp[i] = i
  for (i = 1; i <= al; i++) {
    ai = a.charAt(i - 1)
    lt = mp[0]
    mp[0] = mp[0] + 1
    for (j = 1; j <= bl; j++) {
      tmp = Math.min(mp[j] + 1, mp[j - 1] + 1, lt + (ai == b.charAt(j - 1) ? 0 : 1))
      lt = mp[j]
      mp[j] = tmp
    }
  }
  return 1 - mp[bl] / bl
}

/**
 * Sorted insertion
 * @param arr
 * @param data
 */
export const sortInsert = <T>(
  arr: Array<{ num: number; data: T }>,
  data: { num: number; data: T }
) => {
  let key = data.num
  let left = 0
  let right = arr.length - 1

  while (left <= right) {
    let middle = Math.trunc((left + right) / 2)
    if (key == arr[middle].num) {
      left = middle
      break
    } else if (key < arr[middle].num) {
      right = middle - 1
    } else {
      left = middle + 1
    }
  }
  while (left > 0) {
    if (arr[left - 1].num != key) break
    left--
  }

  arr.splice(left, 0, data)
}

export const arrPush = <T>(list: T[], newList: T[]) => {
  for (let i = 0; i * 1000 < newList.length; i++) {
    list.push(...newList.slice(i * 1000, (i + 1) * 1000))
  }
  return list
}

export const arrUnshift = <T>(list: T[], newList: T[]) => {
  for (let i = 0; i * 1000 < newList.length; i++) {
    list.splice(i * 1000, 0, ...newList.slice(i * 1000, (i + 1) * 1000))
  }
  return list
}

export const arrPushByPosition = <T>(list: T[], newList: T[], position: number) => {
  for (let i = 0; i * 1000 < newList.length; i++) {
    list.splice(position + i * 1000, 0, ...newList.slice(i * 1000, (i + 1) * 1000))
  }
  return list
}

// https://stackoverflow.com/a/2450976
export const arrShuffle = <T>(array: T[]) => {
  let currentIndex = array.length
  let randomIndex

  // While there remain elements to shuffle.
  while (currentIndex != 0) {
    // Pick a remaining element.
    randomIndex = Math.floor(Math.random() * currentIndex)
    currentIndex--

    // And swap it with the current element.
    ;[array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]]
  }

  return array
}

// export const freezeListItem = <T extends any[]>(list: T): MakeArrayItemReadOnly<T> => {
//   for (let i = 0; i < list.length; i++) {
//     Object.freeze(list[i])
//   }
//   return list
// }

export const b64DecodeUnicode = (str: string) => {
  // Going backwards: from bytestream, to percent-encoding, to original string.
  return Buffer.from(str, 'base64').toString()
}
