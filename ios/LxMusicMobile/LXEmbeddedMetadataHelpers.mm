#pragma mark - Embedded metadata writers / readers (MP3/FLAC)
// This file is meant to be #included into AppDelegate.mm so it can reuse
// existing helpers (LXWriteJSONFile, LXMediaMetadataSidecarPath, etc.).

#if LX_HAS_LIBFLAC
static NSData *LXReadFLACPicture(NSString *filePath, NSString **outExt) {
  FLAC__Metadata_Chain *chain = FLAC__metadata_chain_new();
  if (!chain) return nil;
  if (!FLAC__metadata_chain_read(chain, [filePath UTF8String])) {
    FLAC__metadata_chain_delete(chain);
    return nil;
  }
  FLAC__Metadata_Iterator *it = FLAC__metadata_iterator_new();
  FLAC__metadata_iterator_init(it, chain);
  NSData *result = nil;
  do {
    FLAC__StreamMetadata *block = FLAC__metadata_iterator_get_block(it);
    if (block && block->type == FLAC__METADATA_TYPE_PICTURE) {
      FLAC__StreamMetadata_Picture *pic = &block->data.picture;
      if (pic->data_length > 0 && pic->data) {
        result = [NSData dataWithBytes:pic->data length:pic->data_length];
        if (outExt) {
          NSString *mime = pic->mime_type ? [NSString stringWithUTF8String:pic->mime_type] : @"";
          if ([mime containsString:@"png"]) *outExt = @"png";
          else if ([mime containsString:@"gif"]) *outExt = @"gif";
          else *outExt = @"jpg";
        }
        break;
      }
    }
  } while (FLAC__metadata_iterator_next(it));
  FLAC__metadata_iterator_delete(it);
  FLAC__metadata_chain_delete(chain);
  return result;
}

static NSString *LXReadFLACLyric(NSString *filePath) {
  FLAC__Metadata_Chain *chain = FLAC__metadata_chain_new();
  if (!chain) return nil;
  if (!FLAC__metadata_chain_read(chain, [filePath UTF8String])) {
    FLAC__metadata_chain_delete(chain);
    return nil;
  }
  FLAC__Metadata_Iterator *it = FLAC__metadata_iterator_new();
  FLAC__metadata_iterator_init(it, chain);
  NSString *result = nil;
  do {
    FLAC__StreamMetadata *block = FLAC__metadata_iterator_get_block(it);
    if (block && block->type == FLAC__METADATA_TYPE_VORBIS_COMMENT) {
      FLAC__StreamMetadata_VorbisComment *vc = &block->data.vorbis_comment;
      for (uint32_t i = 0; i < vc->num_comments; i++) {
        char *name = NULL, *value = NULL;
        if (FLAC__metadata_object_vorbiscomment_entry_to_name_value_pair(vc->comments[i], &name, &value)) {
          if (name && strcmp(name, "LYRICS") == 0 && value && strlen(value) > 0) {
            result = [NSString stringWithUTF8String:value];
          }
          free(name);
          free(value);
          if (result) break;
        }
      }
      if (result) break;
    }
  } while (FLAC__metadata_iterator_next(it));
  FLAC__metadata_iterator_delete(it);
  FLAC__metadata_chain_delete(chain);
  return result;
}

