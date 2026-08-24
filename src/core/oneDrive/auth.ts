import { getData, removeData, saveData } from '@/plugins/storage'

const AUTHORITY = 'https://login.microsoftonline.com/common/oauth2/v2.0'
const GRAPH_ME_URL = 'https://graph.microsoft.com/v1.0/me'
const REDIRECT_URI = 'https://login.microsoftonline.com/common/oauth2/nativeclient'
const SCOPES = 'offline_access User.Read Files.Read'
const AUTH_INFO_KEY = '@onedrive_auth'
const PENDING_AUTH_KEY = '@onedrive_pending_auth'

const randomChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'

const createRandomString = (length: number) => {
  let result = ''
  for (let i = 0; i < length; i++) {
    result += randomChars[Math.floor(Math.random() * randomChars.length)]
  }
  return result
}

const toFormBody = (data: Record<string, string>) => {
  return Object.entries(data)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')
}

const parseAuthCode = (text: string) => {
  const value = text.trim()
  if (!value) return ''

  const match = value.match(/(?:^|[?&#])code=([^&\s]+)/)
  return match ? decodeURIComponent(match[1]) : value
}

const requestToken = async (params: Record<string, string>) => {
  const response = await fetch(`${AUTHORITY}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: toFormBody(params),
  })
  const body = await response.json()
  if (!response.ok) {
    throw new Error(body.error_description ?? body.error ?? 'OneDrive token request failed')
  }
  return body as {
    access_token: string
    refresh_token?: string
    expires_in: number
  }
}

const requestDeviceToken = async (params: Record<string, string>) => {
  const response = await fetch(`${AUTHORITY}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: toFormBody(params),
  })
  const body = await response.json()
  if (!response.ok) {
    throw new Error(body.error ?? body.error_description ?? 'OneDrive device token request failed')
  }
  return body as {
    access_token: string
    refresh_token?: string
    expires_in: number
  }
}

const getAccountInfo = async (accessToken: string): Promise<LX.OneDrive.AccountInfo | undefined> => {
  const response = await fetch(GRAPH_ME_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })
  if (!response.ok) return undefined
  const body = await response.json()
  return {
    id: body.id,
    displayName: body.displayName,
    userPrincipalName: body.userPrincipalName,
    mail: body.mail,
  }
}

export const getOneDriveAuth = async () => getData<LX.OneDrive.AuthInfo>(AUTH_INFO_KEY)

export const saveOneDriveAuth = async (authInfo: LX.OneDrive.AuthInfo) => {
  await saveData(AUTH_INFO_KEY, authInfo)
}

export const clearOneDriveAuth = async () => {
  await removeData(AUTH_INFO_KEY)
  await removeData(PENDING_AUTH_KEY)
}

export const getPendingOneDriveAuth = async () =>
  getData<LX.OneDrive.PendingAuth>(PENDING_AUTH_KEY)

export const createOneDriveDeviceCode = async (clientId: string) => {
  const cleanClientId = clientId.trim()
  if (!cleanClientId) throw new Error('Client ID 不能为空')

  const response = await fetch(`${AUTHORITY}/devicecode`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: toFormBody({
      client_id: cleanClientId,
      scope: SCOPES,
    }),
  })
  const body = await response.json()
  if (!response.ok) {
    throw new Error(body.error_description ?? body.error ?? 'OneDrive device code request failed')
  }

  return {
    clientId: cleanClientId,
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUri: body.verification_uri,
    verificationUriComplete: body.verification_uri_complete,
    message: body.message,
    expiresAt: Date.now() + body.expires_in * 1000,
    interval: body.interval || 5,
  } as LX.OneDrive.DeviceCodeInfo
}

const wait = async (time: number) => new Promise(resolve => setTimeout(resolve, time))

export const pollOneDriveDeviceCode = async (deviceInfo: LX.OneDrive.DeviceCodeInfo) => {
  let interval = deviceInfo.interval
  while (Date.now() < deviceInfo.expiresAt) {
    await wait(interval * 1000)
    try {
      const token = await requestDeviceToken({
        client_id: deviceInfo.clientId,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceInfo.deviceCode,
      })
      const authInfo: LX.OneDrive.AuthInfo = {
        clientId: deviceInfo.clientId,
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? '',
        expiresAt: Date.now() + token.expires_in * 1000,
        account: await getAccountInfo(token.access_token),
      }
      await saveOneDriveAuth(authInfo)
      return authInfo
    } catch (err: any) {
      if (err.message == 'authorization_pending') continue
      if (err.message == 'slow_down') {
        interval += 5
        continue
      }
      throw err
    }
  }
  throw new Error('设备码已过期，请重新生成')
}

export const createOneDriveAuthUrl = async (clientId: string) => {
  const cleanClientId = clientId.trim()
  if (!cleanClientId) throw new Error('Client ID 不能为空')

  const pending: LX.OneDrive.PendingAuth = {
    clientId: cleanClientId,
    codeVerifier: createRandomString(64),
    state: createRandomString(24),
    createdAt: Date.now(),
  }
  await saveData(PENDING_AUTH_KEY, pending)

  const params = toFormBody({
    client_id: pending.clientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    response_mode: 'query',
    scope: SCOPES,
    code_challenge: pending.codeVerifier,
    code_challenge_method: 'plain',
    state: pending.state,
  })
  return `${AUTHORITY}/authorize?${params}`
}

export const exchangeOneDriveCode = async (rawCode: string) => {
  const pending = await getPendingOneDriveAuth()
  if (!pending) throw new Error('请先打开授权页面')

  const code = parseAuthCode(rawCode)
  if (!code) throw new Error('授权 code 不能为空')

  const token = await requestToken({
    client_id: pending.clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_verifier: pending.codeVerifier,
  })

  const authInfo: LX.OneDrive.AuthInfo = {
    clientId: pending.clientId,
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? '',
    expiresAt: Date.now() + token.expires_in * 1000,
    account: await getAccountInfo(token.access_token),
  }
  await saveOneDriveAuth(authInfo)
  await removeData(PENDING_AUTH_KEY)
  return authInfo
}

export const refreshOneDriveAuth = async () => {
  const auth = await getOneDriveAuth()
  if (!auth?.refreshToken) throw new Error('OneDrive 未登录')

  const token = await requestToken({
    client_id: auth.clientId,
    grant_type: 'refresh_token',
    refresh_token: auth.refreshToken,
    scope: SCOPES,
  })

  const nextAuth: LX.OneDrive.AuthInfo = {
    ...auth,
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? auth.refreshToken,
    expiresAt: Date.now() + token.expires_in * 1000,
  }
  await saveOneDriveAuth(nextAuth)
  return nextAuth
}

export const getValidOneDriveAuth = async () => {
  const auth = await getOneDriveAuth()
  if (!auth) throw new Error('OneDrive 未登录')
  if (auth.expiresAt > Date.now() + 5 * 60 * 1000) return auth
  return refreshOneDriveAuth()
}
