#import "AppDelegate.h"
#import <CommonCrypto/CommonCryptor.h>
#import <CommonCrypto/CommonDigest.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTBundleURLProvider.h>
#import <React/RCTEventEmitter.h>
#import <React/RCTLinkingManager.h>
#import <ReactNativeNavigation/ReactNativeNavigation.h>
#import <Security/Security.h>
#import <AVFoundation/AVFoundation.h>
#import <Accelerate/Accelerate.h>
#import <MediaPlayer/MediaPlayer.h>
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

static NSURLSessionDataTask *LXNowPlayingArtworkTask = nil;
static NSMutableDictionary *LXNowPlayingInfoCache = nil;
static NSString *LXNowPlayingArtworkPath = nil;
static NSUInteger LXNowPlayingArtworkRequestId = 0;
static MPNowPlayingPlaybackState LXNowPlayingState = MPNowPlayingPlaybackStateStopped;
static BOOL LXIsReceivingRemoteControlEvents = NO;
static NSString * const LXTrackPlayerLifecycleNotificationName = @"LXTrackPlayerLifecycle";
static id LXTrackPlayerLifecycleObserver = nil;
static id LXNowPlayingApplicationObserver = nil;
static NSString * const LXRemoteCommandNotificationName = @"LXRemoteCommand";
static BOOL LXRemoteCommandHandlersInstalled = NO;

static void LXBeginReceivingRemoteControlEvents(void);
static void LXEndReceivingRemoteControlEvents(void);

static void LXPostRemoteCommandNotification(NSString *command, NSDictionary *extra) {
  NSMutableDictionary *userInfo = [NSMutableDictionary dictionaryWithDictionary:extra ?: @{}];
  if (command.length) userInfo[@"command"] = command;
  [[NSNotificationCenter defaultCenter] postNotificationName:LXRemoteCommandNotificationName object:nil userInfo:userInfo];
}

static MPRemoteCommandHandlerStatus LXHandleRemoteCommandEvent(NSString *command) {
  LXPostRemoteCommandNotification(command, nil);
  return MPRemoteCommandHandlerStatusSuccess;
}

static MPRemoteCommandHandlerStatus LXHandleRemoteChangePlaybackPositionEvent(MPChangePlaybackPositionCommandEvent *event) {
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
  if (!hasInfo) {
    commandCenter.playCommand.enabled = NO;
    commandCenter.pauseCommand.enabled = NO;
    commandCenter.togglePlayPauseCommand.enabled = NO;
    commandCenter.nextTrackCommand.enabled = NO;
    commandCenter.previousTrackCommand.enabled = NO;
    commandCenter.changePlaybackPositionCommand.enabled = NO;
    LXEndReceivingRemoteControlEvents();
    return;
  }

  BOOL isPlaying = LXNowPlayingState == MPNowPlayingPlaybackStatePlaying;
  commandCenter.playCommand.enabled = !isPlaying;
  commandCenter.pauseCommand.enabled = isPlaying;
  // 控制中心合并的「播放/暂停」按钮对应 togglePlayPauseCommand，必须启用，否则按钮灰置不可点
  commandCenter.togglePlayPauseCommand.enabled = YES;
  commandCenter.nextTrackCommand.enabled = YES;
  commandCenter.previousTrackCommand.enabled = YES;
  commandCenter.changePlaybackPositionCommand.enabled = YES;
  LXBeginReceivingRemoteControlEvents();
}

