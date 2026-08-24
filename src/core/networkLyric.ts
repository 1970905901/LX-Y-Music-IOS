import dgram from 'react-native-udp';
import { Buffer } from 'buffer';
import playerState from '@/store/player/state';
import { onLyricLinePlay, setSendLyricTextEvent } from '@/utils/nativeModules/lyricDesktop';
import { adjustSystemMediaVolume } from '@/utils/nativeModules/utils';
import { playNext, playPrev, togglePlay } from '@/core/player/player';

const BROADCAST_PORT = 41234;
const COMMAND_PORT = 41235;
const COMMAND_NEXT = 'next';
const COMMAND_PREV = 'prev';
const COMMAND_TOGGLE = 'toggle';
const COMMAND_VOLUME_UP = 'volume_up';
const COMMAND_VOLUME_DOWN = 'volume_down';

let targetIp: string | null = null;
let ipClearTimeout: NodeJS.Timeout | null = null;

let lyricSocket: dgram.Socket | null = null;
let commandSocket: dgram.Socket | null = null;

let isLyricListenerActive = false;
let unsubscribeLyricListener: (() => void) | null = null;

const adjustMediaVolume = (direction: 'up' | 'down') => {
  void adjustSystemMediaVolume(direction).catch(() => {});
};

const startLyricSocket = () => {
  if (lyricSocket) return;
  try {
    lyricSocket = dgram.createSocket('udp4');
    lyricSocket.on('message', (msg, rinfo) => {
      if (msg.toString() === 'LX_LYRIC_CLIENT_HERE') {
        targetIp = rinfo.address;
        if (ipClearTimeout) clearTimeout(ipClearTimeout);
        ipClearTimeout = setTimeout(() => { targetIp = null; }, 90 * 1000);
      }
    });

    lyricSocket.bind(BROADCAST_PORT, () => {
      try { lyricSocket?.setBroadcast(true); } catch {}
    });

    lyricSocket.on('error', () => { destroyLyricSocket(); });

    lyricSocket.bind(BROADCAST_PORT, () => {
      try {
        lyricSocket?.setBroadcast(true);
        console.log('>>>>> [网络歌词] UDP 歌词广播 Socket 初始化并监听成功');
      } catch (err) {
        console.error('>>>>> [网络歌词] 设置广播模式失败, 可能是不支持或被占用:', err);
      }
    });

    lyricSocket.on('error', (err) => {
      console.error('>>>>> [网络歌词] UDP 歌词广播 Socket 错误:', err);
      destroyLyricSocket();
    });
  } catch {}
};

const startCommandListener = () => {
  if (commandSocket) return;
  try {
    commandSocket = dgram.createSocket('udp4');
    commandSocket.on('message', (msg) => {
      switch (msg.toString()) {
        case COMMAND_NEXT:
          void playNext();
          break;
        case COMMAND_PREV:
          void playPrev();
          break;
        case COMMAND_TOGGLE:
          togglePlay();
          break;
        case COMMAND_VOLUME_UP:
          adjustMediaVolume('up');
          break;
        case COMMAND_VOLUME_DOWN:
          adjustMediaVolume('down');
          break;
      }
    });

    commandSocket.bind(COMMAND_PORT, () => {});

    commandSocket.on('error', () => { stopCommandListener(); });
  } catch {}
};

const sendUdpPacket = (lineInfo: { text: string; extendedLyrics: string[] }) => {
  if (!targetIp || !lyricSocket) return;

  const payload = {
    lyric: lineInfo.text,
    tlyric: lineInfo.extendedLyrics?.[0] || '',
    name: playerState.musicInfo.name,
    singer: playerState.musicInfo.singer,
    is_playing: playerState.isPlay,
  };

  const message = Buffer.from(JSON.stringify(payload));
  lyricSocket.send(message, 0, message.length, BROADCAST_PORT, targetIp, () => {});
};

const destroyLyricSocket = () => {
  if (!lyricSocket) return;
  try { lyricSocket.close(); } catch (error) {}
  lyricSocket = null;
};

const stopCommandListener = () => {
  if (!commandSocket) return;
  try { commandSocket.close(); } catch (error) {}
  commandSocket = null;
};

const startLyricListener = () => {
  if (isLyricListenerActive) return;
  setSendLyricTextEvent(true);
  unsubscribeLyricListener = onLyricLinePlay((lineInfo) => {
    if (targetIp) sendUdpPacket(lineInfo);
  });
  isLyricListenerActive = true;
};

export const init = () => {
  startLyricSocket();
  startCommandListener();
  startLyricListener();
};
