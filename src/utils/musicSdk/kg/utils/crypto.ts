/**
 * KuGou Music pure JavaScript encryption utility module
 * Fully matches KuGouMusicApi's crypto.js and generate_simulate.js behavior
 *
 * Uses crypto-js for AES encryption
 * Uses node-forge for RSA encryption
 */

import CryptoJS from 'crypto-js';
import forge from 'node-forge';
import { stringMd5 } from 'react-native-quick-md5';

// ============================================================
// Utility functions
// ============================================================

function encodeUtf8(str: string): Uint8Array {
  const codePoints: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      const next = str.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = ((code - 0xd800) << 10) + (next - 0xdc00) + 0x10000;
        i++;
      }
    }
    codePoints.push(code);
  }

  const bytes: number[] = [];
  for (const code of codePoints) {
    if (code <= 0x7f) {
      bytes.push(code);
    } else if (code <= 0x7ff) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code <= 0xffff) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }

  return new Uint8Array(bytes);
}

function normalizeBuffer(data: string | Uint8Array): Uint8Array {
  if (data instanceof Uint8Array) return data;
  return encodeUtf8(data);
}

function wordArrayFromBuffer(uint8: Uint8Array): CryptoJS.lib.WordArray {
  const words: number[] = [];
  for (let i = 0; i < uint8.length; i += 4) {
    words.push(
      ((uint8[i] || 0) << 24) |
        ((uint8[i + 1] || 0) << 16) |
        ((uint8[i + 2] || 0) << 8) |
        (uint8[i + 3] || 0),
    );
  }
  return CryptoJS.lib.WordArray.create(words, uint8.length);
}

function wordArrayToBuffer(wordArray: CryptoJS.lib.WordArray): Uint8Array {
  const { words, sigBytes } = wordArray;
  const uint8 = new Uint8Array(sigBytes);
  for (let i = 0; i < sigBytes; i++) {
    uint8[i] = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
  }
  return uint8;
}