static void LXApplyNowPlayingInfo(void) {
  MPNowPlayingInfoCenter *center = [MPNowPlayingInfoCenter defaultCenter];
  center.nowPlayingInfo = LXNowPlayingInfoCache.count ? [LXNowPlayingInfoCache copy] : nil;
  if (@available(iOS 13.0, *)) {
    center.playbackState = LXNowPlayingState;
  }
  LXSyncRemoteCommandAvailability();
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
      if (requestId != LXNowPlayingArtworkRequestId) return;
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
        if (requestId != LXNowPlayingArtworkRequestId) return;
        center.playbackState = opposite;
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.08 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
          if (requestId != LXNowPlayingArtworkRequestId) return;
          center.playbackState = current;
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

  LXCancelNowPlayingArtworkTask();
  LXNowPlayingArtworkRequestId += 1;
  [info removeObjectForKey:MPMediaItemPropertyArtwork];
  LXNowPlayingArtworkPath = artworkPath.length ? [artworkPath copy] : nil;
  LXApplyNowPlayingInfo();

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

static void LXSetNowPlayingPlaybackState(MPNowPlayingPlaybackState state, NSDictionary *options) {
  LXNowPlayingState = state;

  // 播放事件可能早于歌曲元数据到达。不要把只有 playbackRate、没有标题的
  // 空字典发布给 MPNowPlayingInfoCenter：iOS 27 Beta 7 会把它识别成“未在播放”，
  // 且后续补写元数据不一定重新显示控制中心媒体卡片。先缓存状态，等
  // LXSetNowPlayingInfo 写入有效标题后再统一发布。
  NSString *existingTitle = [LXNowPlayingInfoCache[MPMediaItemPropertyTitle] isKindOfClass:[NSString class]]
    ? LXNowPlayingInfoCache[MPMediaItemPropertyTitle]
    : nil;
  if (existingTitle.length == 0) return;

  NSMutableDictionary *info = LXNowPlayingMutableInfo();
  NSDictionary *stateOptions = options ?: @{};
  NSNumber *elapsedTime = [stateOptions[@"elapsedTime"] isKindOfClass:[NSNumber class]] ? stateOptions[@"elapsedTime"] : nil;
  NSNumber *playbackRate = [stateOptions[@"playbackRate"] isKindOfClass:[NSNumber class]] ? stateOptions[@"playbackRate"] : nil;

  if (elapsedTime != nil) info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = elapsedTime;
  else if (state == MPNowPlayingPlaybackStateStopped) info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = @0;

  info[MPNowPlayingInfoPropertyPlaybackRate] = playbackRate ?: LXDefaultNowPlayingRate();
  info[MPNowPlayingInfoPropertyDefaultPlaybackRate] = LXNowPlayingDefaultPlaybackRateValue();
  LXApplyNowPlayingInfo();
}

static void LXClearNowPlayingInfo(void) {
  LXCancelNowPlayingArtworkTask();
  LXNowPlayingArtworkRequestId += 1;
  LXNowPlayingArtworkPath = nil;
  LXNowPlayingInfoCache = nil;
  LXNowPlayingState = MPNowPlayingPlaybackStateStopped;
  LXApplyNowPlayingInfo();
}

static void LXHandleTrackPlayerLifecycleNotification(NSNotification *notification) {
  NSDictionary *userInfo = [notification.userInfo isKindOfClass:[NSDictionary class]] ? notification.userInfo : @{};
  NSString *event = [userInfo[@"event"] isKindOfClass:[NSString class]] ? userInfo[@"event"] : @"";
  NSNumber *position = [userInfo[@"position"] isKindOfClass:[NSNumber class]] ? userInfo[@"position"] : nil;

  if ([event isEqualToString:@"destroy"] || [event isEqualToString:@"reset"]) {
    LXClearNowPlayingInfo();
    return;
  }

  if (LXNowPlayingInfoCache.count == 0) return;

  if ([event isEqualToString:@"seek"]) {
    LXSetNowPlayingPlaybackState(LXNowPlayingState, @{
      @"elapsedTime": position ?: @0,
      @"playbackRate": LXCurrentNowPlayingRate(),
    });
    return;
  }
}

static void LXRegisterTrackPlayerLifecycleObserver(void) {
  if (LXTrackPlayerLifecycleObserver == nil) {
    LXTrackPlayerLifecycleObserver = [[NSNotificationCenter defaultCenter] addObserverForName:LXTrackPlayerLifecycleNotificationName object:nil queue:[NSOperationQueue mainQueue] usingBlock:^(NSNotification * _Nonnull note) {
      LXHandleTrackPlayerLifecycleNotification(note);
    }];
  }

  if (LXNowPlayingApplicationObserver == nil) {
    LXNowPlayingApplicationObserver = [[NSNotificationCenter defaultCenter] addObserverForName:UIApplicationDidBecomeActiveNotification object:nil queue:[NSOperationQueue mainQueue] usingBlock:^(NSNotification * _Nonnull note) {
      if (LXNowPlayingInfoCache.count == 0) return;
      // iOS 27 Beta 7 可能在应用切换/控制中心展开后丢弃当前媒体会话；
      // 重新提交缓存并同步状态可让控制中心恢复歌曲信息和播放按钮。
      LXApplyNowPlayingInfo();
    }];
  }
}

static void LXSetNowPlayingInfo(NSDictionary *metadata) {
  NSMutableDictionary *info = LXNowPlayingMutableInfo();

  NSString *title = [metadata[@"title"] isKindOfClass:[NSString class]] ? metadata[@"title"] : nil;
  NSString *artist = [metadata[@"artist"] isKindOfClass:[NSString class]] ? metadata[@"artist"] : nil;
  NSString *album = [metadata[@"album"] isKindOfClass:[NSString class]] ? metadata[@"album"] : nil;
  NSNumber *duration = [metadata[@"duration"] isKindOfClass:[NSNumber class]] ? metadata[@"duration"] : nil;
  NSNumber *elapsedTime = [metadata[@"elapsedTime"] isKindOfClass:[NSNumber class]] ? metadata[@"elapsedTime"] : nil;
  NSNumber *playbackRate = [metadata[@"playbackRate"] isKindOfClass:[NSNumber class]] ? metadata[@"playbackRate"] : nil;

  if (title != nil) info[MPMediaItemPropertyTitle] = title;
  if (artist != nil) info[MPMediaItemPropertyArtist] = artist;
  if (album != nil) info[MPMediaItemPropertyAlbumTitle] = album;
  if (duration != nil) info[MPMediaItemPropertyPlaybackDuration] = duration;
  if (elapsedTime != nil) info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = elapsedTime;
  info[MPNowPlayingInfoPropertyPlaybackRate] = playbackRate ?: info[MPNowPlayingInfoPropertyPlaybackRate] ?: LXDefaultNowPlayingRate();
  info[MPNowPlayingInfoPropertyDefaultPlaybackRate] = info[MPNowPlayingInfoPropertyDefaultPlaybackRate] ?: LXNowPlayingDefaultPlaybackRateValue();

  // 仅当调用方显式携带 artwork 字段时才更新封面。蓝牙歌词 / 逐行歌词更新只传
  // { artist: 歌词 }（不含 artwork 键），若仍触发 LXSetNowPlayingArtwork(@"") 会把
  // 控制中心 / 锁屏封面擦除，表现为“播放中封面闪烁/消失”。不携带时仅重应用信息即可。
  if (metadata[@"artwork"] != nil) {
    NSString *artworkPath = [metadata[@"artwork"] isKindOfClass:[NSString class]] ? metadata[@"artwork"] : @"";
    LXSetNowPlayingArtwork(artworkPath);
  } else {
    LXApplyNowPlayingInfo();
  }
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
        // 记录首个带 rootViewController 的窗口作为主窗口候选。
        if (mainWindow == nil) mainWindow = win;
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
        routeSharingPolicy:AVAudioSessionRouteSharingPolicyDefault
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

    NSError *sessionError = nil;
    if (![self prepareAudioSession:&sessionError]) {
      [self emitErrorMessage:sessionError.localizedDescription ?: @"Failed to activate audio session"];
      reject(@"streaming_flac_session", sessionError.localizedDescription ?: @"Failed to activate audio session", sessionError);
      return;
    }

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

  dispatch_sync(self.renderQueue, ^{
    self.lastKnownPosition = requestedPosition;
    [self updatePlaybackGenerationLocked];
    [self resetRealtimeRenderStateLocked];
    [self rebuildRealtimeProcessorsLocked];
    self.completedFrames = self.sampleRate > 0 ? (int64_t)llround(requestedPosition * self.sampleRate) : 0;
    self.playbackAnchorFrame = self.completedFrames;
    self.playbackStarted = NO;
  });

  self.pendingSeekPosition = requestedPosition;
  self.seekRequested = YES;
  self.seekInProgress = self.sampleRate > 0 && requestedPosition > 0;
  self.currentState = self.manualPause ? @"paused" : @"buffering";
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

// 系统分享面板（UIActivityViewController），用于"导出/保存"场景
RCT_REMAP_METHOD(shareFile, shareFile:(NSString *)filePath resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    NSFileManager *fileManager = [NSFileManager defaultManager];
    if (![fileManager fileExistsAtPath:filePath]) {
      reject(@"file_not_found", @"File not found", LXError(@"file_not_found", @"File not found"));
      return;
    }
    NSURL *fileURL = [NSURL fileURLWithPath:filePath];
    UIActivityViewController *activityViewController = [[UIActivityViewController alloc] initWithActivityItems:@[fileURL] applicationActivities:nil];
    UIViewController *controller = LXTopViewController();
    if (controller == nil) {
      reject(@"share_present", @"Unable to find a view controller to present share sheet", LXError(@"share_present", @"Unable to find a view controller to present share sheet"));
      return;
    }
    if (UI_USER_INTERFACE_IDIOM() == UIUserInterfaceIdiomPad) {
      activityViewController.popoverPresentationController.sourceView = controller.view;
      activityViewController.popoverPresentationController.sourceRect = CGRectMake(CGRectGetMidX(controller.view.bounds), CGRectGetMaxY(controller.view.bounds), 0, 0);
      activityViewController.popoverPresentationController.permittedArrowDirections = UIPopoverArrowDirectionDown;
    }
    // 分享面板关闭后恢复主窗口为 key 并重新开启交互（兜底，真正修复依赖 JS 侧先卸载 RN Modal）。
    activityViewController.completionWithItemsHandler = ^(UIActivityType __nullable activityType, BOOL completed, NSArray * __nullable returnedItems, NSError * __nullable activityError) {
      LXEnsureKeyWindow();
    };
    [controller presentViewController:activityViewController animated:YES completion:^{
      resolve(nil);
    }];
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

  NSString *title = sidecar[@"name"];
  if (![title isKindOfClass:[NSString class]] || !title.length) {
    title = LXFindMetadataString(asset, @[ @"title" ], @[ @"title" ]);
  }
  if (!title.length) title = fileURL.URLByDeletingPathExtension.lastPathComponent ?: fileURL.lastPathComponent ?: @"";

  NSString *artist = sidecar[@"singer"];
  if (![artist isKindOfClass:[NSString class]] || !artist.length) {
    artist = LXFindMetadataString(asset, @[ @"artist", @"creator" ], @[ @"artist", @"author", @"performer" ]);
  }
  if (!artist.length) artist = @"";

  NSString *albumName = sidecar[@"albumName"];
  if (![albumName isKindOfClass:[NSString class]] || !albumName.length) {
    albumName = LXFindMetadataString(asset, @[ @"albumname" ], @[ @"album" ]);
  }
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
  NSMutableDictionary *sidecar = [LXReadJSONFile(LXMediaMetadataSidecarPath(filePath)) mutableCopy];
  if (sidecar == nil) sidecar = [NSMutableDictionary dictionary];

  for (NSString *key in @[ @"name", @"singer", @"albumName" ]) {
    NSString *value = [metadata[key] isKindOfClass:[NSString class]] ? metadata[key] : @"";
    sidecar[key] = value;
  }

  NSError *error = nil;
  if (!LXWriteJSONFile(LXMediaMetadataSidecarPath(filePath), sidecar, &error)) {
    reject(@"write_metadata_failed", error.localizedDescription ?: @"Failed to write metadata", error);
    return;
  }
  resolve(nil);
}

RCT_REMAP_METHOD(readPic, readPic:(NSString *)filePath targetPath:(NSString *)targetPath resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSString *sidecarCoverPath = LXFindCoverSidecarPath(filePath);
  NSData *coverData = nil;
  NSString *ext = @"jpg";
  if (sidecarCoverPath.length) {
    coverData = [NSData dataWithContentsOfFile:sidecarCoverPath];
    ext = sidecarCoverPath.pathExtension.length ? sidecarCoverPath.pathExtension.lowercaseString : @"jpg";
  } else {
    AVURLAsset *asset = [AVURLAsset URLAssetWithURL:[NSURL fileURLWithPath:filePath] options:nil];
    coverData = LXFindArtworkData(asset);
    if (coverData.length) ext = LXImageExtensionForData(coverData);
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
  NSString *ext = picPath.pathExtension.lowercaseString.length ? picPath.pathExtension.lowercaseString : @"jpg";
  NSString *targetPath = [NSString stringWithFormat:@"%@.%@", LXMediaCoverSidecarPrefix(filePath), ext];
  NSError *error = nil;
  LXRemoveCoverSidecars(filePath);
  if (![[NSFileManager defaultManager] copyItemAtPath:picPath toPath:targetPath error:&error]) {
    reject(@"write_pic_failed", error.localizedDescription ?: @"Failed to save picture", error);
    return;
  }
  resolve(nil);
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
  resolve(lyric ?: @"");
}

RCT_REMAP_METHOD(writeLyric, writeLyric:(NSString *)filePath lyric:(NSString *)lyric resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSError *error = nil;
  NSString *lrcPath = LXMediaLyricSidecarPath(filePath);
  if (![lyric ?: @"" writeToFile:lrcPath atomically:YES encoding:NSUTF8StringEncoding error:&error]) {
    reject(@"write_lyric_failed", error.localizedDescription ?: @"Failed to save lyric", error);
    return;
  }
  resolve(nil);
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

RCT_REMAP_METHOD(clearNowPlayingInfo, clearNowPlayingInfoWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    LXClearNowPlayingInfo();
    resolve(nil);
  });
}

@end

// 当前持有的后台任务（切歌取链期间申请）。放在原生侧而非依赖 JS 回传：
// 锁屏时 JS↔原生 往返可能来不及完成，若由 JS 独家记账会出现「已 begin 但没 end」的泄漏。
// 这里做幂等管理：重复 begin 复用同一个任务，end 一律结束当前任务。
static UIBackgroundTaskIdentifier LXBackgroundTaskId = UIBackgroundTaskInvalid;

@interface UtilsModule : RCTEventEmitter<RCTBridgeModule>
@property (nonatomic, assign) BOOL hasListeners;
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
  }
  return self;
}

