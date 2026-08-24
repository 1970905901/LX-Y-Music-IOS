import { NativeModules, Platform } from 'react-native'

const { CryptoModule } = NativeModules
const isIOS = Platform.OS === 'ios'

// iOS 无 CryptoModule 原生实现（加解密为安卓特性）。iOS 上同步功能不可用，
// 此处让相关方法抛出明确错误，由调用方（sync）catch 后降级，而非 undefined is not a function。
const assertCrypto = () => {
  if (isIOS || !CryptoModule) throw new Error('CryptoModule is not supported on iOS')
  return CryptoModule
}

// export const testRsa = (text: string, key: string) => {
//   // console.log(sourceFilePath, targetFilePath)
//   return CryptoModule.testRsa()
// }

enum KEY_PREFIX {
  publicKeyStart = '-----BEGIN PUBLIC KEY-----',
  publicKeyEnd = '-----END PUBLIC KEY-----',
  privateKeyStart = '-----BEGIN PRIVATE KEY-----',
  privateKeyEnd = '-----END PRIVATE KEY-----',
}

export enum RSA_PADDING {
  OAEPWithSHA1AndMGF1Padding = 'RSA/ECB/OAEPWithSHA1AndMGF1Padding',
  NoPadding = 'RSA/ECB/NoPadding',
}

export enum AES_MODE {
  CBC_128_PKCS7Padding = 'AES/CBC/PKCS7Padding',
  ECB_128_NoPadding = 'AES',
}

export const generateRsaKey = async () => {
  // console.log(sourceFilePath, targetFilePath)
  const key = (await assertCrypto().generateRsaKey()) as { publicKey: string; privateKey: string }
  return {
    publicKey: `${KEY_PREFIX.publicKeyStart}\n${key.publicKey}${KEY_PREFIX.publicKeyEnd}`,
    privateKey: `${KEY_PREFIX.privateKeyStart}\n${key.privateKey}${KEY_PREFIX.privateKeyEnd}`,
  }
}

export const rsaEncrypt = async (
  text: string,
  key: string,
  padding: RSA_PADDING
): Promise<string> => {
  // console.log(sourceFilePath, targetFilePath)
  return assertCrypto().rsaEncrypt(
    text,
    key.replace(KEY_PREFIX.publicKeyStart, '').replace(KEY_PREFIX.publicKeyEnd, ''),
    padding
  )
}

export const rsaDecrypt = async (
  text: string,
  key: string,
  padding: RSA_PADDING
): Promise<string> => {
  // console.log(sourceFilePath, targetFilePath)
  return assertCrypto().rsaDecrypt(
    text,
    key.replace(KEY_PREFIX.privateKeyStart, '').replace(KEY_PREFIX.privateKeyEnd, ''),
    padding
  )
}

export const rsaEncryptSync = (text: string, key: string, padding: RSA_PADDING): string => {
  // console.log(sourceFilePath, targetFilePath)
  return assertCrypto().rsaEncryptSync(
    text,
    key.replace(KEY_PREFIX.publicKeyStart, '').replace(KEY_PREFIX.publicKeyEnd, ''),
    padding
  )
}

export const rsaDecryptSync = (text: string, key: string, padding: RSA_PADDING): string => {
  // console.log(sourceFilePath, targetFilePath)
  return assertCrypto().rsaDecryptSync(
    text,
    key.replace(KEY_PREFIX.privateKeyStart, '').replace(KEY_PREFIX.privateKeyEnd, ''),
    padding
  )
}

export const aesEncrypt = async (
  text: string,
  key: string,
  vi: string,
  mode: AES_MODE
): Promise<string> => {
  // console.log(sourceFilePath, targetFilePath)
  return assertCrypto().aesEncrypt(text, key, vi, mode)
}

export const aesDecrypt = async (
  text: string,
  key: string,
  vi: string,
  mode: AES_MODE
): Promise<string> => {
  // console.log(sourceFilePath, targetFilePath)
  return assertCrypto().aesDecrypt(text, key, vi, mode)
}

export const aesEncryptSync = (text: string, key: string, vi: string, mode: AES_MODE): string => {
  // console.log(sourceFilePath, targetFilePath)
  return assertCrypto().aesEncryptSync(text, key, vi, mode)
}

export const aesDecryptSync = (text: string, key: string, vi: string, mode: AES_MODE): string => {
  // console.log(sourceFilePath, targetFilePath)
  return assertCrypto().aesDecryptSync(text, key, vi, mode)
}

export const hashSHA1 = async (text: string): Promise<string> => {
  try {
    return await assertCrypto().sha1(text)
  } catch (error) {
    console.error('生成SHA1出现问题:', error)
    throw error
  }
}