function uint8ArrayToHex(arr: Uint8Array): string {
  return Array.from(arr)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function utf8WordArray(input: string | Uint8Array): CryptoJS.lib.WordArray {
  return typeof input === 'string' ? CryptoJS.enc.Utf8.parse(input) : wordArrayFromBuffer(input);
}

function randomString(len: number = 16): string {
  const keyString = '1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const result: string[] = [];
  for (let i = 0; i < len; i++) {
    const ceil = Math.ceil((keyString.length - 1) * Math.random());
    result.push(keyString[ceil]);
  }
  return result.join('');
}

// ============================================================
// AES encryption (matches KuGouMusicApi cryptoAesEncrypt)
// ============================================================

export interface AesEncryptResult {
  str: string;
  key: string;
}

/**
 * AES-CBC encryption
 * Matches KuGouMusicApi's cryptoAesEncrypt behavior
 *
 * @param data data to encrypt (objects will be JSON.stringify'd)
 * @param opt optional key/iv (auto-generated if not provided)
 * @returns {str: hex ciphertext, key: raw key}
 */
export function cryptoAesEncrypt(
  data: any,
  opt?: { key?: string; iv?: string },
): AesEncryptResult {
  const dataStr = typeof data === 'object' ? JSON.stringify(data) : String(data);
  const buffer = normalizeBuffer(dataStr);

  let key: string;
  let iv: string;
  let tempKey = '';

  if (opt?.key && opt?.iv) {
    key = opt.key;
    iv = opt.iv;
  } else {
    tempKey = opt?.key || randomString(16).toLowerCase();
    key = stringMd5(tempKey).substring(0, 32);
    iv = key.substring(key.length - 16);
  }

  const encrypted = CryptoJS.AES.encrypt(wordArrayFromBuffer(buffer), utf8WordArray(key), {
    iv: utf8WordArray(iv),
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });

  const hex = CryptoJS.enc.Hex.stringify(encrypted.ciphertext);
  if (opt?.key && opt?.iv) return { str: hex, key: opt.key };
  return { str: hex, key: tempKey };
}

/**
 * AES-CBC decryption (matches KuGouMusicApi cryptoAesDecrypt)
 * @param data hex-encoded ciphertext
 * @param key raw key string
 * @param iv optional IV (derived from key if not provided)
 * @returns decrypted plaintext
 */
export function cryptoAesDecrypt(data: string, key: string, iv?: string): string {
  let actualKey = key;
  let actualIv = iv;
  if (!actualIv) {
    actualKey = stringMd5(key).substring(0, 32);
    actualIv = actualKey.substring(actualKey.length - 16);
  }

  const cipherParams = CryptoJS.lib.CipherParams.create({
    ciphertext: CryptoJS.enc.Hex.parse(data),
  });

  const decrypted = CryptoJS.AES.decrypt(cipherParams, utf8WordArray(actualKey), {
    iv: utf8WordArray(actualIv),
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });

  return decrypted.toString(CryptoJS.enc.Utf8);
}

// ============================================================
// RSA encryption (matches KuGouMusicApi cryptoRSAEncrypt)
// ============================================================

const RSA_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDIAG7QOELSYoIJvTFJhMpe1s/gbjDJX51HBNnEl5HXqTW6lQ7LC8jr9fWZTwusknp+sVGzwd40MwP6U5yDE27M/X1+UR4tvOGOqp94TJtQ1EPnWGWXngpeIW5GxoQGao1rmYWAu6oi1z9XkChrsUdC6DJE5E221wf/4WLFxwAtRQIDAQAB
-----END PUBLIC KEY-----`;

const rsaKeyCache = new Map<string, forge.pki.rsa.PublicKey>();

function getForgePublicKey(pem: string): forge.pki.rsa.PublicKey {
  if (!rsaKeyCache.has(pem)) {
    rsaKeyCache.set(pem, forge.pki.publicKeyFromPem(pem) as forge.pki.rsa.PublicKey);
  }
  return rsaKeyCache.get(pem)!;
}

function rsaRawEncrypt(buffer: Uint8Array, publicKey: forge.pki.rsa.PublicKey): string {
  const keyLength = Math.ceil(publicKey.n.bitLength() / 8);
  const message = new forge.jsbn.BigInteger(uint8ArrayToHex(buffer), 16);
  const encrypted = message.modPow(publicKey.e, publicKey.n);
  return encrypted.toString(16).padStart(keyLength * 2, '0');
}

/**
 * RSA encryption (zero-padding, matches KuGouMusicApi cryptoRSAEncrypt)
 * Used for encrypt_user_info's pk field
 */
export function cryptoRSAEncrypt(data: any, publicKeyPem?: string): string {
  const dataStr = typeof data === 'object' ? JSON.stringify(data) : String(data);
  const buffer = normalizeBuffer(dataStr);
  const pem = publicKeyPem || RSA_PUBLIC_KEY;
  const key = getForgePublicKey(pem);
  const keyLength = Math.ceil(key.n.bitLength() / 8);

  if (buffer.length > keyLength) throw new Error('Data length exceeds key size');
  let padded = buffer;
  if (buffer.length < keyLength) {
    padded = new Uint8Array(keyLength);
    padded.set(buffer);
  }

  return rsaRawEncrypt(padded, key);
}

/**
 * RSA-PKCS1v15 encryption (matches KuGouMusicApi rsaEncrypt2)
 * Used for playlist deletion and other endpoints
 */
export function rsaEncrypt2(data: string, publicKeyPem?: string): string {
  const buffer = normalizeBuffer(data);
  const pem = publicKeyPem || RSA_PUBLIC_KEY;
  const key = getForgePublicKey(pem);
  let binaryStr = '';
  for (let i = 0; i < buffer.length; i++) binaryStr += String.fromCharCode(buffer[i]);
  const encrypted = key.encrypt(binaryStr, 'RSAES-PKCS1-V1_5');
  return forge.util.bytesToHex(encrypted);
}

/**
 * Playlist AES encryption (matches KuGouMusicApi playlistAesEncrypt)
 * Generates random 6-char key, derives AES key and IV via MD5
 */
export function playlistAesEncrypt(data: any): { key: string; str: string } {
  const useData = typeof data === 'object' ? JSON.stringify(data) : String(data);
  const key = randomString(6).toLowerCase();
  const md5Key = stringMd5(key);
  const encryptKey = md5Key.substring(0, 16);
  const iv = md5Key.substring(16, 32);

  const encrypted = CryptoJS.AES.encrypt(CryptoJS.enc.Utf8.parse(useData), utf8WordArray(encryptKey), {
    iv: utf8WordArray(iv),
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });

  return { key, str: CryptoJS.enc.Base64.stringify(encrypted.ciphertext) };
}

/**
 * Playlist AES decryption (matches KuGouMusicApi playlistAesDecrypt)
 */
export function playlistAesDecrypt(data: { str: string; key: string }): any {
  const md5Key = stringMd5(data.key);
  const encryptKey = md5Key.substring(0, 16);
  const iv = md5Key.substring(16, 32);

  const cipherParams = CryptoJS.lib.CipherParams.create({
    ciphertext: CryptoJS.enc.Base64.parse(data.str),
  });
  const decrypted = CryptoJS.AES.decrypt(cipherParams, utf8WordArray(encryptKey), {
    iv: utf8WordArray(iv),
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });

  const text = decrypted.toString(CryptoJS.enc.Utf8);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ============================================================
// Generate sid/edt (matches KuGouMusicApi generateSimulate)
// ============================================================

const SSA_RSA_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAoW2+Ylo8ALePSQTP0xBF
lFmEOHvBD9tS+s7DBlfKEu3RzzvZTaX1JtYbX4+AVUqj6ARz8IM+CKByqGFvbHN/
W64XxNI+q7z36ajCL3VTJ2W5G9MCJitc6oGbire4NQfhaEq0nC+hxBWQvCbIFflA
2ItrLUbSU7z1bHA/a+jlQm4OWvY+IKnTryOJTPuT1yNOVjbJ8wBLKy2DgQr9pPqW
PmEQtGpR5IM9V8Kao6PaSdKYOWGbX3i2+RzIKhvZUxxtJwdVbqPlDPlW9h4/xIBc
56Lgvr4aIl8nFtwbj4UJVUTFuGrs0tY9H/tXvZ22dUCKuGxW/gW7ZF+gXz6vHtYa
rQIDAQAB
-----END PUBLIC KEY-----`;

const SSA_AES_IV = 'kugousecurity123';
let SENTINEL = 0xffffffff - Math.floor(Math.random() * 20);

function ri(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function f3(t: number, i: number, x: number, y: number): string {
  return `3,${t},${i},${x},${y}`;
}
function f5(t: number, i: number): string {
  return `5,${t},${i}`;
}
function f6(t: number, i: number, x: number, y: number): string {
  return `6,${t},${i},${x},${y}`;
}
function fs3(i: number, x: number, y: number): string {
  return `3,${SENTINEL},${i},${x},${y}`;
}
function fs5(i: number): string {
  return `5,${SENTINEL},${i}`;
}
function fs6(i: number, x: number, y: number): string {
  return `6,${SENTINEL},${i},${x},${y}`;
}

function bezierPath(
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  n: number,
): Array<{ x: number; y: number }> {
  const c1x = sx + (ex - sx) * 0.3 + ri(-80, 80);
  const c1y = sy + (ey - sy) * 0.2 + ri(-60, 60);
  const c2x = sx + (ex - sx) * 0.7 + ri(-60, 60);
  const c2y = sy + (ey - sy) * 0.8 + ri(-40, 40);

  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const x =
      u * u * u * sx + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * ex;
    const y =
      u * u * u * sy + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ey;
    const jitter = Math.max(0.5, 3 - t * 2.5);
    pts.push({
      x: x + (Math.random() - 0.5) * jitter,
      y: y + (Math.random() - 0.5) * jitter,
    });
  }
  return pts;
}

function generateEDTData(opts: {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  mousePoints: number;
}): string {
  const { startX, startY, endX, endY, mousePoints } = opts;
  const entries: string[] = [];
  let ts = 0;
  let ei = 0;

  entries.push(f5(0, 0));
  entries.push(fs5(0));
  entries.push(f5(0, 0));
  entries.push(fs5(0));

  ts += ri(5, 20);
  entries.push(f6(ts, ei, 750, 500));
  entries.push(fs6(ei, 750, 500));
  ei++;

  for (let i = 0; i < 3; i++) {
    ts += ri(80, 600);
    entries.push(f5(ts, ei));
    entries.push(fs5(ei));
    ei++;
  }

  const path = bezierPath(startX, startY, endX, endY, mousePoints);
  let si = 0;
  for (let i = 0; i < path.length; i++) {
    const { x, y } = path[i];
    ts += ri(8, 50);
    entries.push(f3(ts, si, Math.round(x), Math.round(y)));
    entries.push(fs3(si, Math.round(x), Math.round(y)));

    if (i > 0 && i % 12 === 0) {
      ts += ri(20, 60);
      entries.push(f5(ts, ei));
      entries.push(fs5(ei));
      ei++;
    }
    si = (si + 1) % 2;
  }

  ts += ri(5, 30);
  entries.push(f3(ts, 1, Math.round(endX + ri(-5, 5)), Math.round(endY + ri(-5, 5))));
  entries.push(fs3(1, Math.round(endX), Math.round(endY)));

  return entries.join(':');
}

/**
 * Generate simulated sid and edt
 * Fully matches KuGouMusicApi generateSimulate behavior
 *
 * @returns {edt: base64 ciphertext, sid: base64 ciphertext}
 */
export function generateSidEdt(
  mid: string,
  userid: string,
  dfid: string,
  webglHash?: string,
): { edt: string; sid: string } {
  SENTINEL = 0xffffffff - Math.floor(Math.random() * 20);

  const key = stringMd5(randomString(16)).substring(0, 16);

  const points = ri(30, 60);
  const startX = ri(200, 600);
  const startY = ri(200, 500);
  const endX = ri(500, 700);
  const endY = ri(80, 150);

  const webgl =
    webglHash ||
    (BigInt(ri(0, 0xffffffff)) * BigInt(0x100000000) + BigInt(ri(0, 0xffffffff))).toString();
  const ts = Date.now();

  const data = generateEDTData({ startX, startY, endX, endY, mousePoints: points });
  const plaintext = `mid=${mid};userid=${userid};dfid=${dfid};webgl=${webgl};webdriver=0;ts=${ts};data=${data}`;

  console.log('[KuGou Crypto] generateSidEdt plaintext length:', plaintext.length);

  const edtData = CryptoJS.AES.encrypt(plaintext, CryptoJS.enc.Utf8.parse(key), {
    iv: CryptoJS.enc.Utf8.parse(SSA_AES_IV),
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  }).toString();

  const rsaKey = forge.pki.publicKeyFromPem(SSA_RSA_PUBLIC_KEY) as forge.pki.rsa.PublicKey;
  const encrypted = rsaKey.encrypt(key, 'RSA-OAEP', {
    md: forge.md.sha256.create(),
    mgf1: { md: forge.md.sha256.create() },
  });
  const sidBase64 = forge.util.encode64(encrypted);

  console.log('[KuGou Crypto] generateSidEdt EDT长度:', edtData.length);
  console.log('[KuGou Crypto] generateSidEdt SID长度:', sidBase64.length);

  return { edt: edtData, sid: sidBase64 };
}
