import {
  getUserPlaylists as kgGetUserPlaylists,
  addSongToPlaylist as kgAddSongToPlaylist,
  removeSongsFromPlaylist as kgRemoveSongsFromPlaylist,
  subscribePlaylist as kgSubscribePlaylist,
  unsubscribePlaylist as kgUnsubscribePlaylist,
  getPlaylistSongs as kgGetPlaylistSongs,
  sendCaptcha as kgSendCaptcha,
  loginByPhone as kgLoginByPhone,
  refreshToken as kgRefreshToken,
  getVerifyInfo as kgGetVerifyInfo,
  verifyUserInfo as kgVerifyUserInfo,
  buildCookieString as kgBuildCookieString,
} from './utils/api'

export default {
  /**
   * Get user playlist list
   * @param {string} cookie - KuGou Cookie string
   * @returns {Promise<{createdList: Array, collectedList: Array, total: number}>}
   */
  async getUserPlaylists(cookie) {
    const result = await kgGetUserPlaylists(cookie)
    if (!result.success) throw new Error(result.message || 'Failed to get playlists')
    return {
      createdList: result.data?.createdList || [],
      collectedList: result.data?.collectedList || [],
      total: result.data?.total || 0,
    }
  },

  /**
   * Add song to playlist
   * @param {string} cookie - KuGou Cookie string
   * @param {string|number} listId - Playlist ID
   * @param {object} songInfo - Song info { name, hash, album_id?, mixsongid? }
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async addSongToPlaylist(cookie, listId, songInfo) {
    const result = await kgAddSongToPlaylist(cookie, Number(listId), songInfo)
    if (!result.success) throw new Error(result.message || 'Failed to add song')
    return result
  },

  /**
   * Remove songs from playlist
   * @param {string} cookie - KuGou Cookie string
   * @param {string|number} listId - Playlist ID
   * @param {Array<number>} fileIds - Array of song fileids to remove
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async removeSongsFromPlaylist(cookie, listId, fileIds) {
    const result = await kgRemoveSongsFromPlaylist(cookie, Number(listId), fileIds.map(id => Number(id)))
    if (!result.success) throw new Error(result.message || 'Failed to remove songs')
    return result
  },

  /**
   * Subscribe/Unsubscribe playlist or Create playlist
   * @param {string} cookie - KuGou Cookie string
   * @param {object} playlistInfo - Playlist info
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async subscribePlaylist(cookie, playlistInfo) {
    const result = await kgSubscribePlaylist(cookie, playlistInfo)
    if (!result.success) throw new Error(result.message || 'Failed to subscribe playlist')
    return result
  },

  /**
   * Unsubscribe/Delete playlist
   * @param {string} cookie - KuGou Cookie string
   * @param {string|number} listId - Playlist ID
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async unsubscribePlaylist(cookie, listId) {
    const result = await kgUnsubscribePlaylist(cookie, Number(listId))
    if (!result.success) throw new Error(result.message || 'Failed to unsubscribe playlist')
    return result
  },

  /**
   * Get playlist songs
   * @param {string} cookie - KuGou Cookie string
   * @param {string} globalCollectionId - Global playlist ID
   * @param {number} [page=1] - Page number
   * @param {number} [pagesize=100] - Items per page
   * @returns {Promise<{list: Array, total: number}>}
   */
  async getPlaylistSongs(cookie, globalCollectionId, page = 1, pagesize = 100) {
    const result = await kgGetPlaylistSongs(cookie, globalCollectionId, page, pagesize)
    if (!result.success) throw new Error(result.message || 'Failed to get playlist songs')
    return {
      list: result.data?.list || [],
      total: result.data?.total || 0,
    }
  },

  /**
   * Send verification code
   * @param {string} mobile - Phone number
   * @returns {Promise<{success: boolean, message: string, ssaCode?: string}>}
   */
  async sendCaptcha(mobile) {
    return kgSendCaptcha(mobile)
  },

  /**
   * Phone number login
   * @param {string} mobile - Phone number
   * @param {string} code - Verification code
   * @param {string} [userid] - User ID, required when phone is bound to multiple accounts
   * @returns {Promise<{success: boolean, data?: object, message: string}>}
   */
  async loginByPhone(mobile, code, userid) {
    return kgLoginByPhone(mobile, code, undefined, userid)
  },

  /**
   * Refresh Token
   * @param {string} token - Current token
   * @param {string} userid - User ID
   * @returns {Promise<{success: boolean, data?: object, message: string}>}
   */
  async refreshToken(token, userid) {
    return kgRefreshToken(token, userid)
  },

  /**
   * Get verification info
   * @param {string} eventid - Event ID
   * @returns {Promise<{success: boolean, data?: object, message: string}>}
   */
  async getVerifyInfo(eventid) {
    return kgGetVerifyInfo(eventid)
  },

  /**
   * Submit verification result
   * @param {string} eventid - Event ID
   * @param {number} vType - Verification type
   * @param {string} verifycode - Verification code
   * @param {string} sid - sid
   * @param {string} edt - edt
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async verifyUserInfo(eventid, vType, verifycode, sid, edt) {
    return kgVerifyUserInfo(eventid, vType, verifycode, sid, edt)
  },

  /**
   * Build Cookie string
   * @param {object} data - { userid, token, t1, dfid, mid }
   * @returns {string}
   */
  buildCookieString(data) {
    return kgBuildCookieString(data)
  },
}
