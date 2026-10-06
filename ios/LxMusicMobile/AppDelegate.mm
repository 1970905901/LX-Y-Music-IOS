#import "AppDelegate.h"
#import <CommonCrypto/CommonCryptor.h>
#import <CommonCrypto/CommonDigest.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTBridge.h>
#import <React/RCTBundleURLProvider.h>
#import <React/RCTEventEmitter.h>
#import <React/RCTLinkingManager.h>
#import <React/RCTScrollView.h>
#import <objc/runtime.h>
#import <ReactNativeNavigation/ReactNativeNavigation.h>

@class SceneDelegate;
#import <Security/Security.h>
#import <AVFoundation/AVFoundation.h>
#import <Accelerate/Accelerate.h>
#import <MediaPlayer/MediaPlayer.h>
#import <Photos/Photos.h>
#import <JavaScriptCore/JavaScriptCore.h>
#import <math.h>
#include <alloca.h>
#include <atomic>
#include <algorithm>
#include <memory>
#include <utility>
#include <vector>
#include "LXSharedIRConvolutionKernel.hpp"

#if __has_include(<FLAC/stream_decoder.h>)
#import <FLAC/stream_decoder.h>
#import <FLAC/metadata.h>
#define LX_HAS_LIBFLAC 1
#else
#define LX_HAS_LIBFLAC 0
#endif

static NSData *LXBase64Decode(NSString *value) {
  if (value == nil) return [NSData data];
  return [[NSData alloc] initWithBase64EncodedString:value options:NSDataBase64DecodingIgnoreUnknownCharacters] ?: [NSData data];
}

static NSString *LXBase64Encode(NSData *value) {
  if (value == nil || value.length == 0) return @"";
  return [value base64EncodedStringWithOptions:0];
}

static NSData *LXDERLength(NSUInteger length) {
  if (length < 0x80) {
    uint8_t value = (uint8_t)length;
    return [NSData dataWithBytes:&value length:1];
  }

  uint8_t lengthBytes[sizeof(NSUInteger)] = { 0 };
  NSUInteger index = sizeof(NSUInteger);
  NSUInteger value = length;
  while (value > 0) {
    index -= 1;
    lengthBytes[index] = (uint8_t)(value & 0xFF);
    value >>= 8;
  }

  uint8_t prefix = (uint8_t)(0x80 | (sizeof(NSUInteger) - index));
  NSMutableData *data = [NSMutableData dataWithBytes:&prefix length:1];
  [data appendBytes:&lengthBytes[index] length:sizeof(NSUInteger) - index];
  return data;
}

static NSData *LXDERWrap(uint8_t tag, NSData *value) {
  NSMutableData *data = [NSMutableData dataWithBytes:&tag length:1];
  [data appendData:LXDERLength(value.length)];
  [data appendData:value];
  return data;
}

static BOOL LXReadASN1Length(NSData *data, NSUInteger *index, NSUInteger *length) {
  if (*index >= data.length) return NO;

  const uint8_t *bytes = (const uint8_t *)data.bytes;
  uint8_t byte = bytes[*index];
  *index += 1;

  if ((byte & 0x80) == 0) {
    *length = byte;
    return *index + *length <= data.length;
  }

  NSUInteger byteCount = byte & 0x7F;
  if (byteCount == 0 || *index + byteCount > data.length) return NO;

  NSUInteger value = 0;
  for (NSUInteger i = 0; i < byteCount; i++) {
    value = (value << 8) | bytes[*index + i];
  }
  *index += byteCount;
  *length = value;
  return *index + *length <= data.length;
}

static NSData *LXRSAPublicKeyAlgorithmIdentifier(void) {
  static const uint8_t bytes[] = {
    0x30, 0x0D,
    0x06, 0x09,
    0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x01, 0x01,
    0x05, 0x00,
  };
  return [NSData dataWithBytes:bytes length:sizeof(bytes)];
}

static NSData *LXWrapRSAPublicKey(NSData *publicKeyData) {
  NSMutableData *bitStringValue = [NSMutableData dataWithBytes:"\x00" length:1];
  [bitStringValue appendData:publicKeyData];

  NSMutableData *sequence = [NSMutableData dataWithData:LXRSAPublicKeyAlgorithmIdentifier()];
  [sequence appendData:LXDERWrap(0x03, bitStringValue)];
  return LXDERWrap(0x30, sequence);
}

static NSData *LXWrapRSAPrivateKey(NSData *privateKeyData) {
  static const uint8_t versionBytes[] = { 0x02, 0x01, 0x00 };
  NSData *version = [NSData dataWithBytes:versionBytes length:sizeof(versionBytes)];

  NSMutableData *sequence = [NSMutableData dataWithData:version];
  [sequence appendData:LXRSAPublicKeyAlgorithmIdentifier()];
  [sequence appendData:LXDERWrap(0x04, privateKeyData)];
  return LXDERWrap(0x30, sequence);
}

static NSData *LXStripPublicKeyHeader(NSData *data) {
  if (data.length < 1) return data;

  const uint8_t *bytes = (const uint8_t *)data.bytes;
  NSUInteger index = 0;
  NSUInteger length = 0;

  if (bytes[index] != 0x30) return data;
  index += 1;
  if (!LXReadASN1Length(data, &index, &length)) return data;
  if (index >= data.length) return data;
  if (bytes[index] == 0x02) return data;

  if (bytes[index] != 0x30) return data;
  index += 1;
  if (!LXReadASN1Length(data, &index, &length)) return data;
  index += length;
  if (index >= data.length || bytes[index] != 0x03) return data;

  index += 1;
  if (!LXReadASN1Length(data, &index, &length)) return data;
  if (index >= data.length || bytes[index] != 0x00) return data;
  index += 1;
  if (index > data.length) return data;

  return [data subdataWithRange:NSMakeRange(index, data.length - index)];
}

static NSData *LXStripPrivateKeyHeader(NSData *data) {
  if (data.length < 1) return data;

  const uint8_t *bytes = (const uint8_t *)data.bytes;
  NSUInteger index = 0;
  NSUInteger length = 0;

  if (bytes[index] != 0x30) return data;
  index += 1;
  if (!LXReadASN1Length(data, &index, &length)) return data;
  if (index >= data.length || bytes[index] != 0x02) return data;

  index += 1;
  if (!LXReadASN1Length(data, &index, &length)) return data;
  index += length;
  if (index >= data.length) return data;
  if (bytes[index] == 0x02) return data;
  if (bytes[index] != 0x30) return data;

  index += 1;
  if (!LXReadASN1Length(data, &index, &length)) return data;
  index += length;
  if (index >= data.length || bytes[index] != 0x04) return data;

  index += 1;
  if (!LXReadASN1Length(data, &index, &length)) return data;
  if (index + length > data.length) return data;

  return [data subdataWithRange:NSMakeRange(index, length)];
}

static NSError *LXError(NSString *code, NSString *message) {
  return [NSError errorWithDomain:@"CryptoModule" code:0 userInfo:@{
    NSLocalizedDescriptionKey: message,
    @"code": code,
  }];
}

static double LXClampDouble(double value, double minValue, double maxValue) {
  if (value < minValue) return minValue;
  if (value > maxValue) return maxValue;
  return value;
}

static UIColor *LXColorFromString(NSString *value, UIColor *fallback) {
  if (![value isKindOfClass:[NSString class]] || value.length == 0) return fallback;
  NSString *text = [[value stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]] lowercaseString];

  if ([text hasPrefix:@"#"]) {
    NSString *hex = [text substringFromIndex:1];
    unsigned long long hexValue = 0;
    if (![[NSScanner scannerWithString:hex] scanHexLongLong:&hexValue]) return fallback;

    if (hex.length == 6) {
      return [UIColor colorWithRed:((hexValue >> 16) & 0xFF) / 255.0
                             green:((hexValue >> 8) & 0xFF) / 255.0
                              blue:(hexValue & 0xFF) / 255.0
                             alpha:1];
    }
    if (hex.length == 8) {
      return [UIColor colorWithRed:((hexValue >> 24) & 0xFF) / 255.0
                             green:((hexValue >> 16) & 0xFF) / 255.0
                              blue:((hexValue >> 8) & 0xFF) / 255.0
                             alpha:(hexValue & 0xFF) / 255.0];
    }
    return fallback;
  }

  NSRegularExpression *regex = [NSRegularExpression regularExpressionWithPattern:@"rgba?\\s*\\(([^\\)]+)\\)" options:0 error:nil];
  NSTextCheckingResult *match = [regex firstMatchInString:text options:0 range:NSMakeRange(0, text.length)];
  if (match == nil || match.numberOfRanges < 2) return fallback;

  NSString *params = [text substringWithRange:[match rangeAtIndex:1]];
  NSArray<NSString *> *parts = [params componentsSeparatedByString:@","];
  if (parts.count < 3) return fallback;

  CGFloat rgba[4] = { 0, 0, 0, 1 };
  for (NSInteger i = 0; i < MIN(parts.count, 4); i++) {
    NSString *component = [parts[i] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    rgba[i] = i == 3 ? MAX(MIN(component.doubleValue, 1), 0) : MAX(MIN(component.doubleValue / 255.0, 1), 0);
  }
  return [UIColor colorWithRed:rgba[0] green:rgba[1] blue:rgba[2] alpha:rgba[3]];
}

static BOOL LXColorNeedsDarkText(UIColor *color) {
  CGFloat red = 0;
  CGFloat green = 0;
  CGFloat blue = 0;
  CGFloat alpha = 0;
  if (![color getRed:&red green:&green blue:&blue alpha:&alpha]) return YES;
  CGFloat luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return luminance > 0.62;
}

static SecKeyRef LXCreateRSAKey(NSData *data, CFTypeRef keyClass, NSError **error) {
  NSData *normalizedData = CFEqual(keyClass, kSecAttrKeyClassPublic)
    ? LXStripPublicKeyHeader(data)
    : LXStripPrivateKeyHeader(data);

  NSDictionary *attributes = @{
    (__bridge id)kSecAttrKeyType: (__bridge id)kSecAttrKeyTypeRSA,
    (__bridge id)kSecAttrKeyClass: (__bridge id)keyClass,
  };

  CFErrorRef cfError = NULL;
  SecKeyRef key = SecKeyCreateWithData((__bridge CFDataRef)normalizedData, (__bridge CFDictionaryRef)attributes, &cfError);
  if (cfError != NULL) {
    if (error != NULL) *error = CFBridgingRelease(cfError);
    else CFRelease(cfError);
  }
  return key;
}

static SecKeyAlgorithm LXRSAAlgorithm(NSString *padding) {
  if ([padding isEqualToString:@"RSA/ECB/OAEPWithSHA1AndMGF1Padding"]) {
    return kSecKeyAlgorithmRSAEncryptionOAEPSHA1;
  }
  return kSecKeyAlgorithmRSAEncryptionRaw;
}

static NSDictionary *LXGenerateRSAKeyPair(NSError **error) {
  CFErrorRef cfError = NULL;
  NSDictionary *attributes = @{
    (__bridge id)kSecAttrKeyType: (__bridge id)kSecAttrKeyTypeRSA,
    (__bridge id)kSecAttrKeySizeInBits: @2048,
  };

  SecKeyRef privateKey = SecKeyCreateRandomKey((__bridge CFDictionaryRef)attributes, &cfError);
  if (privateKey == NULL) {
    if (error != NULL && cfError != NULL) *error = CFBridgingRelease(cfError);
    return nil;
  }

  SecKeyRef publicKey = SecKeyCopyPublicKey(privateKey);
  NSData *publicKeyData = (__bridge_transfer NSData *)SecKeyCopyExternalRepresentation(publicKey, &cfError);
  if (publicKeyData == nil) {
    if (error != NULL && cfError != NULL) *error = CFBridgingRelease(cfError);
    if (publicKey != NULL) CFRelease(publicKey);
    CFRelease(privateKey);
    return nil;
  }

  NSData *privateKeyData = (__bridge_transfer NSData *)SecKeyCopyExternalRepresentation(privateKey, &cfError);
  if (privateKeyData == nil) {
    if (error != NULL && cfError != NULL) *error = CFBridgingRelease(cfError);
    if (publicKey != NULL) CFRelease(publicKey);
    CFRelease(privateKey);
    return nil;
  }

  NSDictionary *result = @{
    @"publicKey": LXBase64Encode(LXWrapRSAPublicKey(publicKeyData)),
    @"privateKey": LXBase64Encode(LXWrapRSAPrivateKey(privateKeyData)),
  };

  if (publicKey != NULL) CFRelease(publicKey);
  CFRelease(privateKey);
  return result;
}

static NSString *LXRSAEncrypt(NSString *decryptedBase64, NSString *publicKeyBase64, NSString *padding, NSError **error) {
  SecKeyRef key = LXCreateRSAKey(LXBase64Decode(publicKeyBase64), kSecAttrKeyClassPublic, error);
  if (key == NULL) return nil;

  NSData *plainData = LXBase64Decode(decryptedBase64);
  SecKeyAlgorithm algorithm = LXRSAAlgorithm(padding);
  if (!SecKeyIsAlgorithmSupported(key, kSecKeyOperationTypeEncrypt, algorithm)) {
    if (error != NULL) *error = LXError(@"rsa_encrypt", @"Unsupported RSA encryption algorithm");
    CFRelease(key);
    return nil;
  }

  CFErrorRef cfError = NULL;
  NSData *encryptedData = (__bridge_transfer NSData *)SecKeyCreateEncryptedData(key, algorithm, (__bridge CFDataRef)plainData, &cfError);
  CFRelease(key);

  if (encryptedData == nil) {
    if (error != NULL && cfError != NULL) *error = CFBridgingRelease(cfError);
    return nil;
  }

  return LXBase64Encode(encryptedData);
}

static NSString *LXRSADecrypt(NSString *encryptedBase64, NSString *privateKeyBase64, NSString *padding, NSError **error) {
  SecKeyRef key = LXCreateRSAKey(LXBase64Decode(privateKeyBase64), kSecAttrKeyClassPrivate, error);
  if (key == NULL) return nil;

  NSData *encryptedData = LXBase64Decode(encryptedBase64);
  SecKeyAlgorithm algorithm = LXRSAAlgorithm(padding);
  if (!SecKeyIsAlgorithmSupported(key, kSecKeyOperationTypeDecrypt, algorithm)) {
    if (error != NULL) *error = LXError(@"rsa_decrypt", @"Unsupported RSA decryption algorithm");
    CFRelease(key);
    return nil;
  }

  CFErrorRef cfError = NULL;
  NSData *decryptedData = (__bridge_transfer NSData *)SecKeyCreateDecryptedData(key, algorithm, (__bridge CFDataRef)encryptedData, &cfError);
  CFRelease(key);

  if (decryptedData == nil) {
    if (error != NULL && cfError != NULL) *error = CFBridgingRelease(cfError);
    return nil;
  }

  NSString *result = [[NSString alloc] initWithData:decryptedData encoding:NSUTF8StringEncoding];
  return result ?: @"";
}

static NSString *LXAES(NSString *dataBase64, NSString *keyBase64, NSString *ivBase64, NSString *mode, CCOperation operation, NSError **error) {
  NSData *data = LXBase64Decode(dataBase64);
  NSData *key = LXBase64Decode(keyBase64);
  NSData *iv = LXBase64Decode(ivBase64);

  if (key.length == 0) {
    if (error != NULL) *error = LXError(@"aes_key", @"Missing AES key");
    return nil;
  }

  BOOL isCBC = [mode isEqualToString:@"AES/CBC/PKCS7Padding"];
  // Android uses Cipher.getInstance("AES") for this mode, which applies ECB with PKCS padding.
  // Match that behavior on iOS so encrypted requests produce the same payloads cross-platform.
  BOOL usesAndroidCompatibleECBPadding = [mode isEqualToString:@"AES"];
  CCOptions options = 0;
  if (isCBC || usesAndroidCompatibleECBPadding) options |= kCCOptionPKCS7Padding;
  if (!isCBC) options |= kCCOptionECBMode;

  char ivBuffer[kCCBlockSizeAES128] = { 0 };
  if (isCBC && iv.length > 0) {
    [iv getBytes:ivBuffer length:MIN(iv.length, sizeof(ivBuffer))];
  }

  size_t outputLength = data.length + kCCBlockSizeAES128;
  NSMutableData *output = [NSMutableData dataWithLength:outputLength];
  size_t moved = 0;

  CCCryptorStatus status = CCCrypt(
    operation,
    kCCAlgorithmAES,
    options,
    key.bytes,
    key.length,
    isCBC ? ivBuffer : NULL,
    data.bytes,
    data.length,
    output.mutableBytes,
    output.length,
    &moved
  );

  if (status != kCCSuccess) {
    if (error != NULL) *error = LXError(@"aes", [NSString stringWithFormat:@"AES operation failed: %d", status]);
    return nil;
  }

  output.length = moved;
  if (operation == kCCEncrypt) return LXBase64Encode(output);

  NSString *result = [[NSString alloc] initWithData:output encoding:NSUTF8StringEncoding];
  return result ?: @"";
}

static NSString *LXSHA1(NSString *value) {
  NSData *data = [value dataUsingEncoding:NSUTF8StringEncoding] ?: [NSData data];
  unsigned char digest[CC_SHA1_DIGEST_LENGTH];
  CC_SHA1(data.bytes, (CC_LONG)data.length, digest);

  NSMutableString *hash = [NSMutableString stringWithCapacity:CC_SHA1_DIGEST_LENGTH * 2];
  for (NSInteger i = 0; i < CC_SHA1_DIGEST_LENGTH; i++) {
    [hash appendFormat:@"%02x", digest[i]];
  }
  return hash;
}

static NSString *LXJSONString(id value) {
  if (value == nil || value == (id)kCFNull) return nil;
  if ([value isKindOfClass:[NSString class]]) return value;
  NSData *data = [NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingFragmentsAllowed error:nil];
  if (!data) return nil;
  return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
}

static NSString *LXJoinJSArguments(NSArray<JSValue *> *arguments) {
  NSMutableArray<NSString *> *parts = [NSMutableArray arrayWithCapacity:arguments.count];
  for (JSValue *value in arguments) {
    if (value.isUndefined || value.isNull) {
      [parts addObject:@"null"];
      continue;
    }
    NSString *text = value.toString;
    [parts addObject:text ?: @"null"];
  }
  return [parts componentsJoinedByString:@" "];
}

static NSArray<NSString *> *LXCacheDirectories(void) {
  NSMutableArray<NSString *> *paths = [NSMutableArray array];
  NSString *cachePath = NSSearchPathForDirectoriesInDomains(NSCachesDirectory, NSUserDomainMask, YES).firstObject;
  if (cachePath.length) [paths addObject:cachePath];
  NSString *tempPath = NSTemporaryDirectory();
  if (tempPath.length && ![paths containsObject:tempPath]) [paths addObject:tempPath];
  return paths;
}

static BOOL LXShouldSkipManagedCacheEntry(NSString *relativePath) {
  if (!relativePath.length) return NO;
  return [relativePath isEqualToString:@"TrackPlayer"] || [relativePath hasPrefix:@"TrackPlayer/"];
}

static unsigned long long LXDirectorySize(NSString *directoryPath) {
  if (!directoryPath.length) return 0;

  NSFileManager *fileManager = [NSFileManager defaultManager];
  BOOL isDirectory = NO;
  if (![fileManager fileExistsAtPath:directoryPath isDirectory:&isDirectory] || !isDirectory) return 0;

  unsigned long long total = 0;
  NSDirectoryEnumerator *enumerator = [fileManager enumeratorAtPath:directoryPath];
  for (NSString *itemPath in enumerator) {
    if (LXShouldSkipManagedCacheEntry(itemPath)) {
      [enumerator skipDescendants];
      continue;
    }
    NSString *fullPath = [directoryPath stringByAppendingPathComponent:itemPath];
    NSDictionary *attributes = [fileManager attributesOfItemAtPath:fullPath error:nil];
    if ([attributes[NSFileType] isEqualToString:NSFileTypeDirectory]) continue;
    total += [attributes[NSFileSize] unsignedLongLongValue];
  }
  return total;
}

static BOOL LXClearDirectoryContents(NSString *directoryPath, NSError **error) {
  if (!directoryPath.length) return YES;

  NSFileManager *fileManager = [NSFileManager defaultManager];
  NSArray<NSString *> *contents = [fileManager contentsOfDirectoryAtPath:directoryPath error:error];
  if (contents == nil) return NO;

  for (NSString *name in contents) {
    if (LXShouldSkipManagedCacheEntry(name)) continue;
    NSString *fullPath = [directoryPath stringByAppendingPathComponent:name];
    if (![fileManager removeItemAtPath:fullPath error:error]) return NO;
  }
  return YES;
}

// 背景图模糊：与 RN 的 Image blurRadius 用完全相同的算法（Accelerate vImage 三次 box convolve ≈ 高斯），
// 保证缓存出来的图与原来每次挂载重算 blurRadius 的结果观感一致，只是「算一次、落盘复用」。
// 背景（动态背景 = 整屏封面 / 自定义背景图）是整屏大图，原先每次进入页面都要重新解码 + 模糊一遍，
// 这几十毫秒里页面只有底色（浅色主题是纯白）= 进入页面「闪一下白色」。缓存后页面首帧直接画本地图。
static UIImage *LXBlurredBackgroundImage(UIImage *inputImage, CGFloat radius) {
  // 算法移植自 RN Libraries/Image/RCTImageBlurUtils.mm 的 RCTBlurredImageWithRadius
  CGImageRef imageRef = inputImage.CGImage;
  CGFloat imageScale = inputImage.scale;
  UIImageOrientation imageOrientation = inputImage.imageOrientation;

  if (imageRef == NULL || CGImageGetWidth(imageRef) * CGImageGetHeight(imageRef) == 0) return inputImage;

  // 转成 32 位带 alpha 位图，vImage 只接受这种格式
  if (CGImageGetBitsPerPixel(imageRef) != 32 || !((CGImageGetBitmapInfo(imageRef) & kCGBitmapAlphaInfoMask))) {
    UIGraphicsImageRendererFormat *const rendererFormat = [UIGraphicsImageRendererFormat defaultFormat];
    rendererFormat.scale = inputImage.scale;
    UIGraphicsImageRenderer *const renderer = [[UIGraphicsImageRenderer alloc] initWithSize:inputImage.size
                                                                                    format:rendererFormat];
    imageRef = [renderer imageWithActions:^(UIGraphicsImageRendererContext *_Nonnull context) {
                 [inputImage drawAtPoint:CGPointZero];
               }].CGImage;
    if (imageRef == NULL) return inputImage;
  }

  vImage_Buffer buffer1, buffer2;
  buffer1.width = buffer2.width = CGImageGetWidth(imageRef);
  buffer1.height = buffer2.height = CGImageGetHeight(imageRef);
  buffer1.rowBytes = buffer2.rowBytes = CGImageGetBytesPerRow(imageRef);
  size_t bytes = buffer1.rowBytes * buffer1.height;
  buffer1.data = malloc(bytes);
  if (!buffer1.data) return inputImage;
  buffer2.data = malloc(bytes);
  if (!buffer2.data) {
    free(buffer1.data);
    return inputImage;
  }

  // 由高斯半径换算 box kernel 宽度（见 SVG spec 注释），与 RN 保持一致
  uint32_t boxSize = floor((radius * imageScale * 3 * sqrt(2 * M_PI) / 4 + 0.5) / 2);
  boxSize |= 1; // 保证为奇数

  vImage_Error tempBufferSize = vImageBoxConvolve_ARGB8888(
      &buffer1, &buffer2, NULL, 0, 0, boxSize, boxSize, NULL, kvImageGetTempBufferSize | kvImageEdgeExtend);
  if (tempBufferSize <= 0) {
    free(buffer1.data);
    free(buffer2.data);
    return inputImage;
  }
  void *tempBuffer = malloc(tempBufferSize);
  if (!tempBuffer) {
    free(buffer1.data);
    free(buffer2.data);
    return inputImage;
  }

  CFDataRef dataSource = CGDataProviderCopyData(CGImageGetDataProvider(imageRef));
  if (dataSource == NULL) {
    free(buffer1.data);
    free(buffer2.data);
    free(tempBuffer);
    return inputImage;
  }
  memcpy(buffer1.data, CFDataGetBytePtr(dataSource), bytes);
  CFRelease(dataSource);

  vImageBoxConvolve_ARGB8888(&buffer1, &buffer2, tempBuffer, 0, 0, boxSize, boxSize, NULL, kvImageEdgeExtend);
  vImageBoxConvolve_ARGB8888(&buffer2, &buffer1, tempBuffer, 0, 0, boxSize, boxSize, NULL, kvImageEdgeExtend);
  vImageBoxConvolve_ARGB8888(&buffer1, &buffer2, tempBuffer, 0, 0, boxSize, boxSize, NULL, kvImageEdgeExtend);

  free(buffer2.data);
  free(tempBuffer);

  CGContextRef ctx = CGBitmapContextCreate(buffer1.data,
                                          buffer1.width,
                                          buffer1.height,
                                          8,
                                          buffer1.rowBytes,
                                          CGImageGetColorSpace(imageRef),
                                          CGImageGetBitmapInfo(imageRef));
  if (ctx == NULL) {
    free(buffer1.data);
    return inputImage;
  }
  CGImageRef blurredRef = CGBitmapContextCreateImage(ctx);
  UIImage *outputImage = blurredRef
      ? [UIImage imageWithCGImage:blurredRef scale:imageScale orientation:imageOrientation]
      : inputImage;
  if (blurredRef) CGImageRelease(blurredRef);
  CGContextRelease(ctx);
  free(buffer1.data);
  return outputImage;
}

// 背景模糊图缓存路径：Caches/lx_bg_blur/v1_<地址哈希>_<半径>.jpg
// 半径不同视为不同图；v1 用于将来改动算法时整体失效旧缓存。
static NSString *LXBlurredBackgroundCachePath(NSString *uri, CGFloat radius) {
  unsigned long long hash = 1469598103934665603ULL; // FNV-1a 64
  NSUInteger length = uri.length;
  for (NSUInteger i = 0; i < length; i++) {
    unsigned int ch = (unsigned int)[uri characterAtIndex:i];
    hash ^= (unsigned long long)(ch & 0xFF);
    hash *= 1099511628211ULL;
    hash ^= (unsigned long long)((ch >> 8) & 0xFF);
    hash *= 1099511628211ULL;
  }
  NSString *name = [NSString stringWithFormat:@"v1_%016llx_%d.jpg", hash, (int)lround(radius)];
  NSString *cacheRoot = LXCacheDirectories().firstObject;
  if (cacheRoot.length == 0) return nil;
  NSString *dir = [cacheRoot stringByAppendingPathComponent:@"lx_bg_blur"];
  [[NSFileManager defaultManager] createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:nil];
  return [dir stringByAppendingPathComponent:name];
}

// 背景模糊图「平均色」文件路径：与模糊图同名，后缀换成 .color（内容是 #RRGGBB 文本，几十字节）。
// 用于 JS 侧的 push 转场背景色与页面首帧底色：转场期间页面内容还没画出来，原生容器只有一块纯色，
// 浅色主题的 c-content-background 是纯白，与「整屏模糊封面」的实际背景形成明显色差 = 转场闪白。
// 用该图的平均色代替纯色后，转场底色与目的页背景接近，观感上不再有白色块跳动。
static NSString *LXBlurredBackgroundColorPath(NSString *blurredPath) {
  if (blurredPath.length == 0) return nil;
  return [[blurredPath stringByDeletingPathExtension] stringByAppendingPathExtension:@"color"];
}

// 计算图片平均色，返回 #RRGGBB；无法计算时返回 nil。
// 做法：把整图直接画进 1x1 的 8bit RGBA 位图上下文，Core Graphics 会插值下采样，
// 读出的那一个像素即为整图平均色（模糊图本身是整屏大图，一次绘制约几毫秒）。
static NSString *LXAverageColorHexOfImage(UIImage *image) {
  CGImageRef imageRef = image.CGImage;
  if (imageRef == NULL) return nil;
  CGColorSpaceRef colorSpace = CGColorSpaceCreateDeviceRGB();
  if (colorSpace == NULL) return nil;
  unsigned char pixel[4] = {0, 0, 0, 0};
  CGContextRef ctx = CGBitmapContextCreate(pixel, 1, 1, 8, 4, colorSpace,
                                           kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
  CGColorSpaceRelease(colorSpace);
  if (ctx == NULL) return nil;
  CGContextSetInterpolationQuality(ctx, kCGInterpolationHigh);
  CGContextDrawImage(ctx, CGRectMake(0, 0, 1, 1), imageRef);
  CGContextRelease(ctx);
  // 显式转 unsigned int：变参提升下若直接传 unsigned char 会与 %X 的类型不匹配（-Wformat）
  return [NSString stringWithFormat:@"#%02X%02X%02X",
                                    (unsigned int)pixel[0], (unsigned int)pixel[1], (unsigned int)pixel[2]];
}

// 控制背景模糊图缓存的规模：只保留最近生成的几张，其余按修改时间最旧优先删除。
// 背景图随歌曲变化，一张约 1MB；而「缓存上限」默认是「不限制」，若无节制落盘会持续占用空间。
static void LXTrimBlurredBackgroundCache(NSString *cachePath, NSUInteger keepCount) {
  NSString *dir = [cachePath stringByDeletingLastPathComponent];
  if (dir.length == 0) return;
  NSFileManager *fileManager = [NSFileManager defaultManager];
  NSArray<NSString *> *names = [fileManager contentsOfDirectoryAtPath:dir error:nil];
  if (names.count <= keepCount) return;

  NSMutableArray<NSDictionary *> *files = [NSMutableArray array];
  for (NSString *name in names) {
    if (![name hasPrefix:@"v1_"] || ![name hasSuffix:@".jpg"]) continue;
    NSString *fullPath = [dir stringByAppendingPathComponent:name];
    NSDictionary *attributes = [fileManager attributesOfItemAtPath:fullPath error:nil];
    if (attributes == nil) continue;
    [files addObject:@{
      @"path": fullPath,
      @"date": attributes[NSFileModificationDate] ?: [NSDate distantPast],
    }];
  }
  if (files.count <= keepCount) return;

  [files sortUsingComparator:^NSComparisonResult(NSDictionary *a, NSDictionary *b) {
    return [b[@"date"] compare:a[@"date"]]; // 新 → 旧
  }];
  for (NSUInteger i = keepCount; i < files.count; i++) {
    NSString *expiredPath = files[i][@"path"];
    [fileManager removeItemAtPath:expiredPath error:nil];
    // 平均色文件与该模糊图同生共死：一并删除，避免留下孤儿文件
    NSString *expiredColorPath = LXBlurredBackgroundColorPath(expiredPath);
    if (expiredColorPath.length > 0) [fileManager removeItemAtPath:expiredColorPath error:nil];
  }
}

static NSURLSessionDataTask *LXNowPlayingArtworkTask = nil;
static NSMutableDictionary *LXNowPlayingInfoCache = nil;
static NSString *LXNowPlayingArtworkPath = nil;
static NSUInteger LXNowPlayingArtworkRequestId = 0;
static MPNowPlayingPlaybackState LXNowPlayingState = MPNowPlayingPlaybackStateStopped;
// 「有播放会话」≠「有元数据缓存」：nativeFlac 换歌会 reset → 清缓存 → 等远端流打开后重新发布。
// 这期间缓存为空但会话仍在；若按缓存为空立刻全关遥控命令，耳机/车机按键会被系统吞掉（连
// recv= 日志都没有）。会话只在真正 stop（playbackState=Stopped）/ destroy / JS clear 时结束。
static BOOL LXNowPlayingHasPlaybackSession = NO;
// —— 蓝牙（车机）字段布局 ——
// 车机（AVRCP）大多只显示/优先显示媒体信息的 title；Android 端与本项目参考实现都是
// 「歌词行进 title、歌名·歌手进 artist」。iOS 端此前把歌词行放 artist，于是手机控制中心 /
// 锁屏能看到歌词，而只读 title 的车机看不到 —— 用户实锤「车载蓝牙歌词还是没有显示」
// （2026-10-03）。处理：只在**蓝牙输出**且**确有歌词行**时做字段对调
// （title = 当前行 / artist = 歌名·歌手）；外放 / 有线耳机 / 关闭「显示蓝牙歌词」时保持原布局。
// LXNowPlayingSongLine 始终保存 JS 发布的原始 title（歌名 - 歌手）：字段对调的还原值，
// 也是「换歌」判定的基准（cache 里的 title 在蓝牙模式下会是歌词行，不能用来判换歌）。
static NSString *LXNowPlayingSongLine = nil;
static NSString *LXNowPlayingCurrentLyricLine = nil;
static BOOL LXIsReceivingRemoteControlEvents = NO;
static NSString * const LXTrackPlayerLifecycleNotificationName = @"LXTrackPlayerLifecycle";
static id LXTrackPlayerLifecycleObserver = nil;
static id LXNowPlayingApplicationObserver = nil;
static id LXNowPlayingScreenObserver = nil;
static id LXNowPlayingRouteObserver = nil;
static id LXNowPlayingInterruptionObserver = nil;
static NSString * const LXRemoteCommandNotificationName = @"LXRemoteCommand";
// 「卡片显示态 vs 引擎真值」探针（原生 → JS）：看门狗每拍请求一次，JS 收到后立即把
// 引擎真实播放态回传（见 LXReportNowPlayingPlaybackTruth）。之所以必须由原生发起：
// JS 的 1s 慢校准 tick 在 App 非 active（控制中心打开 / 后台播放）时按耗电策略停摆，
// 而卡片失效恰恰只在这两个场景被用户看到；原生事件不依赖 JS 定时器。
static NSString * const LXNowPlayingTruthProbeNotificationName = @"LXNowPlayingTruthProbe";
static BOOL LXRemoteCommandHandlersInstalled = NO;
// 最近一次收到遥控命令（播放/暂停/切歌/拖进度）的时间戳（CACurrentMediaTime 毫秒）。
// 卡片重绘靠「把 playbackState 切到相反值再切回」实现，翻转期间控制中心 / 灵动岛的
// 播放暂停按钮图标是反的；若用户正好在这段时间按下，系统会发出「另一边」的命令
// （例如实际在播却发来 play），那一次按压就被吞掉 —— 用户实锤的「暂停/播放要按
// 两下才生效」。因此用户刚操作过的窗口内跳过翻转，优先保证按钮语义正确。
static double LXNowPlayingLastRemoteCommandAtMs = 0;
static const double LXNowPlayingRepaintQuietWindowMs = 1200;
// 遥控命令之后的「补绘」延迟与安全间隔（见 LXScheduleDeferredNowPlayingCardRepaint）：
// 命令收到后不在当拍翻转（会把手指底下的按压吞掉），而是等满「命令后静默窗」
// （MAX(settle, quiet) ≥1200ms，覆盖用户二次按压的自然间隔）再补一次卡片重绘；
// 补绘前若又收到新命令（间隔 < LXNowPlayingCommandSafetyGapMs）则顺延。
static const double LXNowPlayingCommandSettleDelayMs = 500.0;
static const double LXNowPlayingCommandSafetyGapMs = 250.0;
// 重绘翻转的「假状态」窗口：翻转开始后到 LXNowPlayingCardRepaintFlipUntilMs 之前，系统持有的
// 播放态与真实态相反（图标是反的）。这段时间内到达的遥控命令属于翻转噪声：命令入口会提前结束
// 翻转（立刻恢复真实播放态）并把 flip=1 写进 ###LXRemote### 日志，便于真机归因。
static const double LXNowPlayingCardRepaintFlipMs = 60.0;
static double LXNowPlayingCardRepaintFlipUntilMs = 0;
// 封面重绘翻转的假状态窗口（0.15s 延迟 + 0.08s 翻转）：收敛看门狗在这段时间内不得判定
// 「漂移」，否则会把正在翻转的假状态当成错误去纠正，与翻转互相打架。
// 注意：这里不查询 AVAudioSession 的激活态（iOS 26 SDK 无 isActive 选择器，见下方修复注释）。
static const double LXNowPlayingArtworkRepaintFlipMs = 230.0;
static double LXNowPlayingArtworkRepaintFlipUntilMs = 0;
static NSUInteger LXNowPlayingCardRepaintFlipGeneration = 0;
static MPNowPlayingPlaybackState LXNowPlayingCardRepaintFlipRestoreState = MPNowPlayingPlaybackStateStopped;
static void LXScheduleDeferredNowPlayingCardRepaint(void);
static void LXPerformNowPlayingCardRepaintFlip(void);
static void LXEndNowPlayingCardRepaintFlipEarly(void);
// 当前输出路由是否蓝牙（定义在文件后部的可见性判定区块，字段布局这里要用）
static BOOL LXHasBluetoothAudioRoute(void);
// 蓝牙（车机）字段布局：按当前输出路由重排 title/artist（定义在 LXSetNowPlayingInfo 之前）
static void LXApplyNowPlayingTitleArtistFields(NSMutableDictionary *info);
static void LXBeginReceivingRemoteControlEvents(void);
// 歌词行时钟：锚点刷新 / 清行（定义在文件后部歌词驱动区块，此处前置声明）
static void LXRefreshNowPlayingLyricAnchor(void);
static void LXClearNowPlayingLyricLines(void);
static void LXReanchorNowPlayingLyric(double elapsedMs, double snapshotAtMs, double ageMs);
static void LXStartNowPlayingLyricTimer(void);
static void LXSyncNowPlayingLyricTimer(void);
static void LXQueueNowPlayingLyricRedraw(void);
static void LXForceNowPlayingCardRepaint(void);
static NSObject *LXLyricLock(void);
// 屏幕/音频路由变化后重新判定 8.3Hz 歌词时钟是否该跑（熄屏且无蓝牙歌词可送车机时停钟）
static void LXUpdateNowPlayingLyricTimerVisibility(void);
// 记录「屏幕确实亮着」的亮度证据（亮度 0 是「熄屏」与「最低亮度」的公共值，
// 靠这份证据区分）。观察者注册处（文件前部）即需调用，故必须在此前置声明 ——
// 漏了它会直接编译失败（2026-10-03 CI 实例，见 sim-power-drain 契约不变量 5e）。
static void LXRememberScreenBrightness(void);
// 播放位置事件（原生 4Hz 外推位置广播给 JS，驱动进度条等 UI，替代 JS 侧桥接轮询）
static NSNotificationName const LXPlayerPositionNotificationName = @"LXPlayerPosition";
// 时钟冻结标志：RNTP state 事件报告 loading/暂停等非播放态时置 YES——网络流
// 微缓冲会让音频走走停停，墙钟外推持续超前（表现为控制中心歌词"同步一句、
// 停一会、隔几句又同步"）；冻结在最后已知位置才能与音频保持一致。
// 定义在文件前部：生命周期通知处理器（歌词驱动区块之前）即需读写。
static BOOL LXNowPlayingClockHold = NO;
// JS 发布元数据/播放态时 elapsedTime 对应的原生时钟戳（CACurrentMediaTime 毫秒，
// 由 JS 透传 elapsedTimeSnapshotAt / elapsedTimeAgeMs 换算，见
// LXResolveElapsedSnapshotAtMs）。0 = 无戳（退回「锚点钉在现在」的旧行为）。
// 修「灵动岛/控制中心歌词恒定慢半拍」：JS 回传的位置是「过去时刻」的快照，
// 旧逻辑把快照位置钉在「现在」→ 歌词时钟回拨一个桥接往返（~100-300ms），
// 每秒校准/每次换行都回拨一次 → 恒定滞后。带戳回放后外推与真实播放对齐。
static double LXNowPlayingElapsedSnapshotAtMs = 0;
// 快照戳/年龄 → 原生时钟戳（CACurrentMediaTime 毫秒）。snapshotAt 优先（精确）；
// ageMs（JS Date.now 往返年龄）换算为「now − 年龄」的等价戳；都无 → 0。
static double LXResolveElapsedSnapshotAtMs(NSDictionary *payload, double nowMs);
static void LXEndReceivingRemoteControlEvents(void);
// 看门狗（LXReconcileNowPlayingCardNow）在 LXApplyNowPlayingInfo 定义之前调用它：.mm 是 ObjC++，
// 缺前置声明会直接编译失败（CI run#951/#952 即此）。新增「声明顺序」契约脚本守护。
static void LXApplyNowPlayingInfo(void);

static void LXPostRemoteCommandNotification(NSString *command, NSDictionary *extra) {
  NSMutableDictionary *userInfo = [NSMutableDictionary dictionaryWithDictionary:extra ?: @{}];
  if (command.length) userInfo[@"command"] = command;
  [[NSNotificationCenter defaultCenter] postNotificationName:LXRemoteCommandNotificationName object:nil userInfo:userInfo];
}

// 播放/切换键可能要「重新出声」：先把音频会话拉起来。
// 关闭「与其他应用同时播放」时，被其它 App 打断会把 AVAudioSession 置为非激活，
// 重新出声必须先 setActive:YES —— 以前这一步只发生在 JS 的 TrackPlayer.play() 里，
// App 在后台被挂起时第一次按压会落在 JS 尚未跑起来的窗口，引擎收到 play 也不出声
// （用户 2026-10-03 反馈：控制中心点播放无效、要按两次）。放到原生遥控入口后，
// 按压当拍就恢复会话，不再依赖 JS 的到达时机；中断仍在进行时激活失败属正常，
// 那一次由 JS 侧的播放意图重试在中断结束后再拉起（见 core/player/player.ts）。
// 流式 FLAC 引擎是否已经接管音频会话（用于决定「是否需要先 setActive:NO 再配置」）。
// 每次 openStream 都无条件停用会话会让 iOS 撤回本 App 的 Now Playing 角色 —— 卡片（控制中心/
// 灵动岛按钮 + 进度条）随之失效但音频仍在播；只在「从 TrackPlayer 等其它持有者手中接管」时才需要停用。
// TrackPlayer 一旦产生生命周期事件（说明它动过会话），该标记立即失效，下次 openStream 重新接管。
static BOOL LXStreamingFlacOwnsAudioSession = NO;

static void LXActivateAudioSessionForPlayback(void) {
  NSError *sessionError = nil;
  if (![[AVAudioSession sharedInstance] setActive:YES error:&sessionError]) {
    (void)sessionError;
  }
}

static MPRemoteCommandHandlerStatus LXHandleRemoteCommandEvent(NSString *command) {
  LXNowPlayingLastRemoteCommandAtMs = CACurrentMediaTime() * 1000.0;
  double commandNowMs = LXNowPlayingLastRemoteCommandAtMs;
  // 落在重绘翻转的「假状态」窗口内：图标是反的，本次命令方向可能来自假图标。
  // 立刻结束翻转恢复真实播放态，并记录 flip=1 便于真机归因（见静态常量注释）。
  BOOL inRepaintFlipWindow = commandNowMs < LXNowPlayingCardRepaintFlipUntilMs;
  if (inRepaintFlipWindow) LXEndNowPlayingCardRepaintFlipEarly();
  // 遥控命令是**低频**路径（用户每按一次才走一遍），不属于 LXNowPlayingLyricStep 注释里
  // 禁写 NSLog 的 8.3Hz 歌词热路径。这里按固定前缀打印投递链的每一跳：这一类问题已经
  // 反复回归多轮（4a0b5ad / b2883d1 / 437e6d0），每次都只能靠读代码猜是哪一跳吞掉了
  // 按压。有了这几行，下一次再报「按了没反应」时直接 grep ###LXRemote### 即可定位。
  // 注意 hasInfo 要持锁读：歌词时钟线程可能正在改缓存。
  unsigned long lxInfoCount = 0;
  @synchronized (LXLyricLock()) { lxInfoCount = LXNowPlayingInfoCache.count; }
  // 带上输出路由与各命令的 enabled 状态：蓝牙耳机若「完全没反应」，这一行能区分
  // 「命令没到 App（系统按 disabled 吞掉 / Now Playing 被别的 App 抢走）」与
  // 「到了 App 但后续 JS 投递链丢了」——前者 recv 不打印，后者 recv 打印但无 deliver。
  MPRemoteCommandCenter *recvCommandCenter = [MPRemoteCommandCenter sharedCommandCenter];
  NSLog(@"###LXRemote### recv=%@ appState=%ld bt=%d infoCount=%lu nowPlayingState=%ld flip=%d enabled(play=%d pause=%d toggle=%d next=%d)",
        command,
        (long)[UIApplication sharedApplication].applicationState,
        LXHasBluetoothAudioRoute() ? 1 : 0,
        lxInfoCount,
        (long)LXNowPlayingState,
        inRepaintFlipWindow ? 1 : 0,
        recvCommandCenter.playCommand.enabled ? 1 : 0,
        recvCommandCenter.pauseCommand.enabled ? 1 : 0,
        recvCommandCenter.togglePlayPauseCommand.enabled ? 1 : 0,
        recvCommandCenter.nextTrackCommand.enabled ? 1 : 0);
  // 命令处理完之后补一次卡片重绘：卡片按钮的图标只认「playbackState 反转再转回」这条
  // 刷新链路（见 LXForceNowPlayingCardRepaint 注释），不补绘的话这次状态变化只能等下一次
  // 歌词换行才可见 —— 用户看到按钮没变、再按发的还是同一个方向（表现为「按一下没反应，
  // 要按两下」；用户 2026-10-03 实锤：正常播放时控制中心 / 灵动岛按钮还是没修复）。
  LXScheduleDeferredNowPlayingCardRepaint();
  if ([command isEqualToString:@"play"] || [command isEqualToString:@"toggle"]) {
    LXActivateAudioSessionForPlayback();
  }
  LXPostRemoteCommandNotification(command, nil);
  return MPRemoteCommandHandlerStatusSuccess;
}

static MPRemoteCommandHandlerStatus LXHandleRemoteChangePlaybackPositionEvent(MPChangePlaybackPositionCommandEvent *event) {
  LXNowPlayingLastRemoteCommandAtMs = CACurrentMediaTime() * 1000.0;
  // 拖进度条此前是唯一没有 recv= 打点的命令入口（2026-10-05 真机日志里只有 deliver=seek，
  // 无法区分「拖到哪」和「App 认为当前在哪」）；位置单位为秒，elapsed 取系统进度基线。
  double lxSeekElapsed = 0;
  unsigned long lxSeekInfoCount = 0;
  @synchronized (LXLyricLock()) {
    NSNumber *elapsedValue = LXNowPlayingInfoCache[MPNowPlayingInfoPropertyElapsedPlaybackTime];
    lxSeekElapsed = [elapsedValue isKindOfClass:[NSNumber class]] ? elapsedValue.doubleValue : 0;
    lxSeekInfoCount = LXNowPlayingInfoCache.count;
  }
  NSLog(@"###LXRemote### recv=seek pos=%.2f elapsed=%.2f state=%ld info=%lu", event.positionTime, lxSeekElapsed, (long)LXNowPlayingState, lxSeekInfoCount);
  LXPostRemoteCommandNotification(@"seek", @{
    @"position": @(event.positionTime),
  });
  return MPRemoteCommandHandlerStatusSuccess;
}

static NSMutableDictionary *LXNowPlayingMutableInfo(void) {
  if (LXNowPlayingInfoCache == nil) LXNowPlayingInfoCache = [NSMutableDictionary dictionary];
  return LXNowPlayingInfoCache;
}

static void LXInstallRemoteCommandHandlers(void) {
  if (LXRemoteCommandHandlersInstalled) return;

  MPRemoteCommandCenter *commandCenter = [MPRemoteCommandCenter sharedCommandCenter];
  [commandCenter.playCommand addTargetWithHandler:^MPRemoteCommandHandlerStatus(MPRemoteCommandEvent * _Nonnull event) {
    return LXHandleRemoteCommandEvent(@"play");
  }];
  [commandCenter.pauseCommand addTargetWithHandler:^MPRemoteCommandHandlerStatus(MPRemoteCommandEvent * _Nonnull event) {
    return LXHandleRemoteCommandEvent(@"pause");
  }];
  [commandCenter.togglePlayPauseCommand addTargetWithHandler:^MPRemoteCommandHandlerStatus(MPRemoteCommandEvent * _Nonnull event) {
    return LXHandleRemoteCommandEvent(@"toggle");
  }];
  [commandCenter.nextTrackCommand addTargetWithHandler:^MPRemoteCommandHandlerStatus(MPRemoteCommandEvent * _Nonnull event) {
    return LXHandleRemoteCommandEvent(@"next");
  }];
  [commandCenter.previousTrackCommand addTargetWithHandler:^MPRemoteCommandHandlerStatus(MPRemoteCommandEvent * _Nonnull event) {
    return LXHandleRemoteCommandEvent(@"previous");
  }];
  [commandCenter.changePlaybackPositionCommand addTargetWithHandler:^MPRemoteCommandHandlerStatus(MPRemoteCommandEvent * _Nonnull event) {
    if (![event isKindOfClass:[MPChangePlaybackPositionCommandEvent class]]) return MPRemoteCommandHandlerStatusCommandFailed;
    return LXHandleRemoteChangePlaybackPositionEvent((MPChangePlaybackPositionCommandEvent *)event);
  }];
  LXRemoteCommandHandlersInstalled = YES;
}

static void LXSyncRemoteCommandAvailability(void) {
  LXInstallRemoteCommandHandlers();

  MPRemoteCommandCenter *commandCenter = [MPRemoteCommandCenter sharedCommandCenter];
  BOOL hasInfo = LXNowPlayingInfoCache.count > 0;
  // 换歌/重载窗口内元数据缓存会短暂为空，但播放会话仍在 —— 此时必须保持命令可用，
  // 否则耳机/车机按键被系统吞掉（见 LXNowPlayingHasPlaybackSession 注释）。
  BOOL hasSession = LXNowPlayingHasPlaybackSession;

  if (!hasInfo && !hasSession) {
    commandCenter.playCommand.enabled = NO;
    commandCenter.pauseCommand.enabled = NO;
    commandCenter.togglePlayPauseCommand.enabled = NO;
    commandCenter.nextTrackCommand.enabled = NO;
    commandCenter.previousTrackCommand.enabled = NO;
    commandCenter.changePlaybackPositionCommand.enabled = NO;
    LXEndReceivingRemoteControlEvents();
    return;
  }


  // ⚠️ 有信息（或有播放会话，见上方 hasSession）时传输类命令**必须常开**，不得再按 LXNowPlayingState 门控
  // （2026-10-05 用户反馈「连接蓝牙后，蓝牙耳机控制功能失效」）：
  //   · Apple 文档（MPRemoteCommand.isEnabled）：置 NO 后「events for this command are not
  //     sent to your app」——命令被系统直接吞掉，原生与 JS 谁都收不到；
  //   · 而 LXNowPlayingState 是 JS 异步发布的缓存值，天然滞后引擎一拍（remoteCommand.ts
  //     对 playerState.isPlay 的同类说明：系统中断 / 蓝牙路由抖动 / 引擎切换后都会滞后）；
  //     卡片重绘把 playbackState 翻到相反值的 60ms 内，它还与真实状态相反；
  //   · 蓝牙耳机（AVRCP）按键发的是**显式 play / pause**，一旦与缓存态相反，对应的
  //     playCommand / pauseCommand 正好是 disabled → 系统不投递 → 表现即「耳机按键失效」；
  //     控制中心合并按钮走 togglePlayPauseCommand（一直启用），所以同一时刻控制中心仍可用。
  // 方向判定交给 JS：toggle 分支读引擎真实状态（core/init/player/remoteCommand.ts），
  // play / pause 本身幂等，最坏只是重复一次已满足的动作，不会再吞掉一次真实按压。
  commandCenter.playCommand.enabled = YES;
  commandCenter.pauseCommand.enabled = YES;
  commandCenter.togglePlayPauseCommand.enabled = YES;
  commandCenter.nextTrackCommand.enabled = YES;
  commandCenter.previousTrackCommand.enabled = YES;
  commandCenter.changePlaybackPositionCommand.enabled = YES;
  LXBeginReceivingRemoteControlEvents();
}

// 系统只把遥控命令 / 进度条拖动投递给「不是 stopped」的会话：只要 cache 里还有曲目上下文
// （歌名等），把 stopped 写给系统就会得到一张「看得见但按不动、进度条也拖不动」的卡片。
// 典型触发：重装后首次启动（JS 恢复了上一首歌，只发布元数据、还没播放过）、停止播放之后。
// 这种时候按 paused（速率 0）发布：卡片保持可交互，按播放键走 LXHandleRemoteCommandEvent
// 的 play 分支续播；真正没有曲目（cache 空）时才写 stopped，把媒体会话交还给系统。
// 必须在持有 LXLyricLock 时调用（会写回 cache 的 PlaybackRate）。
static MPNowPlayingPlaybackState LXResolveNowPlayingPublishStateLocked(void) {
  if (LXNowPlayingState != MPNowPlayingPlaybackStateStopped || LXNowPlayingInfoCache.count == 0) return LXNowPlayingState;
  // 暂停语义要求速率为 0：否则系统会继续按旧速率外推进度条
  LXNowPlayingInfoCache[MPNowPlayingInfoPropertyPlaybackRate] = @0;
  return MPNowPlayingPlaybackStatePaused;
}

// —— 卡片收敛看门狗 ——
// 卡片是「系统持有的一份副本」：任何一次没落地的写入（后台线程写 MediaPlayer 被系统忽略、
// 翻转被封面换代打断、系统回收媒体会话）都会让它与真实状态漂移，而漂移之后**没有任何自愈
// 路径** —— 无歌词 / 稀疏歌词的歌尤其明显（用户 2026-10-05：正常一段时间又失效）。
// 这里在主线程以 3s 低频核对（只在有卡片时运行，代价可忽略）：不一致就重发，并打一行
// ###LXNowPlaying### reconcile 说明坏在哪，既保证收敛，也让真机日志一次定位。
static dispatch_source_t LXNowPlayingReconcileTimer = nil;
static void LXReconcileNowPlayingCardNow(void);

static void LXStopNowPlayingReconcileTimer(void) {
  if (LXNowPlayingReconcileTimer == nil) return;
  dispatch_source_cancel(LXNowPlayingReconcileTimer);
  LXNowPlayingReconcileTimer = nil;
}

static void LXStartNowPlayingReconcileTimer(void) {
  if (LXNowPlayingReconcileTimer != nil) return;
  if (![NSThread isMainThread]) {
    dispatch_async(dispatch_get_main_queue(), ^{ LXStartNowPlayingReconcileTimer(); });
    return;
  }
  dispatch_source_t timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());
  dispatch_source_set_timer(timer, dispatch_time(DISPATCH_TIME_NOW, (int64_t)(3.0 * NSEC_PER_SEC)), (uint64_t)(3.0 * NSEC_PER_SEC), (uint64_t)(0.5 * NSEC_PER_SEC));
  dispatch_source_set_event_handler(timer, ^{ LXReconcileNowPlayingCardNow(); });
  LXNowPlayingReconcileTimer = timer;
  dispatch_resume(timer);
}

static void LXReconcileNowPlayingCardNow(void) {
  if (![NSThread isMainThread]) {
    dispatch_async(dispatch_get_main_queue(), ^{ LXReconcileNowPlayingCardNow(); });
    return;
  }
  BOOL hasInfo = NO;
  @synchronized (LXLyricLock()) { hasInfo = LXNowPlayingInfoCache.count > 0; }
  if (!hasInfo) {
    // 没有卡片（会话已结束）：停表，不空转
    LXStopNowPlayingReconcileTimer();
    return;
  }
  // 引擎真值探针：看门狗自身只能比对「App 侧状态 vs 卡片状态」，两者同源 —— 某次状态
  // 发布丢失（缓冲→恢复、中断、翻转窗口、桥序）时内部状态与卡片会一起停在旧态，看门狗
  // 看不出任何漂移，而引擎其实还在播：用户看到的就是「有声音、进度条停走、按钮按了没
  // 反应」。引擎是唯一独立真值，这里每拍（3s）请求 JS 回传一次；原生连续两次确认同一
  // 方向的漂移（≥2s）才纠正，避免把「发布在途」误判成漂移。
  [[NSNotificationCenter defaultCenter] postNotificationName:LXNowPlayingTruthProbeNotificationName object:nil];
  // 翻转窗口内系统持有的就是「假状态」，此时比对会把正常翻转误判成漂移
  double nowMs = CACurrentMediaTime() * 1000.0;
  if (nowMs < LXNowPlayingCardRepaintFlipUntilMs || nowMs < LXNowPlayingArtworkRepaintFlipUntilMs) return;

  MPNowPlayingInfoCenter *center = [MPNowPlayingInfoCenter defaultCenter];
  MPNowPlayingPlaybackState expected = MPNowPlayingPlaybackStateUnknown;
  BOOL infoMissing = NO;
  unsigned long infoCount = 0;
  @synchronized (LXLyricLock()) {
    expected = LXResolveNowPlayingPublishStateLocked();
    infoCount = LXNowPlayingInfoCache.count;
    infoMissing = (infoCount > 0 && center.nowPlayingInfo == nil);
  }
  MPRemoteCommandCenter *commandCenter = [MPRemoteCommandCenter sharedCommandCenter];
  BOOL stateDrift = (center.playbackState != expected);
  BOOL commandsDrift = !commandCenter.playCommand.enabled || !commandCenter.nextTrackCommand.enabled;
  if (!stateDrift && !infoMissing && !commandsDrift) return;

  NSLog(@"###LXNowPlaying### reconcile stateDrift=%d infoMissing=%d commandsDrift=%d expected=%ld published=%ld internal=%ld info=%lu",
        stateDrift ? 1 : 0, infoMissing ? 1 : 0, commandsDrift ? 1 : 0,
        (long)expected, (long)center.playbackState, (long)LXNowPlayingState, infoCount);
  // 播放态下修复卡片时顺手确保音频会话是激活的（不再查询 isActive：iOS 26 SDK 无该选择器，
  // CI run#954 实测 `no visible @interface for AVAudioSession declares the selector isActive`）。
  // setActive:YES 幂等，且只在「检测到漂移」这种低频路径调用。
  if (LXNowPlayingState == MPNowPlayingPlaybackStatePlaying) LXActivateAudioSessionForPlayback();
  // 重发一次即可把信息 / 播放态 / 命令可用性全部拉回（内部会走 LXSyncRemoteCommandAvailability）
  LXApplyNowPlayingInfo();
}

static void LXApplyNowPlayingInfo(void) {
  // MediaPlayer 的接口（MPNowPlayingInfoCenter / MPRemoteCommandCenter）必须在主线程使用：
  // 歌词时钟跑在专用后台串行队列（com.lxmusic.nowplaying.lyric），它每次歌词换行都会走到这里。
  // 后台线程写这些属性会被系统忽略，并与主线程的写入互相覆盖 —— 卡片会随机停在错误的播放态
  // 或丢失某次发布（按钮方向反、进度条停走，表现为「正常一段时间又失效」）。
  if (![NSThread isMainThread]) {
    dispatch_async(dispatch_get_main_queue(), ^{ LXApplyNowPlayingInfo(); });
    return;
  }
  @synchronized (LXLyricLock()) {
    MPNowPlayingInfoCenter *center = [MPNowPlayingInfoCenter defaultCenter];
    center.nowPlayingInfo = LXNowPlayingInfoCache.count ? [LXNowPlayingInfoCache copy] : nil;
    if (@available(iOS 13.0, *)) {
      MPNowPlayingPlaybackState publishState = LXResolveNowPlayingPublishStateLocked();
      // 只在发布态变化时打点：本函数被歌词时钟高频调用，逐次打点会淹掉系统日志
      static MPNowPlayingPlaybackState lastLoggedPublishState = MPNowPlayingPlaybackStateUnknown;
      if (publishState != lastLoggedPublishState) {
        lastLoggedPublishState = publishState;
        NSLog(@"###LXNowPlaying### publish state=%ld internal=%ld info=%lu",
              (long)publishState, (long)LXNowPlayingState, (unsigned long)LXNowPlayingInfoCache.count);
      }
      center.playbackState = publishState;
    }
    LXSyncRemoteCommandAvailability();
  }
  // 有卡片就确保看门狗在跑（幂等）；没有卡片时由看门狗自己停表
  BOOL hasCard = NO;
  @synchronized (LXLyricLock()) { hasCard = LXNowPlayingInfoCache.count > 0; }
  if (hasCard) LXStartNowPlayingReconcileTimer();
}

static void LXBeginReceivingRemoteControlEvents(void) {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (LXIsReceivingRemoteControlEvents) return;
    [UIApplication.sharedApplication beginReceivingRemoteControlEvents];
    LXIsReceivingRemoteControlEvents = YES;
  });
}

static void LXEndReceivingRemoteControlEvents(void) {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (!LXIsReceivingRemoteControlEvents) return;
    [UIApplication.sharedApplication endReceivingRemoteControlEvents];
    LXIsReceivingRemoteControlEvents = NO;
  });
}

static void LXCancelNowPlayingArtworkTask(void) {
  if (LXNowPlayingArtworkTask != nil) {
    [LXNowPlayingArtworkTask cancel];
    LXNowPlayingArtworkTask = nil;
  }
}

static void LXApplyNowPlayingArtwork(UIImage *image, NSUInteger requestId) {
  if (image == nil) return;

  dispatch_async(dispatch_get_main_queue(), ^{
    if (requestId != LXNowPlayingArtworkRequestId) return;
    NSMutableDictionary *info = LXNowPlayingMutableInfo();
    MPMediaItemArtwork *artwork = [[MPMediaItemArtwork alloc] initWithBoundsSize:image.size requestHandler:^UIImage * _Nonnull(CGSize size) {
      return image;
    }];
    info[MPMediaItemPropertyArtwork] = artwork;
    // iOS 已知行为：同一播放会话中 nowPlayingInfo 已发布过「无封面」版本后，
    // 仅追加 artwork 再发布不一定能刷新锁屏/控制中心封面（表现为要暂停再播放
    // 才出现封面）。同一 runloop 里「置空 + 立即重设」会被系统合并成一次更新，
    // 仍无法触发重绘。这里先置空，延迟一帧后再发布，强制控制中心重新渲染
    // 整张媒体卡片（含封面）。
    MPNowPlayingInfoCenter *center = [MPNowPlayingInfoCenter defaultCenter];
    center.nowPlayingInfo = nil;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.05 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      // 置空后的重发必须**无条件**执行（与下方翻转的还原同一条不变量）：
      // 「换代」只说明封面归新任务管，而「nowPlayingInfo 不能停在 nil」是所有卡片
      // 功能的前提。提前 return 会让卡片停在「没有信息」的空态（按钮 + 进度条全失效），
      // 只能等 3s 看门狗救回 —— 换歌/首次播放时封面请求换代最频繁，正是这个窗口
      // 把卡片打成死卡的。重发永远取最新缓存，因此无条件执行不会写回旧封面。
      if (requestId != LXNowPlayingArtworkRequestId) {
        NSLog(@"###LXNowPlaying### artworkRepublish superseded → restore info (修复前会停在无卡片态)");
      }
      LXApplyNowPlayingInfo();
    });
    // 汽水(qs) / 排行榜等异步匹配封面的音源，封面是在播放中途才就绪的：仅重设
    // nowPlayingInfo 不一定会让控制中心/锁屏重绘封面（表现为需暂停再播放封面才
    // 出现）。这里在信息重设后，短暂把 playbackState 切到相反值再切回，等效于
    // 控制中心的「暂停→播放」，强制系统重绘整张媒体卡片（含封面）。
    // 注意：playbackState 仅是控制中心/锁屏的显示状态，不驱动真实音频，不会
    // 导致实际播放暂停/继续，也不会触发 remote command 事件。
    if (@available(iOS 13.0, *)) {
      MPNowPlayingPlaybackState current = LXNowPlayingState;
      MPNowPlayingPlaybackState opposite = (current == MPNowPlayingPlaybackStatePlaying)
        ? MPNowPlayingPlaybackStatePaused
        : MPNowPlayingPlaybackStatePlaying;
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.15 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        // 还没翻转就换代：本次翻转作废，直接交给新任务（此时卡片仍是真实态，安全）
        if (requestId != LXNowPlayingArtworkRequestId) return;
        LXNowPlayingArtworkRepaintFlipUntilMs = CACurrentMediaTime() * 1000.0 + LXNowPlayingArtworkRepaintFlipMs;
        center.playbackState = opposite;
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.08 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
          // 已经翻转了，还原必须无条件执行：翻转期间卡片显示的是「假状态」，任何提前 return
          // 都会把它永久留在相反播放态 —— 表现即「按钮方向反/按了没反应、进度条停走」，
          // 直到下一次 LXApplyNowPlayingInfo 才恢复（新封面任务接手不代表假状态已被还原）。
          // 换歌/首次播放时封面请求换代最频繁，正是这个窗口把卡片打成死卡的。
          BOOL superseded = requestId != LXNowPlayingArtworkRequestId;
          if (superseded) {
            NSLog(@"###LXNowPlaying### artworkFlip superseded mid-flip → restore state=%ld (修复前会永久停在假状态)", (long)current);
          }
          center.playbackState = current;
          LXNowPlayingArtworkRepaintFlipUntilMs = 0;
          LXApplyNowPlayingInfo();
        });
      });
    }
    // 异步下载的封面可能被随后到达的元数据刷新短暂覆盖，这里延迟再应用一次，
    // 确保封面在控制中心/锁屏稳定显示（对齐 pauseNowPlaying 的 0.15s 重应用策略）。
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.3 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      if (requestId != LXNowPlayingArtworkRequestId) return;
      LXApplyNowPlayingInfo();
    });
  });
}

static void LXSetNowPlayingArtwork(NSString *artworkPath) {
  NSMutableDictionary *info = LXNowPlayingMutableInfo();
  BOOL hasArtwork = info[MPMediaItemPropertyArtwork] != nil;
  if (!artworkPath.length && LXNowPlayingArtworkPath == nil && !hasArtwork) return;
  if (artworkPath.length && [artworkPath isEqualToString:LXNowPlayingArtworkPath] && (hasArtwork || LXNowPlayingArtworkTask != nil)) return;

  @synchronized (LXLyricLock()) {
    LXCancelNowPlayingArtworkTask();
    LXNowPlayingArtworkRequestId += 1;
    [info removeObjectForKey:MPMediaItemPropertyArtwork];
    LXNowPlayingArtworkPath = artworkPath.length ? [artworkPath copy] : nil;
    LXApplyNowPlayingInfo();
  }

  if (!artworkPath.length) return;

  NSUInteger requestId = LXNowPlayingArtworkRequestId;
  void (^setArtwork)(UIImage *) = ^(UIImage *image) {
    LXApplyNowPlayingArtwork(image, requestId);
  };

  if ([artworkPath hasPrefix:@"http://"] || [artworkPath hasPrefix:@"https://"]) {
    NSURL *url = [NSURL URLWithString:artworkPath];
    if (url == nil) return;
    // 与 JS 侧 FastImage 的 defaultHeaders 保持一致：部分音源封面 CDN 对
    // 无 User-Agent 的裸请求会返回 403，导致控制中心封面下载失败（播放详情页
    // 用 FastImage 带 UA 能正常显示）。这里补上浏览器 UA，保证同一 URL 在
    // 控制中心/锁屏也能下载成功。
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
    [request setValue:@"Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36" forHTTPHeaderField:@"User-Agent"];
    LXNowPlayingArtworkTask = [[NSURLSession sharedSession] dataTaskWithRequest:request completionHandler:^(NSData * _Nullable data, NSURLResponse * _Nullable response, NSError * _Nullable error) {
      if (error != nil || data.length == 0) return;
      UIImage *image = [UIImage imageWithData:data];
      setArtwork(image);
    }];
    [LXNowPlayingArtworkTask resume];
    return;
  }

  UIImage *image = [UIImage imageWithContentsOfFile:artworkPath];
  setArtwork(image);
}

static NSNumber *LXDefaultNowPlayingRate(void) {
  switch (LXNowPlayingState) {
    case MPNowPlayingPlaybackStatePlaying:
      return @1;
    case MPNowPlayingPlaybackStatePaused:
    case MPNowPlayingPlaybackStateStopped:
    default:
      return @0;
  }
}

static NSNumber *LXCurrentNowPlayingRate(void) {
  NSNumber *rate = [LXNowPlayingInfoCache[MPNowPlayingInfoPropertyPlaybackRate] isKindOfClass:[NSNumber class]] ? LXNowPlayingInfoCache[MPNowPlayingInfoPropertyPlaybackRate] : nil;
  return rate ?: LXDefaultNowPlayingRate();
}

static NSNumber *LXNowPlayingDefaultPlaybackRateValue(void) {
  return @1;
}

// elapsedTime 快照戳解析：JS 发布元数据/播放态时可携带
// - elapsedTimeSnapshotAt：快照的原生时钟戳（nativeFlac 路径，getPositionStamped 打点）；
// - elapsedTimeAgeMs：快照墙钟年龄（AVPlayer 路径，JS Date.now 往返中点估计）。
// 换算为统一的 CACurrentMediaTime 毫秒戳（年龄形态在读到 payload 的当下换算，
// 主队列排队延迟天然被覆盖）；两者都无 → 0（LXRefreshNowPlayingLyricAnchor 退回
// 「锚点钉在现在」的旧行为）。见 LXReanchorNowPlayingLyric 的滞后补偿说明。
static double LXResolveElapsedSnapshotAtMs(NSDictionary *payload, double nowMs) {
  NSNumber *snapshotAt = [payload[@"elapsedTimeSnapshotAt"] isKindOfClass:[NSNumber class]]
    ? payload[@"elapsedTimeSnapshotAt"] : nil;
  if (snapshotAt != nil && snapshotAt.doubleValue > 0) return MIN(snapshotAt.doubleValue, nowMs);
  NSNumber *ageMs = [payload[@"elapsedTimeAgeMs"] isKindOfClass:[NSNumber class]]
    ? payload[@"elapsedTimeAgeMs"] : nil;
  if (ageMs != nil && ageMs.doubleValue > 0) return nowMs - MIN(ageMs.doubleValue, 1000.0);
  return 0;
}

// 把快照 elapsed 推进到「发布时刻」的现在值：系统进度条从每次发布的
// ElapsedPlaybackTime 基线 + rate 外推，写快照时刻的过去值会让基线每次发布都
// 回拨一个快照年龄（控制中心进度条后跳、左侧时间倒退）。暂停中（rate ≤ 0）
// 位置不随时间变化，不推进；无戳（snapshotAtMs ≤ 0，nativeFlac/AVPlayer 都没
// 带戳的旧链路）保持旧行为不推进。
static double LXAdvanceElapsedToNowSec(double elapsedSec, double snapshotAtMs, double rate, double nowMs) {
  if (snapshotAtMs <= 0 || rate <= 0) return elapsedSec;
  double dtMs = nowMs - snapshotAtMs;
  if (dtMs <= 0) return elapsedSec; // 未来值钳制（快照时刻不可能晚于现在）
  if (dtMs > 1000.0) dtMs = 1000.0; // 异常年龄钳制（正常 < 300ms）
  return elapsedSec + rate * dtMs / 1000.0;
}

static void LXSetNowPlayingPlaybackState(MPNowPlayingPlaybackState state, NSDictionary *options) {
  MPNowPlayingPlaybackState previousState = LXNowPlayingState;
  LXNowPlayingState = state;
  // 会话生命周期：只有真正的 Stopped 结束会话（播放/暂停/缓冲都算会话仍在）
  LXNowPlayingHasPlaybackSession = (state != MPNowPlayingPlaybackStateStopped);
  if (state != previousState) {
    NSLog(@"###LXNowPlaying### setState %ld -> %ld session=%d info=%lu",
          (long)previousState, (long)state, LXNowPlayingHasPlaybackSession ? 1 : 0, (unsigned long)LXNowPlayingInfoCache.count);
  }

  // 时钟冻结标志与 Now Playing 播放态联动：nativeFlac 驱动下 TrackPlayer 已
  // reset，不再产生 state 生命周期事件，hold 只会停留在 reset 时的 YES ——
  // 原生歌词时钟在控制中心/锁屏永远冻结在锚点行（歌词不实时同步）。
  // 以 play/pause 发布为准解除/置位冻结；TrackPlayer 路径的 state 事件携带
  // 同一引擎状态，仍会照常更新该标志，两条路径一致不冲突。
  LXNowPlayingClockHold = (state != MPNowPlayingPlaybackStatePlaying);

  // 播放/暂停/停止切换时同步时钟生命周期：暂停/停止即停钟（8.3Hz 在非播放态是
  // 净唤醒，锁屏后台耗电），恢复播放时重建。放在早退（无标题）之前——即使元数据
  // 尚未到达，暂停已成立，时钟就不该继续跑。
  LXSyncNowPlayingLyricTimer();

  // 播放事件可能早于歌曲元数据到达。不要把只有 playbackRate、没有标题的
  // 空字典发布给 MPNowPlayingInfoCenter：iOS 27 Beta 7 会把它识别成“未在播放”，
  // 且后续补写元数据不一定重新显示控制中心媒体卡片。先缓存状态，等
  // LXSetNowPlayingInfo 写入有效标题后再统一发布。
  NSString *existingTitle = [LXNowPlayingInfoCache[MPMediaItemPropertyTitle] isKindOfClass:[NSString class]]
    ? LXNowPlayingInfoCache[MPMediaItemPropertyTitle]
    : nil;
  if (existingTitle.length == 0) return;

  @synchronized (LXLyricLock()) {
    NSMutableDictionary *info = LXNowPlayingMutableInfo();
    NSDictionary *stateOptions = options ?: @{};
    NSNumber *elapsedTime = [stateOptions[@"elapsedTime"] isKindOfClass:[NSNumber class]] ? stateOptions[@"elapsedTime"] : nil;
    NSNumber *playbackRate = [stateOptions[@"playbackRate"] isKindOfClass:[NSNumber class]] ? stateOptions[@"playbackRate"] : nil;

    // 推进用速率与随后写入 info 的保持一致（nil → 按播放态兜底，见下方 PlaybackRate 写入）
    double rateForAdvance = (playbackRate ?: LXDefaultNowPlayingRate()).doubleValue;
    double nowMs = CACurrentMediaTime() * 1000.0;
    if (elapsedTime != nil) {
      double snapshotAtMs = LXResolveElapsedSnapshotAtMs(stateOptions, nowMs);
      // 系统进度基线必须写「发布时刻」的值：把快照位置推进到现在，否则每次状态
      // 发布（播放/暂停/seek）进度条都回拨一个快照年龄
      info[MPNowPlayingInfoPropertyElapsedPlaybackTime] =
        @(LXAdvanceElapsedToNowSec(elapsedTime.doubleValue, snapshotAtMs, rateForAdvance, nowMs));
      // 位置缓存对（值, 戳）成对更新：推进后的基线对应「现在」——歌词锚点重锚
      // 读同一缓存对，若值推进而戳仍留在快照时刻，歌词时钟会被推超前
      LXNowPlayingElapsedSnapshotAtMs = (snapshotAtMs > 0) ? nowMs : 0;
    }
    else if (state == MPNowPlayingPlaybackStateStopped) {
      info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = @0;
      LXNowPlayingElapsedSnapshotAtMs = 0;
    }

    info[MPNowPlayingInfoPropertyPlaybackRate] = playbackRate ?: LXDefaultNowPlayingRate();
    info[MPNowPlayingInfoPropertyDefaultPlaybackRate] = LXNowPlayingDefaultPlaybackRateValue();
    // 控制中心遥控（播放/暂停/上一首下一首）的播放状态变化同样重锚歌词时钟
    LXRefreshNowPlayingLyricAnchor();

    // 播放状态可能早于歌曲元数据（标题）到达：先把 playbackRate / elapsedTime 写入缓存，
    // 但暂不发布。iOS 27 Beta 7 会把“只有 playbackRate、没有标题”的空字典识别成“未在播放”，
    // 且后续补写元数据不一定重新显示控制中心媒体卡片；等 LXSetNowPlayingInfo 写入有效标题后
    // 统一发布（届时缓存已含正确的 playbackRate / elapsedTime），避免切歌后控制中心进度卡在“-”。
    if (existingTitle.length == 0) return;

    LXApplyNowPlayingInfo();
  }
  // 播放态变化同样要刷新卡片按钮（详情见 LXScheduleDeferredNowPlayingCardRepaint）
  LXScheduleDeferredNowPlayingCardRepaint();
}

// —— 卡片显示态「引擎真值」自愈 ——
// JS 收到 LXNowPlayingTruthProbeNotificationName 事件后立即回传引擎真实播放态
// （getPlaybackEngineState，AVPlayer / nativeFlac 两条引擎都算）。
// 为什么需要它：3s 收敛看门狗（LXReconcileNowPlayingCardNow）只能比对
// 「App 侧缓存态 vs 系统卡片态」——两者同源。一次状态发布丢失（缓冲→恢复、音频中断、
// 翻转窗口、桥序颠倒、JS 定时器停摆）会让内部状态与卡片**一起**停在旧态，看门狗
// 报不出漂移，而引擎还在出声：用户看到的正是「有声音、进度条停走、按钮按了没反应」，
// 且此后没有任何自愈路径（重启软件才恢复）。引擎是唯一独立真值。
// 防抖：同一方向的漂移必须连续 ≥2s（探针 3s 一拍，即连续两次回传）才纠正 ——
// 单次回传可能撞上发布在途/翻转窗口，不是真漂移。
static double LXNowPlayingTruthDriftSinceMs = 0;
static BOOL LXNowPlayingTruthDriftValue = NO;

static void LXReportNowPlayingPlaybackTruth(BOOL isPlaying, NSDictionary *options) {
  if (![NSThread isMainThread]) {
    dispatch_async(dispatch_get_main_queue(), ^{ LXReportNowPlayingPlaybackTruth(isPlaying, options); });
    return;
  }
  unsigned long infoCount = 0;
  MPNowPlayingPlaybackState internalState = MPNowPlayingPlaybackStateStopped;
  @synchronized (LXLyricLock()) {
    infoCount = LXNowPlayingInfoCache.count;
    internalState = LXNowPlayingState;
  }
  // 没有曲目上下文（无卡片）：不参与自愈 —— 免得把「真的什么都没播」拉成播放态
  if (infoCount == 0) {
    LXNowPlayingTruthDriftSinceMs = 0;
    return;
  }
  BOOL drift = isPlaying ? (internalState != MPNowPlayingPlaybackStatePlaying)
                        : (internalState == MPNowPlayingPlaybackStatePlaying);
  if (!drift) {
    LXNowPlayingTruthDriftSinceMs = 0;
    return;
  }
  double nowMs = CACurrentMediaTime() * 1000.0;
  if (LXNowPlayingTruthDriftSinceMs <= 0 || LXNowPlayingTruthDriftValue != isPlaying) {
    LXNowPlayingTruthDriftSinceMs = nowMs;
    LXNowPlayingTruthDriftValue = isPlaying;
    return;
  }
  if (nowMs - LXNowPlayingTruthDriftSinceMs < 2000.0) return;
  LXNowPlayingTruthDriftSinceMs = 0;
  NSLog(@"###LXNowPlaying### truthDrift engine=%d internal=%ld info=%lu action=fix",
        isPlaying ? 1 : 0, (long)internalState, infoCount);
  if (isPlaying) {
    NSNumber *rate = LXCurrentNowPlayingRate();
    if (rate.doubleValue <= 0) rate = @(1);
    // 系统可能已把媒体会话撤回（这正是卡片按钮失效的机制）：重新激活会话再发布
    LXActivateAudioSessionForPlayback();
    // 必须带上 JS 回传的引擎进度快照（elapsedTime + 快照戳）：纠正播放态后系统会从
    // 新基线按速率外推，直接用缓存里的旧基线会把控制中心进度条整体拉回去。
    NSMutableDictionary *fixOptions = [NSMutableDictionary dictionaryWithDictionary:options ?: @{}];
    fixOptions[@"playbackRate"] = rate;
    LXSetNowPlayingPlaybackState(MPNowPlayingPlaybackStatePlaying, fixOptions);
  } else {
    LXSetNowPlayingPlaybackState(MPNowPlayingPlaybackStatePaused, @{ @"playbackRate": @0 });
  }
  LXApplyNowPlayingInfo();
  // 卡片被系统冻结时，仅重发信息不一定重绘（同歌词换行链路）：补一次重绘翻转
  LXForceNowPlayingCardRepaint();
}

static void LXClearNowPlayingInfo(void) {
  @synchronized (LXLyricLock()) {
    NSLog(@"###LXNowPlaying### clear wasState=%ld wasInfo=%lu session=%d",
          (long)LXNowPlayingState, (unsigned long)LXNowPlayingInfoCache.count, LXNowPlayingHasPlaybackSession ? 1 : 0);
    LXCancelNowPlayingArtworkTask();
    LXNowPlayingArtworkRequestId += 1;
    LXNowPlayingArtworkPath = nil;
    LXNowPlayingInfoCache = nil;
    LXNowPlayingSongLine = nil;
    LXNowPlayingState = MPNowPlayingPlaybackStateStopped;
    LXNowPlayingElapsedSnapshotAtMs = 0;
    LXClearNowPlayingLyricLines();
    LXApplyNowPlayingInfo();
    LXStopNowPlayingReconcileTimer();
  }
  // 停止 / 销毁播放会话：停掉 8.3Hz 歌词时钟（state=Stopped，守卫会停钟）。
  // 放在锁外调用——LXSyncNowPlayingLyricTimer 内部走 LXLyricLock 保护的启动路径，
  // 避免与本处已持有的同一把锁重入（NSObject @synchronized 可重入但没必要嵌套持有）。
  LXSyncNowPlayingLyricTimer();
}

static void LXHandleTrackPlayerLifecycleNotification(NSNotification *notification) {
  // TrackPlayer 动过音频会话（play/pause/reset/destroy…）：流式 FLAC 的「会话已接管」标记失效，
  // 下次 openStream 必须重新接管（先停用再配置），否则可能出现「引擎在跑但没有音频输出」。
  LXStreamingFlacOwnsAudioSession = NO;
  NSDictionary *userInfo = [notification.userInfo isKindOfClass:[NSDictionary class]] ? notification.userInfo : @{};
  NSString *event = [userInfo[@"event"] isKindOfClass:[NSString class]] ? userInfo[@"event"] : @"";
  NSNumber *position = [userInfo[@"position"] isKindOfClass:[NSNumber class]] ? userInfo[@"position"] : nil;

  if ([event isEqualToString:@"destroy"] || [event isEqualToString:@"reset"]) {
    // destroy = 会话结束；reset = nativeFlac 换歌中途，缓存要清但会话仍在（见静态标志注释）
    if ([event isEqualToString:@"destroy"]) LXNowPlayingHasPlaybackSession = NO;
    LXClearNowPlayingInfo();
    return;
  }

  if (LXNowPlayingInfoCache.count == 0) return;

  // "seeked"：AVPlayer seek completion（引擎真正到达落点，非请求目标）——同一重锚语义
  if ([event isEqualToString:@"seek"] || [event isEqualToString:@"seeked"]) {
    LXSetNowPlayingPlaybackState(LXNowPlayingState, @{
      @"elapsedTime": position ?: @0,
      @"playbackRate": LXCurrentNowPlayingRate(),
    });
    return;
  }

  // 状态变化（原生事件携带引擎真实位置 + 真实速率）：重锚歌词时钟并修正缓存速率。
  // 缓冲起停 / 暂停恢复 / 倍速变化若发生在外推期间，线性外推会漂移（表现为控制
  // 中心歌词超前或滞后音乐），这里用引擎真实位置 + 真实速率把时钟拉回正轨，
  // 控制中心拖动进度条的 seek 事件同样经此链路重锚（见上分支）。
  if ([event isEqualToString:@"state"]) {
    if (position != nil) {
      // 原生侧事件自带引擎位置（无桥接滞后），快照即当下 → 不带戳补偿
      LXReanchorNowPlayingLyric(position.doubleValue * 1000.0, 0, 0);
    }
    NSNumber *rate = [userInfo[@"rate"] isKindOfClass:[NSNumber class]] ? userInfo[@"rate"] : nil;
    if (rate != nil && LXNowPlayingInfoCache.count > 0) {
      LXNowPlayingInfoCache[MPNowPlayingInfoPropertyPlaybackRate] = rate;
    }
    // 时钟冻结判定：非播放态（加载/缓冲/暂停等）冻结外推，歌词与音频一同
    // 停走——音频微缓冲会反复发生，外推持续超前正是"同步一句停一会"的根因
    NSString *lifecycleState = [userInfo[@"state"] isKindOfClass:[NSString class]] ? userInfo[@"state"] : nil;
    LXNowPlayingClockHold = !(lifecycleState.length && ([lifecycleState isEqualToString:@"playing"] || [lifecycleState isEqualToString:@"ready"]));
    return;
  }
}

// 系统音频中断（被其它 App 抢占 / 来电）：引擎会立刻停声，而 JS 侧要等 RemoteDuck 事件
// 到达才能把 Now Playing 播放态改成 Paused —— App 在后台被挂起时这段延迟可能很长，期间
// 控制中心 / 灵动岛显示的还是「暂停」图标：用户点它，系统发的是 pause（本来就没在播，
// 看起来「点播放没反应」），要按第二次才轮到真正的 play（用户 2026-10-03 反馈）。
// 原生在中断当拍就把卡片置成 Paused（只动显示态，不碰真实播放），第一次按下即 play。
static void LXHandleNowPlayingInterruptionBegan(void) {
  if (LXNowPlayingState != MPNowPlayingPlaybackStatePlaying) return;
  if (LXNowPlayingInfoCache.count == 0) return;
  // playbackRate 必须显式写 0：系统同时按 info 里的速率外推进度，缺省会沿用旧的正速率
  LXSetNowPlayingPlaybackState(MPNowPlayingPlaybackStatePaused, @{ @"playbackRate": @0 });
}

static void LXRegisterTrackPlayerLifecycleObserver(void) {
  if (LXTrackPlayerLifecycleObserver == nil) {
    LXTrackPlayerLifecycleObserver = [[NSNotificationCenter defaultCenter] addObserverForName:LXTrackPlayerLifecycleNotificationName object:nil queue:[NSOperationQueue mainQueue] usingBlock:^(NSNotification * _Nonnull note) {
      LXHandleTrackPlayerLifecycleNotification(note);
    }];
  }

  if (LXNowPlayingApplicationObserver == nil) {
    LXNowPlayingApplicationObserver = [[NSNotificationCenter defaultCenter] addObserverForName:UIApplicationDidBecomeActiveNotification object:nil queue:[NSOperationQueue mainQueue] usingBlock:^(NSNotification * _Nonnull note) {
      // 回前台 = 屏幕一定亮着：先记录亮度证据（用于区分「熄屏」与「最低亮度仍亮」），
      // 再按可见性重新判定歌词时钟（熄屏期间可能被停掉）。时钟逻辑自身会在「由暗转亮」时
      // 补一次步进 + 重绘，保证第一眼就是正确行。
      LXRememberScreenBrightness();
      LXUpdateNowPlayingLyricTimerVisibility();
      if (LXNowPlayingInfoCache.count == 0) return;
      // iOS 27 Beta 7 可能在应用切换/控制中心展开后丢弃当前媒体会话；
      // 重新激活音频会话并重新提交缓存，可让 iPad 控制中心/锁屏恢复歌曲信息和播放按钮。
      [[AVAudioSession sharedInstance] setActive:YES error:nil];
      LXApplyNowPlayingInfo();
    }];
  }

  // 屏幕点亮状态：iOS 没有公开 API，唯一可用判据是 UIScreen.brightness（熄屏/锁屏时为 0）。
  // 亮度变化通知覆盖「锁屏熄屏 / 抬腕亮屏到锁屏界面」这条链路 —— App 在后台时
  // AppState 不会变，只有亮度会变，所以必须单独观察。
  if (LXNowPlayingScreenObserver == nil) {
    LXNowPlayingScreenObserver = [[NSNotificationCenter defaultCenter] addObserverForName:UIScreenBrightnessDidChangeNotification object:nil queue:[NSOperationQueue mainQueue] usingBlock:^(NSNotification * _Nonnull note) {
      // 先记录「屏幕亮着」的证据（读到非零亮度），再判定是否熄屏 —— 顺序不能反，
      // 否则「从明显亮掉到 0」这一次通知里会丢掉唯一的判定依据。
      LXRememberScreenBrightness();
      LXUpdateNowPlayingLyricTimerVisibility();
    }];
  }

  // 音频路由变化：决定「蓝牙歌词能否送到车机」（蓝牙输出才可能显示，耳机/外放不会），
  // 进而决定熄屏时要不要继续跑 8.3Hz 时钟。
  if (LXNowPlayingRouteObserver == nil) {
    LXNowPlayingRouteObserver = [[NSNotificationCenter defaultCenter] addObserverForName:AVAudioSessionRouteChangeNotification object:nil queue:[NSOperationQueue mainQueue] usingBlock:^(NSNotification * _Nonnull note) {
      LXUpdateNowPlayingLyricTimerVisibility();
      // 车机接入/断开会切换字段布局（蓝牙把歌词行放 title）：立即重排并重发一次，
      // 不等下一次换行/元数据发布（否则刚连上车机时车机看到的还是旧布局）。
      @synchronized (LXLyricLock()) {
        if (LXNowPlayingInfoCache.count > 0) {
          LXApplyNowPlayingTitleArtistFields(LXNowPlayingInfoCache);
          LXApplyNowPlayingInfo();
        }
      }
    }];
  }

  // 音频中断开始：原生立刻把卡片播放态置为 Paused，不等 JS（见 LXHandleNowPlayingInterruptionBegan）
  if (LXNowPlayingInterruptionObserver == nil) {
    LXNowPlayingInterruptionObserver = [[NSNotificationCenter defaultCenter] addObserverForName:AVAudioSessionInterruptionNotification object:[AVAudioSession sharedInstance] queue:[NSOperationQueue mainQueue] usingBlock:^(NSNotification * _Nonnull note) {
      NSNumber *typeValue = [note.userInfo[AVAudioSessionInterruptionTypeKey] isKindOfClass:[NSNumber class]] ? note.userInfo[AVAudioSessionInterruptionTypeKey] : nil;
      if (typeValue == nil || typeValue.unsignedIntegerValue != AVAudioSessionInterruptionTypeBegan) return;
      LXHandleNowPlayingInterruptionBegan();
    }];
  }
}

// 歌词行时钟：锚点刷新 / 清行（定义在文件后部歌词驱动区块，此处前置声明）
static void LXRefreshNowPlayingLyricAnchor(void);
static void LXClearNowPlayingLyricLines(void);
static void LXReanchorNowPlayingLyric(double elapsedMs, double snapshotAtMs, double ageMs);

// 按当前输出路由把「歌名行 / 当前歌词行」写进缓存的两个展示字段（见文件前部字段布局注释）：
//   蓝牙 + 有歌词行 → title = 当前行，artist = 歌名·歌手（车机看 title 也能看到歌词）
//   其它情况        → title = 歌名·歌手，artist = 当前行（手机控制中心/锁屏既有布局）
static void LXApplyNowPlayingTitleArtistFields(NSMutableDictionary *info) {
  if (info == nil) return;
  BOOL useBluetoothLayout = LXHasBluetoothAudioRoute() && LXNowPlayingCurrentLyricLine.length > 0;
  if (useBluetoothLayout) {
    info[MPMediaItemPropertyTitle] = LXNowPlayingCurrentLyricLine;
    info[MPMediaItemPropertyArtist] = LXNowPlayingSongLine ?: @"";
    return;
  }
  if (LXNowPlayingSongLine.length) info[MPMediaItemPropertyTitle] = LXNowPlayingSongLine;
  info[MPMediaItemPropertyArtist] = LXNowPlayingCurrentLyricLine ?: @"";
}

static void LXSetNowPlayingInfo(NSDictionary *metadata) {
  @synchronized (LXLyricLock()) {
    NSMutableDictionary *info = LXNowPlayingMutableInfo();

    NSString *title = [metadata[@"title"] isKindOfClass:[NSString class]] ? metadata[@"title"] : nil;
    // 有标题 = 有当前曲目：会话开始（换歌 reset 清缓存期间靠它保持遥控命令可用）
    if (title != nil) LXNowPlayingHasPlaybackSession = YES;
    // 只打长度与状态，不打歌名（日志可能被用户导出）
    NSLog(@"###LXNowPlaying### metadata titleLen=%lu state=%ld session=%d",
          (unsigned long)(title ? title.length : 0), (long)LXNowPlayingState, LXNowPlayingHasPlaybackSession ? 1 : 0);
    NSString *artist = [metadata[@"artist"] isKindOfClass:[NSString class]] ? metadata[@"artist"] : nil;
    NSString *album = [metadata[@"album"] isKindOfClass:[NSString class]] ? metadata[@"album"] : nil;
    NSNumber *duration = [metadata[@"duration"] isKindOfClass:[NSNumber class]] ? metadata[@"duration"] : nil;
    NSNumber *elapsedTime = [metadata[@"elapsedTime"] isKindOfClass:[NSNumber class]] ? metadata[@"elapsedTime"] : nil;
    NSNumber *playbackRate = [metadata[@"playbackRate"] isKindOfClass:[NSNumber class]] ? metadata[@"playbackRate"] : nil;

    // 歌词时间轴归属判定：标题变化 = 换歌 → 清掉旧歌时间轴（新歌歌词经
    // lyricUpdated 重新注入）。不能用"artist 为空"判定换歌——封面图等后到的
    // 元数据发布时 artist 也为空，会把已注入的时间轴误清（真机实测表现为
    // 控制中心歌词整首歌不显示，诊断模式显示"无时间轴"）。
    // 基准用 LXNowPlayingSongLine（JS 原始 title）而不是 cache.title：蓝牙模式下
    // cache.title 已被换成歌词行，拿它判定会把每次换行都当成换歌（歌词时间轴被清空）。
    NSString *previousTitle = LXNowPlayingSongLine;
    BOOL isNewSong = title != nil && previousTitle.length > 0 && ![title isEqualToString:previousTitle];

    if (title != nil) LXNowPlayingSongLine = title;
    if (artist != nil) LXNowPlayingCurrentLyricLine = artist.length > 0 ? artist : nil;
    LXApplyNowPlayingTitleArtistFields(info);
    if (album != nil) info[MPMediaItemPropertyAlbumTitle] = album;
    if (duration != nil) info[MPMediaItemPropertyPlaybackDuration] = duration;
    double nowMs = CACurrentMediaTime() * 1000.0;
    if (elapsedTime != nil) {
      double snapshotAtMs = LXResolveElapsedSnapshotAtMs(metadata, nowMs);
      // 推进用速率与随后写入 info 的一致（nil → 沿用缓存 → 播放态兜底）
      NSNumber *advanceRate = playbackRate;
      if (advanceRate == nil && [info[MPNowPlayingInfoPropertyPlaybackRate] isKindOfClass:[NSNumber class]]) {
        advanceRate = info[MPNowPlayingInfoPropertyPlaybackRate];
      }
      if (advanceRate == nil) advanceRate = LXDefaultNowPlayingRate();
      // 系统进度基线必须写「发布时刻」的值：把快照位置推进到现在，否则逐行
      // 元数据每次发布（前台每行一次）进度条都回拨一个快照年龄
      info[MPNowPlayingInfoPropertyElapsedPlaybackTime] =
        @(LXAdvanceElapsedToNowSec(elapsedTime.doubleValue, snapshotAtMs, advanceRate.doubleValue, nowMs));
      // 位置缓存对（值, 戳）成对更新：推进后的基线对应「现在」——歌词锚点重锚
      // 读同一缓存对，若值推进而戳仍留在快照时刻，歌词时钟会被推超前
      LXNowPlayingElapsedSnapshotAtMs = (snapshotAtMs > 0) ? nowMs : 0;
    }
    info[MPNowPlayingInfoPropertyPlaybackRate] = playbackRate ?: info[MPNowPlayingInfoPropertyPlaybackRate] ?: LXDefaultNowPlayingRate();
    info[MPNowPlayingInfoPropertyDefaultPlaybackRate] = info[MPNowPlayingInfoPropertyDefaultPlaybackRate] ?: LXNowPlayingDefaultPlaybackRateValue();
    // JS 以正速率发布 = 断言「当前正在播放」：解除可能残留的时钟冻结（hold）。
    // nativeFlac 驱动下 TrackPlayer 已 reset、不再产生 state 生命周期事件，hold 若
    // 停留在 reset 时的 YES，原生歌词时钟会永久冻在锚点行（控制中心歌词不实时同步）。
    // 逐行歌词元数据现在携带正速率，任何一次换行都能把时钟自愈回正常外推。
    if (playbackRate != nil && playbackRate.doubleValue > 0) LXNowPlayingClockHold = NO;

    if (isNewSong) LXClearNowPlayingLyricLines();
    // 歌词时钟锚点：以本次发布的引擎真实位置（elapsedTime）为基准外推；
    // 前台 JS 每行歌词都会发布一次，锚点随之持续校准
    LXRefreshNowPlayingLyricAnchor();
    // 位置事件枢纽不依赖歌词存在：无歌词的歌也要有时钟（驱动 JS 进度 UI）。
    // 但只在播放中运行——暂停/停止/空闲时停钟，避免 8.3Hz 净唤醒（锁屏后台耗电）。
    LXSyncNowPlayingLyricTimer();

    // 仅当调用方显式携带 artwork 字段时才更新封面。蓝牙歌词 / 逐行歌词更新只传
    // { artist: 歌词 }（不含 artwork 键），若仍触发 LXSetNowPlayingArtwork(@"") 会把
    // 控制中心 / 锁屏封面擦除，表现为“播放中封面闪烁/消失”。不携带时仅重应用信息即可。
    if (metadata[@"artwork"] != nil) {
      NSString *artworkPath = [metadata[@"artwork"] isKindOfClass:[NSString class]] ? metadata[@"artwork"] : @"";
      LXSetNowPlayingArtwork(artworkPath);
    } else {
      LXApplyNowPlayingInfo();
    }

    // 卡片重绘不能用 applicationState 当「卡片是否可见」的代理（同 LXScheduleDeferredNowPlayingCardRepaint）：
    // 灵动岛展开/点按、前台下拉控制中心时，App 都停在 Active，卡片却摆在用户眼前。
    // 旧实现在这里直接 return，而这正是「上一首/下一首按了没反应」的正体：
    //   · 换歌后整张卡片冻在上一首（title / 封面 / 进度都是旧的），音乐确实切了但看不出；
    //   · 更没歌词的歌：新歌没有歌词时时间轴为空，原生歌词时钟那条兜底重绘（LXNowPlayingLyricStep）
    //     也不会触发（无行变化就直接 return）—— 卡片永远不更新，用户归因于「上一首/下一首没有用」。
    // 节奏控制：前台只在**换歌**（isNewSong）时强制重绘（每首一次），逐行歌词刷新交给原生
    // 歌词时钟（那里**没有** app-state 门控），不在这里叠加翻转；后台仍按旧行为每次发布都重绘。
    if (isNewSong || [UIApplication sharedApplication].applicationState != UIApplicationStateActive) {
      LXForceNowPlayingCardRepaint();
    }
  }
}

// ============================================================================
// Now Playing 歌词原生驱动：JS 在歌词加载后把整条时间轴（time/text）交给原生，
// 原生 GCD 时钟（专用串行队列）按「锚点外推」的播放位置直接查行并写入控制
// 中心（artist 字段）。不用任何主线程 RunLoop 定时器：下拉控制中心 / 通知中心
// 时 App 进入 inactive，主 RunLoop 退入非 common 模式、主线程定时器（JS
// BackgroundTimer 与 NSTimer 同）全部停摆，控制中心歌词会冻结在打开前的那一行；
// GCD 队列时钟不受 RunLoop 模式影响。锚点：JS 每次发布 Now Playing 元数据都
// 携带引擎真实位置（elapsedTime），以此为基础、按 playbackRate 线性外推；前台
// JS 路径先行写入同一行文本时，tick 检测到 artist 已是最新行则静默跳过。
static NSMutableArray<NSDictionary<NSString *, id> *> *LXNowPlayingLyricLines = nil;
static dispatch_source_t LXNowPlayingLyricTimer = nil;
static dispatch_queue_t LXNowPlayingLyricQueue = nil;
static double LXNowPlayingLyricAnchorSystemMs = 0;  // CACurrentMediaTime() 毫秒
static double LXNowPlayingLyricAnchorElapsedMs = 0; // 锚点对应的播放位置（ms）
static NSInteger LXNowPlayingLyricIndex = -1;
// 强制重绘单飞标志 / 待办标志：见 LXForceNowPlayingCardRepaint()
static BOOL LXNowPlayingCardRepaintInFlight = NO;
static BOOL LXNowPlayingCardRepaintQueued = NO;

// 临时诊断（定位控制中心歌词冻结，定位后置 0 关闭）：非前台时把时钟内部状态
// 写进媒体卡片 artist 字段——D+计数前进=时钟运行且卡片可重绘；计数冻结=时钟
// 未运行或卡片不重绘；文案（无时间轴/无锚点/已暂停/歌词行）指示命中的分支。
#ifndef LX_LYRIC_DEBUG
#define LX_LYRIC_DEBUG 0
#endif

// 时钟状态锁：tick 运行在专用串行队列，而 JS 元数据发布 / 清行 / 重锚发生在主线程，
// 两侧都会读写锚点与行集，统一用该锁串行化。GCD 时钟不受 RunLoop 模式影响——
// 控制中心盖住 App 时主线程 RunLoop 退入非 common 模式、主线程定时器停摆
// （JS BackgroundTimer 与原生 NSTimer 同停），这正是控制中心歌词冻结的根因。
static NSObject *LXLyricLock(void) {
  static NSObject *lock = nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{ lock = [NSObject new]; });
  return lock;
}

static void LXRefreshNowPlayingLyricAnchor(void) {
  NSNumber *elapsed = [LXNowPlayingInfoCache[MPNowPlayingInfoPropertyElapsedPlaybackTime] isKindOfClass:[NSNumber class]]
    ? LXNowPlayingInfoCache[MPNowPlayingInfoPropertyElapsedPlaybackTime]
    : nil;
  if (elapsed == nil) return;
  // 带元数据发布链路解析出的快照戳回放锚点（无戳时退回旧行为）
  LXReanchorNowPlayingLyric(elapsed.doubleValue * 1000.0, LXNowPlayingElapsedSnapshotAtMs, 0);
}

// 以显式的引擎位置（ms）重锚歌词时钟（seek / state 事件携带的真实位置）。
// snapshotAtMs：快照的原生时钟戳（StreamingFlacPlayerModule.getPositionStamped
// 打点，经 JS 校准链路/元数据透传回传）；ageMs：快照墙钟年龄（AVPlayer 路径
// 无原生戳时的 JS Date.now 中点估计）。两者都有效时优先 snapshotAt（绝对单调
// 时间、零估计误差），把锚点系统时间回放到快照时刻——外推与真实播放位置对齐，
// 消除「快照位置被钉在现在」造成的歌词恒定滞后（灵动岛/控制中心慢半拍根因）。
static void LXReanchorNowPlayingLyric(double elapsedMs, double snapshotAtMs, double ageMs) {
  @synchronized (LXLyricLock()) {
    LXNowPlayingLyricAnchorElapsedMs = elapsedMs;
    double nowMs = CACurrentMediaTime() * 1000.0;
    double anchorSystemMs = nowMs;
    if (snapshotAtMs > 0) {
      // 钳制防未来值（快照时刻不可能晚于重锚时刻，防御桥序异常）
      anchorSystemMs = MIN(snapshotAtMs, nowMs);
    } else if (ageMs > 0) {
      // 年龄含完整桥接往返与主队列排队；超过 1s 视为异常（正常 <300ms）不补偿
      anchorSystemMs = nowMs - MIN(ageMs, 1000.0);
    }
    LXNowPlayingLyricAnchorSystemMs = anchorSystemMs;
  }
}

static void LXClearNowPlayingLyricLines(void) {
  @synchronized (LXLyricLock()) {
    LXNowPlayingLyricLines = nil;
    LXNowPlayingLyricIndex = -1;
    // 字段布局的还原值也要清：否则旧歌/旧行会继续留在卡片与车机上
    LXNowPlayingCurrentLyricLine = nil;
  }
}

static void LXNowPlayingLyricStep(void) {
  @synchronized (LXLyricLock()) {
    NSNumber *cachedRate = [LXNowPlayingInfoCache[MPNowPlayingInfoPropertyPlaybackRate] isKindOfClass:[NSNumber class]]
      ? LXNowPlayingInfoCache[MPNowPlayingInfoPropertyPlaybackRate]
      : nil;
    double rate = cachedRate.doubleValue;
    // 速率缓存为 0、但控制中心播放态是「播放中」：缓存被一次 pause 发布写成 0，
    // 而此前的逐行歌词元数据不带 playbackRate，缓存永远不会被恢复——此时若按
    // 「暂停」直接 return，歌词时钟会永久冻结在锚点行，表现为控制中心歌词不再
    // 实时同步。这里以播放态兜底恢复速率（LXDefaultNowPlayingRate 在 Playing 时
    // 返回 1、否则返回 0），并把恢复值写回缓存，避免系统也按 rate=0 停止外推。
    if (rate <= 0) {
      NSNumber *fallbackRate = LXDefaultNowPlayingRate();
      if (fallbackRate.doubleValue <= 0) return; // 真·暂停/停止：歌词不推进
      rate = fallbackRate.doubleValue;
      LXNowPlayingInfoCache[MPNowPlayingInfoPropertyPlaybackRate] = fallbackRate;
    }
    BOOL appActive = [UIApplication sharedApplication].applicationState == UIApplicationStateActive;

#if LX_LYRIC_DEBUG
    // 诊断模式：非前台时每 tick 把时钟状态写入卡片（普通链路停用）
    if (!appActive) {
      static NSInteger dbgTick = 0;
      dbgTick += 1;
      NSString *mark;
      if (LXNowPlayingLyricLines.count == 0) {
        mark = @"无时间轴";
      } else if (LXNowPlayingLyricAnchorSystemMs <= 0) {
        mark = @"无锚点";
      } else {
        double positionMs = LXNowPlayingClockHold
          ? LXNowPlayingLyricAnchorElapsedMs
          : LXNowPlayingLyricAnchorElapsedMs + ((CACurrentMediaTime() * 1000.0) - LXNowPlayingLyricAnchorSystemMs) * rate;
        NSUInteger lo = 0, hi = LXNowPlayingLyricLines.count - 1;
        NSInteger found = -1;
        while (lo <= hi) {
          NSUInteger mid = lo + (hi - lo) / 2;
          double lineTime = [LXNowPlayingLyricLines[mid][@"time"] doubleValue];
          if (lineTime <= positionMs) { found = (NSInteger)mid; lo = mid + 1; }
          else { if (mid == 0) break; hi = mid - 1; }
        }
        NSString *text = found >= 0 ? LXNowPlayingLyricLines[(NSUInteger)found][@"text"] : nil;
        mark = (text.length > 12 ? [text substringToIndex:12] : text) ?: @"无行";
        // 前缀带冻结标志与速率：区别「时钟被 hold 冻结」（冻:，文本不再前进但 D 计数
        // 前进）与「时钟行走但卡片不重绘」（走:，文本与 D 同停时=不重绘）。
        mark = [NSString stringWithFormat:@"%@R%.1f %@",
                LXNowPlayingClockHold ? @"冻:" : @"走:", rate, mark];
        }
        LXNowPlayingInfoCache[MPMediaItemPropertyArtist] = [NSString stringWithFormat:@"D%ld %@", (long)dbgTick, mark ?: @""];
      LXApplyNowPlayingInfo();
      return;
    }
#endif

    if (LXNowPlayingLyricAnchorSystemMs <= 0) return;
    // 时钟冻结（缓冲/暂停等非播放态，由 RNTP state 事件置位）：停在最后已知的
    // 引擎位置，不随墙钟外推——音频微缓冲走走停停时，外推持续超前正是
    // "同步一句停一会、隔几句又同步"的根因
    double positionMs = LXNowPlayingClockHold
      ? LXNowPlayingLyricAnchorElapsedMs
      : LXNowPlayingLyricAnchorElapsedMs + ((CACurrentMediaTime() * 1000.0) - LXNowPlayingLyricAnchorSystemMs) * rate;
    // 位置事件枢纽：前台播放时把外推位置广播给 JS（4Hz 单向事件），驱动进度条等
    // UI，替代 JS 侧每 250ms 两次桥接查询（getPosition + 引擎状态）。后台/熄屏
    // 不发（无 UI 需要更新）。
    if ([UIApplication sharedApplication].applicationState == UIApplicationStateActive) {
      [[NSNotificationCenter defaultCenter] postNotificationName:LXPlayerPositionNotificationName
                                                          object:nil
                                                          userInfo:@{ @"position": @(positionMs / 1000.0), @"rate": @(rate) }];
    }
    if (LXNowPlayingLyricLines.count == 0) return;
    // 二分查找当前行（lines 按 time 升序）
    NSUInteger lo = 0, hi = LXNowPlayingLyricLines.count - 1;
    NSInteger found = -1;
    while (lo <= hi) {
      NSUInteger mid = lo + (hi - lo) / 2;
      double lineTime = [LXNowPlayingLyricLines[mid][@"time"] doubleValue];
      if (lineTime <= positionMs) { found = (NSInteger)mid; lo = mid + 1; }
      else { if (mid == 0) break; hi = mid - 1; }
    }
    if (found < 0 || found == LXNowPlayingLyricIndex) return;
    NSString *text = LXNowPlayingLyricLines[(NSUInteger)found][@"text"];
    if (![text isKindOfClass:[NSString class]] || text.length == 0) return;
    LXNowPlayingLyricIndex = found;
    // 前台 JS 路径可能已把同行写入 artist：一致则静默跳过，避免重复发布
    NSString *currentArtist = [LXNowPlayingInfoCache[MPMediaItemPropertyArtist] isKindOfClass:[NSString class]]
      ? LXNowPlayingInfoCache[MPMediaItemPropertyArtist]
      : nil;
    if ([currentArtist isEqualToString:text]) return;
    // 重发前刷新系统进度基线：缓存里的 ElapsedPlaybackTime 是上次发布时的值，
    // 直接重发会把系统进度外推基线拉回旧值（每次换行进度条后跳、左侧时间倒退）。
    // 改写为当前外推位置（行变化只在播放中发生，positionMs 即「现在」的位置），
    // 并与快照戳成对更新为现在（歌词锚点重锚读同一缓存对，值/戳错配会推超前）
    LXNowPlayingInfoCache[MPNowPlayingInfoPropertyElapsedPlaybackTime] = @(positionMs / 1000.0);
    LXNowPlayingElapsedSnapshotAtMs = CACurrentMediaTime() * 1000.0;
    LXNowPlayingCurrentLyricLine = text;
    // 蓝牙（车机）模式下把当前行写进 title，其它场景仍写 artist —— 见文件前部字段布局注释
    LXApplyNowPlayingTitleArtistFields(LXNowPlayingInfoCache);
    // 热路径（每次换行）不得写 NSLog：NSLog 同步写 Apple System Log，锁屏后台期间
    // 每次换行都会唤醒 I/O，是后台耗电的可观来源之一。需要诊断时用
    // LX_LYRIC_DEBUG 分支（写卡片 artist）而非日志。
    LXApplyNowPlayingInfo();
    // 行变化后立即强制重绘媒体卡片：实测系统不会因为「重发 nowPlayingInfo」就实时
    // 刷新卡片——卡片冻结在上次重绘时的那一行（表现为控制中心歌词不实时同步），
    // 必须把 playbackState 切反再切回（等效用户手动暂停→播放）才触发整张卡片重绘。
    // 此前是「排两拍、由后续两个 tick 分步翻转」，单行最多额外滞后 500ms，且中途
    // 一直是假的「已暂停」态（进度条停走）；现在改为主队列上原子完成，只持续 60ms。
    LXForceNowPlayingCardRepaint();
  }
}

static void LXStartNowPlayingLyricTimer(void) {
  if (LXNowPlayingLyricTimer != nil) return;
  LXNowPlayingLyricQueue = dispatch_queue_create("com.lxmusic.nowplaying.lyric", DISPATCH_QUEUE_SERIAL);
  dispatch_source_t timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, LXNowPlayingLyricQueue);
  // 周期 0.12s：换行检测的最坏延迟从 250ms 降到 120ms（时钟只做一次二分查找，
  // 未换行时立即返回，开销可忽略）。控制中心歌词的「实时感」主要就取决于这一拍。
  dispatch_source_set_timer(timer,
                            dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.12 * NSEC_PER_SEC)),
                            (uint64_t)(0.12 * NSEC_PER_SEC),
                            (uint64_t)(0.03 * NSEC_PER_SEC));
  dispatch_source_set_event_handler(timer, ^{ LXNowPlayingLyricStep(); });
  dispatch_resume(timer);
  LXNowPlayingLyricTimer = timer;
}

// 停止歌词时钟（无歌词 / 停播 / 蓝牙歌词关闭时调用）。
// 为什么必须能停：该时钟是 8.3Hz（0.12s）的原生 GCD 定时器，设计上「不依赖主
// RunLoop」以便控制中心盖住 App 时仍刷新歌词——代价是**创建后永不停止**。此前
// 只在歌词非空时启动、从不停钟：切到一首无歌词的歌、停止播放、或清空时间轴后，
// 它仍会按 8.3Hz 永久唤醒 CPU（锁屏后台期间 CPU 本应深度睡眠），是「播放 1 小时
// 掉 10% 电」的主要后台耗电源之一。停钟后 dispatch_source_cancel 释放内核定时器，
// 再次 setNowPlayingLyrics 非空时会经 LXStartNowPlayingLyricTimer 重建。
static void LXStopNowPlayingLyricTimer(void) {
  if (LXNowPlayingLyricTimer == nil) return;
  dispatch_source_cancel(LXNowPlayingLyricTimer);
  LXNowPlayingLyricTimer = nil;
  LXNowPlayingLyricQueue = nil;
}

// 读取主屏亮度；读不到返回 -1（未知）。UIScreen.brightness 取值 0.0~1.0，
// **0.0 就是「最低亮度」**（Apple 文档原话），所以 0 既可能是熄屏、也可能是屏幕亮着但被调到最低。
static CGFloat LXReadScreenBrightness(void) {
  UIScreen *screen = nil;
  if (@available(iOS 13.0, *)) {
    for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
      if (![scene isKindOfClass:[UIWindowScene class]]) continue;
      screen = ((UIWindowScene *)scene).screen;
      if (screen != nil) break;
    }
  }
  if (screen == nil) return -1;
  return screen.brightness;
}

// 「刚才还明显亮」的亮度阈值：只有从明显亮直接掉到 0，才敢认定屏幕熄灭。
// 低于该值（最低亮度 / 暗环境自动亮度 / 渐暗到 0）一律按「屏幕仍亮」处理 ——
// 用户实机反馈：亮度调到最低看锁屏卡片时，歌词曾被冻住（误判成熄屏），这里从根上避免。
static const CGFloat LXScreenOffTrustBrightness = 0.3;

// 最近一次观测到的非零亮度（-1 = 未知）：只在读到 > 0 时更新，0 不覆盖它。
static CGFloat LXLastNonZeroBrightness = -1;

// 记录「屏幕确实亮着」时的亮度证据（只要读到非零就记）。
static void LXRememberScreenBrightness(void) {
  CGFloat brightness = LXReadScreenBrightness();
  if (brightness > 0) LXLastNonZeroBrightness = brightness;
}

// 屏幕是否点亮（所有不确定情形一律判「亮」——宁可不省电，也绝不让可见的歌词冻结）：
//   · App 前台 / 读到亮度 > 0            → 一定亮；
//   · 读不到亮度（无场景/异常）           → 按亮处理；
//   · 亮度 == 0：仅当「刚才明显亮过（>= 0.3）」才认定熄灭；
//     最低亮度、暗环境自动亮度、渐暗到 0、从未观测到非零亮度 → 全部按亮处理。
static BOOL LXScreenIsOn(void) {
  if ([UIApplication sharedApplication].applicationState == UIApplicationStateActive) return YES;
  CGFloat brightness = LXReadScreenBrightness();
  if (brightness < 0) return YES;
  if (brightness > 0) return YES;
  return LXLastNonZeroBrightness < LXScreenOffTrustBrightness;
}

// 当前输出路由是否蓝牙：只有蓝牙输出才可能把 now playing 元数据（含歌词行）送到车机屏幕；
// 耳机（有线）/ 外放都不存在「别处正在显示我们的歌词」这回事。
static BOOL LXHasBluetoothAudioRoute(void) {
  for (AVAudioSessionPortDescription *output in [AVAudioSession sharedInstance].currentRoute.outputs) {
    NSString *portType = output.portType;
    if ([portType isEqualToString:AVAudioSessionPortBluetoothA2DP] ||
        [portType isEqualToString:AVAudioSessionPortBluetoothHFP] ||
        [portType isEqualToString:AVAudioSessionPortBluetoothLE]) {
      return YES;
    }
  }
  return NO;
}

// 8.3Hz（0.12s）时钟的可见性门控 —— **不降频**：用户明确要求歌词不能有延迟，所以只要
// 可能被人看到，就必须维持 0.12s 原速（改 0.3~0.5s 的方案已否决）。
// 「屏幕点亮」判定见 LXScreenIsOn：亮度 0 时只有「刚才明显亮过（>= 0.3）」才算熄屏，
// 最低亮度 / 暗环境自动亮度一律按亮处理（用户实机反馈的最低亮度冻歌词问题）。
// 只在「任何地方都不可能看到歌词」时停钟：
//   ① App 前台：歌词页/进度条需要 4Hz 位置事件 → 必须跑；
//   ② 屏幕点亮：锁屏卡片 / 控制中心可能正被看着 → 必须跑；
//   ③ 熄屏 + 非前台 + 歌词时间轴非空 + 蓝牙输出：车机屏幕可能正在滚动歌词
//      （「蓝牙歌词」把行写进 artist，再由系统送到车机）→ 必须跑。
// 其余情况（熄屏、非前台、没有蓝牙歌词可送）时停钟省电；亮屏/回前台/路由变化时由
// LXUpdateNowPlayingLyricTimerVisibility() 重建。
static BOOL LXShouldRunNowPlayingLyricTimer(void) {
  if (LXNowPlayingState != MPNowPlayingPlaybackStatePlaying) return NO;
  if ([UIApplication sharedApplication].applicationState == UIApplicationStateActive) return YES;
  if (LXScreenIsOn()) return YES;
  BOOL hasLyricLines = NO;
  @synchronized (LXLyricLock()) {
    hasLyricLines = LXNowPlayingLyricLines.count > 0;
  }
  return hasLyricLines && LXHasBluetoothAudioRoute();
}

// 屏幕/路由/前台状态变化后的统一入口：由暗转亮时先把当前行补上并重绘一次，再同步时钟，
// 保证「亮起来的第一眼就是正确行」（不做任何降频，因此不存在延迟问题）。
static void LXUpdateNowPlayingLyricTimerVisibility(void) {
  static BOOL lastScreenOn = YES;
  BOOL screenOn = LXScreenIsOn();
  BOOL becameVisible = screenOn && !lastScreenOn;
  lastScreenOn = screenOn;

  if (becameVisible && LXNowPlayingState == MPNowPlayingPlaybackStatePlaying) {
    // 熄屏期间时钟可能已停：手动走一拍把行推进到当前时刻，再补一次卡片重绘
    LXNowPlayingLyricStep();
    LXQueueNowPlayingLyricRedraw();
  }
  LXSyncNowPlayingLyricTimer();
}

// 时钟生命周期守卫：只在「正在播放且歌词可能被看到」时才让 8.3Hz 时钟运行。
// 暂停 / 停止 / 空闲时停钟——这些状态下 tick 里 rate ≤ 0 会立刻早退（不做任何事），
// 但 8.3Hz 的唤醒本身仍在阻止 CPU 深度睡眠，是锁屏后台的净耗电。播放态恢复时
// （LXNowPlayingState 由 JS 的 play 发布置为 Playing，或元数据发布触发同步）重建。
// 注意：时钟同时承担「前台 4Hz 位置事件 → JS 进度条」的枢纽职责，故前台播放时
// 必须运行（不能只在有歌词时运行，否则无歌词的歌在前台进度条失去平滑驱动，
// 退化为 1s 慢校准的跳变）。可见性判定见 LXShouldRunNowPlayingLyricTimer。
static void LXSyncNowPlayingLyricTimer(void) {
  if (LXShouldRunNowPlayingLyricTimer()) {
    LXStartNowPlayingLyricTimer();
  } else {
    LXStopNowPlayingLyricTimer();
  }
}

// 歌词时间轴变化（新歌加载 / 换行集）：整组替换并重置行游标
static void LXSetNowPlayingLyricLines(NSArray<NSDictionary *> *lines) {
  NSMutableArray<NSDictionary<NSString *, id> *> *merged = [NSMutableArray array];
  for (NSDictionary *item in lines) {
    NSNumber *time = [item[@"time"] isKindOfClass:[NSNumber class]] ? item[@"time"] : nil;
    NSString *text = [item[@"text"] isKindOfClass:[NSString class]] ? item[@"text"] : nil;
    if (time == nil || time.doubleValue < 0 || text.length == 0) continue;
    [merged addObject:@{ @"time": time, @"text": text }];
  }
  @synchronized (LXLyricLock()) {
    LXNowPlayingLyricLines = merged.count ? merged : nil;
    LXNowPlayingLyricIndex = -1;
  }
  // 时钟生命周期交给统一守卫：仅播放中运行时（暂停/停止即停钟，避免 8.3Hz 净唤醒）。
  // 无歌词不影响时钟——时钟还承担前台 4Hz 位置事件（驱动 JS 进度条）。
  LXSyncNowPlayingLyricTimer();
}

// App 转入 inactive（下拉控制中心 / 通知中心 / 锁屏）时补一次强制重绘：
// 媒体卡片在下拉瞬间只渲染一次快照（下拉前已提交的行），若不在打开时补一次
// 重绘，用户第一眼看到的歌词停留在下拉前，直到下一个换行点才前进。
// 由 AppDelegate 的 UIApplicationWillResignActiveNotification 观察者调用。
static void LXQueueNowPlayingLyricRedraw(void) {
  @synchronized (LXLyricLock()) {
    if (LXNowPlayingLyricLines.count == 0) return;
  }
  LXForceNowPlayingCardRepaint();
}

// 强制控制中心 / 锁屏重绘媒体卡片（歌词换行时调用）。
//
// 为什么必须做：实测 iOS 上「只重发 nowPlayingInfo」并不会让控制中心/锁屏刷新
// 媒体卡片——卡片冻结在上次重绘时的那一行，每次重新下拉才前进一行，表现为
// 控制中心歌词不实时同步；只有把 playbackState 切到相反值再切回（等效用户
// 手动暂停→播放）才会触发整张卡片重绘。本项目封面链路用的也是同一招。
//
// 与旧实现（tick 里置 2、由后续两个 tick 分步切反/切回）的区别：
// 1) 旧实现一次重绘要跨 2 拍（0.5s），换行密集时还会被下一次换行反复推迟，
//    卡片会长时间停在假的「已暂停」态（进度条停走、锁屏卡片可能被折叠）；
//    这里改为主队列原子完成：立即切反，60ms 后切回并重发信息。
// 2) 旧实现没有单飞保护，换行密集时会叠加多次翻转。这里 inFlight/Queued
//    两级保护：执行中收到新请求只记一个待办，完成后再补一次（不丢换行）。
static void LXPerformNowPlayingCardRepaintFlip(void) {
  if (![NSThread isMainThread]) {
    dispatch_async(dispatch_get_main_queue(), ^{ LXPerformNowPlayingCardRepaintFlip(); });
    return;
  }
  // 部署目标 iOS 14.0，MPNowPlayingInfoCenter.playbackState 恒可用，无需 @available 守卫
  // 与歌词时钟（专用串行队列）共享同一把锁读缓存：时钟线程可能在写
  BOOL hasInfo = NO;
  @synchronized (LXLyricLock()) {
    hasInfo = LXNowPlayingInfoCache.count > 0;
  }
  if (!hasInfo) return;
  if (LXNowPlayingCardRepaintInFlight) {
    LXNowPlayingCardRepaintQueued = YES;
    return;
  }
  LXNowPlayingCardRepaintInFlight = YES;
  MPNowPlayingInfoCenter *center = [MPNowPlayingInfoCenter defaultCenter];
  MPNowPlayingPlaybackState current = LXNowPlayingState;
  MPNowPlayingPlaybackState opposite = (current == MPNowPlayingPlaybackStatePlaying)
    ? MPNowPlayingPlaybackStatePaused
    : MPNowPlayingPlaybackStatePlaying;
  LXNowPlayingCardRepaintFlipGeneration += 1;
  NSUInteger generation = LXNowPlayingCardRepaintFlipGeneration;
  LXNowPlayingCardRepaintFlipRestoreState = current;
  LXNowPlayingCardRepaintFlipUntilMs = CACurrentMediaTime() * 1000.0 + LXNowPlayingCardRepaintFlipMs;
  center.playbackState = opposite;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(LXNowPlayingCardRepaintFlipMs * NSEC_PER_MSEC)), dispatch_get_main_queue(), ^{
    if (generation != LXNowPlayingCardRepaintFlipGeneration) return; // 已被提前结束，还原交给 LXEndNowPlayingCardRepaintFlipEarly
    center.playbackState = current;
    LXNowPlayingCardRepaintFlipUntilMs = 0;
    LXApplyNowPlayingInfo();
    LXNowPlayingCardRepaintInFlight = NO;
    if (LXNowPlayingCardRepaintQueued) {
      LXNowPlayingCardRepaintQueued = NO;
      LXForceNowPlayingCardRepaint();
    }
  });
}

// 命令落在翻转的假状态窗口内时提前结束翻转：图标立刻恢复真实播放态（后续按压不再基于假图标）；
// 待执行的还原块由代际守卫作废。
static void LXEndNowPlayingCardRepaintFlipEarly(void) {
  // 与 LXApplyNowPlayingInfo 同理：MediaPlayer 的写入必须在主线程（遥控命令处理器在系统实现上
  // 通常已是主线程，这里把约束写死，避免将来换调用点时这次「还原」被静默忽略、卡片留在假状态）。
  if (![NSThread isMainThread]) {
    dispatch_async(dispatch_get_main_queue(), ^{ LXEndNowPlayingCardRepaintFlipEarly(); });
    return;
  }
  if (LXNowPlayingCardRepaintFlipUntilMs <= 0) return;
  LXNowPlayingCardRepaintFlipGeneration += 1;
  [MPNowPlayingInfoCenter defaultCenter].playbackState = LXNowPlayingCardRepaintFlipRestoreState;
  LXNowPlayingCardRepaintFlipUntilMs = 0;
  LXNowPlayingCardRepaintInFlight = NO;
  if (LXNowPlayingCardRepaintQueued) {
    LXNowPlayingCardRepaintQueued = NO;
    LXForceNowPlayingCardRepaint();
  }
}

// 命令处理完之后的「补绘」：把因静默窗口被推迟的卡片刷新在几百毫秒内补上。
// 为什么必须补：卡片（按钮图标 + 歌词）只认「playbackState 切反再切回」这条刷新链路；
// 若因为「用户刚按过」而不刷，这次状态变化要等下一次歌词换行才可见 —— 按钮图标停在
// 旧的播放态，用户再按时系统发的还是同一个方向（对已满足的方向是空操作），表现就是
// 「按一下没反应、要按两下」（用户 2026-10-03 实锤：正常播放时控制中心/灵动岛按钮）。
//
// 可见性判定：**不能**用 applicationState 当「卡片是否可见」的代理。旧实现在排期处与
// 触发处各加了一道 `applicationState == Active 就 return`，而 applicationState 只有「前台 / 非活跃 /
// 后台」三态，媒体卡片却在这三态下都可能摆在用户眼前：
//   · 灵动岛：展开/点按是系统覆盖层，App 全程停在 Active —— 这道门 100% 拦死补绘，
//     表现为「前台点灵动岛按钮，音乐会切但图标不动，再按还是同一个方向」。
//   · 控制中心：按完 500ms 落点时用户往往已经收起面板、App 回到 Active —— 同样拦死。
//   · 锁屏 / 后台：本来就是非 Active，这道门从来没起过作用（纯负担）。
// 于是「用户刚按过之后的这 1.2s 静默窗口」把所有重绘都汇进本函数、本函数又把它们
// 全部丢弃 —— 前台按控制中心/灵动岛后卡片必然冻住，直到下一次歌词换行才恢复
// （无歌词 / 稀疏歌的歌尤其明显）。现在不再按 App 状态拦：真正的「没人看」由
// LXPerformNowPlayingCardRepaintFlip 里的 hasInfo（没有 nowPlayingInfo 就没有卡片）兜底，而一次翻转只是两次
// playbackState 赋值、间隔 60ms、且被下面的单飞 + 顺延限流，代价可忽略。
// 保留的约束：单飞 + 顺延 —— 补绘前若又有新命令（间隔 < LXNowPlayingCommandSafetyGapMs）
// 就推迟，绝不在用户连按的当拍翻转。
static void LXScheduleDeferredNowPlayingCardRepaint(void) {
  static BOOL scheduled = NO;
  if (scheduled) return;

  scheduled = YES;
  double nowMs = CACurrentMediaTime() * 1000.0;
  double sinceCommandMs = LXNowPlayingLastRemoteCommandAtMs > 0
    ? nowMs - LXNowPlayingLastRemoteCommandAtMs
    : LXNowPlayingCommandSettleDelayMs;
  // 补绘必须等满「命令后静默窗」：500ms 正是用户二次按压的自然间隔，太早翻转会让这次按压
  // 落在假状态窗口里（见 LXEndNowPlayingCardRepaintFlipEarly 注释），因此取两者较大值。
  double targetDelayMs = MAX(LXNowPlayingCommandSettleDelayMs, LXNowPlayingRepaintQuietWindowMs);
  double waitMs = sinceCommandMs >= targetDelayMs
    ? 0.0
    : targetDelayMs - sinceCommandMs;

  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(waitMs * NSEC_PER_MSEC)), dispatch_get_main_queue(), ^{
    scheduled = NO;
    // 等待期间又来了新命令：顺延（用户还在按，先把按键语义保住）
    if (LXNowPlayingLastRemoteCommandAtMs > 0 &&
        CACurrentMediaTime() * 1000.0 - LXNowPlayingLastRemoteCommandAtMs < LXNowPlayingCommandSafetyGapMs) {
      LXScheduleDeferredNowPlayingCardRepaint();
      return;
    }
    // 不再按 applicationState 兜底：灵动岛 / 前台控制中心下卡片同样可见，按前台丢弃本身就是本事故正体。
    LXPerformNowPlayingCardRepaintFlip();
  });
}

// 外部统一入口：安静窗口内不立刻翻转（会吞掉手指底下的按压），改为安排一次延迟补绘。
static void LXForceNowPlayingCardRepaint(void) {
  if (![NSThread isMainThread]) {
    dispatch_async(dispatch_get_main_queue(), ^{ LXForceNowPlayingCardRepaint(); });
    return;
  }
  if (LXNowPlayingLastRemoteCommandAtMs > 0 &&
      CACurrentMediaTime() * 1000.0 - LXNowPlayingLastRemoteCommandAtMs < LXNowPlayingRepaintQuietWindowMs) {
    // 用户刚按过：不在按压当拍翻转，改为延迟补绘（见 LXScheduleDeferredNowPlayingCardRepaint）
    LXScheduleDeferredNowPlayingCardRepaint();
    return;
  }
  LXPerformNowPlayingCardRepaintFlip();
}

static UIViewController *LXTopViewController(void) {
  UIWindow *window = nil;
  if (@available(iOS 13.0, *)) {
    for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
      if (![scene isKindOfClass:[UIWindowScene class]]) continue;
      UIWindowScene *windowScene = (UIWindowScene *)scene;
      for (UIWindow *sceneWindow in windowScene.windows) {
        if (sceneWindow.isKeyWindow) {
          window = sceneWindow;
          break;
        }
      }
      if (window != nil) break;
    }
  }
  if (window == nil) {
    for (UIWindow *appWindow in UIApplication.sharedApplication.windows) {
      if (appWindow.isKeyWindow) {
        window = appWindow;
        break;
      }
    }
  }
  if (window == nil) window = UIApplication.sharedApplication.windows.firstObject;

  UIViewController *controller = window.rootViewController;
  if (controller == nil) return nil;
  while (controller.presentedViewController != nil) controller = controller.presentedViewController;
  return controller;
}

// 检测是否仍有 React Native 的 Modal 独立 window 残留（部分 RN 版本把 Modal 渲染在独立 UIWindow 上，
// 其 rootViewController 为 RCTModalHostViewController）。在原生文件选择器 present 之前需要等它彻底消失，
// 否则 picker 会被遮挡或 present 到正在释放的 VC 上，表现为“点了没反应”。
static BOOL LXAnotherRNModalWindowPresent(void) {
  for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
    if (![scene isKindOfClass:[UIWindowScene class]]) continue;
    UIWindowScene *windowScene = (UIWindowScene *)scene;
    for (UIWindow *win in windowScene.windows) {
      if (win.rootViewController != nil &&
          [NSStringFromClass([win.rootViewController class]) isEqualToString:@"RCTModalHostViewController"]) {
        return YES;
      }
    }
  }
  return NO;
}

// UIDocumentPickerViewController 以独立进程运行。选中/取消并关闭后，应用主窗口可能
// 不再是 keyWindow，或其 userInteractionEnabled 未被系统恢复，导致整屏无响应（只能重启）。
// 在关闭完成后显式恢复主窗口为 key 并重新开启交互。
// 注意：此处仅作为兜底。真正的修复是 JS 侧在调起原生面板前先完整卸载底层 RN Modal
// （见 UserApiEditModal），使原生面板不会覆盖在仍存在的 RN Modal 之上。
//
// Toast 等 RNN 浮层是独立 UIWindow（RNNOverlayManager 用 RNNOverlayWindow，
// windowLevel = UIWindowLevelNormal），与主窗口同级；主窗口一旦 makeKeyAndVisible、
// 或出现后建的原生面板窗口，浮层就会被压到下面。界面上表现为「点了下载没有任何提示」
// （浮层其实已创建，只是看不见）。JS 侧每次弹 Toast 后调 raiseOverlayWindows 把它
// 统一提到 UIWindowLevelAlert 之上——按 level 排序后不再受主窗口 makeKey 影响。
static BOOL LXIsRNNOverlayWindow(UIWindow *window) {
  return [NSStringFromClass(window.class) isEqualToString:@"RNNOverlayWindow"];
}

static void LXRaiseOverlayWindows(void) {
  for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
    if (![scene isKindOfClass:[UIWindowScene class]]) continue;
    for (UIWindow *window in ((UIWindowScene *)scene).windows) {
      if (LXIsRNNOverlayWindow(window)) window.windowLevel = UIWindowLevelAlert + 1;
    }
  }
}

static void LXEnsureKeyWindow(void) {
  dispatch_async(dispatch_get_main_queue(), ^{
    UIWindow *mainWindow = nil;
    for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
      if (![scene isKindOfClass:[UIWindowScene class]]) continue;
      UIWindowScene *windowScene = (UIWindowScene *)scene;
      for (UIWindow *win in windowScene.windows) {
        // 对所有窗口恢复交互，避免某个窗口的交互被系统遗留为关闭状态。
        win.userInteractionEnabled = YES;
        if (win.rootViewController != nil && win.rootViewController.view != nil) {
          win.rootViewController.view.userInteractionEnabled = YES;
        }
        // 记录首个带 rootViewController 的窗口作为主窗口候选（跳过 RNN 浮层窗口：
        // 也是 level Normal 的独立窗口，若被选成「主窗口」并 makeKey，主窗口反倒不在
        // 顶层——背景捕获 / LXTopViewController 的关键窗口判定都会取错窗口）。
        if (mainWindow == nil && !LXIsRNNOverlayWindow(win)) mainWindow = win;
      }
    }
    // 仅当主窗口当前不是 keyWindow 时才切换，避免不必要的 window 层级抖动。
    if (mainWindow != nil && !mainWindow.isKeyWindow) {
      [mainWindow makeKeyAndVisible];
    }
  });
}

static NSDictionary *LXFileInfoFromPath(NSString *path) {
  NSFileManager *fileManager = [NSFileManager defaultManager];
  BOOL isDirectory = NO;
  [fileManager fileExistsAtPath:path isDirectory:&isDirectory];
  NSDictionary *attributes = [fileManager attributesOfItemAtPath:path error:nil] ?: @{};
  NSDate *modifiedDate = attributes[NSFileModificationDate] ?: [NSDate date];
  NSString *name = path.lastPathComponent ?: @"";
  return @{
    @"name": name,
    @"path": path ?: @"",
    @"size": attributes[NSFileSize] ?: @0,
    @"isDirectory": @(isDirectory),
    @"isFile": @(!isDirectory),
    @"lastModified": @((long long)(modifiedDate.timeIntervalSince1970 * 1000)),
    @"mimeType": [NSNull null],
    @"canRead": @([fileManager isReadableFileAtPath:path ?: @""]),
  };
}

static NSString *LXPrepareImportedFilePath(NSString *targetPath, NSURL *sourceURL, NSError **error) {
  NSFileManager *fileManager = [NSFileManager defaultManager];
  NSString *basePath = targetPath.length ? targetPath : NSTemporaryDirectory();
  BOOL isDirectory = NO;
  BOOL exists = [fileManager fileExistsAtPath:basePath isDirectory:&isDirectory];

  if (!exists || isDirectory || basePath.pathExtension.length == 0) {
    if (![fileManager fileExistsAtPath:basePath]) {
      if (![fileManager createDirectoryAtPath:basePath withIntermediateDirectories:YES attributes:nil error:error]) return nil;
    }
    NSString *fileName = sourceURL.lastPathComponent.length ? sourceURL.lastPathComponent : [NSString stringWithFormat:@"%@.tmp", NSUUID.UUID.UUIDString];
    return [basePath stringByAppendingPathComponent:fileName];
  }

  NSString *parentPath = [basePath stringByDeletingLastPathComponent];
  if (parentPath.length && ![fileManager fileExistsAtPath:parentPath]) {
    if (![fileManager createDirectoryAtPath:parentPath withIntermediateDirectories:YES attributes:nil error:error]) return nil;
  }
  return basePath;
}

static NSArray<NSString *> *LXDocumentTypesForExtensions(id extTypes) {
  if (![extTypes isKindOfClass:[NSArray class]]) return @[ @"public.data", @"public.item" ];

  NSMutableOrderedSet<NSString *> *types = [NSMutableOrderedSet orderedSet];
  BOOL needsGenericDataType = NO;
  for (id item in (NSArray *)extTypes) {
    if (![item isKindOfClass:[NSString class]]) continue;
    NSString *ext = ((NSString *)item).lowercaseString;
    if (!ext.length) continue;

    if ([ext isEqualToString:@"js"]) {
      [types addObject:@"public.javascript"];
      [types addObject:@"public.source-code"];
      [types addObject:@"com.netscape.javascript-source"];
      [types addObject:@"public.text"];
      [types addObject:@"public.data"];
      continue;
    }
    if ([ext isEqualToString:@"json"]) {
      [types addObject:@"public.json"];
      continue;
    }
    if ([ext isEqualToString:@"lxmc"]) {
      needsGenericDataType = YES;
      continue;
    }
    if ([ext isEqualToString:@"bin"]) {
      needsGenericDataType = YES;
      continue;
    }
    if ([ext isEqualToString:@"jpg"] || [ext isEqualToString:@"jpeg"]) {
      [types addObject:@"public.jpeg"];
      continue;
    }
    if ([ext isEqualToString:@"png"]) {
      [types addObject:@"public.png"];
      continue;
    }
    if ([ext isEqualToString:@"gif"]) {
      [types addObject:@"com.compuserve.gif"];
      continue;
    }
    if ([ext isEqualToString:@"txt"] || [ext isEqualToString:@"lrc"]) {
      [types addObject:@"public.plain-text"];
      continue;
    }
    if ([ext isEqualToString:@"mp3"]) {
      [types addObject:@"public.mp3"];
      continue;
    }
    if ([ext isEqualToString:@"m4a"] || [ext isEqualToString:@"aac"]) {
      [types addObject:@"public.audio"];
      continue;
    }
    if ([ext isEqualToString:@"wav"]) {
      [types addObject:@"com.microsoft.waveform-audio"];
      continue;
    }
    if ([ext isEqualToString:@"flac"] || [ext isEqualToString:@"ogg"]) {
      [types addObject:@"public.audio"];
      continue;
    }

    needsGenericDataType = YES;
  }

  if (needsGenericDataType) {
    [types addObject:@"public.data"];
    [types addObject:@"public.item"];
  }

  return types.count ? types.array : @[ @"public.data", @"public.item" ];
}

static NSString * const LXSoundEffectConfigDidChangeNotification = @"LXSoundEffectConfigDidChangeNotification";

static NSArray<NSNumber *> *LXSoundEffectEqualizerFrequencies(void) {
  static NSArray<NSNumber *> *frequencies = nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    frequencies = @[ @31, @62, @125, @250, @500, @1000, @2000, @4000, @8000, @16000 ];
  });
  return frequencies;
}

static NSArray<NSNumber *> *LXSoundEffectDefaultEqualizerGains(void) {
  static NSArray<NSNumber *> *gains = nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    gains = @[ @0, @0, @0, @0, @0, @0, @0, @0, @0, @0 ];
  });
  return gains;
}

static BOOL LXSoundEffectEqualizerEnabled = NO;
static NSArray<NSNumber *> *LXSoundEffectEqualizerGains = nil;
static NSString *LXSoundEffectConvolutionFileName = @"";
static NSString *LXSoundEffectConvolutionAssetUri = @"";
static float LXSoundEffectConvolutionMainGain = 10.0f;
static float LXSoundEffectConvolutionSendGain = 0.0f;
static BOOL LXSoundEffectPannerEnabled = NO;
static float LXSoundEffectPannerSoundR = 5.0f;
static float LXSoundEffectPannerSpeed = 25.0f;
static float LXSoundEffectPitchShifterPlaybackRate = 1.0f;

static float LXSoundEffectClampFloatValue(id value, float defaultValue, float minValue, float maxValue) {
  float result = [value respondsToSelector:@selector(floatValue)] ? [value floatValue] : defaultValue;
  if (result < minValue) return minValue;
  if (result > maxValue) return maxValue;
  return result;
}

static uint16_t LXReadLE16(const uint8_t *bytes) {
  return (uint16_t)bytes[0] | ((uint16_t)bytes[1] << 8);
}

static uint32_t LXReadLE32(const uint8_t *bytes) {
  return (uint32_t)bytes[0] |
    ((uint32_t)bytes[1] << 8) |
    ((uint32_t)bytes[2] << 16) |
    ((uint32_t)bytes[3] << 24);
}

static NSURL *LXSoundEffectResolveAssetURL(NSString *assetUri, NSString *fileName) {
  if ([assetUri isKindOfClass:[NSString class]] && assetUri.length) {
    NSURL *url = [NSURL URLWithString:assetUri];
    if (url != nil && url.scheme.length) return url;
    if ([assetUri hasPrefix:@"/"]) return [NSURL fileURLWithPath:assetUri];
  }

  if (![fileName isKindOfClass:[NSString class]] || !fileName.length) return nil;
  NSString *resource = [fileName stringByDeletingPathExtension];
  NSString *ext = [fileName pathExtension];
  return [NSBundle.mainBundle URLForResource:resource withExtension:ext.length ? ext : nil];
}

struct LXImpulseResponseData {
  double sampleRate = 0;
  std::vector<std::vector<float>> channels;
};

static std::vector<float> LXResampleLinear(const std::vector<float> &input, double inputSampleRate, double outputSampleRate) {
  if (input.empty() || inputSampleRate <= 0 || outputSampleRate <= 0 || fabs(inputSampleRate - outputSampleRate) <= 0.5) return input;

  double ratio = outputSampleRate / inputSampleRate;
  size_t outputLength = std::max<size_t>(1, (size_t)llround((double)input.size() * ratio));
  if (outputLength == input.size()) return input;

  std::vector<float> output(outputLength, 0);
  size_t maxIndex = input.size() - 1;
  for (size_t index = 0; index < outputLength; index++) {
    double position = (double)index / ratio;
    size_t lower = std::min<size_t>((size_t)floor(position), maxIndex);
    size_t upper = std::min<size_t>(lower + 1, maxIndex);
    float fraction = (float)(position - (double)lower);
    output[index] = lower == upper
      ? input[lower]
      : input[lower] * (1.0f - fraction) + input[upper] * fraction;
  }
  return output;
}

static float LXCalculateImpulseNormalizationScale(const std::vector<std::vector<float>> &channels, double sampleRate) {
  const float gainCalibration = 0.00125f;
  const float gainCalibrationSampleRate = 44100.0f;
  const float minPower = 0.000125f;
  if (channels.empty()) return 1.0f;

  size_t channelCount = channels.size();
  size_t length = 0;
  for (const auto &channel : channels) {
    length = std::max(length, channel.size());
  }
  if (!length) return 1.0f;

  double power = 0;
  for (const auto &channel : channels) {
    for (float sample : channel) power += sample * sample;
  }
  power = sqrt(power / (double)(channelCount * length));
  if (!isfinite(power) || power < minPower) power = minPower;

  float scale = (float)((1.0 / power) * gainCalibration);
  scale *= gainCalibrationSampleRate / (float)sampleRate;
  if (channelCount == 4) scale *= 0.5f;
  return scale;
}

static LXImpulseResponseData LXLoadImpulseResponse(NSURL *url, double targetSampleRate) {
  LXImpulseResponseData result;
  if (url == nil) return result;

  NSData *data = [NSData dataWithContentsOfURL:url];
  if (data.length < 44) return result;

  const uint8_t *bytes = (const uint8_t *)data.bytes;
  if (memcmp(bytes, "RIFF", 4) != 0 || memcmp(bytes + 8, "WAVE", 4) != 0) return result;

  uint16_t audioFormat = 0;
  uint16_t channelCount = 0;
  uint32_t sampleRate = 0;
  uint16_t bitsPerSample = 0;
  const uint8_t *pcmData = NULL;
  uint32_t pcmDataSize = 0;

  NSUInteger offset = 12;
  while (offset + 8 <= data.length) {
    const uint8_t *chunk = bytes + offset;
    uint32_t chunkSize = LXReadLE32(chunk + 4);
    NSUInteger nextOffset = offset + 8 + chunkSize + (chunkSize & 1u);
    if (nextOffset > data.length) break;

    if (memcmp(chunk, "fmt ", 4) == 0 && chunkSize >= 16) {
      audioFormat = LXReadLE16(chunk + 8);
      channelCount = LXReadLE16(chunk + 10);
      sampleRate = LXReadLE32(chunk + 12);
      bitsPerSample = LXReadLE16(chunk + 22);
    } else if (memcmp(chunk, "data", 4) == 0) {
      pcmData = chunk + 8;
      pcmDataSize = chunkSize;
    }
    offset = nextOffset;
  }

  if (audioFormat != 1 || channelCount == 0 || sampleRate == 0 || bitsPerSample != 16 || pcmData == NULL || pcmDataSize == 0) {
    return result;
  }

  size_t frameCount = pcmDataSize / (channelCount * sizeof(int16_t));
  if (!frameCount) return result;

  result.sampleRate = (double)sampleRate;
  result.channels.assign(channelCount, std::vector<float>(frameCount, 0));
  const int16_t *samples = (const int16_t *)pcmData;
  const float scale = (float)INT16_MAX;
  for (size_t frame = 0; frame < frameCount; frame++) {
    for (uint16_t channel = 0; channel < channelCount; channel++) {
      result.channels[channel][frame] = (float)samples[frame * channelCount + channel] / scale;
    }
  }

  if (fabs(result.sampleRate - targetSampleRate) > 0.5) {
    for (auto &channel : result.channels) channel = LXResampleLinear(channel, result.sampleRate, targetSampleRate);
    result.sampleRate = targetSampleRate;
  }

  float normalizationScale = LXCalculateImpulseNormalizationScale(result.channels, result.sampleRate);
  if (normalizationScale != 1.0f) {
    for (auto &channel : result.channels) {
      for (float &sample : channel) sample *= normalizationScale;
    }
  }

  return result;
}

class LXStreamingPlanarPCMBuffer {
public:
  void reset(size_t channelCount, size_t frameCapacity) {
    channelCount_ = std::max<size_t>(1, channelCount);
    frameCapacity_ = std::max<size_t>(1, frameCapacity);
    channels_.assign(channelCount_, std::vector<float>(frameCapacity_, 0));
    readCursor_.store(0, std::memory_order_release);
    writeCursor_.store(0, std::memory_order_release);
  }

  size_t availableToRead() const {
    uint64_t writeCursor = writeCursor_.load(std::memory_order_acquire);
    uint64_t readCursor = readCursor_.load(std::memory_order_acquire);
    return (size_t)std::min<uint64_t>(writeCursor - readCursor, frameCapacity_);
  }

  size_t availableToWrite() const {
    return frameCapacity_ - availableToRead();
  }

  void clear() {
    uint64_t writeCursor = writeCursor_.load(std::memory_order_acquire);
    readCursor_.store(writeCursor, std::memory_order_release);
  }

  size_t write(float *const *inputChannels, size_t frameCount, size_t activeChannels) {
    if (channels_.empty() || frameCount == 0) return 0;

    uint64_t writeCursor = writeCursor_.load(std::memory_order_relaxed);
    uint64_t readCursor = readCursor_.load(std::memory_order_acquire);
    size_t writableFrames = (size_t)std::min<uint64_t>(frameCount, frameCapacity_ - std::min<uint64_t>(writeCursor - readCursor, frameCapacity_));
    if (!writableFrames) return 0;

    size_t activeCount = std::min(activeChannels, channelCount_);
    size_t startIndex = (size_t)(writeCursor % frameCapacity_);
    size_t firstPart = std::min(writableFrames, frameCapacity_ - startIndex);
    size_t secondPart = writableFrames - firstPart;

    for (size_t channel = 0; channel < channelCount_; channel++) {
      std::vector<float> &buffer = channels_[channel];
      if (channel < activeCount && inputChannels != NULL && inputChannels[channel] != NULL) {
        memcpy(buffer.data() + startIndex, inputChannels[channel], firstPart * sizeof(float));
        if (secondPart) memcpy(buffer.data(), inputChannels[channel] + firstPart, secondPart * sizeof(float));
      } else {
        memset(buffer.data() + startIndex, 0, firstPart * sizeof(float));
        if (secondPart) memset(buffer.data(), 0, secondPart * sizeof(float));
      }
    }

    writeCursor_.store(writeCursor + writableFrames, std::memory_order_release);
    return writableFrames;
  }

  size_t read(float *const *outputChannels, size_t frameCount, size_t activeChannels) {
    if (channels_.empty() || frameCount == 0 || outputChannels == NULL) return 0;

    uint64_t readCursor = readCursor_.load(std::memory_order_relaxed);
    uint64_t writeCursor = writeCursor_.load(std::memory_order_acquire);
    size_t readableFrames = (size_t)std::min<uint64_t>(frameCount, writeCursor - readCursor);
    if (!readableFrames) return 0;

    size_t activeCount = std::min(activeChannels, channelCount_);
    size_t startIndex = (size_t)(readCursor % frameCapacity_);
    size_t firstPart = std::min(readableFrames, frameCapacity_ - startIndex);
    size_t secondPart = readableFrames - firstPart;

    for (size_t channel = 0; channel < activeCount; channel++) {
      const std::vector<float> &buffer = channels_[channel];
      memcpy(outputChannels[channel], buffer.data() + startIndex, firstPart * sizeof(float));
      if (secondPart) memcpy(outputChannels[channel] + firstPart, buffer.data(), secondPart * sizeof(float));
    }

    readCursor_.store(readCursor + readableFrames, std::memory_order_release);
    return readableFrames;
  }

private:
  size_t channelCount_ = 0;
  size_t frameCapacity_ = 0;
  std::vector<std::vector<float>> channels_;
  std::atomic<uint64_t> readCursor_ { 0 };
  std::atomic<uint64_t> writeCursor_ { 0 };
};

struct LXRealtimePannerDelayLine {
  std::vector<float> buffer;
  NSUInteger writeIndex = 0;

  LXRealtimePannerDelayLine() : buffer(1, 0), writeIndex(0) {}
  explicit LXRealtimePannerDelayLine(NSUInteger size) : buffer(MAX(size, (NSUInteger)1), 0), writeIndex(0) {}

  float pushAndRead(float input, NSUInteger delaySamples) {
    NSUInteger bufferCount = (NSUInteger)buffer.size();
    NSUInteger clampedDelay = MIN(delaySamples, bufferCount > 0 ? bufferCount - 1 : 0);
    buffer[writeIndex] = input;
    NSUInteger readIndex = (writeIndex + bufferCount - clampedDelay) % bufferCount;
    float output = buffer[readIndex];
    writeIndex += 1;
    if (writeIndex >= bufferCount) writeIndex = 0;
    return output;
  }
};

struct LXRealtimePhaseVocoderChannelState {
  std::vector<float> inputBuffer;
  std::vector<float> outputBuffer;
  std::vector<float> hopInput;
  std::vector<float> outputQueue;
};

class LXRealtimeConvolutionProcessor {
public:
  LXRealtimeConvolutionProcessor(const LXImpulseResponseData &impulse, NSUInteger inputChannels, NSUInteger outputChannels, float dryGain, float wetGain) {
    _kernel = std::make_unique<LXSharedDSP::IRConvolutionKernel>(impulse.channels, inputChannels, outputChannels, dryGain, wetGain);
  }

  bool isReady() const {
    return _kernel != nullptr && _kernel->isReady();
  }

  void updateDryGain(float dryGain, float wetGain) {
    if (_kernel == nullptr) return;
    _kernel->updateGains(dryGain, wetGain);
  }

  void processPCMChannels(float *const *channels, NSUInteger frameCount, NSUInteger activeChannels) {
    if (_kernel == nullptr) return;
    _kernel->processPCMChannels(channels, frameCount, activeChannels);
  }

private:
  std::unique_ptr<LXSharedDSP::IRConvolutionKernel> _kernel;
};

class LXRealtimeSpatialPannerProcessor {
public:
  LXRealtimeSpatialPannerProcessor(double sampleRate, float soundR, float speed) {
    _sampleRate = sampleRate;
    _processedSamples = 0;
    _maxDelaySamples = std::max((NSUInteger)llround(sampleRate * 0.00075), (NSUInteger)1);
    _leftDelay = LXRealtimePannerDelayLine(_maxDelaySamples + 2);
    _rightDelay = LXRealtimePannerDelayLine(_maxDelaySamples + 2);
    updateSoundR(soundR, speed);
  }

  void updateSoundR(float soundR, float speed) {
    _soundR.store(fmaxf(0.1f, fminf(soundR / 10.0f, 3.0f)), std::memory_order_release);
    _speed.store(fmaxf(1.0f, fminf(speed, 50.0f)), std::memory_order_release);
  }

  void processPCMChannels(float *const *channels, NSUInteger frameCount, NSUInteger activeChannels) {
    if (channels == NULL || activeChannels < 2 || _sampleRate <= 0) return;

    float soundR = _soundR.load(std::memory_order_acquire);
    float speed = _speed.load(std::memory_order_acquire);
    for (NSUInteger frame = 0; frame < frameCount; frame++) {
      double phaseStep = (M_PI / 180.0) / (MAX((double)speed * 0.01, 0.1) * _sampleRate);
      float angle = (float)(_processedSamples * phaseStep);
      float x = sinf(angle) * soundR;
      float y = cosf(angle) * soundR;
      float z = cosf(angle) * soundR;
      float distance = sqrtf(x * x + y * y + z * z);
      float attenuation = 1.0f / (1.0f + 0.18f * distance);
      float normalizedX = fmaxf(-1.0f, fminf(1.0f, x / fmaxf(soundR, 0.0001f)));
      float leftGain = attenuation * sqrtf(0.5f * (1.0f - normalizedX));
      float rightGain = attenuation * sqrtf(0.5f * (1.0f + normalizedX));
      float backFactor = z > 0 ? fmaxf(0.72f, 1.0f - 0.12f * z) : 1.0f;
      float sidePreserve = 0.28f * attenuation;
      NSUInteger itdSamples = (NSUInteger)llroundf(fabsf(normalizedX) * (float)_maxDelaySamples);

      float inputLeft = channels[0][frame];
      float inputRight = channels[1][frame];
      float mid = 0.5f * (inputLeft + inputRight);
      float side = 0.5f * (inputLeft - inputRight);

      float delayedLeft = _leftDelay.pushAndRead(mid * leftGain * backFactor, normalizedX > 0 ? itdSamples : 0);
      float delayedRight = _rightDelay.pushAndRead(mid * rightGain * backFactor, normalizedX < 0 ? itdSamples : 0);

      channels[0][frame] = fmaxf(fminf(delayedLeft + side * sidePreserve, 1.0f), -1.0f);
      channels[1][frame] = fmaxf(fminf(delayedRight - side * sidePreserve, 1.0f), -1.0f);
      _processedSamples += 1.0;
    }
  }

private:
  double _sampleRate = 0;
  double _processedSamples = 0;
  NSUInteger _maxDelaySamples = 0;
  LXRealtimePannerDelayLine _leftDelay;
  LXRealtimePannerDelayLine _rightDelay;
  std::atomic<float> _soundR { 0.5f };
  std::atomic<float> _speed { 25.0f };
};

class LXRealtimePhaseVocoderPitchShifter {
public:
  explicit LXRealtimePhaseVocoderPitchShifter(NSUInteger channelCount) {
    _blockSize = 4096;
    _hopSize = 128;
    _overlapCount = (float)(_blockSize / _hopSize);
    _channelCount = std::max((NSUInteger)1, channelCount);

    NSUInteger log2Value = (NSUInteger)llround(log2((double)_blockSize));
    if (((NSUInteger)1 << log2Value) != _blockSize) return;
    _log2n = (vDSP_Length)log2Value;
    _fftSetup = vDSP_create_fftsetup(_log2n, FFTRadix(kFFTRadix2));
    if (_fftSetup == NULL) return;

    _hannWindow.resize(_blockSize);
    for (NSUInteger index = 0; index < _blockSize; index++) {
      _hannWindow[index] = (float)(0.8 * (1.0 - cos(2.0 * M_PI * (double)index / (double)_blockSize)));
    }

    _channels.resize(_channelCount);
    for (NSUInteger channel = 0; channel < _channelCount; channel++) {
      _channels[channel].inputBuffer.assign(_blockSize, 0);
      _channels[channel].outputBuffer.assign(_blockSize, 0);
      _channels[channel].hopInput.assign(_hopSize, 0);
      _channels[channel].outputQueue.assign(_hopSize, 0);
    }
    _isReady = true;
  }

  ~LXRealtimePhaseVocoderPitchShifter() {
    if (_fftSetup != NULL) vDSP_destroy_fftsetup(_fftSetup);
  }

  bool isReady() const {
    return _isReady;
  }

  void processPCMChannels(float *const *channels, NSUInteger frameCount, NSUInteger activeChannels, float pitchFactor) {
    if (!_isReady) return;
    NSUInteger usedChannels = MIN(activeChannels, _channelCount);
    if (!channels || usedChannels == 0) return;
    if (fabsf(pitchFactor - 1.0f) < 0.01f) return;

    for (NSUInteger frame = 0; frame < frameCount; frame++) {
      for (NSUInteger channel = 0; channel < usedChannels; channel++) {
        _channels[channel].hopInput[_hopFill] = channels[channel][frame];
      }
      _hopFill += 1;

      if (_outputReadIndex < _hopSize) {
        for (NSUInteger channel = 0; channel < usedChannels; channel++) {
          channels[channel][frame] = _channels[channel].outputQueue[_outputReadIndex];
        }
        _outputReadIndex += 1;
      } else {
        for (NSUInteger channel = 0; channel < usedChannels; channel++) channels[channel][frame] = 0;
      }

      if (_hopFill >= _hopSize) {
        processHopWithPitchFactor(pitchFactor, usedChannels);
        _hopFill = 0;
        _outputReadIndex = 0;
        _timeCursor += _hopSize;
      }
    }
  }

private:
  void applyWindow(std::vector<float> &values) {
    for (NSUInteger index = 0; index < MIN(values.size(), _hannWindow.size()); index++) {
      values[index] *= _hannWindow[index];
    }
  }

  void performFFT(std::vector<float> &real, std::vector<float> &imag, FFTDirection direction) {
    DSPSplitComplex split = {
      .realp = real.data(),
      .imagp = imag.data(),
    };
    vDSP_fft_zip(_fftSetup, &split, 1, _log2n, direction);
  }

  std::vector<float> computeMagnitudes(const std::vector<float> &real, const std::vector<float> &imag, NSUInteger count) {
    std::vector<float> magnitudes(count, 0);
    for (NSUInteger index = 0; index < count; index++) {
      magnitudes[index] = real[index] * real[index] + imag[index] * imag[index];
    }
    return magnitudes;
  }

  std::vector<NSUInteger> findPeaks(const std::vector<float> &magnitudes) {
    std::vector<NSUInteger> peaks;
    if (magnitudes.size() <= 4) return peaks;

    NSUInteger index = 2;
    NSUInteger end = (NSUInteger)magnitudes.size() - 2;
    while (index < end) {
      float magnitude = magnitudes[index];
      if (magnitudes[index - 1] >= magnitude || magnitudes[index - 2] >= magnitude) {
        index += 1;
        continue;
      }
      if (magnitudes[index + 1] >= magnitude || magnitudes[index + 2] >= magnitude) {
        index += 1;
        continue;
      }
      peaks.push_back(index);
      index += 2;
    }
    return peaks;
  }

  void completeSpectrum(std::vector<float> &real, std::vector<float> &imag) {
    NSUInteger half = _blockSize / 2;
    if (half <= 1) return;
    for (NSUInteger index = 1; index < half; index++) {
      real[_blockSize - index] = real[index];
      imag[_blockSize - index] = -imag[index];
    }
  }

  void shiftSpectrum(const std::vector<float> &real, const std::vector<float> &imag, std::vector<float> &shiftedReal, std::vector<float> &shiftedImag, float pitchFactor) {
    NSUInteger halfCount = _blockSize / 2;
    if (halfCount <= 2) return;

    std::vector<float> magnitudes = computeMagnitudes(real, imag, halfCount + 1);
    std::vector<NSUInteger> peaks = findPeaks(magnitudes);

    for (NSUInteger peakIndex = 0; peakIndex < peaks.size(); peakIndex++) {
      NSInteger currentPeak = (NSInteger)peaks[peakIndex];
      NSInteger shiftedPeak = (NSInteger)llround((double)currentPeak * pitchFactor);
      if (shiftedPeak > (NSInteger)halfCount) break;

      NSInteger startIndex = peakIndex > 0
        ? currentPeak - (NSInteger)floor((double)(currentPeak - (NSInteger)peaks[peakIndex - 1]) / 2.0)
        : 0;
      NSInteger endIndex = peakIndex < peaks.size() - 1
        ? currentPeak + (NSInteger)ceil((double)((NSInteger)peaks[peakIndex + 1] - currentPeak) / 2.0)
        : (NSInteger)halfCount + 1;

      for (NSInteger offset = startIndex - currentPeak; offset < endIndex - currentPeak; offset++) {
        NSInteger binIndex = currentPeak + offset;
        NSInteger shiftedIndex = shiftedPeak + offset;
        if (shiftedIndex < 0 || shiftedIndex > (NSInteger)halfCount || binIndex < 0 || binIndex > (NSInteger)halfCount) continue;

        float omegaDelta = 2.0f * (float)M_PI * (float)(shiftedIndex - binIndex) / (float)_blockSize;
        float phase = omegaDelta * (float)_timeCursor;
        float phaseShiftReal = cosf(phase);
        float phaseShiftImag = sinf(phase);
        float valueReal = real[(NSUInteger)binIndex];
        float valueImag = imag[(NSUInteger)binIndex];

        float shiftedValueReal = valueReal * phaseShiftReal - valueImag * phaseShiftImag;
        float shiftedValueImag = valueReal * phaseShiftImag + valueImag * phaseShiftReal;
        shiftedReal[(NSUInteger)shiftedIndex] += shiftedValueReal;
        shiftedImag[(NSUInteger)shiftedIndex] += shiftedValueImag;
      }
    }
  }

  void processHopWithPitchFactor(float pitchFactor, NSUInteger usedChannels) {
    for (NSUInteger channel = 0; channel < usedChannels; channel++) {
      LXRealtimePhaseVocoderChannelState &state = _channels[channel];
      std::copy(state.inputBuffer.begin() + _hopSize, state.inputBuffer.end(), state.inputBuffer.begin());
      std::copy(state.hopInput.begin(), state.hopInput.end(), state.inputBuffer.begin() + (_blockSize - _hopSize));

      std::vector<float> windowedInput = state.inputBuffer;
      applyWindow(windowedInput);

      std::vector<float> spectrumReal = windowedInput;
      std::vector<float> spectrumImag(_blockSize, 0);
      performFFT(spectrumReal, spectrumImag, FFTDirection(FFT_FORWARD));

      std::vector<float> shiftedReal(_blockSize, 0);
      std::vector<float> shiftedImag(_blockSize, 0);
      shiftSpectrum(spectrumReal, spectrumImag, shiftedReal, shiftedImag, pitchFactor);
      completeSpectrum(shiftedReal, shiftedImag);

      performFFT(shiftedReal, shiftedImag, FFTDirection(FFT_INVERSE));
      std::vector<float> timeDomain(_blockSize, 0);
      for (NSUInteger index = 0; index < _blockSize; index++) timeDomain[index] = shiftedReal[index] / (float)_blockSize;
      applyWindow(timeDomain);

      for (NSUInteger index = 0; index < _blockSize; index++) {
        state.outputBuffer[index] += timeDomain[index] / _overlapCount;
      }

      std::copy(state.outputBuffer.begin(), state.outputBuffer.begin() + _hopSize, state.outputQueue.begin());
      std::copy(state.outputBuffer.begin() + _hopSize, state.outputBuffer.end(), state.outputBuffer.begin());
      std::fill(state.outputBuffer.begin() + (_blockSize - _hopSize), state.outputBuffer.end(), 0.0f);
    }
  }

  NSUInteger _blockSize = 0;
  NSUInteger _hopSize = 0;
  float _overlapCount = 0;
  NSUInteger _channelCount = 0;
  FFTSetup _fftSetup = NULL;
  vDSP_Length _log2n = 0;
  std::vector<float> _hannWindow;
  std::vector<LXRealtimePhaseVocoderChannelState> _channels;
  NSUInteger _hopFill = 0;
  NSUInteger _outputReadIndex = 0;
  NSUInteger _timeCursor = 0;
  bool _isReady = false;
};

struct LXBiquadCoefficients {
  float b0 = 1.0f;
  float b1 = 0.0f;
  float b2 = 0.0f;
  float a1 = 0.0f;
  float a2 = 0.0f;

  bool isBypass() const {
    return b0 == 1.0f && b1 == 0.0f && b2 == 0.0f && a1 == 0.0f && a2 == 0.0f;
  }
};

struct LXBiquadState {
  float z1 = 0.0f;
  float z2 = 0.0f;
};

class LXRealtimeEqualizerProcessor {
public:
  LXRealtimeEqualizerProcessor(double sampleRate, NSUInteger channelCount, const std::vector<float> &gains) {
    _sampleRate = sampleRate;
    _channelCount = std::max((NSUInteger)1, channelCount);
    _coefficients = makeCoefficients(sampleRate, gains);
    _headroomGain = makeHeadroomGain(gains);
    _states.assign(_channelCount, std::vector<LXBiquadState>(_coefficients.size()));
    _isReady = !_coefficients.empty();
  }

  bool isReady() const {
    return _isReady;
  }

  void processPCMChannels(float *const *channels, NSUInteger frameCount, NSUInteger activeChannels) {
    if (!_isReady || channels == NULL) return;
    NSUInteger usedChannels = MIN(activeChannels, _channelCount);
    if (usedChannels == 0) return;

    for (NSUInteger frame = 0; frame < frameCount; frame++) {
      for (NSUInteger channel = 0; channel < usedChannels; channel++) {
        float output = channels[channel][frame];
        for (NSUInteger bandIndex = 0; bandIndex < _coefficients.size(); bandIndex++) {
          const LXBiquadCoefficients &coeff = _coefficients[bandIndex];
          if (coeff.isBypass()) continue;

          LXBiquadState &state = _states[channel][bandIndex];
          float filtered = coeff.b0 * output + state.z1;
          state.z1 = coeff.b1 * output - coeff.a1 * filtered + state.z2;
          state.z2 = coeff.b2 * output - coeff.a2 * filtered;
          output = filtered;
        }
        channels[channel][frame] = output * _headroomGain;
      }
    }
  }

private:
  static std::vector<LXBiquadCoefficients> makeCoefficients(double sampleRate, const std::vector<float> &gains) {
    static const std::vector<float> frequencies = { 31.0f, 62.0f, 125.0f, 250.0f, 500.0f, 1000.0f, 2000.0f, 4000.0f, 8000.0f, 16000.0f };
    std::vector<LXBiquadCoefficients> coefficients(frequencies.size());
    if (sampleRate <= 0) return coefficients;

    const float q = 1.41f;
    for (NSUInteger index = 0; index < frequencies.size(); index++) {
      float gain = index < gains.size() ? gains[index] : 0.0f;
      if (fabsf(gain) < 0.01f) continue;

      float amplitude = powf(10.0f, gain / 40.0f);
      float omega = 2.0f * (float)M_PI * frequencies[index] / (float)sampleRate;
      float cosOmega = cosf(omega);
      float sinOmega = sinf(omega);
      float alpha = sinOmega / (2.0f * q);

      float b0 = 1.0f + alpha * amplitude;
      float b1 = -2.0f * cosOmega;
      float b2 = 1.0f - alpha * amplitude;
      float a0 = 1.0f + alpha / amplitude;
      float a1 = -2.0f * cosOmega;
      float a2 = 1.0f - alpha / amplitude;

      LXBiquadCoefficients coeff;
      coeff.b0 = b0 / a0;
      coeff.b1 = b1 / a0;
      coeff.b2 = b2 / a0;
      coeff.a1 = a1 / a0;
      coeff.a2 = a2 / a0;
      coefficients[index] = coeff;
    }
    return coefficients;
  }

  static float makeHeadroomGain(const std::vector<float> &gains) {
    (void)gains;
    return 1.0f;
  }

  double _sampleRate = 0;
  NSUInteger _channelCount = 0;
  std::vector<LXBiquadCoefficients> _coefficients;
  std::vector<std::vector<LXBiquadState>> _states;
  float _headroomGain = 1.0f;
  bool _isReady = false;
};

class LXRealtimeDynamicsProcessor {
public:
  explicit LXRealtimeDynamicsProcessor(double sampleRate) {
    if (sampleRate <= 0) return;
    _attackCoeff = expf(-1.0f / (0.001f * (float)sampleRate));
    _releaseCoeff = expf(-1.0f / (0.08f * (float)sampleRate));
    _isReady = true;
  }

  bool isReady() const {
    return _isReady;
  }

  void processPCMChannels(float *const *channels, NSUInteger frameCount, NSUInteger activeChannels) {
    if (!_isReady || channels == NULL || activeChannels == 0) return;

    for (NSUInteger frame = 0; frame < frameCount; frame++) {
      float peak = 0.0f;
      for (NSUInteger channel = 0; channel < activeChannels; channel++) {
        peak = fmaxf(peak, fabsf(channels[channel][frame]));
      }

      float targetGain = 1.0f;
      if (peak > _limiterThreshold) {
        targetGain = _limiterThreshold / peak;
      }

      float coeff = targetGain < _currentGain ? _attackCoeff : _releaseCoeff;
      _currentGain = coeff * _currentGain + (1.0f - coeff) * targetGain;
      _currentGain = fmaxf(0.0f, fminf(_currentGain, 1.0f));

      for (NSUInteger channel = 0; channel < activeChannels; channel++) {
        channels[channel][frame] *= _currentGain;
      }
    }
  }

private:
  float _attackCoeff = 0.0f;
  float _releaseCoeff = 0.0f;
  float _limiterThreshold = 0.98f;
  float _currentGain = 1.0f;
  bool _isReady = false;
};

@interface LXStreamingConvolutionEngine : NSObject
- (instancetype)initWithAssetURL:(NSURL *)assetURL
                       sampleRate:(double)sampleRate
                    inputChannels:(NSUInteger)inputChannels
                   outputChannels:(NSUInteger)outputChannels
                          dryGain:(float)dryGain
                          wetGain:(float)wetGain;
- (void)updateDryGain:(float)dryGain wetGain:(float)wetGain;
- (void)processPCMChannels:(float *const *)channels frameCount:(NSUInteger)frameCount activeChannels:(NSUInteger)activeChannels;
@end

@interface LXStreamingPhaseVocoderPitchShifter : NSObject
- (instancetype)initWithChannelCount:(NSUInteger)channelCount;
- (void)processPCMChannels:(float *const *)channels frameCount:(NSUInteger)frameCount activeChannels:(NSUInteger)activeChannels pitchFactor:(float)pitchFactor;
@end

@interface LXStreamingSpatialPannerEngine : NSObject
- (instancetype)initWithSampleRate:(double)sampleRate soundR:(float)soundR speed:(float)speed;
- (void)updateSoundR:(float)soundR speed:(float)speed;
- (void)processPCMChannels:(float *const *)channels frameCount:(NSUInteger)frameCount activeChannels:(NSUInteger)activeChannels;
@end

@implementation LXStreamingConvolutionEngine {
  NSUInteger _blockSize;
  NSUInteger _fftSize;
  NSUInteger _partitionCount;
  NSUInteger _inputChannels;
  NSUInteger _outputChannels;
  vDSP_Length _log2n;
  FFTSetup _fftSetup;
  std::vector<std::vector<std::vector<float>>> _filterReal;
  std::vector<std::vector<std::vector<float>>> _filterImag;
  std::vector<std::vector<std::vector<float>>> _historyReal;
  std::vector<std::vector<std::vector<float>>> _historyImag;
  std::vector<std::vector<float>> _overlaps;
  std::vector<std::vector<float>> _inputBuffer;
  std::vector<std::vector<float>> _outputQueue;
  NSUInteger _inputFill;
  NSUInteger _outputReadIndex;
  float _dryGain;
  float _wetGain;
}

+ (std::vector<std::pair<NSUInteger, NSUInteger>>)routeMappingWithIRChannelCount:(NSUInteger)irChannelCount inputChannels:(NSUInteger)inputChannels outputChannels:(NSUInteger)outputChannels {
  if (inputChannels >= 2 && outputChannels >= 2 && irChannelCount >= 4) {
    return {
      { 0 * inputChannels + 0, 0 },
      { 0 * inputChannels + 1, 2 },
      { 1 * inputChannels + 0, 1 },
      { 1 * inputChannels + 1, 3 },
    };
  }
  if (outputChannels >= 2 && irChannelCount >= 2 && inputChannels == 1) {
    return { { 0, 0 }, { 1, 1 } };
  }
  if (inputChannels >= 2 && outputChannels >= 2 && irChannelCount >= 2) {
    return {
      { 0 * inputChannels + 0, 0 },
      { 1 * inputChannels + 1, 1 },
    };
  }
  if (inputChannels >= 2 && outputChannels >= 2) {
    return {
      { 0 * inputChannels + 0, 0 },
      { 1 * inputChannels + 1, 0 },
    };
  }
  return { { 0, 0 } };
}

+ (void)performFFTWithSetup:(FFTSetup)setup log2n:(vDSP_Length)log2n real:(std::vector<float> &)real imag:(std::vector<float> &)imag direction:(FFTDirection)direction {
  DSPSplitComplex split = {
    .realp = real.data(),
    .imagp = imag.data(),
  };
  vDSP_fft_zip(setup, &split, 1, log2n, direction);
}

- (instancetype)initWithAssetURL:(NSURL *)assetURL
                       sampleRate:(double)sampleRate
                    inputChannels:(NSUInteger)inputChannels
                   outputChannels:(NSUInteger)outputChannels
                          dryGain:(float)dryGain
                          wetGain:(float)wetGain {
  self = [super init];
  if (self == nil) return nil;

  LXImpulseResponseData impulse = LXLoadImpulseResponse(assetURL, sampleRate);
  if (impulse.channels.empty()) return nil;

  _blockSize = 512;
  _fftSize = _blockSize * 2;
  _inputChannels = MAX((NSUInteger)1, inputChannels);
  _outputChannels = MAX((NSUInteger)1, outputChannels);
  _dryGain = dryGain;
  _wetGain = wetGain;
  _inputFill = 0;
  _outputReadIndex = 0;

  size_t impulseLength = 0;
  for (const auto &channel : impulse.channels) impulseLength = std::max(impulseLength, channel.size());
  _partitionCount = MAX((NSUInteger)1, (NSUInteger)ceil((double)impulseLength / (double)_blockSize));

  NSUInteger log2Value = (NSUInteger)llround(log2((double)_fftSize));
  if (((NSUInteger)1 << log2Value) != _fftSize) return nil;
  _log2n = (vDSP_Length)log2Value;
  _fftSetup = vDSP_create_fftsetup(_log2n, FFTRadix(kFFTRadix2));
  if (_fftSetup == NULL) return nil;

  NSUInteger routeCount = _inputChannels * _outputChannels;
  _filterReal.assign(routeCount, std::vector<std::vector<float>>(_partitionCount, std::vector<float>(_fftSize, 0)));
  _filterImag.assign(routeCount, std::vector<std::vector<float>>(_partitionCount, std::vector<float>(_fftSize, 0)));
  _historyReal.assign(_inputChannels, std::vector<std::vector<float>>(_partitionCount, std::vector<float>(_fftSize, 0)));
  _historyImag.assign(_inputChannels, std::vector<std::vector<float>>(_partitionCount, std::vector<float>(_fftSize, 0)));
  _overlaps.assign(_outputChannels, std::vector<float>(_blockSize, 0));
  _inputBuffer.assign(_inputChannels, std::vector<float>(_blockSize, 0));
  _outputQueue.assign(_outputChannels, std::vector<float>());

  auto routeMapping = [LXStreamingConvolutionEngine routeMappingWithIRChannelCount:impulse.channels.size() inputChannels:_inputChannels outputChannels:_outputChannels];
  for (const auto &route : routeMapping) {
    const auto &impulseChannel = impulse.channels[std::min((size_t)route.second, impulse.channels.size() - 1)];
    for (NSUInteger partition = 0; partition < _partitionCount; partition++) {
      NSUInteger start = partition * _blockSize;
      NSUInteger end = MIN(start + _blockSize, (NSUInteger)impulseChannel.size());
      std::vector<float> real(_fftSize, 0);
      if (start < end) std::copy(impulseChannel.begin() + start, impulseChannel.begin() + end, real.begin());
      std::vector<float> imag(_fftSize, 0);
      [LXStreamingConvolutionEngine performFFTWithSetup:_fftSetup log2n:_log2n real:real imag:imag direction:FFTDirection(FFT_FORWARD)];
      _filterReal[route.first][partition] = std::move(real);
      _filterImag[route.first][partition] = std::move(imag);
    }
  }

  return self;
}

- (void)dealloc {
  if (_fftSetup != NULL) vDSP_destroy_fftsetup(_fftSetup);
}

- (void)updateDryGain:(float)dryGain wetGain:(float)wetGain {
  _dryGain = dryGain;
  _wetGain = wetGain;
}

- (void)processBufferedBlock {
  std::vector<std::vector<float>> wetOutputs(_outputChannels, std::vector<float>(_blockSize, 0));

  for (NSUInteger inputChannel = 0; inputChannel < _inputChannels; inputChannel++) {
    std::vector<float> real(_fftSize, 0);
    std::copy(_inputBuffer[inputChannel].begin(), _inputBuffer[inputChannel].end(), real.begin());
    std::vector<float> imag(_fftSize, 0);
    [LXStreamingConvolutionEngine performFFTWithSetup:_fftSetup log2n:_log2n real:real imag:imag direction:FFTDirection(FFT_FORWARD)];
    _historyReal[inputChannel].insert(_historyReal[inputChannel].begin(), real);
    _historyImag[inputChannel].insert(_historyImag[inputChannel].begin(), imag);
    if (_historyReal[inputChannel].size() > _partitionCount) {
      _historyReal[inputChannel].pop_back();
      _historyImag[inputChannel].pop_back();
    }
  }

  for (NSUInteger outputChannel = 0; outputChannel < _outputChannels; outputChannel++) {
    std::vector<float> sumReal(_fftSize, 0);
    std::vector<float> sumImag(_fftSize, 0);

    for (NSUInteger inputChannel = 0; inputChannel < _inputChannels; inputChannel++) {
      NSUInteger routeIndex = outputChannel * _inputChannels + inputChannel;
      for (NSUInteger partition = 0; partition < _partitionCount; partition++) {
        const auto &inputReal = _historyReal[inputChannel][partition];
        const auto &inputImag = _historyImag[inputChannel][partition];
        const auto &filterReal = _filterReal[routeIndex][partition];
        const auto &filterImag = _filterImag[routeIndex][partition];
        for (NSUInteger index = 0; index < _fftSize; index++) {
          float real = filterReal[index] * inputReal[index] - filterImag[index] * inputImag[index];
          float imag = filterReal[index] * inputImag[index] + filterImag[index] * inputReal[index];
          sumReal[index] += real;
          sumImag[index] += imag;
        }
      }
    }

    [LXStreamingConvolutionEngine performFFTWithSetup:_fftSetup log2n:_log2n real:sumReal imag:sumImag direction:FFTDirection(FFT_INVERSE)];
    float scale = 1.0f / (float)_fftSize;
    for (NSUInteger index = 0; index < _fftSize; index++) sumReal[index] *= scale;

    for (NSUInteger index = 0; index < _blockSize; index++) {
      wetOutputs[outputChannel][index] = sumReal[index] + _overlaps[outputChannel][index];
    }
    _overlaps[outputChannel].assign(sumReal.begin() + _blockSize, sumReal.end());
  }

  _outputQueue.assign(_outputChannels, std::vector<float>(_blockSize, 0));
  _outputReadIndex = 0;
  for (NSUInteger outputChannel = 0; outputChannel < _outputChannels; outputChannel++) {
    for (NSUInteger index = 0; index < _blockSize; index++) {
      float dry = outputChannel < _inputBuffer.size() ? _inputBuffer[outputChannel][index] * _dryGain : 0;
      float wet = wetOutputs[outputChannel][index] * _wetGain;
      _outputQueue[outputChannel][index] = dry + wet;
    }
  }
}

- (void)processPCMChannels:(float *const *)channels frameCount:(NSUInteger)frameCount activeChannels:(NSUInteger)activeChannels {
  NSUInteger usedChannels = MIN(activeChannels, _inputChannels);
  if (usedChannels == 0 || channels == NULL) return;

  for (NSUInteger frame = 0; frame < frameCount; frame++) {
    for (NSUInteger channel = 0; channel < usedChannels; channel++) {
      _inputBuffer[channel][_inputFill] = channels[channel][frame];
    }
    _inputFill += 1;
    if (_inputFill >= _blockSize) {
      [self processBufferedBlock];
      _inputFill = 0;
    }

    if (!_outputQueue.empty() && _outputReadIndex < _outputQueue[0].size()) {
      for (NSUInteger channel = 0; channel < usedChannels; channel++) {
        channels[channel][frame] = channel < _outputChannels ? _outputQueue[channel][_outputReadIndex] : 0;
      }
      _outputReadIndex += 1;
      if (_outputReadIndex >= _outputQueue[0].size()) {
        _outputQueue.assign(_outputChannels, std::vector<float>());
        _outputReadIndex = 0;
      }
    } else {
      for (NSUInteger channel = 0; channel < usedChannels; channel++) channels[channel][frame] = 0;
    }
  }
}
@end

struct LXStreamingPannerDelayLine {
  std::vector<float> buffer;
  NSUInteger writeIndex = 0;

  LXStreamingPannerDelayLine() : buffer(1, 0), writeIndex(0) {}
  explicit LXStreamingPannerDelayLine(NSUInteger size) : buffer(MAX(size, (NSUInteger)1), 0), writeIndex(0) {}

  float pushAndRead(float input, NSUInteger delaySamples) {
    NSUInteger bufferCount = (NSUInteger)buffer.size();
    NSUInteger clampedDelay = MIN(delaySamples, bufferCount > 0 ? bufferCount - 1 : 0);
    buffer[writeIndex] = input;
    NSUInteger readIndex = (writeIndex + bufferCount - clampedDelay) % bufferCount;
    float output = buffer[readIndex];
    writeIndex += 1;
    if (writeIndex >= bufferCount) writeIndex = 0;
    return output;
  }
};

@implementation LXStreamingSpatialPannerEngine {
  double _sampleRate;
  double _processedSamples;
  NSUInteger _maxDelaySamples;
  LXStreamingPannerDelayLine _leftDelay;
  LXStreamingPannerDelayLine _rightDelay;
  float _soundR;
  float _speed;
}

- (instancetype)initWithSampleRate:(double)sampleRate soundR:(float)soundR speed:(float)speed {
  self = [super init];
  if (self == nil) return nil;
  _sampleRate = sampleRate;
  _processedSamples = 0;
  _maxDelaySamples = MAX((NSUInteger)llround(sampleRate * 0.00075), (NSUInteger)1);
  _leftDelay = LXStreamingPannerDelayLine(_maxDelaySamples + 2);
  _rightDelay = LXStreamingPannerDelayLine(_maxDelaySamples + 2);
  [self updateSoundR:soundR speed:speed];
  return self;
}

- (void)updateSoundR:(float)soundR speed:(float)speed {
  _soundR = fmaxf(0.1f, fminf(soundR / 10.0f, 3.0f));
  _speed = fmaxf(1.0f, fminf(speed, 50.0f));
}

- (void)processPCMChannels:(float *const *)channels frameCount:(NSUInteger)frameCount activeChannels:(NSUInteger)activeChannels {
  if (channels == NULL || activeChannels < 2 || _sampleRate <= 0) return;

  for (NSUInteger frame = 0; frame < frameCount; frame++) {
    double phaseStep = (M_PI / 180.0) / (MAX((double)_speed * 0.01, 0.1) * _sampleRate);
    float angle = (float)(_processedSamples * phaseStep);
    float x = sinf(angle) * _soundR;
    float y = cosf(angle) * _soundR;
    float z = cosf(angle) * _soundR;
    float attenuation = 1.0f;
    float normalizedX = fmaxf(-1.0f, fminf(1.0f, x / fmaxf(_soundR, 0.0001f)));
    float leftGain = attenuation * sqrtf(0.5f * (1.0f - normalizedX));
    float rightGain = attenuation * sqrtf(0.5f * (1.0f + normalizedX));
    float backFactor = z > 0 ? fmaxf(0.72f, 1.0f - 0.12f * z) : 1.0f;
    float sidePreserve = 0.28f * attenuation;
    NSUInteger itdSamples = (NSUInteger)llroundf(fabsf(normalizedX) * (float)_maxDelaySamples);

    float inputLeft = channels[0][frame];
    float inputRight = channels[1][frame];
    float mid = 0.5f * (inputLeft + inputRight);
    float side = 0.5f * (inputLeft - inputRight);

    float delayedLeft = _leftDelay.pushAndRead(mid * leftGain * backFactor, normalizedX > 0 ? itdSamples : 0);
    float delayedRight = _rightDelay.pushAndRead(mid * rightGain * backFactor, normalizedX < 0 ? itdSamples : 0);

    channels[0][frame] = fmaxf(fminf(delayedLeft + side * sidePreserve, 1.0f), -1.0f);
    channels[1][frame] = fmaxf(fminf(delayedRight - side * sidePreserve, 1.0f), -1.0f);
    _processedSamples += 1.0;
  }
}
@end

struct LXPhaseVocoderChannelState {
  std::vector<float> inputBuffer;
  std::vector<float> outputBuffer;
  std::vector<float> hopInput;
  std::vector<float> outputQueue;
};

@implementation LXStreamingPhaseVocoderPitchShifter {
  NSUInteger _blockSize;
  NSUInteger _hopSize;
  float _overlapCount;
  NSUInteger _channelCount;
  FFTSetup _fftSetup;
  vDSP_Length _log2n;
  std::vector<float> _hannWindow;
  std::vector<LXPhaseVocoderChannelState> _channels;
  NSUInteger _hopFill;
  NSUInteger _outputReadIndex;
  NSUInteger _timeCursor;
}

- (instancetype)initWithChannelCount:(NSUInteger)channelCount {
  self = [super init];
  if (self == nil) return nil;

  _blockSize = 4096;
  _hopSize = 128;
  _overlapCount = (float)(_blockSize / _hopSize);
  _channelCount = MAX((NSUInteger)1, channelCount);

  NSUInteger log2Value = (NSUInteger)llround(log2((double)_blockSize));
  if (((NSUInteger)1 << log2Value) != _blockSize) return nil;
  _log2n = (vDSP_Length)log2Value;
  _fftSetup = vDSP_create_fftsetup(_log2n, FFTRadix(kFFTRadix2));
  if (_fftSetup == NULL) return nil;

  _hannWindow.resize(_blockSize);
  for (NSUInteger index = 0; index < _blockSize; index++) {
    _hannWindow[index] = (float)(0.8 * (1.0 - cos(2.0 * M_PI * (double)index / (double)_blockSize)));
  }

  _channels.resize(_channelCount);
  for (NSUInteger channel = 0; channel < _channelCount; channel++) {
    _channels[channel].inputBuffer.assign(_blockSize, 0);
    _channels[channel].outputBuffer.assign(_blockSize, 0);
    _channels[channel].hopInput.assign(_hopSize, 0);
    _channels[channel].outputQueue.assign(_hopSize, 0);
  }

  _hopFill = 0;
  _outputReadIndex = 0;
  _timeCursor = 0;
  return self;
}

- (void)dealloc {
  if (_fftSetup != NULL) vDSP_destroy_fftsetup(_fftSetup);
}

- (void)applyWindow:(std::vector<float> &)values {
  for (NSUInteger index = 0; index < MIN(values.size(), _hannWindow.size()); index++) {
    values[index] *= _hannWindow[index];
  }
}

- (void)performFFTWithReal:(std::vector<float> &)real imag:(std::vector<float> &)imag direction:(FFTDirection)direction {
  DSPSplitComplex split = {
    .realp = real.data(),
    .imagp = imag.data(),
  };
  vDSP_fft_zip(_fftSetup, &split, 1, _log2n, direction);
}

- (std::vector<float>)computeMagnitudesWithReal:(const std::vector<float> &)real imag:(const std::vector<float> &)imag count:(NSUInteger)count {
  std::vector<float> magnitudes(count, 0);
  for (NSUInteger index = 0; index < count; index++) {
    magnitudes[index] = real[index] * real[index] + imag[index] * imag[index];
  }
  return magnitudes;
}

- (std::vector<NSUInteger>)findPeaksInMagnitudes:(const std::vector<float> &)magnitudes {
  std::vector<NSUInteger> peaks;
  if (magnitudes.size() <= 4) return peaks;

  NSUInteger index = 2;
  NSUInteger end = (NSUInteger)magnitudes.size() - 2;
  while (index < end) {
    float magnitude = magnitudes[index];
    if (magnitudes[index - 1] >= magnitude || magnitudes[index - 2] >= magnitude) {
      index += 1;
      continue;
    }
    if (magnitudes[index + 1] >= magnitude || magnitudes[index + 2] >= magnitude) {
      index += 1;
      continue;
    }
    peaks.push_back(index);
    index += 2;
  }
  return peaks;
}

- (void)completeSpectrumWithReal:(std::vector<float> &)real imag:(std::vector<float> &)imag {
  NSUInteger half = _blockSize / 2;
  if (half <= 1) return;
  for (NSUInteger index = 1; index < half; index++) {
    real[_blockSize - index] = real[index];
    imag[_blockSize - index] = -imag[index];
  }
}

- (void)shiftSpectrumWithReal:(const std::vector<float> &)real
                         imag:(const std::vector<float> &)imag
                     outReal:(std::vector<float> &)shiftedReal
                     outImag:(std::vector<float> &)shiftedImag
                 pitchFactor:(float)pitchFactor {
  NSUInteger halfCount = _blockSize / 2;
  if (halfCount <= 2) return;

  std::vector<float> magnitudes = [self computeMagnitudesWithReal:real imag:imag count:halfCount + 1];
  std::vector<NSUInteger> peaks = [self findPeaksInMagnitudes:magnitudes];

  for (NSUInteger peakIndex = 0; peakIndex < peaks.size(); peakIndex++) {
    NSInteger currentPeak = (NSInteger)peaks[peakIndex];
    NSInteger shiftedPeak = (NSInteger)llround((double)currentPeak * pitchFactor);
    if (shiftedPeak > (NSInteger)halfCount) break;

    NSInteger startIndex = peakIndex > 0
      ? currentPeak - (NSInteger)floor((double)(currentPeak - (NSInteger)peaks[peakIndex - 1]) / 2.0)
      : 0;
    NSInteger endIndex = peakIndex < peaks.size() - 1
      ? currentPeak + (NSInteger)ceil((double)((NSInteger)peaks[peakIndex + 1] - currentPeak) / 2.0)
      : (NSInteger)halfCount + 1;

    for (NSInteger offset = startIndex - currentPeak; offset < endIndex - currentPeak; offset++) {
      NSInteger binIndex = currentPeak + offset;
      NSInteger shiftedIndex = shiftedPeak + offset;
      if (shiftedIndex < 0 || shiftedIndex > (NSInteger)halfCount || binIndex < 0 || binIndex > (NSInteger)halfCount) continue;

      float omegaDelta = 2.0f * (float)M_PI * (float)(shiftedIndex - binIndex) / (float)_blockSize;
      float phase = omegaDelta * (float)_timeCursor;
      float phaseShiftReal = cosf(phase);
      float phaseShiftImag = sinf(phase);
      float valueReal = real[(NSUInteger)binIndex];
      float valueImag = imag[(NSUInteger)binIndex];

      float shiftedValueReal = valueReal * phaseShiftReal - valueImag * phaseShiftImag;
      float shiftedValueImag = valueReal * phaseShiftImag + valueImag * phaseShiftReal;
      shiftedReal[(NSUInteger)shiftedIndex] += shiftedValueReal;
      shiftedImag[(NSUInteger)shiftedIndex] += shiftedValueImag;
    }
  }
}

- (void)processHopWithPitchFactor:(float)pitchFactor usedChannels:(NSUInteger)usedChannels {
  for (NSUInteger channel = 0; channel < usedChannels; channel++) {
    LXPhaseVocoderChannelState &state = _channels[channel];
    std::copy(state.inputBuffer.begin() + _hopSize, state.inputBuffer.end(), state.inputBuffer.begin());
    std::copy(state.hopInput.begin(), state.hopInput.end(), state.inputBuffer.begin() + (_blockSize - _hopSize));

    std::vector<float> windowedInput = state.inputBuffer;
    [self applyWindow:windowedInput];

    std::vector<float> spectrumReal = windowedInput;
    std::vector<float> spectrumImag(_blockSize, 0);
    [self performFFTWithReal:spectrumReal imag:spectrumImag direction:FFTDirection(FFT_FORWARD)];

    std::vector<float> shiftedReal(_blockSize, 0);
    std::vector<float> shiftedImag(_blockSize, 0);
    [self shiftSpectrumWithReal:spectrumReal imag:spectrumImag outReal:shiftedReal outImag:shiftedImag pitchFactor:pitchFactor];
    [self completeSpectrumWithReal:shiftedReal imag:shiftedImag];

    [self performFFTWithReal:shiftedReal imag:shiftedImag direction:FFTDirection(FFT_INVERSE)];
    std::vector<float> timeDomain(_blockSize, 0);
    for (NSUInteger index = 0; index < _blockSize; index++) timeDomain[index] = shiftedReal[index] / (float)_blockSize;
    [self applyWindow:timeDomain];

    for (NSUInteger index = 0; index < _blockSize; index++) {
      state.outputBuffer[index] += timeDomain[index] / _overlapCount;
    }

    std::copy(state.outputBuffer.begin(), state.outputBuffer.begin() + _hopSize, state.outputQueue.begin());
    std::copy(state.outputBuffer.begin() + _hopSize, state.outputBuffer.end(), state.outputBuffer.begin());
    std::fill(state.outputBuffer.begin() + (_blockSize - _hopSize), state.outputBuffer.end(), 0.0f);
  }
}

- (void)processPCMChannels:(float *const *)channels frameCount:(NSUInteger)frameCount activeChannels:(NSUInteger)activeChannels pitchFactor:(float)pitchFactor {
  NSUInteger usedChannels = MIN(activeChannels, _channelCount);
  if (!channels || usedChannels == 0) return;
  if (fabsf(pitchFactor - 1.0f) < 0.01f) return;

  for (NSUInteger frame = 0; frame < frameCount; frame++) {
    for (NSUInteger channel = 0; channel < usedChannels; channel++) {
      _channels[channel].hopInput[_hopFill] = channels[channel][frame];
    }
    _hopFill += 1;

    if (_outputReadIndex < _hopSize) {
      for (NSUInteger channel = 0; channel < usedChannels; channel++) {
        channels[channel][frame] = _channels[channel].outputQueue[_outputReadIndex];
      }
      _outputReadIndex += 1;
    } else {
      for (NSUInteger channel = 0; channel < usedChannels; channel++) channels[channel][frame] = 0;
    }

    if (_hopFill >= _hopSize) {
      [self processHopWithPitchFactor:pitchFactor usedChannels:usedChannels];
      _hopFill = 0;
      _outputReadIndex = 0;
      _timeCursor += _hopSize;
    }
  }
}
@end

static AVAudioUnitReverbPreset LXSoundEffectReverbPresetForFileName(NSString *fileName) {
  if ([fileName isEqualToString:@"filter-telephone.wav"]) return AVAudioUnitReverbPresetSmallRoom;
  if ([fileName isEqualToString:@"s2_r4_bd.wav"]) return AVAudioUnitReverbPresetCathedral;
  if ([fileName isEqualToString:@"bright-hall.wav"]) return AVAudioUnitReverbPresetLargeHall;
  if ([fileName isEqualToString:@"cinema-diningroom.wav"]) return AVAudioUnitReverbPresetLargeRoom;
  if ([fileName isEqualToString:@"dining-living-true-stereo.wav"]) return AVAudioUnitReverbPresetMediumRoom;
  if ([fileName isEqualToString:@"living-bedroom-leveled.wav"]) return AVAudioUnitReverbPresetSmallRoom;
  if ([fileName isEqualToString:@"spreader50-65ms.wav"]) return AVAudioUnitReverbPresetMediumChamber;
  if ([fileName isEqualToString:@"s3_r1_bd.wav"]) return AVAudioUnitReverbPresetPlate;
  if ([fileName isEqualToString:@"matrix-reverb1.wav"]) return AVAudioUnitReverbPresetMediumHall;
  if ([fileName isEqualToString:@"matrix-reverb2.wav"]) return AVAudioUnitReverbPresetMediumHall2;
  if ([fileName isEqualToString:@"cardiod-35-10-spread.wav"]) return AVAudioUnitReverbPresetLargeChamber;
  if ([fileName isEqualToString:@"tim-omni-35-10-magnetic.wav"]) return AVAudioUnitReverbPresetMediumHall3;
  if ([fileName isEqualToString:@"feedback-spring.wav"]) return AVAudioUnitReverbPresetPlate;
  return AVAudioUnitReverbPresetMediumRoom;
}

static NSDictionary *LXCurrentSoundEffectConfig(void) {
  NSArray<NSNumber *> *gains = LXSoundEffectEqualizerGains;
  if (gains == nil || gains.count != LXSoundEffectEqualizerFrequencies().count) gains = LXSoundEffectDefaultEqualizerGains();
  return @{
    @"enabled": @(LXSoundEffectEqualizerEnabled),
    @"gains": gains,
    @"equalizer": @{
      @"enabled": @(LXSoundEffectEqualizerEnabled),
      @"gains": gains,
    },
    @"convolution": @{
      @"fileName": LXSoundEffectConvolutionFileName ?: @"",
      @"assetUri": LXSoundEffectConvolutionAssetUri ?: @"",
      @"mainGain": @(LXSoundEffectConvolutionMainGain),
      @"sendGain": @(LXSoundEffectConvolutionSendGain),
    },
    @"panner": @{
      @"enabled": @(LXSoundEffectPannerEnabled),
      @"soundR": @(LXSoundEffectPannerSoundR),
      @"speed": @(LXSoundEffectPannerSpeed),
    },
    @"pitchShifter": @{
      @"playbackRate": @(LXSoundEffectPitchShifterPlaybackRate),
    },
  };
}

static void LXUpdateSoundEffectConfig(NSDictionary *config) {
  NSDictionary *equalizerConfig = [config[@"equalizer"] isKindOfClass:[NSDictionary class]] ? config[@"equalizer"] : config;
  NSDictionary *convolutionConfig = [config[@"convolution"] isKindOfClass:[NSDictionary class]] ? config[@"convolution"] : nil;
  NSDictionary *pannerConfig = [config[@"panner"] isKindOfClass:[NSDictionary class]] ? config[@"panner"] : nil;
  NSDictionary *pitchShifterConfig = [config[@"pitchShifter"] isKindOfClass:[NSDictionary class]] ? config[@"pitchShifter"] : nil;

  BOOL enabled = [equalizerConfig[@"enabled"] boolValue];
  NSMutableArray<NSNumber *> *nextGains = [NSMutableArray arrayWithCapacity:LXSoundEffectEqualizerFrequencies().count];
  NSArray *inputGains = [equalizerConfig[@"gains"] isKindOfClass:[NSArray class]] ? equalizerConfig[@"gains"] : nil;
  for (NSUInteger index = 0; index < LXSoundEffectEqualizerFrequencies().count; index += 1) {
    id value = index < inputGains.count ? inputGains[index] : nil;
    [nextGains addObject:@([value respondsToSelector:@selector(floatValue)] ? [value floatValue] : 0.0f)];
  }

  LXSoundEffectEqualizerEnabled = enabled;
  LXSoundEffectEqualizerGains = nextGains.copy;
  LXSoundEffectConvolutionFileName = [convolutionConfig[@"fileName"] isKindOfClass:[NSString class]] ? [convolutionConfig[@"fileName"] copy] : @"";
  LXSoundEffectConvolutionAssetUri = [convolutionConfig[@"assetUri"] isKindOfClass:[NSString class]] ? [convolutionConfig[@"assetUri"] copy] : @"";
  LXSoundEffectConvolutionMainGain = LXSoundEffectClampFloatValue(convolutionConfig[@"mainGain"], 10.0f, 0.0f, 50.0f);
  LXSoundEffectConvolutionSendGain = LXSoundEffectClampFloatValue(convolutionConfig[@"sendGain"], 0.0f, 0.0f, 50.0f);
  LXSoundEffectPannerEnabled = [pannerConfig[@"enabled"] boolValue];
  LXSoundEffectPannerSoundR = LXSoundEffectClampFloatValue(pannerConfig[@"soundR"], 5.0f, 1.0f, 30.0f);
  LXSoundEffectPannerSpeed = LXSoundEffectClampFloatValue(pannerConfig[@"speed"], 25.0f, 1.0f, 50.0f);
  LXSoundEffectPitchShifterPlaybackRate = LXSoundEffectClampFloatValue(pitchShifterConfig[@"playbackRate"], 1.0f, 0.5f, 1.5f);
  [[NSNotificationCenter defaultCenter] postNotificationName:LXSoundEffectConfigDidChangeNotification
                                                      object:nil
                                                    userInfo:LXCurrentSoundEffectConfig()];
}

@interface SoundEffectModule : NSObject<RCTBridgeModule>
@end

@implementation SoundEffectModule

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup {
  return YES;
}

RCT_REMAP_METHOD(updateConfig, updateConfig:(NSDictionary *)config resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  LXUpdateSoundEffectConfig(config ?: @{});
  resolve(nil);
}

RCT_REMAP_METHOD(updateEqualizerConfig, updateEqualizerConfig:(NSDictionary *)config resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  LXUpdateSoundEffectConfig(config ?: @{});
  resolve(nil);
}

@end

@interface StreamingFlacPlayerModule : RCTEventEmitter<RCTBridgeModule, NSURLSessionDataDelegate>
@property (nonatomic, strong) NSURLSession *session;
@property (nonatomic, strong) NSURLSessionDataTask *task;
@property (nonatomic, strong) NSMutableData *streamData;
@property (nonatomic, strong) NSCondition *streamCondition;
@property (nonatomic, strong) dispatch_queue_t decoderQueue;
@property (nonatomic, strong) dispatch_queue_t renderQueue;
@property (nonatomic, strong) AVAudioEngine *engine;
@property (nonatomic, strong) AVAudioSourceNode *sourceNode;
@property (nonatomic, strong) AVAudioUnitTimePitch *timePitchNode;
@property (nonatomic, strong) AVAudioUnitReverb *reverbNode;
@property (nonatomic, strong) AVAudioMixerNode *dryMixerNode;
@property (nonatomic, strong) AVAudioMixerNode *wetMixerNode;
@property (nonatomic, strong) AVAudioMixerNode *soundEffectMixerNode;
@property (nonatomic, strong) AVAudioFormat *outputFormat;
@property (nonatomic, strong) dispatch_source_t pannerTimer;
@property (nonatomic, copy) NSString *convolutionAssetKey;
@property (nonatomic, copy) NSString *currentState;
@property (nonatomic, copy) NSString *currentURL;
@property (nonatomic, strong) NSError *streamError;
@property (nonatomic, assign) BOOL hasListeners;
@property (nonatomic, assign) BOOL downloadCompleted;
@property (nonatomic, assign) BOOL stopRequested;
@property (nonatomic, assign) BOOL playbackStarted;
@property (nonatomic, assign) BOOL manualPause;
@property (nonatomic, assign) BOOL interruptedBySystem;
@property (nonatomic, assign) NSUInteger readOffset;
@property (nonatomic, assign) double duration;
@property (nonatomic, assign) double sampleRate;
@property (nonatomic, assign) NSUInteger channels;
@property (nonatomic, assign) NSUInteger bitsPerSample;
@property (nonatomic, assign) int64_t totalSamples;
@property (nonatomic, assign) double startThresholdSeconds;
@property (nonatomic, assign) double maxBufferSeconds;
@property (nonatomic, assign) double pausedBufferSeconds;
@property (nonatomic, assign) double lastKnownPosition;
@property (nonatomic, assign) int64_t expectedContentLength;
@property (nonatomic, assign) double pendingSeekPosition;
@property (nonatomic, assign) int64_t pendingSeekGeneration; // 登记 seek 时的流代际（切歌复位后失配即作废）
@property (nonatomic, assign) float currentVolume;
@property (nonatomic, assign) float currentRate;
@property (nonatomic, assign) int64_t queuedFrames;
@property (nonatomic, assign) int64_t completedFrames;
@property (nonatomic, assign) int64_t seekTargetFrame;
@property (nonatomic, assign) int64_t decodedFramesCursor;
@property (nonatomic, assign) int64_t playbackGeneration;
@property (nonatomic, assign) int64_t playbackAnchorFrame;
@property (nonatomic, assign) float pannerPhase;
@property (nonatomic, assign) BOOL seekRequested;
@property (nonatomic, assign) BOOL seekInProgress;
#if LX_HAS_LIBFLAC
@property (nonatomic, assign) FLAC__StreamDecoder *decoder;
#endif
@end

#if LX_HAS_LIBFLAC
static FLAC__StreamDecoderReadStatus LXStreamingFlacReadCallback(const FLAC__StreamDecoder *decoder, FLAC__byte buffer[], size_t *bytes, void *client_data);
static FLAC__StreamDecoderWriteStatus LXStreamingFlacWriteCallback(const FLAC__StreamDecoder *decoder, const FLAC__Frame *frame, const FLAC__int32 * const buffer[], void *client_data);
static void LXStreamingFlacMetadataCallback(const FLAC__StreamDecoder *decoder, const FLAC__StreamMetadata *metadata, void *client_data);
static void LXStreamingFlacErrorCallback(const FLAC__StreamDecoder *decoder, FLAC__StreamDecoderErrorStatus status, void *client_data);
static NSString *LXStreamingFlacDecoderErrorStatusName(FLAC__StreamDecoderErrorStatus status);
#endif

@implementation StreamingFlacPlayerModule {
  std::unique_ptr<LXStreamingPlanarPCMBuffer> _pcmBuffer;
  std::atomic<int64_t> _renderedFrames;
  std::atomic<bool> _sourceRenderingEnabled;
  std::atomic<bool> _streamFinished;
  std::atomic<bool> _stopRequestedFlag;
  std::atomic<bool> _bufferingNotificationScheduled;
  std::atomic<bool> _endedNotificationScheduled;
  std::atomic<int64_t> _renderPlaybackGeneration;
  std::atomic<float> _pitchPlaybackRate;
  std::shared_ptr<LXRealtimeEqualizerProcessor> _realtimeEqualizerProcessor;
  std::shared_ptr<LXRealtimeDynamicsProcessor> _realtimeDynamicsProcessor;
  std::shared_ptr<LXRealtimeConvolutionProcessor> _realtimeConvolutionProcessor;
  std::shared_ptr<LXRealtimePhaseVocoderPitchShifter> _realtimePitchProcessor;
  std::shared_ptr<LXRealtimeSpatialPannerProcessor> _realtimePannerProcessor;
  BOOL _lastRealtimeEqualizerEnabled;
  std::vector<float> _lastRealtimeEqualizerGains;
}

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup {
  return YES;
}

- (instancetype)init {
  self = [super init];
  if (self != nil) {
    _renderedFrames.store(0, std::memory_order_release);
    _sourceRenderingEnabled.store(false, std::memory_order_release);
    _streamFinished.store(false, std::memory_order_release);
    _stopRequestedFlag.store(false, std::memory_order_release);
    _bufferingNotificationScheduled.store(false, std::memory_order_release);
    _endedNotificationScheduled.store(false, std::memory_order_release);
    _renderPlaybackGeneration.store(0, std::memory_order_release);
    _pitchPlaybackRate.store(1.0f, std::memory_order_release);
    _lastRealtimeEqualizerEnabled = NO;
    _streamCondition = [[NSCondition alloc] init];
    _decoderQueue = dispatch_queue_create("cn.toside.music.mobile.streamingflac.decoder", DISPATCH_QUEUE_SERIAL);
    _renderQueue = dispatch_queue_create("cn.toside.music.mobile.streamingflac.render", DISPATCH_QUEUE_SERIAL);
    _currentState = @"idle";
    _startThresholdSeconds = 1.5;
    _maxBufferSeconds = 8.0;
    _pausedBufferSeconds = 2.0;
    _currentVolume = 1.0f;
    _currentRate = 1.0f;
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(handleAudioSessionInterruption:)
                                                 name:AVAudioSessionInterruptionNotification
                                               object:[AVAudioSession sharedInstance]];
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(handleApplicationWillResignActive:)
                                                 name:UIApplicationWillResignActiveNotification
                                               object:nil];
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(handleApplicationDidEnterBackground:)
                                                 name:UIApplicationDidEnterBackgroundNotification
                                               object:nil];
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(handleApplicationDidBecomeActive:)
                                                 name:UIApplicationDidBecomeActiveNotification
                                               object:nil];
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(handleSoundEffectConfigChanged:)
                                                 name:LXSoundEffectConfigDidChangeNotification
                                               object:nil];
  }
  return self;
}

- (void)dealloc {
  [[NSNotificationCenter defaultCenter] removeObserver:self];
}

- (NSArray<NSString *> *)supportedEvents {
  return @[ @"streaming-flac-event" ];
}

- (void)startObserving {
  self.hasListeners = YES;
}

- (void)stopObserving {
  self.hasListeners = NO;
}

- (void)emitEventWithType:(NSString *)type body:(NSDictionary *)body {
  if (!self.hasListeners) return;
  NSMutableDictionary *payload = body != nil ? [body mutableCopy] : [NSMutableDictionary dictionary];
  payload[@"type"] = type ?: @"state";
  dispatch_async(dispatch_get_main_queue(), ^{
    [self sendEventWithName:@"streaming-flac-event" body:payload];
  });
}

- (void)emitState:(NSString *)state position:(NSNumber *)position duration:(NSNumber *)duration {
  self.currentState = state ?: @"idle";
  [self emitEventWithType:@"state" body:@{
    @"state": self.currentState,
    @"position": position ?: @(self.lastKnownPosition),
    @"duration": duration ?: @(self.duration),
  }];
}

- (void)emitErrorMessage:(NSString *)message {
  [self emitEventWithType:@"error" body:@{
    @"message": message ?: @"Unknown streaming flac error",
    @"state": self.currentState ?: @"idle",
    @"position": @(self.lastKnownPosition),
    @"duration": @(self.duration),
  }];
}

- (void)emitWarningMessage:(NSString *)message code:(NSNumber *)code statusName:(NSString *)statusName {
  NSMutableDictionary *payload = [NSMutableDictionary dictionary];
  payload[@"message"] = message ?: @"Unknown streaming flac warning";
  payload[@"state"] = self.currentState ?: @"idle";
  payload[@"position"] = @(self.lastKnownPosition);
  payload[@"duration"] = @(self.duration);
  if (code != nil) payload[@"code"] = code;
  if (statusName.length) payload[@"statusName"] = statusName;
  [self emitEventWithType:@"warning" body:payload];
}

- (BOOL)prepareAudioSession:(NSError **)error {
  AVAudioSession *session = [AVAudioSession sharedInstance];
  if (@available(iOS 13.0, *)) {
    if (![session setCategory:AVAudioSessionCategoryPlayback
                      mode:AVAudioSessionModeDefault
        routeSharingPolicy:AVAudioSessionRouteSharingPolicyLongFormAudio
                   options:0
                     error:error]) return NO;
  } else {
    if (![session setCategory:AVAudioSessionCategoryPlayback error:error]) return NO;
  }
  if (![session setActive:YES error:error]) return NO;
  return YES;
}

- (BOOL)isCurrentStreamSession:(NSURLSession *)session task:(NSURLSessionTask *)task {
  if (session == nil || session != self.session) return NO;
  if (task != nil && task != self.task) return NO;
  return YES;
}

- (void)waitForDecoderLoopToFinish {
  dispatch_sync(self.decoderQueue, ^{
    // Wait until any previously queued decoder work has exited.
  });
}

- (int64_t)currentQueuedFrameCountLocked {
  int64_t queuedFrames = _pcmBuffer != nullptr ? (int64_t)_pcmBuffer->availableToRead() : 0;
  self.queuedFrames = queuedFrames;
  return queuedFrames;
}

- (void)updatePlaybackGenerationLocked {
  self.playbackGeneration += 1;
  _renderPlaybackGeneration.store(self.playbackGeneration, std::memory_order_release);
}

- (void)resetRealtimeRenderStateLocked {
  // ⚠️ 位置守恒：播放位置 = playbackAnchorFrame + _renderedFrames（见
  // currentPlaybackPositionLocked）。本方法会把 _renderedFrames 清零，若不同时把
  // 已渲染的帧数折进 anchor，位置就会从 (anchor + rendered) 突变到 (anchor + 0)
  // ——表现为控制中心进度条左侧时间倒退、进度条回跳。
  //
  // 但【不能无条件折算】：sampleRate <= 0 表示流已复位（resetStreamingState 会先
  // 把 sampleRate 清零、anchor 归零再调本方法），此时折算会把刚归零的 anchor 又
  // 写成旧值，让换歌后的位置凭空冒出来。故仅在「流仍有效」时守恒。
  //
  // 逐路径核对（sampleRate > 0 时才会走到折算）：
  //   ① resetStreamingState（换歌）：sampleRate 已置 0 → 不折算，anchor 保持 0 ✓
  //   ② configureAudioGraphWithSampleRate（首次配置）：anchor/rendered 均 0 → 空操作 ✓
  //   ③④ applyPendingSeekIfNeeded / seekToPosition：reset 之后显式写入
  //      playbackAnchorFrame = 目标帧，折算值被覆盖 → 落点仍正确 ✓
  //   ⑤ cleanupAudioGraphLocked ← stopStreamingInternal（停止）：sampleRate 仍 > 0，
  //      此前正缺这一步，rendered 清零而 anchor 停在旧值 → 位置回退到 anchor/sampleRate
  //      （实测可倒退数十秒）。折算后位置保持在停止那一刻 ✓
  int64_t rendered = _renderedFrames.load(std::memory_order_acquire);
  if (self.sampleRate > 0 && (self.playbackAnchorFrame != 0 || rendered != 0)) {
    int64_t completed = self.playbackAnchorFrame + rendered;
    self.completedFrames = completed;
    self.playbackAnchorFrame = completed;
    self.lastKnownPosition = MAX(0, (double)completed / self.sampleRate);
  }
  if (_pcmBuffer != nullptr) _pcmBuffer->clear();
  _renderedFrames.store(0, std::memory_order_release);
  _sourceRenderingEnabled.store(false, std::memory_order_release);
  _bufferingNotificationScheduled.store(false, std::memory_order_release);
  _endedNotificationScheduled.store(false, std::memory_order_release);
  self.queuedFrames = 0;
}

- (void)rebuildRealtimeProcessorsLocked {
  std::atomic_store_explicit(&_realtimeEqualizerProcessor, std::shared_ptr<LXRealtimeEqualizerProcessor>(), std::memory_order_release);
  std::atomic_store_explicit(&_realtimeDynamicsProcessor, std::shared_ptr<LXRealtimeDynamicsProcessor>(), std::memory_order_release);
  std::atomic_store_explicit(&_realtimeConvolutionProcessor, std::shared_ptr<LXRealtimeConvolutionProcessor>(), std::memory_order_release);
  std::atomic_store_explicit(&_realtimePitchProcessor, std::shared_ptr<LXRealtimePhaseVocoderPitchShifter>(), std::memory_order_release);
  std::atomic_store_explicit(&_realtimePannerProcessor, std::shared_ptr<LXRealtimeSpatialPannerProcessor>(), std::memory_order_release);
  _lastRealtimeEqualizerEnabled = NO;
  _lastRealtimeEqualizerGains.clear();
  self.convolutionAssetKey = nil;
  [self applySoundEffectConfigLocked];
}

- (void)scheduleBufferingStateForGeneration:(int64_t)generation {
  if (_bufferingNotificationScheduled.exchange(true, std::memory_order_acq_rel)) return;
  _sourceRenderingEnabled.store(false, std::memory_order_release);
  dispatch_async(self.renderQueue, ^{
    if (generation != self.playbackGeneration) return;
    if (_sourceRenderingEnabled.load(std::memory_order_acquire)) return;
    if (self.stopRequested || self.manualPause || !self.playbackStarted) return;
    self.lastKnownPosition = [self currentPlaybackPositionLocked];
    self.playbackStarted = NO;
    self.currentState = @"buffering";
    [self emitState:@"buffering" position:@(self.lastKnownPosition) duration:@(self.duration)];
  });
}

- (void)scheduleEndedStateForGeneration:(int64_t)generation {
  if (_endedNotificationScheduled.exchange(true, std::memory_order_acq_rel)) return;
  _sourceRenderingEnabled.store(false, std::memory_order_release);
  dispatch_async(self.renderQueue, ^{
    if (generation != self.playbackGeneration) return;
    if (_sourceRenderingEnabled.load(std::memory_order_acquire)) return;
    if (self.stopRequested || self.streamError != nil || !self.downloadCompleted || [self currentQueuedFrameCountLocked] > 0) return;
    self.lastKnownPosition = [self currentPlaybackPositionLocked];
    self.playbackStarted = NO;
    self.currentState = @"stopped";
    [self emitEventWithType:@"ended" body:@{
      @"state": @"stopped",
      @"position": @(self.lastKnownPosition),
      @"duration": @(self.duration),
    }];
  });
}

- (void)resetStreamingState {
  self.streamData = [NSMutableData data];
  self.readOffset = 0;
  self.streamError = nil;
  self.downloadCompleted = NO;
  self.stopRequested = NO;
  _streamFinished.store(false, std::memory_order_release);
  _stopRequestedFlag.store(false, std::memory_order_release);
  self.playbackStarted = NO;
  self.manualPause = NO;
  self.interruptedBySystem = NO;
  self.duration = 0;
  self.sampleRate = 0;
  self.channels = 0;
  self.bitsPerSample = 0;
  self.totalSamples = 0;
  self.expectedContentLength = -1;
  self.lastKnownPosition = 0;
  self.pendingSeekPosition = 0;
  self.queuedFrames = 0;
  self.completedFrames = 0;
  self.seekTargetFrame = 0;
  self.decodedFramesCursor = 0;
  self.seekRequested = NO;
  self.seekInProgress = NO;
  [self updatePlaybackGenerationLocked];
  self.playbackAnchorFrame = 0;
  _pitchPlaybackRate.store(1.0f, std::memory_order_release);
  [self resetRealtimeRenderStateLocked];
  self.outputFormat = nil;
  self.sourceNode = nil;
  self.reverbNode = nil;
  self.dryMixerNode = nil;
  self.wetMixerNode = nil;
  self.soundEffectMixerNode = nil;
  self.convolutionAssetKey = nil;
  self.pannerTimer = nil;
  self.pannerPhase = 0.0f;
  std::atomic_store_explicit(&_realtimeEqualizerProcessor, std::shared_ptr<LXRealtimeEqualizerProcessor>(), std::memory_order_release);
  std::atomic_store_explicit(&_realtimeDynamicsProcessor, std::shared_ptr<LXRealtimeDynamicsProcessor>(), std::memory_order_release);
  std::atomic_store_explicit(&_realtimeConvolutionProcessor, std::shared_ptr<LXRealtimeConvolutionProcessor>(), std::memory_order_release);
  std::atomic_store_explicit(&_realtimePitchProcessor, std::shared_ptr<LXRealtimePhaseVocoderPitchShifter>(), std::memory_order_release);
  std::atomic_store_explicit(&_realtimePannerProcessor, std::shared_ptr<LXRealtimeSpatialPannerProcessor>(), std::memory_order_release);
  _lastRealtimeEqualizerEnabled = NO;
  _lastRealtimeEqualizerGains.clear();
}

- (void)handleSoundEffectConfigChanged:(NSNotification *)notification {
  dispatch_async(self.renderQueue, ^{
    [self applySoundEffectConfigLocked];
  });
}

- (BOOL)shouldRestorePlaybackOutputLocked {
  if (self.stopRequested || self.currentURL.length == 0) return NO;
  if (self.manualPause) return NO;
  if (self.sourceNode == nil || self.soundEffectMixerNode == nil) return NO;
  return ![self.currentState isEqualToString:@"idle"] && ![self.currentState isEqualToString:@"stopped"];
}

- (void)restorePlaybackOutputLocked {
  if (![self shouldRestorePlaybackOutputLocked]) return;
  self.soundEffectMixerNode.outputVolume = self.currentVolume;
  if (self.timePitchNode != nil) self.timePitchNode.rate = self.currentRate;
  [self applySoundEffectConfigLocked];
}

- (void)schedulePlaybackOutputRestoreWithDelays:(NSArray<NSNumber *> *)delays {
  dispatch_async(self.renderQueue, ^{
    [self restorePlaybackOutputLocked];
  });

  for (NSNumber *delay in delays) {
    NSTimeInterval delaySeconds = MAX(delay.doubleValue, 0);
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delaySeconds * NSEC_PER_SEC)), self.renderQueue, ^{
      [self restorePlaybackOutputLocked];
    });
  }
}

- (void)stopPannerLocked {
  if (self.pannerTimer != nil) {
    dispatch_source_cancel(self.pannerTimer);
    self.pannerTimer = nil;
  }
  std::atomic_store_explicit(&_realtimePannerProcessor, std::shared_ptr<LXRealtimeSpatialPannerProcessor>(), std::memory_order_release);
  self.pannerPhase = 0.0f;
  if (self.soundEffectMixerNode != nil) self.soundEffectMixerNode.pan = 0.0f;
}

- (void)restartPannerLockedWithSoundR:(float)soundR speed:(float)speed {
  [self stopPannerLocked];
  if (self.sampleRate <= 0 || self.channels < 2) return;
  std::shared_ptr<LXRealtimeSpatialPannerProcessor> processor = std::make_shared<LXRealtimeSpatialPannerProcessor>(self.sampleRate, soundR, speed);
  std::atomic_store_explicit(&_realtimePannerProcessor, processor, std::memory_order_release);
  self.soundEffectMixerNode.pan = 0.0f;
}

- (BOOL)refreshConvolutionEngineLockedWithAssetUri:(NSString *)assetUri fileName:(NSString *)fileName mainGain:(float)mainGain sendGain:(float)sendGain {
  if (self.sampleRate <= 0 || self.channels == 0 || fileName.length == 0) {
    std::atomic_store_explicit(&_realtimeConvolutionProcessor, std::shared_ptr<LXRealtimeConvolutionProcessor>(), std::memory_order_release);
    self.convolutionAssetKey = nil;
    return NO;
  }

  NSURL *assetURL = LXSoundEffectResolveAssetURL(assetUri, fileName);
  if (assetURL == nil) {
    std::atomic_store_explicit(&_realtimeConvolutionProcessor, std::shared_ptr<LXRealtimeConvolutionProcessor>(), std::memory_order_release);
    self.convolutionAssetKey = nil;
    return NO;
  }

  NSString *assetKey = assetURL.absoluteString ?: fileName;
  std::shared_ptr<LXRealtimeConvolutionProcessor> currentProcessor = std::atomic_load_explicit(&_realtimeConvolutionProcessor, std::memory_order_acquire);
  if (currentProcessor != nullptr && [self.convolutionAssetKey isEqualToString:assetKey]) {
    currentProcessor->updateDryGain(mainGain / 10.0f, sendGain / 10.0f);
    return YES;
  }

  LXImpulseResponseData impulse = LXLoadImpulseResponse(assetURL, self.sampleRate);
  if (impulse.channels.empty()) {
    std::atomic_store_explicit(&_realtimeConvolutionProcessor, std::shared_ptr<LXRealtimeConvolutionProcessor>(), std::memory_order_release);
    self.convolutionAssetKey = nil;
    return NO;
  }

  std::shared_ptr<LXRealtimeConvolutionProcessor> processor = std::make_shared<LXRealtimeConvolutionProcessor>(
    impulse,
    self.channels,
    MIN(self.channels, (NSUInteger)2),
    mainGain / 10.0f,
    sendGain / 10.0f
  );
  if (!processor->isReady()) {
    std::atomic_store_explicit(&_realtimeConvolutionProcessor, std::shared_ptr<LXRealtimeConvolutionProcessor>(), std::memory_order_release);
    self.convolutionAssetKey = nil;
    return NO;
  }

  std::atomic_store_explicit(&_realtimeConvolutionProcessor, processor, std::memory_order_release);
  self.convolutionAssetKey = assetKey;
  return YES;
}

- (void)refreshPitchShifterEngineLockedWithPitchFactor:(float)pitchFactor {
  if (self.sampleRate <= 0 || self.channels == 0 || fabsf(pitchFactor - 1.0f) < 0.01f) {
    std::atomic_store_explicit(&_realtimePitchProcessor, std::shared_ptr<LXRealtimePhaseVocoderPitchShifter>(), std::memory_order_release);
    return;
  }
  std::shared_ptr<LXRealtimePhaseVocoderPitchShifter> currentProcessor = std::atomic_load_explicit(&_realtimePitchProcessor, std::memory_order_acquire);
  if (currentProcessor != nullptr) return;
  std::shared_ptr<LXRealtimePhaseVocoderPitchShifter> processor = std::make_shared<LXRealtimePhaseVocoderPitchShifter>(self.channels);
  if (!processor->isReady()) return;
  std::atomic_store_explicit(&_realtimePitchProcessor, processor, std::memory_order_release);
}

- (void)refreshDynamicsProcessorLockedWithActive:(BOOL)active {
  if (self.sampleRate <= 0 || !active) {
    std::atomic_store_explicit(&_realtimeDynamicsProcessor, std::shared_ptr<LXRealtimeDynamicsProcessor>(), std::memory_order_release);
    return;
  }

  std::shared_ptr<LXRealtimeDynamicsProcessor> processor = std::atomic_load_explicit(&_realtimeDynamicsProcessor, std::memory_order_acquire);
  if (processor != nullptr) return;

  processor = std::make_shared<LXRealtimeDynamicsProcessor>(self.sampleRate);
  if (!processor->isReady()) {
    std::atomic_store_explicit(&_realtimeDynamicsProcessor, std::shared_ptr<LXRealtimeDynamicsProcessor>(), std::memory_order_release);
    return;
  }
  std::atomic_store_explicit(&_realtimeDynamicsProcessor, processor, std::memory_order_release);
}

- (void)refreshEqualizerEngineLockedWithEnabled:(BOOL)enabled gains:(const std::vector<float> &)gains {
  if (self.sampleRate <= 0 || self.channels == 0 || !enabled) {
    std::atomic_store_explicit(&_realtimeEqualizerProcessor, std::shared_ptr<LXRealtimeEqualizerProcessor>(), std::memory_order_release);
    _lastRealtimeEqualizerEnabled = NO;
    _lastRealtimeEqualizerGains.clear();
    return;
  }

  bool hasEnabledGain = false;
  for (float gain : gains) {
    if (fabsf(gain) >= 0.01f) {
      hasEnabledGain = true;
      break;
    }
  }
  if (!hasEnabledGain) {
    std::atomic_store_explicit(&_realtimeEqualizerProcessor, std::shared_ptr<LXRealtimeEqualizerProcessor>(), std::memory_order_release);
    _lastRealtimeEqualizerEnabled = NO;
    _lastRealtimeEqualizerGains.clear();
    return;
  }

  bool hasSameConfig = _lastRealtimeEqualizerEnabled == enabled && _lastRealtimeEqualizerGains.size() == gains.size();
  if (hasSameConfig) {
    for (NSUInteger index = 0; index < gains.size(); index++) {
      if (fabsf(_lastRealtimeEqualizerGains[index] - gains[index]) >= 0.0001f) {
        hasSameConfig = false;
        break;
      }
    }
  }
  if (hasSameConfig) return;

  std::shared_ptr<LXRealtimeEqualizerProcessor> processor = std::make_shared<LXRealtimeEqualizerProcessor>(self.sampleRate, self.channels, gains);
  if (!processor->isReady()) {
    std::atomic_store_explicit(&_realtimeEqualizerProcessor, std::shared_ptr<LXRealtimeEqualizerProcessor>(), std::memory_order_release);
    _lastRealtimeEqualizerEnabled = NO;
    _lastRealtimeEqualizerGains.clear();
    return;
  }
  std::atomic_store_explicit(&_realtimeEqualizerProcessor, processor, std::memory_order_release);
  _lastRealtimeEqualizerEnabled = enabled;
  _lastRealtimeEqualizerGains = gains;
}

- (void)applySoundEffectConfigLocked {
  if (self.timePitchNode == nil) return;

  NSDictionary *config = LXCurrentSoundEffectConfig();
  NSDictionary *equalizerConfig = [config[@"equalizer"] isKindOfClass:[NSDictionary class]] ? config[@"equalizer"] : config;
  NSDictionary *convolutionConfig = [config[@"convolution"] isKindOfClass:[NSDictionary class]] ? config[@"convolution"] : nil;
  NSDictionary *pannerConfig = [config[@"panner"] isKindOfClass:[NSDictionary class]] ? config[@"panner"] : nil;
  NSDictionary *pitchShifterConfig = [config[@"pitchShifter"] isKindOfClass:[NSDictionary class]] ? config[@"pitchShifter"] : nil;

  BOOL enabled = [equalizerConfig[@"enabled"] boolValue];
  NSArray<NSNumber *> *gains = [equalizerConfig[@"gains"] isKindOfClass:[NSArray class]] ? equalizerConfig[@"gains"] : LXSoundEffectDefaultEqualizerGains();
  NSArray<NSNumber *> *frequencies = LXSoundEffectEqualizerFrequencies();
  std::vector<float> equalizerGains;
  equalizerGains.reserve(frequencies.count);
  for (NSUInteger index = 0; index < frequencies.count; index += 1) {
    id value = index < gains.count ? gains[index] : nil;
    equalizerGains.push_back([value respondsToSelector:@selector(floatValue)] ? [value floatValue] : 0.0f);
  }
  NSString *convolutionFileName = [convolutionConfig[@"fileName"] isKindOfClass:[NSString class]] ? convolutionConfig[@"fileName"] : @"";
  NSString *convolutionAssetUri = [convolutionConfig[@"assetUri"] isKindOfClass:[NSString class]] ? convolutionConfig[@"assetUri"] : @"";
  float convolutionMainGain = LXSoundEffectClampFloatValue(convolutionConfig[@"mainGain"], 10.0f, 0.0f, 50.0f);
  float convolutionSendGain = LXSoundEffectClampFloatValue(convolutionConfig[@"sendGain"], 0.0f, 0.0f, 50.0f);
  BOOL pannerEnabled = [pannerConfig[@"enabled"] boolValue];
  float pannerSoundR = LXSoundEffectClampFloatValue(pannerConfig[@"soundR"], 5.0f, 1.0f, 30.0f);
  float pannerSpeed = LXSoundEffectClampFloatValue(pannerConfig[@"speed"], 25.0f, 1.0f, 50.0f);
  float pitchPlaybackRate = LXSoundEffectClampFloatValue(pitchShifterConfig[@"playbackRate"], 1.0f, 0.5f, 1.5f);
  BOOL hasConvolution = convolutionFileName.length > 0;
  BOOL hasPitchShift = fabsf(pitchPlaybackRate - 1.0f) >= 0.01f;
  _pitchPlaybackRate.store(pitchPlaybackRate, std::memory_order_release);
  [self refreshEqualizerEngineLockedWithEnabled:enabled gains:equalizerGains];
  [self refreshDynamicsProcessorLockedWithActive:(enabled || hasConvolution || pannerEnabled || hasPitchShift)];
  BOOL usesTrueConvolution = hasConvolution && [self refreshConvolutionEngineLockedWithAssetUri:convolutionAssetUri fileName:convolutionFileName mainGain:convolutionMainGain sendGain:convolutionSendGain];
  if (!hasConvolution) {
    std::atomic_store_explicit(&_realtimeConvolutionProcessor, std::shared_ptr<LXRealtimeConvolutionProcessor>(), std::memory_order_release);
    self.convolutionAssetKey = nil;
  }
  [self refreshPitchShifterEngineLockedWithPitchFactor:pitchPlaybackRate];
  if (pannerEnabled) {
    std::shared_ptr<LXRealtimeSpatialPannerProcessor> pannerProcessor = std::atomic_load_explicit(&_realtimePannerProcessor, std::memory_order_acquire);
    if (pannerProcessor == nullptr) [self restartPannerLockedWithSoundR:pannerSoundR speed:pannerSpeed];
    else pannerProcessor->updateSoundR(pannerSoundR, pannerSpeed);
  } else {
    [self stopPannerLocked];
  }

  if (self.timePitchNode != nil) {
    self.timePitchNode.rate = self.currentRate;
    self.timePitchNode.pitch = 0.0f;
  }

  if (self.reverbNode != nil) {
    self.reverbNode.wetDryMix = 100.0f;
    self.reverbNode.bypass = !hasConvolution || usesTrueConvolution;
    if (hasConvolution && !usesTrueConvolution) [self.reverbNode loadFactoryPreset:LXSoundEffectReverbPresetForFileName(convolutionFileName)];
  }
  if (self.dryMixerNode != nil) self.dryMixerNode.outputVolume = usesTrueConvolution ? 1.0f : (hasConvolution ? (convolutionMainGain / 10.0f) : 1.0f);
  if (self.wetMixerNode != nil) self.wetMixerNode.outputVolume = usesTrueConvolution ? 0.0f : (hasConvolution ? (convolutionSendGain / 10.0f) : 0.0f);
  if (self.soundEffectMixerNode != nil) self.soundEffectMixerNode.outputVolume = self.currentVolume;

}

- (void)handleAudioSessionInterruption:(NSNotification *)notification {
  NSDictionary *userInfo = notification.userInfo;
  if (userInfo == nil || self.currentURL.length == 0) return;

  AVAudioSessionInterruptionType type = (AVAudioSessionInterruptionType)[userInfo[AVAudioSessionInterruptionTypeKey] unsignedIntegerValue];
  switch (type) {
    case AVAudioSessionInterruptionTypeBegan: {
      __block BOOL shouldEmitPause = NO;
      dispatch_sync(self.renderQueue, ^{
        BOOL shouldHandle = self.sourceNode != nil && (self.playbackStarted || [self.currentState isEqualToString:@"buffering"]);
        if (!shouldHandle || self.manualPause) return;
        self.lastKnownPosition = [self currentPlaybackPositionLocked];
        if (self.engine != nil && self.engine.isRunning) [self.engine pause];
        _sourceRenderingEnabled.store(false, std::memory_order_release);
        self.playbackStarted = NO;
        shouldEmitPause = YES;
      });
      if (!shouldEmitPause) return;
      self.interruptedBySystem = YES;
      self.currentState = @"paused";
      [self emitState:@"paused" position:@(self.lastKnownPosition) duration:@(self.duration)];
      break;
    }
    case AVAudioSessionInterruptionTypeEnded: {
      BOOL shouldResume = ([userInfo[AVAudioSessionInterruptionOptionKey] unsignedIntegerValue] & AVAudioSessionInterruptionOptionShouldResume) != 0;
      if (!self.interruptedBySystem || self.manualPause || !shouldResume) {
        self.interruptedBySystem = NO;
        return;
      }

      self.interruptedBySystem = NO;
      NSError *sessionError = nil;
      if (![self prepareAudioSession:&sessionError]) {
        [self emitErrorMessage:sessionError.localizedDescription ?: @"Failed to reactivate audio session"];
        return;
      }

      __block NSError *engineError = nil;
      __block BOOL didResumePlaying = NO;
      __block BOOL shouldEmitBuffering = NO;
      dispatch_sync(self.renderQueue, ^{
        if (![self ensureAudioEngineRunningLocked:&engineError]) return;
        self.manualPause = NO;
        [self maybeStartPlaybackLocked];
        didResumePlaying = self.playbackStarted;
        if (!didResumePlaying) {
          self.currentState = @"buffering";
          shouldEmitBuffering = YES;
        }
      });
      if (engineError != nil) {
        [self emitErrorMessage:engineError.localizedDescription ?: @"Failed to restart audio engine after interruption"];
        return;
      }
      [self schedulePlaybackOutputRestoreWithDelays:@[ @0.15, @0.6 ]];
      if (shouldEmitBuffering) {
        [self emitState:@"buffering" position:@(self.lastKnownPosition) duration:@(self.duration)];
      }
      break;
    }
    default:
      break;
  }
}

- (void)cleanupAudioGraphLocked {
  [self stopPannerLocked];
  [self resetRealtimeRenderStateLocked];
  if (self.engine != nil) {
    [self.engine stop];
    if (self.sourceNode != nil) [self.engine detachNode:self.sourceNode];
    if (self.timePitchNode != nil) [self.engine detachNode:self.timePitchNode];
    if (self.reverbNode != nil) [self.engine detachNode:self.reverbNode];
    if (self.dryMixerNode != nil) [self.engine detachNode:self.dryMixerNode];
    if (self.wetMixerNode != nil) [self.engine detachNode:self.wetMixerNode];
    if (self.soundEffectMixerNode != nil) [self.engine detachNode:self.soundEffectMixerNode];
  }
  self.sourceNode = nil;
  self.timePitchNode = nil;
  self.reverbNode = nil;
  self.dryMixerNode = nil;
  self.wetMixerNode = nil;
  self.soundEffectMixerNode = nil;
  self.engine = nil;
  self.outputFormat = nil;
  std::atomic_store_explicit(&_realtimeEqualizerProcessor, std::shared_ptr<LXRealtimeEqualizerProcessor>(), std::memory_order_release);
  std::atomic_store_explicit(&_realtimeDynamicsProcessor, std::shared_ptr<LXRealtimeDynamicsProcessor>(), std::memory_order_release);
  std::atomic_store_explicit(&_realtimeConvolutionProcessor, std::shared_ptr<LXRealtimeConvolutionProcessor>(), std::memory_order_release);
  std::atomic_store_explicit(&_realtimePitchProcessor, std::shared_ptr<LXRealtimePhaseVocoderPitchShifter>(), std::memory_order_release);
  _lastRealtimeEqualizerEnabled = NO;
  _lastRealtimeEqualizerGains.clear();
  _pcmBuffer.reset();
}

- (double)currentPlaybackPositionLocked {
  if (self.sampleRate <= 0) return self.lastKnownPosition;
  int64_t renderedFrames = _renderedFrames.load(std::memory_order_acquire);
  // 【55b199a 回退】_renderedFrames 在 AVAudioEngine 输出渲染回调（renderSource-
  // FramesToBufferList）里累计——它是「已从输出环取走、交给扬声器」的已播帧数，
  // anchor + rendered 本就是可听位置；当时误判为解码写环计数、再减 queued 造成
  // 双重扣减，位置滞后一个环深（快进/快退后歌词落后于音频数秒，真机实锤）。
  self.completedFrames = self.playbackAnchorFrame + renderedFrames;
  self.lastKnownPosition = MAX(0, (double)self.completedFrames / self.sampleRate);
  return self.lastKnownPosition;
}

- (double)currentBufferedPositionLocked {
  double position = [self currentPlaybackPositionLocked];
  double buffered = position;
  NSUInteger streamLength = 0;
  NSUInteger readOffset = 0;
  [self.streamCondition lock];
  streamLength = self.streamData.length;
  readOffset = self.readOffset;
  [self.streamCondition unlock];

  if (self.sampleRate > 0) {
    int64_t queuedFrames = [self currentQueuedFrameCountLocked];
    buffered = MAX(buffered, position + MAX(0, (double)queuedFrames / self.sampleRate));

    NSUInteger availableCompressedBytes = streamLength > readOffset ? streamLength - readOffset : 0;
    if (readOffset > 0 && self.decodedFramesCursor > 0 && availableCompressedBytes > 0) {
      double estimatedDecodedFrames = ((double)availableCompressedBytes * (double)self.decodedFramesCursor) / (double)readOffset;
      buffered = MAX(buffered, position + ((double)queuedFrames + estimatedDecodedFrames) / self.sampleRate);
    }
  }

  if (self.expectedContentLength > 0 && self.duration > 0 && streamLength > 0) {
    double downloadedPosition = ((double)streamLength / (double)self.expectedContentLength) * self.duration;
    buffered = MAX(buffered, downloadedPosition);
  }

  if (self.duration > 0) buffered = MIN(buffered, self.duration);
  return buffered;
}

- (OSStatus)renderSourceFramesToBufferList:(AudioBufferList *)outputData
                                 frameCount:(AVAudioFrameCount)frameCount
                                  isSilence:(BOOL *)isSilence
                                  timestamp:(const AudioTimeStamp *)timestamp {
  if (outputData == NULL || frameCount == 0) {
    if (isSilence != NULL) *isSilence = YES;
    return noErr;
  }

  UInt32 bufferCount = outputData->mNumberBuffers;
  float **channelPointers = (float **)alloca(sizeof(float *) * MAX((UInt32)1, bufferCount));
  for (UInt32 channel = 0; channel < bufferCount; channel++) {
    channelPointers[channel] = (float *)outputData->mBuffers[channel].mData;
    if (channelPointers[channel] != NULL) memset(channelPointers[channel], 0, (size_t)frameCount * sizeof(float));
  }

  if (_stopRequestedFlag.load(std::memory_order_acquire) || !_sourceRenderingEnabled.load(std::memory_order_acquire) || _pcmBuffer == nullptr) {
    if (isSilence != NULL) *isSilence = YES;
    return noErr;
  }

  NSUInteger activeChannels = MIN((NSUInteger)bufferCount, self.channels);
  size_t framesRead = _pcmBuffer->read(channelPointers, frameCount, activeChannels);
  if (framesRead > 0) {
    std::shared_ptr<LXRealtimeEqualizerProcessor> equalizerProcessor = std::atomic_load_explicit(&_realtimeEqualizerProcessor, std::memory_order_acquire);
    if (equalizerProcessor != nullptr) {
      equalizerProcessor->processPCMChannels(channelPointers, (NSUInteger)framesRead, activeChannels);
    }

    std::shared_ptr<LXRealtimePhaseVocoderPitchShifter> pitchProcessor = std::atomic_load_explicit(&_realtimePitchProcessor, std::memory_order_acquire);
    if (pitchProcessor != nullptr) {
      pitchProcessor->processPCMChannels(channelPointers, (NSUInteger)framesRead, activeChannels, _pitchPlaybackRate.load(std::memory_order_acquire));
    }

    std::shared_ptr<LXRealtimeConvolutionProcessor> convolutionProcessor = std::atomic_load_explicit(&_realtimeConvolutionProcessor, std::memory_order_acquire);
    if (convolutionProcessor != nullptr) {
      convolutionProcessor->processPCMChannels(channelPointers, (NSUInteger)framesRead, activeChannels);
    }

    std::shared_ptr<LXRealtimeDynamicsProcessor> dynamicsProcessor = std::atomic_load_explicit(&_realtimeDynamicsProcessor, std::memory_order_acquire);
    if (dynamicsProcessor != nullptr) {
      dynamicsProcessor->processPCMChannels(channelPointers, (NSUInteger)framesRead, activeChannels);
    }

    std::shared_ptr<LXRealtimeSpatialPannerProcessor> pannerProcessor = std::atomic_load_explicit(&_realtimePannerProcessor, std::memory_order_acquire);
    if (pannerProcessor != nullptr) {
      pannerProcessor->processPCMChannels(channelPointers, (NSUInteger)framesRead, activeChannels);
    }

    for (NSUInteger channel = 0; channel < activeChannels; channel++) {
      for (NSUInteger frame = 0; frame < (NSUInteger)framesRead; frame++) {
        channelPointers[channel][frame] = fmaxf(fminf(channelPointers[channel][frame], 1.0f), -1.0f);
      }
    }
  }

  _renderedFrames.fetch_add((int64_t)framesRead, std::memory_order_acq_rel);
  if (isSilence != NULL) *isSilence = framesRead == 0;

  int64_t generation = _renderPlaybackGeneration.load(std::memory_order_acquire);
  int64_t remainingFrames = _pcmBuffer != nullptr ? (int64_t)_pcmBuffer->availableToRead() : 0;
  if (_streamFinished.load(std::memory_order_acquire)) {
    if (remainingFrames == 0 && !_stopRequestedFlag.load(std::memory_order_acquire)) {
      [self scheduleEndedStateForGeneration:generation];
    }
  } else if (self.sampleRate > 0 && _sourceRenderingEnabled.load(std::memory_order_acquire) && ((double)remainingFrames / self.sampleRate) < 0.35) {
    [self scheduleBufferingStateForGeneration:generation];
  }

  return noErr;
}

- (void)configureAudioGraphWithSampleRate:(double)sampleRate channels:(NSUInteger)channels bitsPerSample:(NSUInteger)bitsPerSample {
  dispatch_sync(self.renderQueue, ^{
    if (self.engine != nil) return;

    self.outputFormat = [[AVAudioFormat alloc] initWithCommonFormat:AVAudioPCMFormatFloat32
                                                         sampleRate:sampleRate
                                                           channels:(AVAudioChannelCount)channels
                                                        interleaved:NO];
    NSUInteger bufferCapacityFrames = MAX((NSUInteger)llround(sampleRate * MAX(self.maxBufferSeconds + 2.0, 12.0)), (NSUInteger)4096);
    _pcmBuffer = std::make_unique<LXStreamingPlanarPCMBuffer>();
    _pcmBuffer->reset(channels, bufferCapacityFrames);
    [self resetRealtimeRenderStateLocked];
    self.engine = [[AVAudioEngine alloc] init];
    __weak StreamingFlacPlayerModule *weakSelf = self;
    self.sourceNode = [[AVAudioSourceNode alloc] initWithFormat:self.outputFormat renderBlock:^OSStatus(BOOL *isSilence, const AudioTimeStamp *timestamp, AVAudioFrameCount frameCount, AudioBufferList *outputData) {
      StreamingFlacPlayerModule *strongSelf = weakSelf;
      if (strongSelf == nil) {
        if (isSilence != NULL) *isSilence = YES;
        if (outputData != NULL) {
          for (UInt32 index = 0; index < outputData->mNumberBuffers; index++) {
            if (outputData->mBuffers[index].mData != NULL) memset(outputData->mBuffers[index].mData, 0, outputData->mBuffers[index].mDataByteSize);
          }
        }
        return noErr;
      }
      return [strongSelf renderSourceFramesToBufferList:outputData frameCount:frameCount isSilence:isSilence timestamp:timestamp];
    }];
    self.timePitchNode = [[AVAudioUnitTimePitch alloc] init];
    self.reverbNode = [[AVAudioUnitReverb alloc] init];
    self.dryMixerNode = [[AVAudioMixerNode alloc] init];
    self.wetMixerNode = [[AVAudioMixerNode alloc] init];
    self.soundEffectMixerNode = [[AVAudioMixerNode alloc] init];
    [self.engine attachNode:self.sourceNode];
    [self.engine attachNode:self.timePitchNode];
    [self.engine attachNode:self.reverbNode];
    [self.engine attachNode:self.dryMixerNode];
    [self.engine attachNode:self.wetMixerNode];
    [self.engine attachNode:self.soundEffectMixerNode];
    [self.engine connect:self.sourceNode to:self.timePitchNode format:self.outputFormat];
    AVAudioConnectionPoint *dryConnectionPoint = [[AVAudioConnectionPoint alloc] initWithNode:self.dryMixerNode bus:0];
    AVAudioConnectionPoint *reverbConnectionPoint = [[AVAudioConnectionPoint alloc] initWithNode:self.reverbNode bus:0];
    [self.engine connect:self.timePitchNode
      toConnectionPoints:@[dryConnectionPoint, reverbConnectionPoint]
                 fromBus:0
                  format:self.outputFormat];
    [self.engine connect:self.reverbNode to:self.wetMixerNode format:self.outputFormat];
    [self.engine connect:self.dryMixerNode to:self.soundEffectMixerNode format:self.outputFormat];
    [self.engine connect:self.wetMixerNode to:self.soundEffectMixerNode format:self.outputFormat];
    [self.engine connect:self.soundEffectMixerNode to:self.engine.mainMixerNode format:self.outputFormat];
    self.timePitchNode.rate = self.currentRate;
    self.reverbNode.wetDryMix = 100.0f;
    self.dryMixerNode.outputVolume = 1.0f;
    self.wetMixerNode.outputVolume = 0.0f;
    self.soundEffectMixerNode.pan = 0.0f;
    self.soundEffectMixerNode.outputVolume = self.currentVolume;
    [self applySoundEffectConfigLocked];
    [self.engine prepare];

    NSError *error = nil;
    if (![self.engine startAndReturnError:&error]) {
      self.streamError = error ?: LXError(@"streaming_flac_engine", @"Failed to start AVAudioEngine");
    }
  });

  if (self.streamError != nil) {
    [self emitErrorMessage:self.streamError.localizedDescription ?: @"Failed to start AVAudioEngine"];
  }
}

- (BOOL)ensureAudioEngineRunningLocked:(NSError **)error {
  if (self.engine != nil && !self.engine.isRunning) {
    if (![self.engine startAndReturnError:error]) return NO;
  }
  if (self.soundEffectMixerNode != nil) self.soundEffectMixerNode.outputVolume = self.currentVolume;
  if (self.timePitchNode != nil) self.timePitchNode.rate = self.currentRate;
  [self applySoundEffectConfigLocked];
  return YES;
}

- (void)maybeStartPlaybackLocked {
  if (self.manualPause || self.sourceNode == nil || self.sampleRate <= 0) return;
  if (self.engine == nil || !self.engine.isRunning) return;
  int64_t queuedFrames = [self currentQueuedFrameCountLocked];
  double queuedSeconds = (double)queuedFrames / self.sampleRate;
  if (!self.playbackStarted && (queuedSeconds >= self.startThresholdSeconds || (self.downloadCompleted && queuedFrames > 0))) {
    _sourceRenderingEnabled.store(true, std::memory_order_release);
    _bufferingNotificationScheduled.store(false, std::memory_order_release);
    _endedNotificationScheduled.store(false, std::memory_order_release);
    self.playbackStarted = YES;
    [self emitState:@"playing" position:@(self.lastKnownPosition) duration:@(self.duration)];
  }
}

- (void)handleApplicationWillResignActive:(NSNotification *)notification {
  if (self.currentURL.length == 0) return;
  [self schedulePlaybackOutputRestoreWithDelays:@[ @0.08, @0.35 ]];
}

- (void)handleApplicationDidEnterBackground:(NSNotification *)notification {
  if (self.currentURL.length == 0) return;
  [self schedulePlaybackOutputRestoreWithDelays:@[ @0.15, @0.6 ]];
}

- (void)handleApplicationDidBecomeActive:(NSNotification *)notification {
  if (self.currentURL.length == 0) return;
  [self schedulePlaybackOutputRestoreWithDelays:@[ @0.05, @0.2, @0.8 ]];
}

- (void)waitForBufferCapacityIfNeeded {
  while (!self.stopRequested && !self.seekRequested) {
    BOOL shouldWait = NO;
    if (self.sourceNode != nil && self.sampleRate > 0) {
      double queuedSeconds = (double)[self currentQueuedFrameCountLocked] / self.sampleRate;
      double limit = self.manualPause ? self.pausedBufferSeconds : self.maxBufferSeconds;
      shouldWait = limit > 0 && queuedSeconds >= limit;
    }
    if (!shouldWait) break;
    [NSThread sleepForTimeInterval:0.03];
  }
}

#if LX_HAS_LIBFLAC
- (void)applyPendingSeekIfNeeded {
  if (!self.seekRequested || self.sampleRate <= 0) return;
  // 切歌竞态守卫：登记 pendingSeek 后流代际已前进（发生过切歌/复位）= 该 seek 属于
  // 上一首歌，绝不应用到新流（新歌从 0 开始播）
  if (self.pendingSeekGeneration != self.playbackGeneration) {
    self.seekRequested = NO;
    return;
  }

  double clampedPosition = self.duration > 0
    ? LXClampDouble(self.pendingSeekPosition, 0, self.duration)
    : MAX(self.pendingSeekPosition, 0);
  int64_t targetFrame = (int64_t)llround(clampedPosition * self.sampleRate);

  self.seekRequested = NO;
  self.seekTargetFrame = MAX((int64_t)0, targetFrame);
  self.seekInProgress = self.seekTargetFrame > 0;
  self.decodedFramesCursor = 0;

  [self.streamCondition lock];
  self.readOffset = 0;
  [self.streamCondition broadcast];
  [self.streamCondition unlock];

  if (self.decoder != NULL && !FLAC__stream_decoder_reset(self.decoder)) {
    self.streamError = LXError(@"streaming_flac_seek", @"Failed to reset FLAC decoder for seek");
    [self emitErrorMessage:self.streamError.localizedDescription];
    return;
  }

  dispatch_sync(self.renderQueue, ^{
    [self updatePlaybackGenerationLocked];
    [self resetRealtimeRenderStateLocked];
    [self rebuildRealtimeProcessorsLocked];
    self.completedFrames = self.seekTargetFrame;
    self.playbackAnchorFrame = self.seekTargetFrame;
    self.lastKnownPosition = clampedPosition;
    self.playbackStarted = NO;
  });
}
#endif

- (void)schedulePCMBufferWithFrame:(const FLAC__Frame *)frame buffer:(const FLAC__int32 * const[])decodedBuffer startOffset:(NSUInteger)startOffset {
  if (self.outputFormat == nil || self.streamError != nil || _pcmBuffer == nullptr) return;

  const NSUInteger blockSize = frame->header.blocksize;
  if (startOffset >= blockSize) return;

  const NSUInteger playableFrames = blockSize - startOffset;
  std::vector<std::vector<float>> pcmChannels(self.channels, std::vector<float>(playableFrames, 0));
  std::vector<float *> channelPointers(self.channels, nullptr);
  for (NSUInteger channel = 0; channel < self.channels; channel++) {
    channelPointers[channel] = pcmChannels[channel].data();
  }
  double scale = self.bitsPerSample > 1 ? ldexp(1.0, (int)self.bitsPerSample - 1) : 1.0;
  if (scale <= 0) scale = 1.0;
  for (NSUInteger channel = 0; channel < self.channels; channel++) {
    for (NSUInteger sample = 0; sample < playableFrames; sample++) {
      FLAC__int32 value = decodedBuffer[channel][sample + startOffset];
      double normalized = LXClampDouble((double)value / scale, -1.0, 1.0);
      pcmChannels[channel][sample] = (float)normalized;
    }
  }

  size_t writtenFrames = _pcmBuffer->write(channelPointers.data(), playableFrames, self.channels);
  if (writtenFrames != playableFrames) {
    self.streamError = LXError(@"streaming_flac_buffer", @"Streaming PCM ring buffer overflow");
    [self emitErrorMessage:self.streamError.localizedDescription];
    return;
  }

  dispatch_sync(self.renderQueue, ^{
    if (self.sourceNode == nil || self.stopRequested) return;
    [self currentQueuedFrameCountLocked];
    [self maybeStartPlaybackLocked];
  });
}

- (void)startDecoderLoop {
#if !LX_HAS_LIBFLAC
  self.streamError = LXError(@"streaming_flac_decoder", @"libFLAC is not available");
  [self emitErrorMessage:self.streamError.localizedDescription];
#else
  dispatch_async(self.decoderQueue, ^{
    self.decoder = FLAC__stream_decoder_new();
    if (self.decoder == NULL) {
      self.streamError = LXError(@"streaming_flac_decoder", @"Failed to create FLAC decoder");
      [self emitErrorMessage:self.streamError.localizedDescription];
      return;
    }

    FLAC__stream_decoder_set_md5_checking(self.decoder, false);
    FLAC__StreamDecoderInitStatus initStatus = FLAC__stream_decoder_init_stream(
      self.decoder,
      LXStreamingFlacReadCallback,
      NULL,
      NULL,
      NULL,
      NULL,
      LXStreamingFlacWriteCallback,
      LXStreamingFlacMetadataCallback,
      LXStreamingFlacErrorCallback,
      (__bridge void *)self
    );
    if (initStatus != FLAC__STREAM_DECODER_INIT_STATUS_OK) {
      self.streamError = LXError(@"streaming_flac_init", [NSString stringWithFormat:@"FLAC decoder init failed: %d", initStatus]);
      [self emitErrorMessage:self.streamError.localizedDescription];
      FLAC__stream_decoder_delete(self.decoder);
      self.decoder = NULL;
      return;
    }

    while (!self.stopRequested) {
      [self applyPendingSeekIfNeeded];
      if (!FLAC__stream_decoder_process_single(self.decoder)) {
        if (self.streamError == nil) {
          self.streamError = LXError(@"streaming_flac_decode", @"FLAC decoder failed during processing");
          [self emitErrorMessage:self.streamError.localizedDescription];
        }
        break;
      }
      [self waitForBufferCapacityIfNeeded];
      if (self.totalSamples > 0 && self.decodedFramesCursor >= self.totalSamples) {
        [self finishStreamDownloadIfNeeded];
        break;
      }
      if (FLAC__stream_decoder_get_state(self.decoder) == FLAC__STREAM_DECODER_END_OF_STREAM) {
        self.downloadCompleted = YES;
        _streamFinished.store(true, std::memory_order_release);
        break;
      }
    }

    FLAC__stream_decoder_finish(self.decoder);
    FLAC__stream_decoder_delete(self.decoder);
    self.decoder = NULL;

    dispatch_async(self.renderQueue, ^{
      if (self.streamError == nil && self.downloadCompleted && [self currentQueuedFrameCountLocked] == 0 && !self.stopRequested &&
          !_endedNotificationScheduled.exchange(true, std::memory_order_acq_rel)) {
        self.lastKnownPosition = [self currentPlaybackPositionLocked];
        self.playbackStarted = NO;
        self.currentState = @"stopped";
        [self emitEventWithType:@"ended" body:@{
          @"state": @"stopped",
          @"position": @(self.lastKnownPosition),
          @"duration": @(self.duration),
        }];
      }
    });
  });
#endif
}

- (void)stopStreamingInternal:(BOOL)resetAudio {
  self.stopRequested = YES;
  _stopRequestedFlag.store(true, std::memory_order_release);
  [self.streamCondition lock];
  self.downloadCompleted = YES;
  _streamFinished.store(true, std::memory_order_release);
  [self.streamCondition broadcast];
  [self.streamCondition unlock];
  [self.task cancel];
  [self.session invalidateAndCancel];
  self.task = nil;
  self.session = nil;
  if (resetAudio) {
    dispatch_sync(self.renderQueue, ^{
      self.lastKnownPosition = [self currentPlaybackPositionLocked];
      [self updatePlaybackGenerationLocked];
      [self cleanupAudioGraphLocked];
    });
  }
  [self waitForDecoderLoopToFinish];
}

- (void)finishStreamDownloadIfNeeded {
  NSURLSessionDataTask *task = self.task;
  NSURLSession *session = self.session;
  self.task = nil;
  self.session = nil;
  self.downloadCompleted = YES;
  _streamFinished.store(true, std::memory_order_release);
  [self.streamCondition lock];
  [self.streamCondition broadcast];
  [self.streamCondition unlock];
  if (task != nil) [task cancel];
  if (session != nil) [session invalidateAndCancel];
}

- (void)restartDecoderLoopForSeek {
  self.stopRequested = YES;
  _stopRequestedFlag.store(true, std::memory_order_release);
  [self.streamCondition lock];
  [self.streamCondition broadcast];
  [self.streamCondition unlock];
  dispatch_sync(self.decoderQueue, ^{});
  self.stopRequested = NO;
  _stopRequestedFlag.store(false, std::memory_order_release);
  self.streamError = nil;
  self.readOffset = 0;
  [self startDecoderLoop];
}

RCT_REMAP_METHOD(openStream, openStream:(NSString *)urlString headers:(NSDictionary *)headers volume:(nonnull NSNumber *)volume rate:(nonnull NSNumber *)rate autoplay:(nonnull NSNumber *)autoplay resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (![urlString isKindOfClass:[NSString class]] || urlString.length == 0) {
      NSError *error = LXError(@"streaming_flac_url", @"Missing FLAC stream url");
      reject(@"streaming_flac_url", error.localizedDescription, error);
      return;
    }

    // 从 TrackPlayer 或其它持有者手中接管音频会话时需要「先停用再重新配置」：直接在已激活的
    // 会话上 setCategory，iOS 可能无法重新应用 LongFormAudio 策略，导致 AVAudioEngine 运行
    // 正常但无音频输出。
    // 但**同驱动换歌不要重复停用**：停用会让 iOS 撤回本 App 的 Now Playing 角色，重新激活后
    // 若信息/播放态发布早于会话就绪就会被系统忽略 —— 现象是「有声音，但控制中心/灵动岛按钮
    // 与进度条全部失效，重启或下一次发布才可能恢复」（2026-10-06 真机复现，nativeFlac 路径）。
    AVAudioSession *session = [AVAudioSession sharedInstance];
    if (!LXStreamingFlacOwnsAudioSession) {
      [session setActive:NO withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation error:nil];
    }

    NSError *sessionError = nil;
    if (![self prepareAudioSession:&sessionError]) {
      [self emitErrorMessage:sessionError.localizedDescription ?: @"Failed to activate audio session"];
      reject(@"streaming_flac_session", sessionError.localizedDescription ?: @"Failed to activate audio session", sessionError);
      return;
    }
    // 会话已由本引擎接管：后续同驱动换歌 / 重新 openStream 不再停用会话
    LXStreamingFlacOwnsAudioSession = YES;

    [self stopStreamingInternal:YES];
    [self resetStreamingState];
    self.currentURL = urlString;
    self.currentState = @"loading";
    self.currentVolume = [volume floatValue];
    self.currentRate = MAX([rate floatValue], 0.5f);
    BOOL shouldAutoplay = autoplay == nil ? YES : [autoplay boolValue];
    self.manualPause = !shouldAutoplay;
    self.interruptedBySystem = NO;
    LXBeginReceivingRemoteControlEvents();
    [self emitState:(shouldAutoplay ? @"loading" : @"paused") position:@0 duration:@0];

    NSURL *url = [NSURL URLWithString:urlString];
    if (url == nil) {
      NSError *error = LXError(@"streaming_flac_url", @"Invalid FLAC stream url");
      reject(@"streaming_flac_url", error.localizedDescription, error);
      return;
    }

    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
    if ([headers isKindOfClass:[NSDictionary class]]) {
      for (NSString *key in headers) {
        NSString *value = [headers[key] isKindOfClass:[NSString class]] ? headers[key] : nil;
        if (value.length) [request setValue:value forHTTPHeaderField:key];
      }
    }

    NSOperationQueue *delegateQueue = [[NSOperationQueue alloc] init];
    delegateQueue.maxConcurrentOperationCount = 1;
    self.session = [NSURLSession sessionWithConfiguration:[NSURLSessionConfiguration defaultSessionConfiguration] delegate:self delegateQueue:delegateQueue];
    self.task = [self.session dataTaskWithRequest:request];
    self.startThresholdSeconds = 1.5;
    [self.task resume];
    [self startDecoderLoop];
    resolve(nil);
  });
}

RCT_REMAP_METHOD(resume, resumeStreamWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    NSError *sessionError = nil;
    if (![self prepareAudioSession:&sessionError]) {
      [self emitErrorMessage:sessionError.localizedDescription ?: @"Failed to activate audio session"];
      reject(@"streaming_flac_resume", sessionError.localizedDescription ?: @"Failed to activate audio session", sessionError);
      return;
    }

    __block NSError *engineError = nil;
    __block BOOL shouldEmitBuffering = NO;
    dispatch_sync(self.renderQueue, ^{
      if (![self ensureAudioEngineRunningLocked:&engineError]) return;
      self.manualPause = NO;
      self.interruptedBySystem = NO;
      [self maybeStartPlaybackLocked];
      shouldEmitBuffering = !self.playbackStarted;
      if (shouldEmitBuffering) self.currentState = @"buffering";
    });

    if (engineError != nil) {
      [self emitErrorMessage:engineError.localizedDescription ?: @"Failed to restart audio engine before resuming playback"];
      reject(@"streaming_flac_resume", engineError.localizedDescription ?: @"Failed to restart audio engine before resuming playback", engineError);
      return;
    }

    if (shouldEmitBuffering) {
      [self emitState:@"buffering" position:@(self.lastKnownPosition) duration:@(self.duration)];
    }
    LXBeginReceivingRemoteControlEvents();
    resolve(nil);
  });
}

RCT_REMAP_METHOD(pause, pauseStreamWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSError *sessionError = nil;
  [self prepareAudioSession:&sessionError];
  dispatch_sync(self.renderQueue, ^{
    self.lastKnownPosition = [self currentPlaybackPositionLocked];
    self.manualPause = YES;
    self.interruptedBySystem = NO;
    if (self.engine != nil && self.engine.isRunning) [self.engine pause];
    _sourceRenderingEnabled.store(false, std::memory_order_release);
    self.playbackStarted = NO;
  });
  LXBeginReceivingRemoteControlEvents();
  [self emitState:@"paused" position:@(self.lastKnownPosition) duration:@(self.duration)];
  resolve(nil);
}

RCT_REMAP_METHOD(stop, stopStreamWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  self.manualPause = YES;
  self.interruptedBySystem = NO;
  [self stopStreamingInternal:YES];
  self.currentState = @"stopped";
  [self emitState:@"stopped" position:@0 duration:@(self.duration)];
  resolve(nil);
}

RCT_REMAP_METHOD(reset, resetStreamWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  [self stopStreamingInternal:YES];
  [self resetStreamingState];
  LXEndReceivingRemoteControlEvents();
  self.currentState = @"idle";
  [self emitState:@"idle" position:@0 duration:@0];
  resolve(nil);
}

RCT_REMAP_METHOD(seekTo, seekToStream:(nonnull NSNumber *)position resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if (self.currentURL.length == 0 || [self.currentState isEqualToString:@"idle"] || [self.currentState isEqualToString:@"stopped"]) {
    NSError *error = LXError(@"streaming_flac_seek", @"No streaming FLAC playback to seek");
    reject(@"streaming_flac_seek", error.localizedDescription, error);
    return;
  }
  if (self.decoder == NULL && self.sampleRate > 0) {
    NSError *error = LXError(@"streaming_flac_seek", @"Streaming FLAC decoder is no longer active");
    reject(@"streaming_flac_seek", error.localizedDescription, error);
    return;
  }

  double requestedPosition = MAX([position doubleValue], 0);
  if (self.duration > 0) requestedPosition = LXClampDouble(requestedPosition, 0, self.duration);

  // 【切歌竞态守卫】seek 与切歌（resetStreamingState → playbackGeneration++）并发时，
  // 旧歌的 seek 会落在新流上：锚点/lastKnownPosition 被写到旧目标、pendingSeek 在
  // 新流解码时被应用 → 新歌不从头上播放（真机有概率复现）。以请求时刻的 generation
  // 与 currentURL 为凭：应用锚点前后各校验一次，任一变化即整单作废（resolve(@0)，
  // JS 侧 targetPosition=0 不走快路径，不会污染新流）。
  int64_t entryGeneration = self.playbackGeneration;
  NSString *entryURL = self.currentURL;
  __block BOOL seekApplied = NO;

  dispatch_sync(self.renderQueue, ^{
    if (self.playbackGeneration != entryGeneration || ![entryURL isEqualToString:self.currentURL]) return;
    seekApplied = YES;
    self.lastKnownPosition = requestedPosition;
    [self updatePlaybackGenerationLocked];
    [self resetRealtimeRenderStateLocked];
    [self rebuildRealtimeProcessorsLocked];
    self.completedFrames = self.sampleRate > 0 ? (int64_t)llround(requestedPosition * self.sampleRate) : 0;
    self.playbackAnchorFrame = self.completedFrames;
    self.playbackStarted = NO;
  });
  if (!seekApplied || self.playbackGeneration != entryGeneration + 1 || ![entryURL isEqualToString:self.currentURL]) {
    resolve(@0);
    return;
  }

  self.pendingSeekPosition = requestedPosition;
  self.pendingSeekGeneration = self.playbackGeneration;
  self.seekRequested = YES;
  self.seekInProgress = self.sampleRate > 0 && requestedPosition > 0;
  self.currentState = self.manualPause ? @"paused" : @"buffering";
  // seek 生效窗口冻结控制中心/灵动岛/锁屏歌词时钟（对齐上游 waiting→lrc.pause）。
  // nativeFlac 的 emitState 只发 JS 桥、原生时钟收不到生命周期事件（AVPlayer 路径
  // 由 RNTrackPlayer 生命周期通知驱动冻结，本路径没有），不冻结会在整个重解码
  // 缓冲期从旧位置继续外推——歌词在静音期往前走。出声后 JS 确认 playing 才发布
  // 正速率，由「见正 playbackRate 即解除」（LXSetNowPlayingInfo 内）自动解冻，
  // 并随同一次发布的带戳位置重锚到真实落点。
  LXNowPlayingClockHold = YES;
  [self.streamCondition lock];
  [self.streamCondition broadcast];
  [self.streamCondition unlock];

  [self emitState:self.currentState position:@(requestedPosition) duration:@(self.duration)];
  resolve(@(requestedPosition));
}

RCT_REMAP_METHOD(setVolume, setStreamVolume:(nonnull NSNumber *)volume resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  self.currentVolume = [volume floatValue];
  dispatch_sync(self.renderQueue, ^{
    if (self.soundEffectMixerNode != nil) self.soundEffectMixerNode.outputVolume = self.currentVolume;
  });
  resolve(nil);
}

RCT_REMAP_METHOD(setRate, setStreamRate:(nonnull NSNumber *)rate resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  self.currentRate = MAX([rate floatValue], 0.5f);
  dispatch_sync(self.renderQueue, ^{
    if (self.timePitchNode != nil) self.timePitchNode.rate = self.currentRate;
  });
  resolve(nil);
}

RCT_REMAP_METHOD(getPosition, getStreamPositionWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  __block double position = 0;
  dispatch_sync(self.renderQueue, ^{
    position = [self currentPlaybackPositionLocked];
  });
  resolve(@(position));
}

// 带原生时钟戳的位置快照：position 为 renderQueue 内取得的引擎真实位置，
// snapshotAt 为该快照对应的 CACurrentMediaTime 毫秒。JS 校准链路/元数据发布
// 据此把歌词时钟锚点回放到快照时刻（LXReanchorNowPlayingLyric），消除「快照
// 位置被钉在现在」造成的灵动岛/控制中心歌词恒定滞后（桥接往返 ~100-300ms）。
RCT_REMAP_METHOD(getPositionStamped, getStreamPositionStampedWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  __block double position = 0;
  __block double snapshotAt = 0;
  dispatch_sync(self.renderQueue, ^{
    position = [self currentPlaybackPositionLocked];
    snapshotAt = CACurrentMediaTime() * 1000.0;
  });
  resolve(@{ @"position": @(position), @"snapshotAt": @(snapshotAt) });
}

RCT_REMAP_METHOD(getBufferedPosition, getStreamBufferedPositionWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  __block double buffered = 0;
  dispatch_sync(self.renderQueue, ^{
    buffered = [self currentBufferedPositionLocked];
  });
  resolve(@(buffered));
}

RCT_REMAP_METHOD(getDuration, getStreamDurationWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  resolve(@(self.duration));
}

RCT_REMAP_METHOD(getState, getStreamStateWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  resolve(self.currentState ?: @"idle");
}

- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)dataTask didReceiveResponse:(NSURLResponse *)response completionHandler:(void (^)(NSURLSessionResponseDisposition disposition))completionHandler {
  if (![self isCurrentStreamSession:session task:dataTask]) {
    completionHandler(NSURLSessionResponseCancel);
    return;
  }
  int64_t expectedContentLength = response.expectedContentLength;
  if (expectedContentLength <= 0 && [response isKindOfClass:[NSHTTPURLResponse class]]) {
    id contentLengthValue = [((NSHTTPURLResponse *)response) allHeaderFields][@"Content-Length"];
    if ([contentLengthValue isKindOfClass:[NSString class]]) expectedContentLength = [contentLengthValue longLongValue];
  }
  self.expectedContentLength = expectedContentLength > 0 ? expectedContentLength : -1;
  completionHandler(NSURLSessionResponseAllow);
}

- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)dataTask didReceiveData:(NSData *)data {
  if (![self isCurrentStreamSession:session task:dataTask]) return;
  if (self.stopRequested || !data.length) return;
  [self.streamCondition lock];
  [self.streamData appendData:data];
  [self.streamCondition broadcast];
  [self.streamCondition unlock];
}

- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task didCompleteWithError:(NSError *)error {
  if (![self isCurrentStreamSession:session task:task]) return;
  [self.streamCondition lock];
  if (error != nil && error.code != NSURLErrorCancelled) {
    self.streamError = error;
    [self emitErrorMessage:error.localizedDescription ?: @"FLAC stream download failed"];
  }
  self.downloadCompleted = YES;
  _streamFinished.store(true, std::memory_order_release);
  [self.streamCondition broadcast];
  [self.streamCondition unlock];
}

#if LX_HAS_LIBFLAC
- (FLAC__StreamDecoderReadStatus)readBytes:(FLAC__byte *)buffer bytes:(size_t *)bytes {
  [self.streamCondition lock];
  while (!self.stopRequested) {
    NSUInteger available = self.streamData.length > self.readOffset ? self.streamData.length - self.readOffset : 0;
    if (available > 0) {
      size_t requested = *bytes;
      size_t count = MIN(requested, available);
      memcpy(buffer, ((const FLAC__byte *)self.streamData.bytes) + self.readOffset, count);
      self.readOffset += count;
      *bytes = count;
      [self.streamCondition unlock];
      return FLAC__STREAM_DECODER_READ_STATUS_CONTINUE;
    }
    if (self.streamError != nil) {
      [self.streamCondition unlock];
      return FLAC__STREAM_DECODER_READ_STATUS_ABORT;
    }
    if (self.downloadCompleted) {
      *bytes = 0;
      [self.streamCondition unlock];
      return FLAC__STREAM_DECODER_READ_STATUS_END_OF_STREAM;
    }
    [self.streamCondition waitUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.1]];
  }
  [self.streamCondition unlock];
  return FLAC__STREAM_DECODER_READ_STATUS_ABORT;
}

- (void)handleStreamInfo:(const FLAC__StreamMetadata_StreamInfo *)streamInfo {
  self.sampleRate = streamInfo->sample_rate;
  self.channels = streamInfo->channels;
  self.bitsPerSample = streamInfo->bits_per_sample;
  self.totalSamples = (int64_t)streamInfo->total_samples;
  self.duration = streamInfo->total_samples > 0 && streamInfo->sample_rate > 0
    ? (double)streamInfo->total_samples / streamInfo->sample_rate
    : 0;
  [self configureAudioGraphWithSampleRate:self.sampleRate channels:self.channels bitsPerSample:self.bitsPerSample];
}

- (FLAC__StreamDecoderWriteStatus)handleFrame:(const FLAC__Frame *)frame buffer:(const FLAC__int32 * const[])decodedBuffer {
  if (self.streamError != nil) return FLAC__STREAM_DECODER_WRITE_STATUS_ABORT;

  const NSUInteger blockSize = frame->header.blocksize;
  const int64_t frameStart = self.decodedFramesCursor;
  const int64_t frameEnd = frameStart + (int64_t)blockSize;
  NSUInteger startOffset = 0;
  self.decodedFramesCursor = frameEnd;

  if (self.seekInProgress) {
    if (frameEnd <= self.seekTargetFrame) return FLAC__STREAM_DECODER_WRITE_STATUS_CONTINUE;
    if (self.seekTargetFrame > frameStart) startOffset = (NSUInteger)(self.seekTargetFrame - frameStart);
    self.seekInProgress = NO;
  }

  [self waitForBufferCapacityIfNeeded];
  if (self.stopRequested || self.seekRequested) return FLAC__STREAM_DECODER_WRITE_STATUS_CONTINUE;

  [self schedulePCMBufferWithFrame:frame buffer:decodedBuffer startOffset:startOffset];
  return self.streamError == nil ? FLAC__STREAM_DECODER_WRITE_STATUS_CONTINUE : FLAC__STREAM_DECODER_WRITE_STATUS_ABORT;
}

- (void)handleDecoderErrorStatus:(FLAC__StreamDecoderErrorStatus)status {
  if (self.stopRequested) return;
  NSString *statusName = LXStreamingFlacDecoderErrorStatusName(status);
  dispatch_sync(self.renderQueue, ^{
    self.lastKnownPosition = [self currentPlaybackPositionLocked];
  });
  if (status == FLAC__STREAM_DECODER_ERROR_STATUS_LOST_SYNC) {
    if (self.totalSamples > 0 && self.decodedFramesCursor >= self.totalSamples) return;
    [self emitWarningMessage:[NSString stringWithFormat:@"FLAC decoder warning: %@ (%d)", statusName, status]
                        code:@(status)
                  statusName:statusName];
    return;
  }
  self.streamError = LXError(@"streaming_flac_decode", [NSString stringWithFormat:@"FLAC decoder error: %@ (%d)", statusName, status]);
  [self emitErrorMessage:self.streamError.localizedDescription];
  [self.streamCondition lock];
  [self.streamCondition broadcast];
  [self.streamCondition unlock];
}
#endif

@end

#if LX_HAS_LIBFLAC
static FLAC__StreamDecoderReadStatus LXStreamingFlacReadCallback(const FLAC__StreamDecoder *decoder, FLAC__byte buffer[], size_t *bytes, void *client_data) {
  return [(__bridge StreamingFlacPlayerModule *)client_data readBytes:buffer bytes:bytes];
}

static FLAC__StreamDecoderWriteStatus LXStreamingFlacWriteCallback(const FLAC__StreamDecoder *decoder, const FLAC__Frame *frame, const FLAC__int32 * const buffer[], void *client_data) {
  return [(__bridge StreamingFlacPlayerModule *)client_data handleFrame:frame buffer:buffer];
}

static void LXStreamingFlacMetadataCallback(const FLAC__StreamDecoder *decoder, const FLAC__StreamMetadata *metadata, void *client_data) {
  if (metadata->type != FLAC__METADATA_TYPE_STREAMINFO) return;
  [(__bridge StreamingFlacPlayerModule *)client_data handleStreamInfo:&metadata->data.stream_info];
}

static void LXStreamingFlacErrorCallback(const FLAC__StreamDecoder *decoder, FLAC__StreamDecoderErrorStatus status, void *client_data) {
  [(__bridge StreamingFlacPlayerModule *)client_data handleDecoderErrorStatus:status];
}

static NSString *LXStreamingFlacDecoderErrorStatusName(FLAC__StreamDecoderErrorStatus status) {
  if (status >= 0 && status <= FLAC__STREAM_DECODER_ERROR_STATUS_MISSING_FRAME) {
    const char *name = FLAC__StreamDecoderErrorStatusString[status];
    if (name != NULL) return [NSString stringWithUTF8String:name];
  }
  return [NSString stringWithFormat:@"UNKNOWN_%d", status];
}
#endif

@interface FilePickerModule : NSObject<RCTBridgeModule, UIDocumentPickerDelegate>
@property (nonatomic, copy) RCTPromiseResolveBlock pickerResolve;
@property (nonatomic, copy) RCTPromiseRejectBlock pickerReject;
@property (nonatomic, copy) NSString *targetPath;
@property (nonatomic, strong) UIDocumentPickerViewController *pickerController;
@property (nonatomic, assign) BOOL pickerPresenting;
@property (nonatomic, assign) BOOL pickerIsFolder;
// 分享面板（UIActivityViewController）的独立状态。不复用 picker 状态机，
// 避免与 UIDocumentPicker / 目录选择器的 busy 判断互相干扰。
@property (nonatomic, copy) RCTPromiseResolveBlock shareResolve;
@property (nonatomic, copy) RCTPromiseRejectBlock shareReject;
@property (nonatomic, strong) UIActivityViewController *shareController;
@end

@implementation FilePickerModule

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup {
  return YES;
}

- (void)resetPickerState {
  self.pickerResolve = nil;
  self.pickerReject = nil;
  self.targetPath = nil;
  self.pickerController = nil;
  self.pickerPresenting = NO;
  self.pickerIsFolder = NO;
}

- (void)rejectPickerWithCode:(NSString *)code message:(NSString *)message error:(NSError *)error {
  if (self.pickerReject != nil) self.pickerReject(code, message, error);
  [self resetPickerState];
}

RCT_REMAP_METHOD(openDocument, openDocument:(NSDictionary *)options resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self.pickerController != nil || self.pickerPresenting) {
      // 若旧 picker 已不在视图层级（例如之前 present 到了正在消失的 VC 上，delegate 永远不会回调），
      // 状态机会一直占住导致后续点击全部 busy。检测到这种 orphan picker 时强制清理并继续 present。
      BOOL isOrphan = self.pickerController != nil
        && self.pickerController.presentingViewController == nil
        && self.pickerController.view.window == nil
        && ![self.pickerController isBeingPresented];
      if (isOrphan || (self.pickerPresenting && self.pickerController == nil)) {
        if (self.pickerController != nil) {
          [self.pickerController dismissViewControllerAnimated:NO completion:^{ LXEnsureKeyWindow(); }];
        }
        [self resetPickerState];
      } else {
        reject(@"picker_busy", @"Another picker is already active", LXError(@"picker_busy", @"Another picker is already active"));
        return;
      }
    }

    self.pickerResolve = resolve;
    self.pickerReject = reject;
    self.targetPath = [options[@"toPath"] isKindOfClass:[NSString class]] ? options[@"toPath"] : @"";

    NSArray<NSString *> *documentTypes = LXDocumentTypesForExtensions(options[@"extTypes"]);
    UIDocumentPickerViewController *picker = [[UIDocumentPickerViewController alloc] initWithDocumentTypes:documentTypes inMode:UIDocumentPickerModeImport];
    picker.delegate = self;
    picker.allowsMultipleSelection = NO;
    // FormSheet 不移除底层 VC 的 view（FullScreen 会移除），降低交互异常概率。
    // 真正导致“选完文件后整屏卡死、只能重启”的根因是：UIDocumentPicker 以独立进程运行，
    // 关闭后应用主窗口常常不再是 keyWindow / 交互未恢复。该问题已由 LXEnsureKeyWindow()
    // 在关闭完成的回调中修复，与 modalPresentationStyle 无关。
    picker.modalPresentationStyle = UIModalPresentationFormSheet;
    self.pickerPresenting = YES;
    // 不立即 present：JS 侧已在调起原生面板前卸载了底层 RN Modal，但 Modal 的原生视图
    // 释放存在时序（淡出动画 / 独立 window 移除 / keyWindow 切回主窗口），过早 present
    // 会让 picker 落到正在释放的 VC 上或被残留的 Modal window 遮挡，表现为“点了没反应”。
    // 这里轮询等待到底层 Modal 彻底消失后再 present，最多等待约 2s，超时则明确报错便于定位。
    [self presentDocumentPickerWhenReady:picker attempts:0];
  });
}

- (void)presentDocumentPickerWhenReady:(UIDocumentPickerViewController *)picker attempts:(NSInteger)attempts {
  if (attempts >= 40) {
    self.pickerPresenting = NO;
    [self rejectPickerWithCode:@"picker_present" message:@"Timed out waiting for previous modal to dismiss before showing file picker" error:LXError(@"picker_present", @"Timed out waiting for previous modal to dismiss before showing file picker")];
    return;
  }
  UIViewController *controller = LXTopViewController();
  // 仍需等待的情况：
  // ① 取不到 VC；② 顶层 VC 仍持有上一个 modal（RN Modal 以 present 方式挂载）；
  // ③ 顶层 VC 自身就是 RN Modal 的 RCTModalHostViewController（Modal 直接挂在主 window 上，
  //    LXAnotherRNModalWindowPresent 检测不到，会导致 picker 呈现到正在消失的 Modal VC 上）；
  // ④ 顶层 VC 正在 dismiss；⑤ 仍有 RCTModalHostViewController 的独立 window 残留。
  BOOL isRNModalVC = controller != nil && [NSStringFromClass([controller class]) isEqualToString:@"RCTModalHostViewController"];
  BOOL isBeingDismissed = controller != nil && controller.isBeingDismissed;
  if (controller == nil || controller.presentedViewController != nil || isRNModalVC || isBeingDismissed || LXAnotherRNModalWindowPresent()) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(50 * NSEC_PER_MSEC)), dispatch_get_main_queue(), ^{
      [self presentDocumentPickerWhenReady:picker attempts:attempts + 1];
    });
    return;
  }
  [controller presentViewController:picker animated:YES completion:^{
    self.pickerController = picker;
    self.pickerPresenting = NO;
  }];
}

- (void)documentPickerWasCancelled:(UIDocumentPickerViewController *)controller {
  [controller dismissViewControllerAnimated:YES completion:^{
    LXEnsureKeyWindow();
  }];
  [self rejectPickerWithCode:@"picker_cancelled" message:@"Document selection was cancelled" error:LXError(@"picker_cancelled", @"Document selection was cancelled")];
}

- (void)documentPicker:(UIDocumentPickerViewController *)controller didPickDocumentsAtURLs:(NSArray<NSURL *> *)urls {
  NSURL *pickedURL = urls.firstObject;
  [controller dismissViewControllerAnimated:YES completion:^{
    LXEnsureKeyWindow();
  }];

  if (pickedURL == nil) {
    [self rejectPickerWithCode:@"picker_empty" message:@"No document was selected" error:LXError(@"picker_empty", @"No document was selected")];
    return;
  }

  // 目录选择模式：直接返回所选文件夹路径（不复制文件）。
  // 选择器已通过 directoryURL 限定在应用沙盒 Documents 内，所选目录恒可写，
  // 无需安全作用域书签（iOS 对沙盒外目录的持久写入才需要，已在 JS 层拒绝此类选择）。
  if (self.pickerIsFolder) {
    NSString *folderPath = [pickedURL.path stringByStandardizingPath];
    NSMutableDictionary *result = [NSMutableDictionary dictionary];
    result[@"path"] = folderPath;
    result[@"data"] = folderPath;
    if (self.pickerResolve != nil) self.pickerResolve(result);
    [self resetPickerState];
    return;
  }

  NSError *error = nil;
  BOOL startedAccessing = [pickedURL startAccessingSecurityScopedResource];
  NSString *targetPath = LXPrepareImportedFilePath(self.targetPath ?: @"", pickedURL, &error);
  if (targetPath == nil) {
    if (startedAccessing) [pickedURL stopAccessingSecurityScopedResource];
    [self rejectPickerWithCode:@"copy_target_failed" message:error.localizedDescription ?: @"Failed to prepare imported file path" error:error];
    return;
  }

  NSFileManager *fileManager = [NSFileManager defaultManager];
  [fileManager removeItemAtPath:targetPath error:nil];
  if (![fileManager copyItemAtURL:pickedURL toURL:[NSURL fileURLWithPath:targetPath] error:&error]) {
    if (startedAccessing) [pickedURL stopAccessingSecurityScopedResource];
    [self rejectPickerWithCode:@"copy_failed" message:error.localizedDescription ?: @"Failed to import selected file" error:error];
    return;
  }
  if (startedAccessing) [pickedURL stopAccessingSecurityScopedResource];

  NSDictionary *fileInfo = LXFileInfoFromPath(targetPath);
  NSMutableDictionary *result = fileInfo != nil ? [fileInfo mutableCopy] : [NSMutableDictionary dictionary];
  if (result == nil) result = [NSMutableDictionary dictionary];
  result[@"data"] = targetPath;
  if (self.pickerResolve != nil) self.pickerResolve(result);
  [self resetPickerState];
}

// 选择文件夹（系统原生目录选择器，用于"下载路径"等选目录场景）
RCT_REMAP_METHOD(selectFolder, selectFolderWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self.pickerController != nil || self.pickerPresenting) {
      reject(@"picker_busy", @"Another picker is already active", LXError(@"picker_busy", @"Another picker is already active"));
      return;
    }
    UIViewController *controller = LXTopViewController();
    if (controller == nil) {
      reject(@"picker_present", @"Unable to find a view controller to present folder picker", LXError(@"picker_present", @"Unable to find a view controller to present folder picker"));
      return;
    }

    self.pickerResolve = resolve;
    self.pickerReject = reject;
    self.pickerIsFolder = YES;

    // public.folder 在 UIDocumentPickerModeOpen 下用于选择目录。
    // 将初始目录限定在应用沙盒 Documents，用户在该范围内所选目录恒可写（无需安全作用域书签）。
    NSArray<NSString *> *documentTypes = @[@"public.folder"];
    UIDocumentPickerViewController *picker = [[UIDocumentPickerViewController alloc] initWithDocumentTypes:documentTypes inMode:UIDocumentPickerModeOpen];
    picker.directoryURL = [[NSFileManager defaultManager] URLsForDirectory:NSDocumentDirectory inDomains:NSUserDomainMask].lastObject;
    picker.delegate = self;
    picker.allowsMultipleSelection = NO;
    // 同 openDocument：FormSheet 不移除底层 view；关闭后的主窗口交互恢复由 LXEnsureKeyWindow() 负责
    picker.modalPresentationStyle = UIModalPresentationFormSheet;
    self.pickerPresenting = YES;
    [controller presentViewController:picker animated:YES completion:^{
      self.pickerController = picker;
      self.pickerPresenting = NO;
    }];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      if (self.pickerPresenting && self.pickerController == nil) {
        [self rejectPickerWithCode:@"picker_present" message:@"Folder picker did not finish presenting" error:LXError(@"picker_present", @"Folder picker did not finish presenting")];
      }
    });
  });
}

// 超时/失败时统一收敛 share 状态并 reject，避免状态卡死导致后续导出全部无响应。
- (void)finishShareSheetWithErrorCode:(NSString *)code message:(NSString *)message {
  RCTPromiseRejectBlock reject = self.shareReject;
  self.shareController = nil;
  self.shareResolve = nil;
  self.shareReject = nil;
  if (reject != nil) reject(code, message, LXError(code, message));
}

- (void)presentShareSheetWhenReady:(UIActivityViewController *)activityViewController attempts:(NSInteger)attempts {
  if (attempts >= 40) {
    [self finishShareSheetWithErrorCode:@"share_present" message:@"Timed out waiting for previous modal to dismiss before showing share sheet"];
    return;
  }
  UIViewController *controller = LXTopViewController();
  // 与 openDocument 同理，以下情况必须继续等待：
  // ① 取不到 VC；② 顶层 VC 仍持有上一个 modal；③ 顶层 VC 本身就是 RN Modal 的
  // RCTModalHostViewController；④ 顶层 VC 正在 dismiss；⑤ 仍有 Modal 独立 window 残留。
  BOOL isRNModalVC = controller != nil && [NSStringFromClass([controller class]) isEqualToString:@"RCTModalHostViewController"];
  BOOL isBeingDismissed = controller != nil && controller.isBeingDismissed;
  if (controller == nil || controller.presentedViewController != nil || isRNModalVC || isBeingDismissed || LXAnotherRNModalWindowPresent()) {
    // 本文件是 Objective-C++（.mm），C++ 模式下没有 typeof 关键字，因此这里与
    // presentDocumentPickerWhenReady 保持一致，直接捕获 self（延迟 50ms 即释放，无实际影响）。
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(50 * NSEC_PER_MSEC)), dispatch_get_main_queue(), ^{
      [self presentShareSheetWhenReady:activityViewController attempts:attempts + 1];
    });
    return;
  }
  if (UI_USER_INTERFACE_IDIOM() == UIUserInterfaceIdiomPad && controller.view != nil) {
    activityViewController.popoverPresentationController.sourceView = controller.view;
    activityViewController.popoverPresentationController.sourceRect = CGRectMake(CGRectGetMidX(controller.view.bounds), CGRectGetMaxY(controller.view.bounds), 0, 0);
    activityViewController.popoverPresentationController.permittedArrowDirections = UIPopoverArrowDirectionDown;
  }
  RCTPromiseResolveBlock resolve = self.shareResolve;
  self.shareResolve = nil;
  self.shareReject = nil;
  [controller presentViewController:activityViewController animated:YES completion:^{
    if (resolve != nil) resolve(nil);
  }];
}

// 系统分享面板（UIActivityViewController），用于"导出/保存"场景
RCT_REMAP_METHOD(shareFile, shareFile:(NSString *)filePath resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    NSString *targetPath = [filePath isKindOfClass:[NSString class]] ? [filePath stringByStandardizingPath] : @"";
    NSFileManager *fileManager = [NSFileManager defaultManager];
    if (!targetPath.length || ![fileManager fileExistsAtPath:targetPath]) {
      reject(@"file_not_found", @"File not found", LXError(@"file_not_found", @"File not found"));
      return;
    }
    // 面板已在展示：忽略重复请求，避免连点导出叠加多层面板。
    if (self.shareController != nil && self.shareController.presentingViewController != nil) {
      resolve(nil);
      return;
    }

    NSURL *fileURL = [NSURL fileURLWithPath:targetPath];
    UIActivityViewController *activityViewController = [[UIActivityViewController alloc] initWithActivityItems:@[fileURL] applicationActivities:nil];
    // 分享面板关闭后恢复主窗口为 key 并重新开启交互（兜底，真正修复依赖 JS 侧先卸载 RN Modal）。
    // 同样避免 typeof：直接捕获 self，由下面的 self.shareController = nil 在面板关闭时打破引用环。
    activityViewController.completionWithItemsHandler = ^(UIActivityType __nullable activityType, BOOL completed, NSArray * __nullable returnedItems, NSError * __nullable activityError) {
      LXEnsureKeyWindow();
      self.shareController = nil;
    };
    self.shareController = activityViewController;
    self.shareResolve = resolve;
    self.shareReject = reject;
    // 导出入口（歌单 / 备份 / 音源菜单项）都由 RN Modal 承载，点击菜单项时 Modal 仍在
    // 关闭动画中，此时 LXTopViewController() 返回的是 RCTModalHostViewController，
    // 面板会被 present 到正在消失的 VC 上并随之销毁，表现为"点了导出没任何反应"。
    // 这里轮询等到底层 Modal 彻底消失后再 present，最多等待约 2s。
    [self presentShareSheetWhenReady:activityViewController attempts:0];
  });
}



@end

@interface UserApiModule : RCTEventEmitter<RCTBridgeModule>
@property (nonatomic, strong) JSContext *jsContext;
@property (nonatomic, strong) dispatch_queue_t scriptQueue;
@property (nonatomic, copy) NSString *scriptKey;
@property (nonatomic, assign) BOOL initSent;
@property (nonatomic, assign) BOOL hasListeners;
@property (nonatomic, strong) NSDictionary *scriptInfo;
@end

@implementation UserApiModule

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

- (instancetype)init {
  self = [super init];
  if (self != nil) {
    _scriptQueue = dispatch_queue_create("cn.toside.music.mobile.userapi", DISPATCH_QUEUE_SERIAL);
  }
  return self;
}

- (NSArray<NSString *> *)supportedEvents {
  return @[ @"api-action" ];
}

- (void)startObserving {
  self.hasListeners = YES;
}

- (void)stopObserving {
  self.hasListeners = NO;
}

- (void)emitLogWithType:(NSString *)type message:(NSString *)message {
  if (!self.hasListeners) return;
  dispatch_async(dispatch_get_main_queue(), ^{
    [self sendEventWithName:@"api-action" body:@{
      @"action": @"log",
      @"type": type ?: @"log",
      @"log": message ?: @"",
    }];
  });
}

- (void)emitAction:(NSString *)action dataString:(NSString *)dataString errorMessage:(NSString *)errorMessage {
  if (!self.hasListeners) return;
  NSMutableDictionary *body = [NSMutableDictionary dictionaryWithObject:action forKey:@"action"];
  if (dataString != nil) body[@"data"] = dataString;
  if (errorMessage != nil) body[@"errorMessage"] = errorMessage;
  dispatch_async(dispatch_get_main_queue(), ^{
    [self sendEventWithName:@"api-action" body:body];
  });
}

- (NSString *)loadPreloadScript {
  NSString *path = [[NSBundle mainBundle] pathForResource:@"user-api-preload" ofType:@"js"];
  if (!path.length) return nil;
  return [NSString stringWithContentsOfFile:path encoding:NSUTF8StringEncoding error:nil];
}

- (void)emitInitFailed:(NSString *)message {
  NSDictionary *data = @{
    @"info": [NSNull null],
    @"status": @NO,
    @"errorMessage": message ?: @"Create JavaScript Env Failed",
  };
  [self emitAction:@"init" dataString:LXJSONString(data) errorMessage:(message ?: @"Create JavaScript Env Failed")];
  [self emitLogWithType:@"error" message:(message ?: @"Create JavaScript Env Failed")];
}

- (void)destroyContext {
  self.jsContext = nil;
  self.scriptKey = nil;
  self.initSent = NO;
  self.scriptInfo = nil;
}

- (void)callJSAction:(NSString *)action data:(id)data {
  if (self.jsContext == nil) return;
  JSValue *nativeCall = self.jsContext[@"__lx_native__"];
  if (nativeCall == nil || nativeCall.isUndefined) return;

  NSMutableArray *arguments = [NSMutableArray arrayWithObjects:self.scriptKey ?: @"", action ?: @"", nil];
  if (data != nil) {
    NSString *jsonString = [data isKindOfClass:[NSString class]] ? data : LXJSONString(data);
    if (jsonString != nil) [arguments addObject:jsonString];
  }
  [nativeCall callWithArguments:arguments];
}

- (BOOL)createJSEnv:(NSDictionary *)scriptInfo error:(NSString **)errorMessage {
  self.scriptKey = NSUUID.UUID.UUIDString;
  self.scriptInfo = scriptInfo;
  self.initSent = NO;
  JSContext *context = [[JSContext alloc] init];
  self.jsContext = context;

  __weak UserApiModule *weakSelf = self;
  __block NSString *lastException = nil;
  context.exceptionHandler = ^(JSContext *ctx, JSValue *exception) {
    ctx.exception = exception;
    lastException = exception.toString ?: @"Unknown JavaScript exception";
    [weakSelf emitLogWithType:@"error" message:[NSString stringWithFormat:@"Call script error: %@", lastException]];
  };

  context[@"globalThis"] = context.globalObject;
  context[@"window"] = context.globalObject;
  context[@"self"] = context.globalObject;
  context[@"global"] = context.globalObject;

  JSValue *console = [JSValue valueWithNewObjectInContext:context];
  console[@"log"] = ^{ [weakSelf emitLogWithType:@"log" message:LXJoinJSArguments([JSContext currentArguments])]; };
  console[@"info"] = ^{ [weakSelf emitLogWithType:@"info" message:LXJoinJSArguments([JSContext currentArguments])]; };
  console[@"warn"] = ^{ [weakSelf emitLogWithType:@"warn" message:LXJoinJSArguments([JSContext currentArguments])]; };
  console[@"error"] = ^{ [weakSelf emitLogWithType:@"error" message:LXJoinJSArguments([JSContext currentArguments])]; };
  context[@"console"] = console;

  context[@"__lx_native_call__"] = ^id(NSString *key, NSString *action, NSString *data) {
    if (![weakSelf.scriptKey isEqualToString:key]) return nil;
    if ([action isEqualToString:@"init"]) {
      if (weakSelf.initSent) return nil;
      weakSelf.initSent = YES;
    }
    [weakSelf emitAction:action dataString:data errorMessage:nil];
    return nil;
  };

  context[@"__lx_native_call__utils_str2b64"] = ^NSString *(NSString *input) {
    NSData *data = [input dataUsingEncoding:NSUTF8StringEncoding] ?: [NSData data];
    return [data base64EncodedStringWithOptions:0];
  };

  context[@"__lx_native_call__utils_b642buf"] = ^NSString *(NSString *input) {
    NSData *data = [[NSData alloc] initWithBase64EncodedString:input options:NSDataBase64DecodingIgnoreUnknownCharacters] ?: [NSData data];
    NSMutableArray<NSNumber *> *result = [NSMutableArray arrayWithCapacity:data.length];
    const unsigned char *bytes = (const unsigned char *)data.bytes;
    for (NSUInteger index = 0; index < data.length; index++) {
      [result addObject:@((NSInteger)bytes[index])];
    }
    return LXJSONString(result) ?: @"[]";
  };

  context[@"__lx_native_call__utils_str2md5"] = ^NSString *(NSString *input) {
    NSString *decoded = [input stringByRemovingPercentEncoding] ?: input ?: @"";
    NSData *data = [decoded dataUsingEncoding:NSUTF8StringEncoding] ?: [NSData data];
    unsigned char digest[CC_MD5_DIGEST_LENGTH];
    CC_MD5(data.bytes, (CC_LONG)data.length, digest);
    NSMutableString *hash = [NSMutableString stringWithCapacity:CC_MD5_DIGEST_LENGTH * 2];
    for (NSInteger i = 0; i < CC_MD5_DIGEST_LENGTH; i++) {
      [hash appendFormat:@"%02x", digest[i]];
    }
    return hash;
  };

  context[@"__lx_native_call__utils_aes_encrypt"] = ^NSString *(NSString *text, NSString *key, NSString *iv, NSString *mode) {
    return LXAES(text ?: @"", key ?: @"", iv ?: @"", mode ?: @"", kCCEncrypt, nil) ?: @"";
  };

  context[@"__lx_native_call__utils_rsa_encrypt"] = ^NSString *(NSString *text, NSString *key, NSString *padding) {
    return LXRSAEncrypt(text ?: @"", key ?: @"", padding ?: @"", nil) ?: @"";
  };

  context[@"__lx_native_call__set_timeout"] = ^id(NSNumber *identifier, NSNumber *timeout) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(MAX(timeout.doubleValue, 0) * NSEC_PER_MSEC)), weakSelf.scriptQueue, ^{
      [weakSelf callJSAction:@"__set_timeout__" data:identifier ?: @0];
    });
    return nil;
  };

  NSString *preloadScript = [self loadPreloadScript];
  if (!preloadScript.length) {
    if (errorMessage != NULL) *errorMessage = @"create JavaScript Env failed";
    return NO;
  }

  [context evaluateScript:preloadScript];
  if (lastException.length) {
    if (errorMessage != NULL) *errorMessage = lastException;
    return NO;
  }

  JSValue *setup = context[@"lx_setup"];
  [setup callWithArguments:@[
    self.scriptKey ?: @"",
    scriptInfo[@"id"] ?: @"",
    scriptInfo[@"name"] ?: @"Unknown",
    scriptInfo[@"description"] ?: @"",
    scriptInfo[@"version"] ?: @"",
    scriptInfo[@"author"] ?: @"",
    scriptInfo[@"homepage"] ?: @"",
    scriptInfo[@"script"] ?: @"",
  ]];
  if (lastException.length) {
    if (errorMessage != NULL) *errorMessage = lastException;
    return NO;
  }
  return YES;
}

RCT_EXPORT_METHOD(loadScript:(NSDictionary *)data) {
  dispatch_async(self.scriptQueue, ^{
    [self destroyContext];
    NSString *errorMessage = nil;
    if (![self createJSEnv:data error:&errorMessage]) {
      [self emitInitFailed:errorMessage];
      return;
    }

    __weak UserApiModule *weakSelf = self;
    __block NSString *lastException = nil;
    self.jsContext.exceptionHandler = ^(JSContext *ctx, JSValue *exception) {
      ctx.exception = exception;
      lastException = exception.toString ?: @"Unknown JavaScript exception";
      [weakSelf emitLogWithType:@"error" message:[NSString stringWithFormat:@"Call script error: %@", lastException]];
    };

    [self.jsContext evaluateScript:data[@"script"] ?: @""];
    if (lastException.length) {
      [weakSelf callJSAction:@"__run_error__" data:nil];
      if (!weakSelf.initSent) {
        weakSelf.initSent = YES;
        [weakSelf emitInitFailed:lastException];
      }
    }
  });
}

RCT_EXPORT_METHOD(sendAction:(NSString *)action info:(NSString *)info) {
  dispatch_async(self.scriptQueue, ^{
    if (self.jsContext == nil) return;
    [self callJSAction:action data:info];
  });
}

RCT_EXPORT_METHOD(destroy) {
  dispatch_async(self.scriptQueue, ^{
    [self destroyContext];
  });
}

@end

static NSString *LXMediaMetadataSidecarPath(NSString *filePath) {
  return [filePath stringByAppendingString:@".lxmeta.json"];
}

static NSString *LXMediaLyricSidecarPath(NSString *filePath) {
  NSString *basePath = [filePath stringByDeletingPathExtension];
  return [basePath stringByAppendingPathExtension:@"lrc"];
}

static NSString *LXMediaCoverSidecarPrefix(NSString *filePath) {
  return [filePath stringByAppendingString:@".lxcover"];
}

static NSString *LXAudioExtForPath(NSString *filePath) {
  NSString *ext = filePath.pathExtension.lowercaseString;
  if ([ext isEqualToString:@"flac"] ||
      [ext isEqualToString:@"ogg"] ||
      [ext isEqualToString:@"wav"] ||
      [ext isEqualToString:@"m4a"] ||
      [ext isEqualToString:@"aac"]) return ext;
  return @"mp3";
}

static NSDictionary *LXReadJSONFile(NSString *path) {
  NSData *data = [NSData dataWithContentsOfFile:path];
  if (!data.length) return @{};
  id result = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  return [result isKindOfClass:[NSDictionary class]] ? result : @{};
}

static BOOL LXWriteJSONFile(NSString *path, NSDictionary *json, NSError **error) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:json options:0 error:error];
  if (!data) return NO;
  return [data writeToFile:path options:NSDataWritingAtomic error:error];
}

static NSArray<AVMetadataItem *> *LXAllMetadataItems(AVAsset *asset) {
  NSMutableArray<AVMetadataItem *> *items = [NSMutableArray array];
  [items addObjectsFromArray:asset.commonMetadata];
  for (NSString *format in asset.availableMetadataFormats) {
    [items addObjectsFromArray:[asset metadataForFormat:format]];
  }
  return items;
}

static NSString *LXMetadataStringValue(id value) {
  if ([value isKindOfClass:[NSString class]]) return value;
  if ([value isKindOfClass:[NSNumber class]]) return ((NSNumber *)value).stringValue;
  return @"";
}

static NSString *LXFindMetadataString(AVAsset *asset, NSArray<NSString *> *commonKeys, NSArray<NSString *> *identifierKeywords) {
  NSArray<AVMetadataItem *> *items = LXAllMetadataItems(asset);
  for (AVMetadataItem *item in items) {
    NSString *commonKey = item.commonKey.lowercaseString ?: @"";
    NSString *identifier = item.identifier.lowercaseString ?: @"";
    BOOL matched = [commonKeys containsObject:commonKey];
    if (!matched) {
      for (NSString *keyword in identifierKeywords) {
        if ([identifier containsString:keyword]) {
          matched = YES;
          break;
        }
      }
    }
    if (!matched) continue;
    NSString *stringValue = item.stringValue ?: LXMetadataStringValue(item.value);
    if (stringValue.length) return stringValue;
  }
  return @"";
}

static NSData *LXFindArtworkData(AVAsset *asset) {
  NSArray<AVMetadataItem *> *items = LXAllMetadataItems(asset);
  for (AVMetadataItem *item in items) {
    NSString *commonKey = item.commonKey.lowercaseString ?: @"";
    NSString *identifier = item.identifier.lowercaseString ?: @"";
    if (![commonKey isEqualToString:@"artwork"] &&
        ![identifier containsString:@"artwork"] &&
        ![identifier containsString:@"covr"] &&
        ![identifier containsString:@"apic"]) continue;

    if (item.dataValue.length) return item.dataValue;
    if ([item.value isKindOfClass:[NSData class]]) return (NSData *)item.value;
    if ([item.value isKindOfClass:[NSDictionary class]]) {
      id data = ((NSDictionary *)item.value)[@"data"];
      if ([data isKindOfClass:[NSData class]]) return data;
    }
  }
  return nil;
}

static NSString *LXImageExtensionForData(NSData *data) {
  if (data.length >= 8) {
    const uint8_t *bytes = (const uint8_t *)data.bytes;
    if (bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4E && bytes[3] == 0x47) return @"png";
    if (bytes[0] == 0xFF && bytes[1] == 0xD8) return @"jpg";
    if (bytes[0] == 'G' && bytes[1] == 'I' && bytes[2] == 'F') return @"gif";
  }
  return @"jpg";
}

static NSString *LXFindCoverSidecarPath(NSString *filePath) {
  NSString *directory = [filePath stringByDeletingLastPathComponent];
  NSString *prefix = [[filePath.lastPathComponent stringByAppendingString:@".lxcover."] lowercaseString];
  NSArray<NSString *> *contents = [[NSFileManager defaultManager] contentsOfDirectoryAtPath:directory error:nil] ?: @[];
  for (NSString *name in contents) {
    if ([name.lowercaseString hasPrefix:prefix]) {
      return [directory stringByAppendingPathComponent:name];
    }
  }
  return nil;
}

static void LXRemoveCoverSidecars(NSString *filePath) {
  NSString *directory = [filePath stringByDeletingLastPathComponent];
  NSString *prefix = [[filePath.lastPathComponent stringByAppendingString:@".lxcover."] lowercaseString];
  NSArray<NSString *> *contents = [[NSFileManager defaultManager] contentsOfDirectoryAtPath:directory error:nil] ?: @[];
  for (NSString *name in contents) {
    if ([name.lowercaseString hasPrefix:prefix]) {
      NSString *target = [directory stringByAppendingPathComponent:name];
      [[NSFileManager defaultManager] removeItemAtPath:target error:nil];
    }
  }
}

#include "LXEmbeddedMetadataHelpers.mm"

@interface LocalMediaMetadata : NSObject<RCTBridgeModule>
@end

@implementation LocalMediaMetadata

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

RCT_REMAP_METHOD(readMetadata, readMetadata:(NSString *)filePath resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSURL *fileURL = [NSURL fileURLWithPath:filePath];
  AVURLAsset *asset = [AVURLAsset URLAssetWithURL:fileURL options:nil];
  NSDictionary *sidecar = LXReadJSONFile(LXMediaMetadataSidecarPath(filePath));
  NSDictionary *attributes = [[NSFileManager defaultManager] attributesOfItemAtPath:filePath error:nil] ?: @{};

  // 优先读取音频文件内部已嵌入的元数据；内部没有时再用旧版 sidecar 兜底。
  NSString *title = LXFindMetadataString(asset, @[ @"title" ], @[ @"title" ]);
  if (!title.length) title = [sidecar[@"name"] isKindOfClass:[NSString class]] ? sidecar[@"name"] : nil;
  if (!title.length) title = fileURL.URLByDeletingPathExtension.lastPathComponent ?: fileURL.lastPathComponent ?: @"";

  NSString *artist = LXFindMetadataString(asset, @[ @"artist", @"creator" ], @[ @"artist", @"author", @"performer" ]);
  if (!artist.length) artist = [sidecar[@"singer"] isKindOfClass:[NSString class]] ? sidecar[@"singer"] : nil;
  if (!artist.length) artist = @"";

  NSString *albumName = LXFindMetadataString(asset, @[ @"albumname" ], @[ @"album" ]);
  if (!albumName.length) albumName = [sidecar[@"albumName"] isKindOfClass:[NSString class]] ? sidecar[@"albumName"] : nil;
  if (!albumName.length) albumName = @"";

  AVAssetTrack *audioTrack = [asset tracksWithMediaType:AVMediaTypeAudio].firstObject;
  NSInteger bitrate = audioTrack != nil ? (NSInteger)llround(audioTrack.estimatedDataRate / 1000.0) : 0;
  Float64 duration = CMTimeGetSeconds(asset.duration);
  if (!isfinite(duration) || duration < 0) duration = 0;

  NSString *ext = LXAudioExtForPath(filePath);
  resolve(@{
    @"type": ext,
    @"bitrate": @(bitrate).stringValue ?: @"0",
    @"interval": @((NSInteger)llround(duration)),
    @"size": attributes[NSFileSize] ?: @0,
    @"ext": ext,
    @"albumName": albumName,
    @"singer": artist,
    @"name": title,
  });
}

RCT_REMAP_METHOD(writeMetadata, writeMetadata:(NSString *)filePath metadata:(NSDictionary *)metadata overwrite:(BOOL)isOverwrite resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  // iOS：把标签直接写入音频文件内部（MP3/FLAC），不再生成 .lxmeta.json 伴生文件。
  // 对于不支持的格式（如 m4a）仍回退到 sidecar。
  LXWriteEmbeddedMetadataAsync(filePath, metadata, nil, nil, @"write_metadata_failed", resolve, reject);
}

RCT_REMAP_METHOD(readPic, readPic:(NSString *)filePath targetPath:(NSString *)targetPath resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSData *coverData = nil;
  NSString *ext = @"jpg";
  // 1. 优先读取音频文件内部嵌入的封面
  AVURLAsset *asset = [AVURLAsset URLAssetWithURL:[NSURL fileURLWithPath:filePath] options:nil];
  coverData = LXFindArtworkData(asset);
  if (coverData.length) ext = LXImageExtensionForData(coverData);
#if LX_HAS_LIBFLAC
  if (!coverData.length && [filePath.pathExtension.lowercaseString isEqualToString:@"flac"]) {
    coverData = LXReadFLACPicture(filePath, &ext);
  }
#endif
  // 2. 没有内嵌封面时回退到旧版 sidecar 封面
  if (!coverData.length) {
    NSString *sidecarCoverPath = LXFindCoverSidecarPath(filePath);
    if (sidecarCoverPath.length) {
      coverData = [NSData dataWithContentsOfFile:sidecarCoverPath];
      ext = sidecarCoverPath.pathExtension.length ? sidecarCoverPath.pathExtension.lowercaseString : @"jpg";
    }
  }

  if (!coverData.length) {
    reject(@"read_pic_failed", @"No picture metadata found", nil);
    return;
  }

  NSError *error = nil;
  [[NSFileManager defaultManager] createDirectoryAtPath:targetPath withIntermediateDirectories:YES attributes:nil error:&error];
  if (error != nil) {
    reject(@"read_pic_failed", error.localizedDescription ?: @"Failed to create picture cache directory", error);
    return;
  }

  NSString *targetFilePath = [targetPath stringByAppendingPathComponent:[NSString stringWithFormat:@"%@.%@", LXSHA1(filePath), ext]];
  if (![coverData writeToFile:targetFilePath options:NSDataWritingAtomic error:&error]) {
    reject(@"read_pic_failed", error.localizedDescription ?: @"Failed to save picture", error);
    return;
  }

  resolve(targetFilePath);
}

RCT_REMAP_METHOD(writePic, writePic:(NSString *)filePath picPath:(NSString *)picPath resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  // iOS：把封面直接嵌入音频文件（MP3/FLAC），不生成 .lxcover 伴生文件。
  LXWriteEmbeddedMetadataAsync(filePath, @{}, picPath, nil, @"write_pic_failed", resolve, reject);
}

RCT_REMAP_METHOD(readLyric, readLyric:(NSString *)filePath isReadLrcFile:(BOOL)isReadLrcFile resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if (isReadLrcFile) {
    NSString *lrcPath = LXMediaLyricSidecarPath(filePath);
    if ([[NSFileManager defaultManager] fileExistsAtPath:lrcPath]) {
      NSString *lyric = [NSString stringWithContentsOfFile:lrcPath encoding:NSUTF8StringEncoding error:nil];
      resolve(lyric ?: @"");
      return;
    }
  }

  AVURLAsset *asset = [AVURLAsset URLAssetWithURL:[NSURL fileURLWithPath:filePath] options:nil];
  NSString *lyric = LXFindMetadataString(asset, @[], @[ @"lyric", @"lyrics", @"uslt" ]);
#if LX_HAS_LIBFLAC
  if (!lyric.length && [filePath.pathExtension.lowercaseString isEqualToString:@"flac"]) {
    lyric = LXReadFLACLyric(filePath) ?: @"";
  }
#endif
  resolve(lyric ?: @"");
}

RCT_REMAP_METHOD(writeLyric, writeLyric:(NSString *)filePath lyric:(NSString *)lyric resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  // iOS：把歌词直接嵌入音频文件（MP3/FLAC），不生成 .lrc 伴生文件。
  LXWriteEmbeddedMetadataAsync(filePath, @{}, nil, lyric, @"write_lyric_failed", resolve, reject);
}

@end

@interface CacheModule : NSObject<RCTBridgeModule>
@end

@implementation CacheModule

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

RCT_REMAP_METHOD(getAppCacheSize, getAppCacheSizeWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
    unsigned long long total = 0;
    for (NSString *path in LXCacheDirectories()) {
      total += LXDirectorySize(path);
    }
    resolve(@((double)total));
  });
}

RCT_REMAP_METHOD(clearAppCache, clearAppCacheWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
    NSError *error = nil;
    for (NSString *path in LXCacheDirectories()) {
      if (!LXClearDirectoryContents(path, &error)) {
        reject(@"clear_cache_failed", error.localizedDescription ?: @"Failed to clear app cache", error);
        return;
      }
    }
    [[NSURLCache sharedURLCache] removeAllCachedResponses];
    resolve(nil);
  });
}

// 按缓存大小上限对全部应用缓存（Caches + Tmp，排除 TrackPlayer 原生缓存目录）做
// LRU 清理。iOS 上 RNTP 的 maxCacheSize 不生效，getAppCacheSize/clearAppCache 跳过
// TrackPlayer（见 LXShouldSkipManagedCacheEntry），这里保持一致：只清理应用自身可
// 管理的缓存（云盘播放缓存、FastImage 封面缓存、URLCache、临时文件等），按最后
// 修改时间最旧优先删除，直到总大小 <= limitBytes。limitBytes <= 0 表示不限制。
RCT_REMAP_METHOD(enforceCacheLimit, enforceCacheLimitWithLimitBytes:(nonnull NSNumber *)limitBytes
                          resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  long long limit = [limitBytes longLongValue];
  if (limit <= 0) { resolve(@(0)); return; }

  dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
    NSFileManager *fileManager = [NSFileManager defaultManager];
    NSMutableArray<NSDictionary *> *files = [NSMutableArray array];
    unsigned long long total = 0;
    for (NSString *dir in LXCacheDirectories()) {
      NSDirectoryEnumerator *enumerator = [fileManager enumeratorAtPath:dir];
      for (NSString *itemPath in enumerator) {
        // 与 getAppCacheSize 一致：跳过 TrackPlayer 原生缓存目录
        if (LXShouldSkipManagedCacheEntry(itemPath)) { [enumerator skipDescendants]; continue; }
        NSString *fullPath = [dir stringByAppendingPathComponent:itemPath];
        NSDictionary *attrs = [fileManager attributesOfItemAtPath:fullPath error:nil];
        if (!attrs || [attrs[NSFileType] isEqualToString:NSFileTypeDirectory]) continue;
        unsigned long long size = [attrs[NSFileSize] unsignedLongLongValue];
        NSDate *modDate = attrs[NSFileModificationDate];
        long long mtime = modDate ? (long long)([modDate timeIntervalSince1970] * 1000) : 0;
        [files addObject:@{@"path": fullPath, @"size": @(size), @"mtime": @(mtime)}];
        total += size;
      }
    }
    if (total <= (unsigned long long)limit) { resolve(@(0)); return; }

    // 最旧在前，优先删除最久未使用的缓存文件
    NSArray *sorted = [files sortedArrayUsingComparator:^NSComparisonResult(NSDictionary *a, NSDictionary *b) {
      return [a[@"mtime"] compare:b[@"mtime"]];
    }];

    unsigned long long freed = 0;
    for (NSDictionary *f in sorted) {
      if (total <= (unsigned long long)limit) break;
      NSString *path = f[@"path"];
      unsigned long long size = [f[@"size"] unsignedLongLongValue];
      if ([fileManager removeItemAtPath:path error:nil]) {
        total -= size;
        freed += size;
      }
    }
    resolve(@(freed));
  });
}

@end

@interface NowPlayingModule : NSObject<RCTBridgeModule>
@end

@implementation NowPlayingModule

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

RCT_REMAP_METHOD(updateNowPlayingInfo, updateNowPlayingInfo:(NSDictionary *)metadata resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    LXSetNowPlayingInfo(metadata ?: @{});
    resolve(nil);
  });
}

RCT_REMAP_METHOD(playNowPlaying, playNowPlaying:(NSDictionary *)options resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    // 先激活音频会话再发布 Now Playing。iOS 27 Beta 7 对未激活会话的
    // 媒体信息更容易判定为“未在播放”，尤其是首次播放和从后台恢复时。
    [[AVAudioSession sharedInstance] setActive:YES error:nil];
    LXSetNowPlayingPlaybackState(MPNowPlayingPlaybackStatePlaying, options);
    resolve(nil);
  });
}

RCT_REMAP_METHOD(pauseNowPlaying, pauseNowPlaying:(NSDictionary *)options resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    LXSetNowPlayingPlaybackState(MPNowPlayingPlaybackStatePaused, options);
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.15 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      if (LXNowPlayingState != MPNowPlayingPlaybackStatePaused) return;
      LXApplyNowPlayingInfo();
    });
    resolve(nil);
  });
}

RCT_REMAP_METHOD(stopNowPlaying, stopNowPlaying:(NSDictionary *)options resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    LXSetNowPlayingPlaybackState(MPNowPlayingPlaybackStateStopped, options);
    resolve(nil);
  });
}

// 引擎真值回传（JS → 原生）：由 LXNowPlayingTruthProbeNotificationName 探针触发
// （见 LXReportNowPlayingPlaybackTruth）。options 与 play/pauseNowPlaying 同形，
// 纠正播放态时用它刷新进度基线，避免卡片进度回跳。
RCT_REMAP_METHOD(reportPlaybackTruth, reportPlaybackTruth:(BOOL)isPlaying options:(NSDictionary *)options resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    LXReportNowPlayingPlaybackTruth(isPlaying, options ?: @{});
    resolve(nil);
  });
}

RCT_REMAP_METHOD(clearNowPlayingInfo, clearNowPlayingInfoWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    // JS 侧销毁播放会话（destroyTrackPlayerCore）→ 会话结束，交出媒体键
    LXNowPlayingHasPlaybackSession = NO;
    LXClearNowPlayingInfo();
    resolve(nil);
  });
}

// JS 在歌词加载完成后把整条时间轴（[{time: ms, text}]）交给原生：
// 原生 NSTimer 按锚点外推位置直接驱动控制中心歌词，不依赖 JS 定时器
RCT_REMAP_METHOD(setNowPlayingLyrics, setNowPlayingLyrics:(NSArray *)lines resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    LXSetNowPlayingLyricLines(lines ?: @[]);
    resolve(nil);
  });
}

// JS 慢速校准 tick（~1s 一次的引擎真实位置查询）回传位置：重锚原生歌词/位置时钟。
// snapshotAtMs / ageMs：快照时间补偿（见 LXReanchorNowPlayingLyric），消除桥接
// 往返被钉进锚点造成的灵动岛/控制中心歌词恒定滞后。
RCT_REMAP_METHOD(reanchorNowPlayingLyric, reanchorNowPlayingLyric:(double)positionMs
                  snapshotAtMs:(NSNumber *)snapshotAtMs
                  ageMs:(NSNumber *)ageMs
                  resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    LXReanchorNowPlayingLyric(positionMs, snapshotAtMs.doubleValue, ageMs.doubleValue);
    resolve(nil);
  });
}

@end

// 当前持有的后台任务（切歌取链期间申请）。放在原生侧而非依赖 JS 回传：
// 锁屏时 JS↔原生 往返可能来不及完成，若由 JS 独家记账会出现「已 begin 但没 end」的泄漏。
// 这里做幂等管理：重复 begin 复用同一个任务，end 一律结束当前任务。
static UIBackgroundTaskIdentifier LXBackgroundTaskId = UIBackgroundTaskInvalid;

// Tab 栏收起状态机（定义在文件后部的跟踪器区块；此处前置声明供 setTabBarExpanded 使用）
static BOOL LXTabBarManualExpanded = NO;
static NSNotificationName const LXTabBarCollapseChangedNotification = @"LXTabBarCollapseChanged";
static void LXSetTabBarCollapsed(BOOL collapsed);

// JS 监听器（startObserving）尚未就绪时暂存的遥控命令，见 handleRemoteCommandNotification
static const double LXRemoteCommandPendingMaxAgeMs = 30000.0;

@interface UtilsModule : RCTEventEmitter<RCTBridgeModule>
@property (nonatomic, assign) BOOL hasListeners;
// JS 监听器还没就绪时暂存的遥控命令（startObserving 时补发）
@property (nonatomic, strong) NSMutableArray<NSDictionary *> *pendingRemoteCommands;
@end

@implementation UtilsModule

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup {
  return YES;
}

- (instancetype)init {
  self = [super init];
  if (self != nil) {
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(handleAudioRouteChange:)
                                                 name:AVAudioSessionRouteChangeNotification
                                               object:[AVAudioSession sharedInstance]];
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(handleRemoteCommandNotification:)
                                                 name:LXRemoteCommandNotificationName
                                               object:nil];
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(handleTabBarCollapseChanged:)
                                                 name:LXTabBarCollapseChangedNotification
                                               object:nil];
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(handlePlayerPositionChanged:)
                                                 name:LXPlayerPositionNotificationName
                                               object:nil];
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(handleNowPlayingTruthProbe:)
                                                 name:LXNowPlayingTruthProbeNotificationName
                                               object:nil];
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(handlePlayerSeeked:)
                                                 name:LXTrackPlayerLifecycleNotificationName
                                               object:nil];
  }
  return self;
}

- (void)dealloc {
  [[NSNotificationCenter defaultCenter] removeObserver:self];
}

- (NSArray<NSString *> *)supportedEvents {
  // screen-size-changed 已移除：iOS 端从未发送该事件（窗口尺寸由 JS 侧 SizeView onLayout 同步），
  // 声明而不发送属于死事件，且避免误导后续接入
  // screen-state 已删除：本工程从未有发送方（详见 sim-background-js-timers 契约），
  // 「熄屏/回屏」统一以 JS 侧 AppState 为准。
  return @[ @"headphones-disconnected", @"remote-command", @"tabBarCollapseChanged", @"player-position", @"player-seeked", @"now-playing-truth-probe" ];
}

// Tab 栏收起状态（原生跟踪器维护，JS 经 tabBarCollapseChanged 事件与 setTabBarExpanded 命令交互）
- (void)sendTabBarCollapseChanged:(NSNumber *)collapsed {
  if (!self.hasListeners) return;
  [self sendEventWithName:@"tabBarCollapseChanged" body:collapsed];
}

- (void)handleTabBarCollapseChanged:(NSNotification *)notification {
  if (!self.hasListeners) return;
  BOOL collapsed = [notification.userInfo[@"collapsed"] boolValue];
  dispatch_async(dispatch_get_main_queue(), ^{
    [self sendEventWithName:@"tabBarCollapseChanged" body:@(collapsed)];
  });
}

// ≈ 上游 `seeked`：AVPlayer seek completion（引擎真正到达落点）→ JS 触发歌词重锚。
// 仅 AVPlayer 路径；nativeFlac 路径由其 playing 状态事件（出声即发）承担同一职责。
- (void)handlePlayerSeeked:(NSNotification *)notification {
  if (!self.hasListeners) return;
  NSDictionary *userInfo = [notification.userInfo isKindOfClass:[NSDictionary class]] ? notification.userInfo : @{};
  NSString *event = [userInfo[@"event"] isKindOfClass:[NSString class]] ? userInfo[@"event"] : @"";
  NSNumber *position = [userInfo[@"position"] isKindOfClass:[NSNumber class]] ? userInfo[@"position"] : nil;
  if (![event isEqualToString:@"seeked"] || position == nil) return;
  dispatch_async(dispatch_get_main_queue(), ^{
    [self sendEventWithName:@"player-seeked" body:@{ @"position": position }];
  });
}

// 播放位置事件（原生歌词时钟 4Hz 外推位置，仅前台播放时发布）：转发给 JS 驱动进度 UI
- (void)handlePlayerPositionChanged:(NSNotification *)notification {
  if (!self.hasListeners) return;
  NSNumber *position = [notification.userInfo[@"position"] isKindOfClass:[NSNumber class]] ? notification.userInfo[@"position"] : nil;
  NSNumber *rate = [notification.userInfo[@"rate"] isKindOfClass:[NSNumber class]] ? notification.userInfo[@"rate"] : nil;
  if (position == nil) return;
  dispatch_async(dispatch_get_main_queue(), ^{
    [self sendEventWithName:@"player-position" body:@{ @"position": position, @"rate": rate ?: @1 }];
  });
}

// 把暂存的遥控命令按时间窗补发给 JS；过期（如上一次会话遗留）的直接丢弃，
// 避免 App 回到前台时补发一个早就不该生效的操作。
- (void)flushPendingRemoteCommands {
  NSMutableArray<NSDictionary *> *pending = self.pendingRemoteCommands;
  self.pendingRemoteCommands = nil;
  if (pending.count == 0) return;

  double nowMs = CACurrentMediaTime() * 1000.0;
  for (NSDictionary *queued in pending) {
    NSNumber *queuedAtMs = [queued[@"queuedAtMs"] isKindOfClass:[NSNumber class]] ? queued[@"queuedAtMs"] : nil;
    if (queuedAtMs == nil || nowMs - queuedAtMs.doubleValue > LXRemoteCommandPendingMaxAgeMs) continue;
    NSMutableDictionary *body = [queued mutableCopy];
    [body removeObjectForKey:@"queuedAtMs"];
    NSString *flushedCommand = [body[@"command"] isKindOfClass:[NSString class]] ? body[@"command"] : @"";
    NSLog(@"###LXRemote### flush=%@ age=%.0fms", flushedCommand, nowMs - queuedAtMs.doubleValue);
    [self sendEventWithName:@"remote-command" body:body];
  }
}

// 「卡片显示态 vs 引擎真值」探针转发（见 LXReportNowPlayingPlaybackTruth）：
// JS 收到事件后立即回传引擎状态，不依赖 JS 定时器 —— 控制中心打开（App inactive）
// 与后台播放期间同样有效。
- (void)handleNowPlayingTruthProbe:(NSNotification *)notification {
  if (!self.hasListeners) return;
  dispatch_async(dispatch_get_main_queue(), ^{
    [self sendEventWithName:@"now-playing-truth-probe" body:nil];
  });
}

- (void)startObserving {
  self.hasListeners = YES;
  // 补发「JS 监听器就绪前」收到的遥控命令（详情见 handleRemoteCommandNotification）
  dispatch_async(dispatch_get_main_queue(), ^{
    [self flushPendingRemoteCommands];
  });
}

- (void)stopObserving {
  self.hasListeners = NO;
}

// 「私有输出」= 耳机 / 蓝牙：只有这类输出才谈得上「拔出 / 断开 → 自动暂停」
- (BOOL)isPrivateOutputRoute:(AVAudioSessionRouteDescription *)route {
  if (route == nil) return NO;
  for (AVAudioSessionPortDescription *output in route.outputs) {
    NSString *portType = output.portType;
    if ([portType isEqualToString:AVAudioSessionPortHeadphones] ||
        [portType isEqualToString:AVAudioSessionPortBluetoothA2DP] ||
        [portType isEqualToString:AVAudioSessionPortBluetoothHFP] ||
        [portType isEqualToString:AVAudioSessionPortBluetoothLE]) {
      return YES;
    }
  }
  return NO;
}

- (BOOL)shouldEmitHeadphonesDisconnectedForPreviousRoute:(AVAudioSessionRouteDescription *)previousRoute currentRoute:(AVAudioSessionRouteDescription *)currentRoute {
  if (![self isPrivateOutputRoute:previousRoute]) return NO;
  // 新路由仍落在耳机 / 蓝牙输出上时不算「耳机拔出」：音频只是换了一条通道，仍在同一台
  // 设备上出声。车机在导航播报（HFP）与媒体播放（A2DP）之间来回切换正是这种情况 ——
  // 旧实现会把它误判成耳机拔出 → 暂停播放，而且此后没有任何恢复时机，表现为
  // 「车机蓝牙下高德一播报音乐就停、播报结束也不恢复」（用户 2026-10-03 反馈；
  // 不外接蓝牙时高德只 duck，音量压小但不停播，所以看起来正常）。
  if ([self isPrivateOutputRoute:currentRoute]) return NO;
  return YES;
}

- (void)handleAudioRouteChange:(NSNotification *)notification {
  if (!self.hasListeners) return;

  NSDictionary *userInfo = notification.userInfo;
  if (userInfo == nil) return;

  NSNumber *reasonValue = userInfo[AVAudioSessionRouteChangeReasonKey];
  if (reasonValue == nil || [reasonValue unsignedIntegerValue] != AVAudioSessionRouteChangeReasonOldDeviceUnavailable) return;

  AVAudioSessionRouteDescription *previousRoute = userInfo[AVAudioSessionRouteChangePreviousRouteKey];
  if (previousRoute == nil) return;
  // 同时看新路由：只有「确实从耳机 / 蓝牙切到了别的输出」才算断开（见上方说明）
  AVAudioSessionRouteDescription *currentRoute = [AVAudioSession sharedInstance].currentRoute;
  if (![self shouldEmitHeadphonesDisconnectedForPreviousRoute:previousRoute currentRoute:currentRoute]) return;

  dispatch_async(dispatch_get_main_queue(), ^{
    [self sendEventWithName:@"headphones-disconnected" body:nil];
  });
}

- (void)handleRemoteCommandNotification:(NSNotification *)notification {
  NSDictionary *userInfo = [notification.userInfo isKindOfClass:[NSDictionary class]] ? notification.userInfo : @{};
  NSString *command = [userInfo[@"command"] isKindOfClass:[NSString class]] ? userInfo[@"command"] : @"";
  if (!command.length) return;

  NSMutableDictionary *body = [NSMutableDictionary dictionaryWithDictionary:userInfo];
  body[@"command"] = command;

  dispatch_async(dispatch_get_main_queue(), ^{
    // JS 监听器还没就绪（App 被遥控命令唤起 / JS 重载）：先排队，startObserving 时补发。
    // 以前这里直接丢，丢掉的正是用户按的那一次 ——「第一次点播放没反应、要按两次」。
    if (!self.hasListeners) {
      NSLog(@"###LXRemote### queue(no-listener)=%@", command);
      if (self.pendingRemoteCommands == nil) self.pendingRemoteCommands = [NSMutableArray array];
      if (self.pendingRemoteCommands.count >= 4) [self.pendingRemoteCommands removeObjectAtIndex:0];
      body[@"queuedAtMs"] = @(CACurrentMediaTime() * 1000.0);
      [self.pendingRemoteCommands addObject:body];
      return;
    }
    NSLog(@"###LXRemote### deliver=%@", command);
    [self sendEventWithName:@"remote-command" body:body];
  });
}

RCT_EXPORT_METHOD(exitApp) {
  // iOS 禁止程序化退出（违反 HIG，有审核风险）；JS 侧实际走 BackHandler.exitApp（iOS no-op），
  // 此方法保留为 no-op 防止误用
}

// 屏幕常亮：播放歌词/横屏详情页时保持屏幕不熄灭（idleTimerDisabled）
RCT_EXPORT_METHOD(screenkeepAwake) {
  dispatch_async(dispatch_get_main_queue(), ^{
    [UIApplication sharedApplication].idleTimerDisabled = YES;
  });
}

RCT_EXPORT_METHOD(screenUnkeepAwake) {
  dispatch_async(dispatch_get_main_queue(), ^{
    [UIApplication sharedApplication].idleTimerDisabled = NO;
  });
}

// 保存图片到系统相册（歌曲封面 / 歌词海报等）。
// 为什么需要原生：iOS 沙盒里的 Pictures 目录用户不可见（文件 App 也看不到），
// 之前用 RNFetchBlob 兼容层把封面写进沙盒 → 用户点「下载封面」后相册里什么也没有，
// 表现为功能无效。这里改走 PHPhotoLibrary 的「仅新增」写入（对应 Info.plist 的
// NSPhotoLibraryAddUsageDescription，只申请新增权限、不读相册）。
// 入参同时兼容本地路径与 file:// URL。
RCT_EXPORT_METHOD(saveImageToPhotosLibrary:(NSString *)path
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  NSString *filePath = path;
  if ([filePath hasPrefix:@"file://"]) {
    NSURL *url = [NSURL URLWithString:filePath];
    filePath = url.isFileURL ? url.path : filePath;
  }
  UIImage *image = filePath.length > 0 ? [UIImage imageWithContentsOfFile:filePath] : nil;
  if (image == nil) {
    reject(@"image_not_found", @"读取图片失败（文件不存在或不是图片）", nil);
    return;
  }
  [[PHPhotoLibrary sharedPhotoLibrary] performChanges:^{
    [PHAssetChangeRequest creationRequestForAssetFromImage:image];
  } completionHandler:^(BOOL success, NSError *error) {
    if (success) {
      resolve(@(YES));
      return;
    }
    reject(@"save_image_failed", error.localizedDescription ?: @"保存到相册失败", error);
  }];
}

// Toast 浮层提层：浮层与主窗口同为 windowLevel = Normal 的独立 UIWindow，
// 主窗口 makeKey 或后建的原生面板出现就会把它压住（表现为「点了下载没有任何提示」）。
// 提到 UIWindowLevelAlert + 1 后按 level 排序稳定在最上层，任意页面都可见。
// 详见 LXIsRNNOverlayWindow / LXRaiseOverlayWindows。
RCT_EXPORT_METHOD(raiseOverlayWindows) {
  dispatch_async(dispatch_get_main_queue(), ^{
    LXRaiseOverlayWindows();
  });
}

// Tab 栏手动展开（点击左下角收起按钮）：保持展开直到下一次列表滚动离开顶部
RCT_EXPORT_METHOD(setTabBarExpanded) {
  dispatch_async(dispatch_get_main_queue(), ^{
    LXTabBarManualExpanded = YES;
    LXSetTabBarCollapsed(NO);
  });
}

// 锁屏/后台切歌时，JS 侧需要时间请求下一首的播放链接。iOS 在音频停止后会很快挂起 App，
// 导致取链的网络请求被冻结、播放器永久卡在暂停态不再跳歌（Info.plist 的 UIBackgroundModes
// 只有 audio，音频一停就失去后台运行资格）。
// 这里暴露 UIApplication 的后台任务接口：切歌开始时 begin，取链结束后 end，
// 为 JS 争取一段额外的后台执行时间（时长由系统决定，通常约 30 秒）。
RCT_EXPORT_METHOD(beginBackgroundTask:(RCTPromiseResolveBlock)resolve
                             rejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    // 已有有效任务时直接复用，避免连续切歌把系统给的后台预算重复耗光
    if (LXBackgroundTaskId != UIBackgroundTaskInvalid) {
      resolve(@((NSUInteger)LXBackgroundTaskId));
      return;
    }
    LXBackgroundTaskId = [[UIApplication sharedApplication] beginBackgroundTaskWithName:@"LXFetchNextUrl" expirationHandler:^{
      // 系统分配的后台时间耗尽：必须结束任务，否则 App 会被系统直接终止
      if (LXBackgroundTaskId != UIBackgroundTaskInvalid) {
        [[UIApplication sharedApplication] endBackgroundTask:LXBackgroundTaskId];
        LXBackgroundTaskId = UIBackgroundTaskInvalid;
      }
    }];
    // UIBackgroundTaskInvalid 为 0，JS 侧据此判断是否申请成功
    resolve(@((NSUInteger)LXBackgroundTaskId));
  });
}

RCT_EXPORT_METHOD(endBackgroundTask:(nonnull NSNumber *)taskId) {
  UIBackgroundTaskIdentifier identifier = (UIBackgroundTaskIdentifier)[taskId unsignedIntegerValue];
  if (identifier == UIBackgroundTaskInvalid) return;
  dispatch_async(dispatch_get_main_queue(), ^{
    if (LXBackgroundTaskId == UIBackgroundTaskInvalid) return;
    [[UIApplication sharedApplication] endBackgroundTask:LXBackgroundTaskId];
    LXBackgroundTaskId = UIBackgroundTaskInvalid;
  });
}

// 生成并缓存一张「已模糊的背景图」到本地，返回 file:// 地址；无需模糊 / 失败时返回 nil。
// 背景（动态背景 = 整屏封面 / 自定义背景图）原先由 JS 侧 Image 的 blurRadius 在每次挂载时重算，
// 整屏图的解码 + 模糊要几十毫秒，期间页面只有底色（浅色主题纯白）= 进入页面「闪一下白色」。
// 这里按 地址 + 半径 缓存到 Caches/lx_bg_blur（模糊算法与 RN 完全一致，观感不变），
// 页面改用本地文件后首帧即可绘制；热缓存时异步往返只有几毫秒。
RCT_REMAP_METHOD(getBlurredPic,
                 getBlurredPic:(NSString *)uriString
                 blurRadius:(nonnull NSNumber *)blurRadius
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  NSString *uri = [uriString isKindOfClass:[NSString class]] ? uriString : @"";
  CGFloat radius = MAX(0, blurRadius.doubleValue);
  if (uri.length == 0 || radius <= 0) {
    resolve(nil);
    return;
  }

  dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
    NSString *cachePath = LXBlurredBackgroundCachePath(uri, radius);
    if (cachePath.length == 0) {
      resolve(nil);
      return;
    }
    NSFileManager *fileManager = [NSFileManager defaultManager];
    if ([fileManager fileExistsAtPath:cachePath]) {
      resolve([NSURL fileURLWithPath:cachePath].absoluteString);
      return;
    }

    NSData *data = nil;
    if ([uri hasPrefix:@"http://"] || [uri hasPrefix:@"https://"]) {
      NSURL *url = [NSURL URLWithString:uri];
      if (url == nil) {
        resolve(nil);
        return;
      }
      // 与 JS 侧 defaultHeaders、控制中心封面下载保持一致：部分音源封面 CDN 对无 UA 的请求返回 403
      NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
      [request setValue:@"Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36" forHTTPHeaderField:@"User-Agent"];
      request.timeoutInterval = 20;
      __block NSData *fetched = nil;
      dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
      NSURLSessionDataTask *task = [[NSURLSession sharedSession] dataTaskWithRequest:request
                                                                  completionHandler:^(NSData * _Nullable taskData, NSURLResponse * _Nullable response, NSError * _Nullable error) {
        if (error == nil && taskData.length > 0) fetched = taskData;
        dispatch_semaphore_signal(semaphore);
      }];
      [task resume];
      // 本方法本身已在后台队列，这里同步等待下载完成（超时兜底，保证 Promise 一定会返回）
      dispatch_semaphore_wait(semaphore, dispatch_time(DISPATCH_TIME_NOW, (int64_t)(25 * NSEC_PER_SEC)));
      data = fetched;
    } else {
      NSString *filePath = uri;
      if ([filePath hasPrefix:@"file://"]) filePath = [NSURL URLWithString:filePath].path ?: filePath;
      data = [NSData dataWithContentsOfFile:filePath.stringByStandardizingPath];
    }

    UIImage *image = data.length > 0 ? [UIImage imageWithData:data] : nil;
    if (image == nil) {
      resolve(nil);
      return;
    }

    UIImage *blurred = LXBlurredBackgroundImage(image, radius);
    NSData *output = UIImageJPEGRepresentation(blurred, 0.92);
    if (output.length == 0) {
      resolve(nil);
      return;
    }
    BOOL written = [output writeToFile:cachePath atomically:YES];
    if (written) {
      // 顺带把平均色落盘（此刻模糊图已在内存里，求平均色几乎不额外花时间）：
      // JS 侧据此把 push 转场背景色设成与该页背景接近的颜色，消除转场时的闪白。
      NSString *colorPath = LXBlurredBackgroundColorPath(cachePath);
      NSString *colorHex = LXAverageColorHexOfImage(blurred);
      if (colorPath.length > 0 && colorHex.length > 0) {
        [colorHex writeToFile:colorPath atomically:YES encoding:NSUTF8StringEncoding error:nil];
      }
      // 只保留最近 6 张：够覆盖最近播放的几首歌（下一张进入前必定命中），又不会无限占空间
      LXTrimBlurredBackgroundCache(cachePath, 6);
    }
    resolve(written ? [NSURL fileURLWithPath:cachePath].absoluteString : nil);
  });
}

// 取「背景模糊图」的平均色（#RRGGBB），供 JS 侧作为 push 转场背景色与页面首帧底色。
// 与 getBlurredPic 共用同一份缓存命名：模糊图存在时读同名 .color 文本（几十字节，读取极快）。
// 旧版本生成的模糊图没有 .color（升级兼容）时现场补算一次并落盘，此后直接读文件。
// 模糊图尚不存在时返回 nil——JS 侧会在拿到模糊图地址后再调用本方法，顺序由 JS 保证。
RCT_REMAP_METHOD(getBgPicColor,
                 getBgPicColor:(NSString *)uriString
                 blurRadius:(nonnull NSNumber *)blurRadius
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  NSString *uri = [uriString isKindOfClass:[NSString class]] ? uriString : @"";
  CGFloat radius = MAX(0, blurRadius.doubleValue);
  if (uri.length == 0 || radius <= 0) {
    resolve(nil);
    return;
  }

  dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
    NSString *cachePath = LXBlurredBackgroundCachePath(uri, radius);
    if (cachePath.length == 0) {
      resolve(nil);
      return;
    }
    NSFileManager *fileManager = [NSFileManager defaultManager];
    if (![fileManager fileExistsAtPath:cachePath]) {
      resolve(nil);
      return;
    }

    NSString *colorPath = LXBlurredBackgroundColorPath(cachePath);
    if (colorPath.length > 0) {
      NSString *cachedColor = [NSString stringWithContentsOfFile:colorPath
                                                       encoding:NSUTF8StringEncoding
                                                          error:nil];
      cachedColor = [cachedColor stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
      if (cachedColor.length > 0) {
        resolve(cachedColor);
        return;
      }
    }

    UIImage *image = [UIImage imageWithContentsOfFile:cachePath];
    NSString *colorHex = image ? LXAverageColorHexOfImage(image) : nil;
    if (colorHex.length == 0) {
      resolve(nil);
      return;
    }
    if (colorPath.length > 0) {
      [colorHex writeToFile:colorPath atomically:YES encoding:NSUTF8StringEncoding error:nil];
    }
    resolve(colorHex);
  });
}

// 当前安装包的版本号（CFBundleShortVersionString，CI 构建时按日期注入，如 20260926）。
// 「关于」页展示用：JS 侧 package.json 里的 version 只是打包时的快照，可能与实际安装的包不一致，
// 所以必须从运行中的主包读取。
RCT_REMAP_METHOD(getVersionInfo,
                 getVersionInfoWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  NSDictionary *info = [NSBundle mainBundle].infoDictionary;
  NSString *version = info[@"CFBundleShortVersionString"];
  if (version.length == 0) version = info[@"CFBundleVersion"];
  resolve(version ?: @"");
}

// 安全区 insets：JS 侧据此给底部面板/列表补 padding，避免最后一行被 Home 指示器
// （iPhone 刘海/灵动岛机型底部约 34pt）或 iPad 底部区域遮挡。
// iOS 13+ 必须走 UIWindowScene 取 keyWindow：多场景/分屏下 UIApplication.keyWindow 可能为 nil。
RCT_REMAP_METHOD(getSafeAreaInsets,
                 getSafeAreaInsetsWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    UIEdgeInsets insets = UIEdgeInsetsZero;
    if (@available(iOS 13.0, *)) {
      UIWindow *keyWindow = nil;
      for (UIScene *scene in [UIApplication sharedApplication].connectedScenes) {
        if (scene.activationState != UISceneActivationStateForegroundActive) continue;
        if (![scene isKindOfClass:[UIWindowScene class]]) continue;
        for (UIWindow *window in ((UIWindowScene *)scene).windows) {
          if (window.isKeyWindow) {
            keyWindow = window;
            break;
          }
        }
        if (keyWindow != nil) break;
      }
      if (keyWindow != nil) insets = keyWindow.safeAreaInsets;
    }
    resolve(@{
      @"top": @(insets.top),
      @"bottom": @(insets.bottom),
      @"left": @(insets.left),
      @"right": @(insets.right),
    });
  });
}

@end

// ============================================================================
// Tab 栏收起跟踪器（iOS 26 风格：列表滚动收起、回顶展开、点收起按钮手动展开）
// ============================================================================
// 监听所有 RN 滚动视图（Home 各页歌曲列表、详情页列表……无需逐页接线）：
// swizzle -[RCTScrollView scrollViewDidScroll:]，原生侧维护收起状态机
// （offset > 48 收起 / ≤ 2 展开，中间为迟滞区防抖），仅在状态变化时把
// tabBarCollapseChanged 事件发给 JS——滚动事件本身不过桥，性能无损。
// 状态变化经 NSNotification 通知 UtilsModule 转发（避免跨模块拿 bridge 实例）。
static BOOL LXTabBarCollapsedState = NO;
static IMP LXOrigRCTScrollViewDidScroll = NULL;

static void LXSetTabBarCollapsed(BOOL collapsed) {
  if (LXTabBarCollapsedState == collapsed) return;
  LXTabBarCollapsedState = collapsed;
  [[NSNotificationCenter defaultCenter] postNotificationName:LXTabBarCollapseChangedNotification
                                                      object:nil
                                                    userInfo:@{ @"collapsed": @(collapsed) }];
}

static void LX_RCTScrollView_scrollViewDidScroll(id self, SEL _cmd, UIScrollView *scrollView) {
  if (LXOrigRCTScrollViewDidScroll != NULL) {
    ((void (*)(id, SEL, UIScrollView *))LXOrigRCTScrollViewDidScroll)(self, _cmd, scrollView);
  }
  CGPoint offset = scrollView.contentOffset;
  if (offset.y > 48) {
    // 仅「主动拖动」的滚动才收起：惯性滑行（decelerating）与被动偏移不收起——
    // 否则手动展开会被原列表残留的惯性滚动瞬间收回（点击展开失效的根因之一）；
    // 新的主动拖动会清除手动展开标记（再次滚动重新收起）
    if (scrollView.isTracking) LXTabBarManualExpanded = NO;
    if (!LXTabBarManualExpanded) LXSetTabBarCollapsed(YES);
  } else if (offset.y <= 2) {
    LXTabBarManualExpanded = NO;
    LXSetTabBarCollapsed(NO);
  }
  // (2, 48] 迟滞区：保持当前状态，避免顶部抖动来回切换
}

@interface LXTabBarCollapseSetup : NSObject
@end
@implementation LXTabBarCollapseSetup

+ (void)load {
  Method method = class_getInstanceMethod([RCTScrollView class], @selector(scrollViewDidScroll:));
  if (method == nil) return;
  LXOrigRCTScrollViewDidScroll = method_getImplementation(method);
  method_setImplementation(method, (IMP)LX_RCTScrollView_scrollViewDidScroll);
}

@end

@interface CryptoModule : NSObject<RCTBridgeModule>
@end

@implementation CryptoModule

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

RCT_REMAP_METHOD(generateRsaKey, generateRsaKeyWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSError *error = nil;
  NSDictionary *keyPair = LXGenerateRSAKeyPair(&error);
  if (keyPair == nil) {
    reject(@"generate_rsa_key", error.localizedDescription ?: @"Failed to generate RSA key pair", error);
    return;
  }
  resolve(keyPair);
}

RCT_REMAP_METHOD(rsaEncrypt, rsaEncrypt:(NSString *)text key:(NSString *)key padding:(NSString *)padding resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSError *error = nil;
  NSString *result = LXRSAEncrypt(text, key, padding, &error);
  if (result == nil) {
    reject(@"rsa_encrypt", error.localizedDescription ?: @"RSA encrypt failed", error);
    return;
  }
  resolve(result);
}

RCT_REMAP_METHOD(rsaDecrypt, rsaDecrypt:(NSString *)text key:(NSString *)key padding:(NSString *)padding resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSError *error = nil;
  NSString *result = LXRSADecrypt(text, key, padding, &error);
  if (result == nil) {
    reject(@"rsa_decrypt", error.localizedDescription ?: @"RSA decrypt failed", error);
    return;
  }
  resolve(result);
}

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(rsaEncryptSync:(NSString *)text key:(NSString *)key padding:(NSString *)padding) {
  return LXRSAEncrypt(text, key, padding, nil) ?: @"";
}

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(rsaDecryptSync:(NSString *)text key:(NSString *)key padding:(NSString *)padding) {
  return LXRSADecrypt(text, key, padding, nil) ?: @"";
}

RCT_REMAP_METHOD(aesEncrypt, aesEncrypt:(NSString *)text key:(NSString *)key iv:(NSString *)iv mode:(NSString *)mode resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSError *error = nil;
  NSString *result = LXAES(text, key, iv, mode, kCCEncrypt, &error);
  if (result == nil) {
    reject(@"aes_encrypt", error.localizedDescription ?: @"AES encrypt failed", error);
    return;
  }
  resolve(result);
}

RCT_REMAP_METHOD(aesDecrypt, aesDecrypt:(NSString *)text key:(NSString *)key iv:(NSString *)iv mode:(NSString *)mode resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSError *error = nil;
  NSString *result = LXAES(text, key, iv, mode, kCCDecrypt, &error);
  if (result == nil) {
    reject(@"aes_decrypt", error.localizedDescription ?: @"AES decrypt failed", error);
    return;
  }
  resolve(result);
}

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(aesEncryptSync:(NSString *)text key:(NSString *)key iv:(NSString *)iv mode:(NSString *)mode) {
  return LXAES(text, key, iv, mode, kCCEncrypt, nil) ?: @"";
}

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(aesDecryptSync:(NSString *)text key:(NSString *)key iv:(NSString *)iv mode:(NSString *)mode) {
  return LXAES(text, key, iv, mode, kCCDecrypt, nil) ?: @"";
}

RCT_REMAP_METHOD(sha1, sha1:(NSString *)input resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  resolve(LXSHA1(input ?: @""));
}

@end

#pragma mark - Phone Scene Delegate（iOS 13+ 主 App 窗口）

@interface SceneDelegate : UIResponder <UIWindowSceneDelegate>
@property (strong, nonatomic) UIWindow *window;
@property (nonatomic, assign) BOOL didBootstrap;
@end

@implementation AppDelegate

#pragma mark - Scenes（iOS 13+ Phone Scene）

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  LXRegisterTrackPlayerLifecycleObserver();
  self.launchOptions = launchOptions;
  self.initialProps = @{};

  // 下拉控制中心 / 锁屏瞬间媒体卡片只渲染一次快照：转入 inactive 时补一次
  // 强制重绘，让卡片打开后立即刷新到当前歌词行（后续换行由歌词 tick 驱动）。
  [[NSNotificationCenter defaultCenter] addObserver:self
                                           selector:@selector(handleAppWillResignActiveForLyricCard:)
                                               name:UIApplicationWillResignActiveNotification
                                             object:nil];

  return YES;
}

- (void)handleAppWillResignActiveForLyricCard:(NSNotification *)notification
{
  LXQueueNowPlayingLyricRedraw();
}

- (UISceneConfiguration *)application:(UIApplication *)application
          configurationForConnectingSceneSession:(UISceneSession *)connectingSceneSession
                                         options:(UISceneConnectionOptions *)options API_AVAILABLE(ios(13.0))
{
  (void)application;
  (void)options;
  UISceneConfiguration *configuration = [[UISceneConfiguration alloc] initWithName:@"Phone" sessionRole:UIWindowSceneSessionRoleApplication];
  configuration.delegateClass = [SceneDelegate class];
  return configuration;
}

- (NSArray<id<RCTBridgeModule>> *)extraModulesForBridge:(RCTBridge *)bridge {
  return [ReactNativeNavigation extraModulesForBridge:bridge];
}

// 深链（lxmusic://）与「从文件 App 打开 lxmc/bin」（LSSupportsOpeningDocumentsInPlace）
// 此前声明了 scheme/文档类型却无任何原生入口承接，链路断裂。
// 统一转发给 RN Linking，由 JS 侧 core/init/deeplink 的 Linking 监听接收处理。
- (BOOL)application:(UIApplication *)app
            openURL:(NSURL *)url
            options:(NSDictionary<UIApplicationOpenURLOptionsKey, id> *)options {
  return [RCTLinkingManager application:app openURL:url options:options];
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self getBundleURL];
}

- (NSURL *)getBundleURL
{
  NSURL *bundledURL = [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#if DEBUG
  if (bundledURL != nil) return bundledURL;
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return bundledURL;
#endif
}

@end


@implementation SceneDelegate

- (void)scene:(UIScene *)scene willConnectToSession:(UISceneSession *)session options:(UISceneConnectionOptions *)connectionOptions API_AVAILABLE(ios(13.0)) {
  (void)session;
  (void)connectionOptions;
  if (![scene isKindOfClass:[UIWindowScene class]]) return;
  UIWindowScene *windowScene = (UIWindowScene *)scene;

  AppDelegate *appDelegate = (AppDelegate *)UIApplication.sharedApplication.delegate;

  // 1) 立即创建绑定到 windowScene 的窗口，先用原生 LaunchScreen 兜底并 makeKeyAndVisible，
  //    不依赖 RNN 的 RNNSplashScreen（它用 delegate.window + initWithFrame: 兜底，scene 模式下该窗口不会被渲染导致黑屏）。
  UIWindow *window = [[UIWindow alloc] initWithWindowScene:windowScene];
  window.backgroundColor = [UIColor systemBackgroundColor];
  self.window = window;
  appDelegate.window = window;

  UIStoryboard *launchStoryboard = [UIStoryboard storyboardWithName:@"LaunchScreen" bundle:[NSBundle mainBundle]];
  UIViewController *launchVC = [launchStoryboard instantiateInitialViewController];
  if (launchVC == nil) {
    launchVC = [UIViewController new];
    launchVC.view.backgroundColor = [UIColor systemBackgroundColor];
  }
  window.rootViewController = launchVC;
  [window makeKeyAndVisible];
}

- (void)sceneDidBecomeActive:(UIScene *)scene API_AVAILABLE(ios(13.0)) {
  if (self.didBootstrap) return;
  if (![scene isKindOfClass:[UIWindowScene class]]) return;
  if (!self.window) return;

  AppDelegate *appDelegate = (AppDelegate *)UIApplication.sharedApplication.delegate;
  if (!appDelegate) return;

  self.didBootstrap = YES;
  if (!appDelegate.bridge) {
    NSLog(@"###NATIVE_DEBUG### creating RCTBridge");
    appDelegate.bridge = [[RCTBridge alloc] initWithDelegate:appDelegate launchOptions:appDelegate.launchOptions];
    NSLog(@"###NATIVE_DEBUG### RCTBridge created");
  }
  NSLog(@"###NATIVE_DEBUG### bootstrapping ReactNativeNavigation");
  [ReactNativeNavigation bootstrapWithBridge:appDelegate.bridge];
  NSLog(@"###NATIVE_DEBUG### ReactNativeNavigation bootstrap returned");
}

@end