- (void)dealloc {
  [[NSNotificationCenter defaultCenter] removeObserver:self];
}

- (NSArray<NSString *> *)supportedEvents {
  // screen-size-changed 已移除：iOS 端从未发送该事件（窗口尺寸由 JS 侧 SizeView onLayout 同步），
  // 声明而不发送属于死事件，且避免误导后续接入
  return @[ @"headphones-disconnected", @"remote-command", @"screen-state" ];
}

- (void)startObserving {
  self.hasListeners = YES;
}

- (void)stopObserving {
  self.hasListeners = NO;
}

- (BOOL)shouldEmitHeadphonesDisconnectedForPreviousRoute:(AVAudioSessionRouteDescription *)route {
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

- (void)handleAudioRouteChange:(NSNotification *)notification {
  if (!self.hasListeners) return;

  NSDictionary *userInfo = notification.userInfo;
  if (userInfo == nil) return;

  NSNumber *reasonValue = userInfo[AVAudioSessionRouteChangeReasonKey];
  if (reasonValue == nil || [reasonValue unsignedIntegerValue] != AVAudioSessionRouteChangeReasonOldDeviceUnavailable) return;

  AVAudioSessionRouteDescription *previousRoute = userInfo[AVAudioSessionRouteChangePreviousRouteKey];
  if (previousRoute == nil || ![self shouldEmitHeadphonesDisconnectedForPreviousRoute:previousRoute]) return;

  dispatch_async(dispatch_get_main_queue(), ^{
    [self sendEventWithName:@"headphones-disconnected" body:nil];
  });
}

- (void)handleRemoteCommandNotification:(NSNotification *)notification {
  if (!self.hasListeners) return;

  NSDictionary *userInfo = [notification.userInfo isKindOfClass:[NSDictionary class]] ? notification.userInfo : @{};
  NSString *command = [userInfo[@"command"] isKindOfClass:[NSString class]] ? userInfo[@"command"] : @"";
  if (!command.length) return;

  NSMutableDictionary *body = [NSMutableDictionary dictionaryWithDictionary:userInfo];
  body[@"command"] = command;

  dispatch_async(dispatch_get_main_queue(), ^{
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

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  LXRegisterTrackPlayerLifecycleObserver();
  RCTBridge *bridge = [[RCTBridge alloc] initWithDelegate:self launchOptions:launchOptions];
  [ReactNativeNavigation bootstrapWithBridge:bridge];
  self.initialProps = @{};

  return YES;
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
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

@end
