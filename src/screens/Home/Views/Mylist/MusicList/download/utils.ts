export function getFileExtension(quality: LX.Quality) {
  switch (quality) {
    case '128k':
    case '320k':
      return 'mp3'
    default:
      return 'flac'
  }
}

export function getFileExtensionFromUrl(url: string) {
  const match = url.match(/\.([0-9a-z]+)(?=[?#]|$)/i)
  if (match) {
    const ext = match[1].toLowerCase();
    const audioExts = ['mp3', 'm4a', 'flac', 'wav', 'ogg', 'aac', 'wma', 'm4b', 'mp4', 'm4s'];
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'];
    
    if (audioExts.includes(ext)) {
      if (ext === 'm4s') return 'mp3';
      return ext;
    }
    if (imageExts.includes(ext)) return ext;
    return ext;
  }
  if (url.includes('bilibili') || url.includes('bilivideo')) {
    return 'mp3';
  }
  return 'mp3';
}