static BOOL LXWriteFLACMetadata(NSString *filePath, NSDictionary *metadata, NSString *picPath, NSString *lyric, NSError **error) {
  const char *path = [filePath UTF8String];
  FLAC__Metadata_Chain *chain = FLAC__metadata_chain_new();
  if (!chain) {
    if (error) *error = [NSError errorWithDomain:@"LXMediaMetadata" code:1 userInfo:@{NSLocalizedDescriptionKey: @"Failed to create FLAC metadata chain"}];
    return NO;
  }
  BOOL ok = FLAC__metadata_chain_read(chain, path);
  if (!ok) {
    FLAC__Metadata_Chain_Status status = FLAC__metadata_chain_status(chain);
    if (error) *error = [NSError errorWithDomain:@"LXMediaMetadata" code:2 userInfo:@{NSLocalizedDescriptionKey: [NSString stringWithFormat:@"Failed to read FLAC metadata: %s", FLAC__Metadata_ChainStatusString[status]]}];
    FLAC__metadata_chain_delete(chain);
    return NO;
  }

  FLAC__Metadata_Iterator *it = FLAC__metadata_iterator_new();
  FLAC__metadata_iterator_init(it, chain);

  NSString *existingTitle = nil;
  NSString *existingArtist = nil;
  NSString *existingAlbum = nil;
  NSString *existingLyric = nil;
  NSMutableArray<NSNumber *> *blocksToRemove = [NSMutableArray array];
  int idx = 0;
  do {
    FLAC__StreamMetadata *block = FLAC__metadata_iterator_get_block(it);
    if (block) {
      if (block->type == FLAC__METADATA_TYPE_VORBIS_COMMENT) {
        FLAC__StreamMetadata_VorbisComment *vc = &block->data.vorbis_comment;
        for (uint32_t i = 0; i < vc->num_comments; i++) {
          char *name = NULL, *value = NULL;
          if (FLAC__metadata_object_vorbiscomment_entry_to_name_value_pair(vc->comments[i], &name, &value)) {
            NSString *key = name ? [NSString stringWithUTF8String:name] : nil;
            NSString *val = value ? [NSString stringWithUTF8String:value] : nil;
            if (val.length) {
              if ([key isEqualToString:@"TITLE"]) existingTitle = val;
              else if ([key isEqualToString:@"ARTIST"]) existingArtist = val;
              else if ([key isEqualToString:@"ALBUM"]) existingAlbum = val;
              else if ([key isEqualToString:@"LYRICS"]) existingLyric = val;
            }
            free(name);
            free(value);
          }
        }
        [blocksToRemove addObject:@(idx)];
      } else if (block->type == FLAC__METADATA_TYPE_PICTURE) {
        [blocksToRemove addObject:@(idx)];
      }
    }
    idx++;
  } while (FLAC__metadata_iterator_next(it));

  for (NSNumber *n in [blocksToRemove reverseObjectEnumerator]) {
    int target = n.intValue;
    FLAC__metadata_iterator_init(it, chain);
    for (int i = 0; i < target; i++) FLAC__metadata_iterator_next(it);
    FLAC__metadata_iterator_delete_block(it, false);
  }

  NSString *title = [metadata[@"name"] isKindOfClass:[NSString class]] ? metadata[@"name"] : nil;
  NSString *artist = [metadata[@"singer"] isKindOfClass:[NSString class]] ? metadata[@"singer"] : nil;
  NSString *album = [metadata[@"albumName"] isKindOfClass:[NSString class]] ? metadata[@"albumName"] : nil;
  if (!title.length) title = existingTitle;
  if (!artist.length) artist = existingArtist;
  if (!album.length) album = existingAlbum;
  if (!lyric.length) lyric = existingLyric;

  FLAC__StreamMetadata *vcBlock = FLAC__metadata_object_new(FLAC__METADATA_TYPE_VORBIS_COMMENT);
  void (^addVC)(NSString *, NSString *) = ^(NSString *key, NSString *value) {
    if (!key.length || !value.length) return;
    FLAC__StreamMetadata_VorbisComment_Entry entry;
    if (FLAC__metadata_object_vorbiscomment_entry_from_name_value_pair(&entry, [key UTF8String], [value UTF8String])) {
      FLAC__metadata_object_vorbiscomment_append_comment(vcBlock, entry, /*copy*/ true);
      free(entry.entry);
    }
  };
  addVC(@"TITLE", title);
  addVC(@"ARTIST", artist);
  addVC(@"ALBUM", album);
  addVC(@"LYRICS", lyric);

  FLAC__StreamMetadata *picBlock = nil;
  if (picPath.length) {
    NSData *imgData = [NSData dataWithContentsOfFile:picPath];
    if (imgData.length) {
      picBlock = FLAC__metadata_object_new(FLAC__METADATA_TYPE_PICTURE);
      picBlock->data.picture.type = FLAC__STREAM_METADATA_PICTURE_TYPE_FRONT_COVER;
      NSString *ext = picPath.pathExtension.lowercaseString;
      NSString *mime = [ext isEqualToString:@"png"] ? @"image/png" : ([ext isEqualToString:@"gif"] ? @"image/gif" : @"image/jpeg");
      FLAC__metadata_object_picture_set_mime_type(picBlock, (char *)[mime UTF8String], /*copy*/ true);
      FLAC__metadata_object_picture_set_description(picBlock, (FLAC__byte *)"", /*copy*/ true);
      FLAC__metadata_object_picture_set_data(picBlock, (FLAC__byte *)imgData.bytes, (FLAC__uint32)imgData.length, /*copy*/ true);
    }
  }

  FLAC__metadata_iterator_init(it, chain);
  if (vcBlock->data.vorbis_comment.num_comments > 0) {
    FLAC__metadata_iterator_insert_block_after(it, vcBlock);
    if (picBlock) {
      FLAC__metadata_iterator_next(it);
      FLAC__metadata_iterator_insert_block_after(it, picBlock);
    }
  } else {
    FLAC__metadata_object_delete(vcBlock);
    if (picBlock) {
      FLAC__metadata_iterator_insert_block_after(it, picBlock);
    }
  }

  ok = FLAC__metadata_chain_write(chain, /*use_padding*/ true, /*preserve_file_stats*/ false);
  if (!ok) {
    FLAC__Metadata_Chain_Status status = FLAC__metadata_chain_status(chain);
    if (error) *error = [NSError errorWithDomain:@"LXMediaMetadata" code:3 userInfo:@{NSLocalizedDescriptionKey: [NSString stringWithFormat:@"Failed to write FLAC metadata: %s", FLAC__Metadata_ChainStatusString[status]]}];
  }
  FLAC__metadata_iterator_delete(it);
  FLAC__metadata_chain_delete(chain);
  return ok;
}
#endif

