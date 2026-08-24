import { getListMusics } from '@/core/list';
import listState from '@/store/list/state';
import settingState from '@/store/setting/state';
import { LIST_IDS } from '@/config/constant';
import {getPlayHistory, getUserApiList, getUserApiScript} from "@/utils/data.ts";
import { normalizeDownloadTasksForSync } from '@/utils/data/download';
import downloadState from '@/store/download/state';

const SENSITIVE_SETTING_KEYS: Array<keyof LX.AppSetting> = [
  'common.wy_cookie',
  'common.wy_serpapi_key',
  'common.yt_cookie',
  'sync.webdav.password',
];

export const filterSensitiveSettingsForSync = (settings: Partial<LX.AppSetting>) => {
  const nextSettings = { ...settings };
  for (const key of SENSITIVE_SETTING_KEYS) {
    delete nextSettings[key];
  }
  return nextSettings;
};

export const getAllDataForSync = async () => {
  const defaultList = await getListMusics(listState.defaultList.id);
  const loveList = await getListMusics(listState.loveList.id);
  const tempList = await getListMusics(LIST_IDS.TEMP);
  const userList = [];
  for await (const list of listState.userList) {
    userList.push({ ...list, list: await getListMusics(list.id) });
  }
  const lists = { defaultList, loveList, userList, tempList };
  const playHistory = await getPlayHistory();
  const downloadTasks = normalizeDownloadTasksForSync(downloadState.tasks);
  const settings = filterSensitiveSettingsForSync(settingState.setting);

  const userApiList = await getUserApiList();
  const userApiScripts: Record<string, string> = {};
  for (const api of userApiList) {
    userApiScripts[api.id] = await getUserApiScript(api.id);
  }
  const userApis = {
    list: userApiList,
    scripts: userApiScripts,
  };

  return { lists, playHistory, downloadTasks, settings, userApis };
};
