import settingState from '@/store/setting/state'
import { stringMd5 } from 'react-native-quick-md5'

export const SIGN_SALT = 'OIlwieks28dk2k092lksi2UIkp'

export function signAndroidParams(params, data = '') {
  const sortedKeys = Object.keys(params).sort()
  const paramsString = sortedKeys.map(key => {
    const value = typeof params[key] === 'object' ? JSON.stringify(params[key]) : params[key]
    return `${key}=${value}`
  }).join('')
  const signStr = `${SIGN_SALT}${paramsString}${data}${SIGN_SALT}`
  return stringMd5(signStr)
}

export function getDeviceInfo() {
  const cookie = settingState.setting['common.kg_cookie'] || ''
  const cookieObj = {}
  cookie.split(';').forEach(pair => {
    const [k, ...v] = pair.trim().split('=')
    if (k) cookieObj[k.trim()] = v.join('=').trim()
  })
  return {
    dfid: cookieObj.dfid || '',
    mid: cookieObj.mid || '',
    userid: cookieObj.userid || '',
    token: cookieObj.token || '',
  }
}

export const buildHeaders = () => ({
  'User-Agent': 'Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi',
  'kg-rc': '1',
  'kg-thash': '5d816a0',
  'kg-rec': '1',
  'kg-rf': 'B9EDA08A64250DEFFBCADDEE00F8F25F',
})