#pragma mark - MP3 ID3v2.4 helpers

static NSUInteger LXID3TagSizeFromBytes(const uint8_t *bytes) {
  return ((bytes[0] & 0x7F) << 21) | ((bytes[1] & 0x7F) << 14) | ((bytes[2] & 0x7F) << 7) | (bytes[3] & 0x7F);
}

static void LXID3TagSizeToBytes(NSUInteger size, uint8_t *bytes) {
  bytes[0] = (uint8_t)((size >> 21) & 0x7F);
  bytes[1] = (uint8_t)((size >> 14) & 0x7F);
  bytes[2] = (uint8_t)((size >> 7) & 0x7F);
  bytes[3] = (uint8_t)(size & 0x7F);
}

static NSString *LXStringFromEncodingBytes(const uint8_t *bytes, NSUInteger length, uint8_t enc) {
  // Trim a trailing null terminator if present.
  if (length > 0 && bytes[length - 1] == 0) length--;
  if (length == 0) return nil;
  NSStringEncoding nsEnc = NSUTF8StringEncoding;
  if (enc == 0x01) nsEnc = NSUTF16StringEncoding;
  else if (enc == 0x00) nsEnc = NSISOLatin1StringEncoding;
  else if (enc == 0x02) nsEnc = NSUTF16BigEndianStringEncoding;
  else if (enc != 0x03) return nil;
  return [[NSString alloc] initWithBytes:bytes length:length encoding:nsEnc];
}

static NSString *LXID3TextFrameValue(NSData *body) {
  if (body.length < 2) return nil;
  const uint8_t *b = body.bytes;
  return LXStringFromEncodingBytes(b + 1, body.length - 1, b[0]);
}

static NSData *LXID3BuildTextFrame(NSString *value) {
  const char *utf8 = [value UTF8String];
  NSUInteger len = strlen(utf8) + 1;
  NSMutableData *body = [NSMutableData dataWithCapacity:1 + len];
  uint8_t enc = 0x03;
  [body appendBytes:&enc length:1];
  [body appendBytes:utf8 length:len];
  return body;
}

