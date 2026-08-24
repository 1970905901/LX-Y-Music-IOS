import settingState from '@/store/setting/state';
import { webDAVLog } from '@/core/webdavMusic/logger';

import { createClient, FileStat } from 'webdav';

let client: any = null;

function getClient() {
  if (client) return client;

  const settings = settingState.setting;
  const url = settings['sync.webdav.url'];
  const username = settings['sync.webdav.username'];
  const password = settings['sync.webdav.password'];

  if (!url || !username) {
    webDAVLog.warn('WebDAV 未配置: URL 或用户名为空');
    return null;
  }

  // createClient imported at top
  client = createClient(url, { username, password });
  return client;
}

/**
 * When WebDAV configuration changes, call this function to reset the client instance.
 */
export function resetClient() {
  client = null;
}

export async function testConnection(): Promise<boolean> {
  const cli = await getClient();
  if (!cli) throw new Error('WebDAV 未配置');
  await cli.getDirectoryContents('/');
  return true;
}

/**
 * Create directories step by step, compatible with servers that do not support recursive creation.
 * @param cli WebDAV client instance
 * @param dirPath directory path to create
 */
async function ensureDirectoryExists(cli: any, dirPath: string): Promise<void> {
  if (!dirPath || dirPath === '/') return;

  const segments = dirPath.split('/').filter(Boolean);
  let currentPath = '';

  for (const segment of segments) {
    currentPath += `/${segment}`;
    try {
      if (!(await cli.exists(currentPath))) {
        webDAVLog.info(`Directory ${currentPath} not found, creating it...`);
        await cli.createDirectory(currentPath);
      }
    } catch (error: any) {
      throw new Error(`创建目录 ${currentPath} 失败: ${error.message}`);
    }
  }
}

/**
 * Upload file, automatically create parent directories if they do not exist.
 * @param path full file path, e.g., /LX_Music/playlists.json
 * @param content file content
 */
export async function uploadFile(path: string, content: string): Promise<void> {
  const cli = await getClient();
  if (!cli) throw new Error('WebDAV 未配置');

  // 1. 提取目录路径
  const dirPath = path.substring(0, path.lastIndexOf('/'));

  // 2. 确保目录存在
  await ensureDirectoryExists(cli, dirPath);

  // 3. 上传文件
  webDAVLog.info(`All directories exist. Uploading file to ${path}...`);
  await cli.putFileContents(path, content, { overwrite: true });
}

/**
 * Download file, return null if file does not exist.
 * @param path full file path
 */
export async function downloadFile(path: string): Promise<string | null> {
  const cli = await getClient();
  if (!cli) throw new Error('WebDAV 未配置');
  try {
    webDAVLog.info(`Attempting to download file: ${path}`);
    return await cli.getFileContents(path, { format: "text" });
  } catch (error: any) {
    if (error.status === 404 || error.status === 409) {
      webDAVLog.info(`downloadFile: File not found on server: ${path}`);
      return null;
    }
    webDAVLog.error(`downloadFile: Unexpected error for "${path}":`, error);
    throw error;
  }
}

/**
 * Get file status, return null if file does not exist.
 * @param path full file path
 */
export async function getStat(path: string): Promise<any | null> {
  const cli = await getClient();
  if (!cli) throw new Error('WebDAV 未配置');
  try {
    return await cli.stat(path) as Promise<FileStat>;
  } catch (error: any) {
    if (error.status === 404 || error.status === 409) {
      webDAVLog.info(`getStat: File or path not found for "${path}", returning null.`);
      return null;
    }
    webDAVLog.error(`getStat: Unexpected error for "${path}":`, error);
    throw error;
  }
}
