export type Translate = (key: string, values?: Record<string, string | number | boolean>) => string

export const getQualityName = (quality: LX.Quality, t: Translate) => {
  switch (quality) {
    case '128k':
      return '128K'
    case '192k':
      return '192K'
    case '320k':
      return '320K'
    case 'flac':
      return t('quality_lossless')
    case 'flac24bit':
      return t('quality_lossless_24bit')
    case 'hires':
      return t('quality_hires')
    case 'atmos':
      return t('quality_lossless_atmos')
    case 'atmos_plus':
      return t('quality_lossless_atmos_plus')
    case 'master':
      return t('quality_lossless_master')
    default:
      return quality.toUpperCase()
  }
}