static NSString *LXID3USLTFrameValue(NSData *body) {
  if (body.length < 5) return nil;
  const uint8_t *b = body.bytes;
  uint8_t enc = b[0];
  NSUInteger offset = 4;
  if (enc == 0x03) {
    while (offset < body.length && b[offset] != 0) offset++;
    if (offset < body.length) offset++;
    return LXStringFromEncodingBytes(b + offset, body.length - offset, enc);
  } else if (enc == 0x01) {
    while (offset + 1 < body.length && !(b[offset] == 0 && b[offset + 1] == 0)) offset += 2;
    if (offset + 1 < body.length) offset += 2;
    return LXStringFromEncodingBytes(b + offset, body.length - offset, enc);
  }
  return nil;
}

static NSData *LXID3BuildUSLTFrame(NSString *lyric) {
  const char *utf8 = [lyric UTF8String];
  NSUInteger lyricLen = strlen(utf8);
  NSMutableData *body = [NSMutableData dataWithCapacity:1 + 3 + 1 + lyricLen];
  uint8_t enc = 0x03;
  [body appendBytes:&enc length:1];
  [body appendBytes:"eng" length:3];
  uint8_t nullByte = 0;
  [body appendBytes:&nullByte length:1];
  [body appendBytes:utf8 length:lyricLen];
  return body;
}

static NSData *LXID3BuildAPICFrame(NSString *mime, NSData *imageData) {
  const char *mimeC = [mime UTF8String];
  NSMutableData *body = [NSMutableData data];
  uint8_t enc = 0x00;
  [body appendBytes:&enc length:1];
  [body appendBytes:mimeC length:strlen(mimeC) + 1];
  uint8_t type = 0x03;
  [body appendBytes:&type length:1];
  uint8_t desc = 0x00;
  [body appendBytes:&desc length:1];
  [body appendData:imageData];
  return body;
}

static NSDictionary<NSString *, NSData *> *LXReadID3Frames(NSString *filePath, NSUInteger *outHeaderSize) {
  NSMutableDictionary *frames = [NSMutableDictionary dictionary];
  *outHeaderSize = 0;
  NSFileHandle *fh = [NSFileHandle fileHandleForReadingAtPath:filePath];
  if (!fh) return frames;
  NSData *header = [fh readDataOfLength:10];
  if (header.length < 10) { [fh closeFile]; return frames; }
  const uint8_t *h = header.bytes;
  if (!(h[0] == 'I' && h[1] == 'D' && h[2] == '3')) { [fh closeFile]; return frames; }
  uint8_t major = h[3];
  NSUInteger tagSize = LXID3TagSizeFromBytes(h + 6);
  *outHeaderSize = 10 + tagSize;
  NSUInteger offset = 10;
  NSUInteger end = 10 + tagSize;
  while (offset + 10 <= end) {
    [fh seekToFileOffset:offset];
    NSData *frameHeader = [fh readDataOfLength:10];
    const uint8_t *fb = frameHeader.bytes;
    if (fb[0] == 0 && fb[1] == 0 && fb[2] == 0 && fb[3] == 0) break;
    NSString *fid = [[NSString alloc] initWithBytes:fb length:4 encoding:NSASCIIStringEncoding];
    NSUInteger frameSize = 0;
    if (major == 4) {
      frameSize = LXID3TagSizeFromBytes(fb + 4);
    } else if (major == 3) {
      frameSize = ((NSUInteger)fb[4] << 24) | ((NSUInteger)fb[5] << 16) | ((NSUInteger)fb[6] << 8) | fb[7];
    } else {
      break;
    }
    if (frameSize > tagSize || offset + 10 + frameSize > end) break;
    NSData *body = [fh readDataOfLength:frameSize];
    if (fid.length) frames[fid] = body;
    offset += 10 + frameSize;
  }
  [fh closeFile];
  return frames;
}

