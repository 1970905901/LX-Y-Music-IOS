/**
 * QQ Music API comm config factory.
 * Returns a fresh comm object for each request.
 */
export const getComm = (overrides = {}) => ({
  ct: '11',
  cv: '14090508',
  v: '14090508',
  tmeAppID: 'qqmusic',
  phonetype: 'EBG-AN10',
  deviceScore: '553.47',
  devicelevel: '50',
  newdevicelevel: '20',
  rom: 'HuaWei/EMOTION/EmotionUI_14.2.0',
  os_ver: '12',
  OpenUDID: '0',
  OpenUDID2: '0',
  QIMEI36: '0',
  udid: '0',
  chid: '0',
  aid: '0',
  oaid: '0',
  taid: '0',
  tid: '0',
  wid: '0',
  uid: '0',
  sid: '0',
  modeSwitch: '6',
  teenMode: '0',
  ui_mode: '2',
  nettype: '1020',
  v4ip: '',
  ...overrides,
})

/**
 * Parse QQ Music song file info into quality types array.
 * @param {Object} file - songInfo.file
 * @returns {{ types: Array, _qualitys: Object }}
 */
export const parseTxQualityTypes = (file) => {
  if (!file) return { types: [], _qualitys: {} }
  const types = []
  const _qualitys = {}
  if (file.size_128mp3 != 0) {
    types.push({ type: '128k', size: file.size_128mp3 })
    _qualitys['128k'] = { size: file.size_128mp3 }
  }
  if (file.size_320mp3 !== 0) {
    types.push({ type: '320k', size: file.size_320mp3 })
    _qualitys['320k'] = { size: file.size_320mp3 }
  }
  if (file.size_flac !== 0) {
    types.push({ type: 'flac', size: file.size_flac })
    _qualitys.flac = { size: file.size_flac }
  }
  if (file.size_hires !== 0) {
    types.push({ type: 'hires', size: file.size_hires })
    _qualitys.hires = { size: file.size_hires }
  }
  if (file.size_new?.[1] !== 0) {
    types.push({ type: 'atmos', size: file.size_new?.[1] })
    _qualitys.atmos = { size: file.size_new?.[1] }
  }
  if (file.size_new?.[2] !== 0) {
    types.push({ type: 'atmos_plus', size: file.size_new?.[2] })
    _qualitys.atmos_plus = { size: file.size_new?.[2] }
  }
  if (file.size_new?.[0] !== 0) {
    types.push({ type: 'master', size: file.size_new?.[0] })
    _qualitys.master = { size: file.size_new?.[0] }
  }
  return { types, _qualitys }
}
