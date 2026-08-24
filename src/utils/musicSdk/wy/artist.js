// src/utils/musicSdk/wy/artist.js

import { httpFetch } from '../../request'
import { weapi } from './utils/crypto'
import musicDetailApi from './musicDetail'
import settingState from '@/store/setting/state'

const artistApi = {
  /**
   * 获取歌手详情
   * @param {string} id 歌手ID
   */
  async getDetail(id, retryNum = 0) {
    if (retryNum > 2) return Promise.reject(new Error('获取歌手详情失败'));
    const requestObj = httpFetch('https://music.163.com/weapi/artist/head/info/get', {
      method: 'post',
      form: weapi({ id }),
    });
    try {
      const { body } = await requestObj.promise;
      if (body.code !== 200) throw new Error('获取歌手详情失败');
      return body.data;
    } catch (error) {
      return artistApi.getDetail(id, retryNum + 1);
    }
  },

  async getSongs(id, order = 'hot', limit = 100, offset = 0, retryNum = 0) {
    if (retryNum > 2) return Promise.reject(new Error('获取歌手歌曲失败'));
    const requestObj = httpFetch('https://music.163.com/weapi/v1/artist/songs', {
      method: 'post',
      form: weapi({
        id,
        private_cloud: 'true',
        work_type: 1,
        order,
        offset,
        limit,
      }),
    });
    try {
      const { body } = await requestObj.promise;
      if (body.code !== 200) throw new Error('获取歌手歌曲失败');
      const list = await musicDetailApi.filterList({ songs: body.songs, privileges: [] });
      return {
        list,
        total: body.total,
        hasMore: body.more,
      };
    } catch (error) {
      return artistApi.getSongs(id, order, limit, offset, retryNum + 1);
    }
  },

  async getAlbums(id, limit = 100, offset = 0, retryNum = 0) {
    if (retryNum > 2) return Promise.reject(new Error('获取歌手专辑失败'));
    const requestObj = httpFetch('https://music.163.com/weapi/artist/albums/' + id, {
      method: 'post',
      form: weapi({
        limit,
        offset,
        total: true,
      }),
    });
    try {
      const { body } = await requestObj.promise;
      if (body.code !== 200) throw new Error('获取歌手专辑失败');
      return {
        hotAlbums: body.hotAlbums,
        hasMore: body.more,
      };
    } catch (error) {
      return artistApi.getAlbums(id, limit, offset, retryNum + 1);
    }
  },

  async getSimilar(id, retryNum = 0) {
    if (retryNum > 2) return Promise.reject(new Error('获取相似歌手失败'));

    const cookie = settingState.setting['common.wy_cookie']
    if (!cookie) return Promise.reject(new Error('请先设置网易云 Cookie'))

    const requestObj = httpFetch('https://music.163.com/weapi/discovery/simiArtist', {
      method: 'post',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        origin: 'https://music.163.com',
        Referer: `https://music.163.com/artist?id=${id}`,
        cookie,
      },
      form: weapi({
        artistid: id,
      }),
    });

    try {
      const { body } = await requestObj.promise;
      if (body.code === 301) return Promise.reject(new Error('请先设置有效网易云 Cookie'));
      if (body.code !== 200) throw new Error(body.message || '获取相似歌手失败');
      const artists = body.artists || [];
      return Promise.all(artists.map(async artist => {
        if (artist.briefDesc) return artist

        try {
          const detail = await artistApi.getDetail(artist.id)
          const detailArtist = detail.artist || {}
          return {
            ...detailArtist,
            ...artist,
            alias: artist.alias || detailArtist.alias || [],
            briefDesc: artist.briefDesc || detailArtist.briefDesc || '',
            avatar: artist.avatar || artist.picUrl || artist.img1v1Url || detailArtist.avatar || detailArtist.picUrl || detailArtist.img1v1Url || detailArtist.cover,
            cover: artist.cover || artist.picUrl || detailArtist.cover || detailArtist.picUrl,
          }
        } catch {
          return {
            ...artist,
            alias: artist.alias || [],
            briefDesc: artist.briefDesc || '',
            avatar: artist.avatar || artist.picUrl || artist.img1v1Url,
            cover: artist.cover || artist.picUrl,
          }
        }
      }));
    } catch (error) {
      return artistApi.getSimilar(id, retryNum + 1);
    }
  },

}

export const getDetail = (...args) => artistApi.getDetail(...args)
export const getSongs = (...args) => artistApi.getSongs(...args)
export const getAlbums = (...args) => artistApi.getAlbums(...args)
export const getSimilar = (...args) => artistApi.getSimilar(...args)

export default artistApi