static BOOL LXWriteMP3Metadata(NSString *filePath, NSDictionary *metadata, NSString *picPath, NSString *lyric, NSError **error) {
  NSUInteger headerSize = 0;
  NSDictionary *existing = LXReadID3Frames(filePath, &headerSize);
  NSMutableDictionary *frames = [existing mutableCopy];
  [frames removeObjectsForKeys:@[@"TIT2", @"TPE1", @"TALB", @"USLT", @"APIC"]];

  NSString *title = [metadata[@"name"] isKindOfClass:[NSString class]] ? metadata[@"name"] : nil;
  NSString *artist = [metadata[@"singer"] isKindOfClass:[NSString class]] ? metadata[@"singer"] : nil;
  NSString *album = [metadata[@"albumName"] isKindOfClass:[NSString class]] ? metadata[@"albumName"] : nil;
  if (!title.length) title = LXID3TextFrameValue(existing[@"TIT2"]);
  if (!artist.length) artist = LXID3TextFrameValue(existing[@"TPE1"]);
  if (!album.length) album = LXID3TextFrameValue(existing[@"TALB"]);
  if (!lyric.length) lyric = LXID3USLTFrameValue(existing[@"USLT"]);

  if (title.length) frames[@"TIT2"] = LXID3BuildTextFrame(title);
  if (artist.length) frames[@"TPE1"] = LXID3BuildTextFrame(artist);
  if (album.length) frames[@"TALB"] = LXID3BuildTextFrame(album);
  if (lyric.length) frames[@"USLT"] = LXID3BuildUSLTFrame(lyric);

  NSData *existingCover = existing[@"APIC"];
  if (picPath.length) {
    NSData *imgData = [NSData dataWithContentsOfFile:picPath];
    if (imgData.length) {
      NSString *ext = picPath.pathExtension.lowercaseString;
      NSString *mime = [ext isEqualToString:@"png"] ? @"image/png" : ([ext isEqualToString:@"gif"] ? @"image/gif" : @"image/jpeg");
      frames[@"APIC"] = LXID3BuildAPICFrame(mime, imgData);
    }
  } else if (existingCover.length) {
    frames[@"APIC"] = existingCover;
  }

  NSMutableData *tagBody = [NSMutableData data];
  for (NSString *fid in frames) {
    NSData *body = frames[fid];
    NSMutableData *frame = [NSMutableData dataWithBytes:[fid UTF8String] length:4];
    uint8_t sizeBytes[4];
    LXID3TagSizeToBytes(body.length, sizeBytes);
    [frame appendBytes:sizeBytes length:4];
    uint8_t flags[2] = {0, 0};
    [frame appendBytes:flags length:2];
    [frame appendData:body];
    [tagBody appendData:frame];
  }

  NSUInteger tagSize = tagBody.length;
  uint8_t sizeBytes[4];
  LXID3TagSizeToBytes(tagSize, sizeBytes);
  NSMutableData *tag = [NSMutableData dataWithBytes:"ID3" length:3];
  uint8_t ver[2] = {0x04, 0x00};
  [tag appendBytes:ver length:2];
  uint8_t flags = 0x00;
  [tag appendBytes:&flags length:1];
  [tag appendBytes:sizeBytes length:4];
  [tag appendData:tagBody];

  NSFileHandle *readFh = [NSFileHandle fileHandleForReadingAtPath:filePath];
  [readFh seekToFileOffset:headerSize];
  NSData *rest = [readFh readDataToEndOfFile];
  [readFh closeFile];

  NSData *id3v1 = nil;
  if (rest.length >= 128) {
    const uint8_t *tail = (const uint8_t *)rest.bytes + rest.length - 128;
    if (tail[0] == 'T' && tail[1] == 'A' && tail[2] == 'G') {
      id3v1 = [rest subdataWithRange:NSMakeRange(rest.length - 128, 128)];
      rest = [rest subdataWithRange:NSMakeRange(0, rest.length - 128)];
    }
  }

  NSString *tempPath = [filePath stringByAppendingString:@".lxmetadata.tmp"];
  if (![[NSFileManager defaultManager] createFileAtPath:tempPath contents:nil attributes:nil]) {
    if (error) *error = [NSError errorWithDomain:@"LXMediaMetadata" code:10 userInfo:@{NSLocalizedDescriptionKey: @"Failed to create temp file"}];
    return NO;
  }
  NSFileHandle *writeFh = [NSFileHandle fileHandleForWritingAtPath:tempPath];
  [writeFh writeData:tag];
  [writeFh writeData:rest];
  if (id3v1) [writeFh writeData:id3v1];
  [writeFh closeFile];

  NSString *backupPath = [filePath stringByAppendingString:@".lxmetadata.bak"];
  NSError *err = nil;
  [[NSFileManager defaultManager] removeItemAtPath:backupPath error:nil];
  if (![[NSFileManager defaultManager] moveItemAtPath:filePath toPath:backupPath error:&err]) {
    [[NSFileManager defaultManager] removeItemAtPath:tempPath error:nil];
    if (error) *error = err;
    return NO;
  }
  if (![[NSFileManager defaultManager] moveItemAtPath:tempPath toPath:filePath error:&err]) {
    [[NSFileManager defaultManager] moveItemAtPath:backupPath toPath:filePath error:nil];
    [[NSFileManager defaultManager] removeItemAtPath:tempPath error:nil];
    if (error) *error = err;
    return NO;
  }
  [[NSFileManager defaultManager] removeItemAtPath:backupPath error:nil];
  return YES;
}

#pragma mark - Sidecar fallback for unsupported formats

static BOOL LXWriteSidecarMetadata(NSString *filePath, NSDictionary *metadata, NSString *picPath, NSString *lyric, NSError **error) {
  BOOL ok = YES;
  if (metadata[@"name"] || metadata[@"singer"] || metadata[@"albumName"]) {
    NSMutableDictionary *sidecar = [LXReadJSONFile(LXMediaMetadataSidecarPath(filePath)) mutableCopy] ?: [NSMutableDictionary dictionary];
    for (NSString *key in @[@"name", @"singer", @"albumName"]) {
      NSString *value = [metadata[key] isKindOfClass:[NSString class]] ? metadata[key] : @"";
      sidecar[key] = value;
    }
    ok = LXWriteJSONFile(LXMediaMetadataSidecarPath(filePath), sidecar, error);
    if (!ok) return NO;
  }
  if (picPath.length) {
    NSString *ext = picPath.pathExtension.lowercaseString.length ? picPath.pathExtension.lowercaseString : @"jpg";
    NSString *targetPath = [NSString stringWithFormat:@"%@.%@", LXMediaCoverSidecarPrefix(filePath), ext];
    LXRemoveCoverSidecars(filePath);
    NSError *err = nil;
    ok = [[NSFileManager defaultManager] copyItemAtPath:picPath toPath:targetPath error:&err];
    if (!ok) { if (error) *error = err; return NO; }
  }
  if (lyric.length) {
    NSString *lrcPath = LXMediaLyricSidecarPath(filePath);
    ok = [lyric writeToFile:lrcPath atomically:YES encoding:NSUTF8StringEncoding error:error];
    if (!ok) return NO;
  }
  return YES;
}

#pragma mark - Dispatcher

static BOOL LXWriteEmbeddedMetadata(NSString *filePath, NSDictionary *metadata, NSString *picPath, NSString *lyric, NSError **error) {
  NSString *ext = filePath.pathExtension.lowercaseString;
#if LX_HAS_LIBFLAC
  if ([ext isEqualToString:@"flac"]) {
    return LXWriteFLACMetadata(filePath, metadata, picPath, lyric, error);
  }
#endif
  if ([ext isEqualToString:@"mp3"]) {
    return LXWriteMP3Metadata(filePath, metadata, picPath, lyric, error);
  }
  return LXWriteSidecarMetadata(filePath, metadata, picPath, lyric, error);
}

static void LXWriteEmbeddedMetadataAsync(NSString *filePath, NSDictionary *metadata, NSString *picPath, NSString *lyric, NSString *errorCode, RCTPromiseResolveBlock resolve, RCTPromiseRejectBlock reject) {
  dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
    NSError *error = nil;
    if (LXWriteEmbeddedMetadata(filePath, metadata, picPath, lyric, &error)) {
      resolve(nil);
    } else {
      reject(errorCode, error.localizedDescription ?: @"Failed to write metadata", error);
    }
  });
}
