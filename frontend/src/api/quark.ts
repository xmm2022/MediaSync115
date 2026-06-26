import api from './client';
import { extractItems, withResponseData } from './response';
import type { QuarkCookieInfo, QuarkFolderInfo } from './types';

const SAVE_OPERATION_TIMEOUT = 180000;

export const quarkApi = {
  getCookieInfo: () => api.get<QuarkCookieInfo>('/quark/cookie'),

  checkCookie: () => api.get('/quark/cookie/check'),

  updateCookie: (cookie: string) => api.post('/quark/cookie/update', { cookie }),

  checkConnectivity: () => api.get('/quark/connectivity/check'),

  listFolders: async (parentFid = '0', page = 1, size = 200) => {
    const response = await api.get('/quark/folders', { params: { parent_fid: parentFid, page, size } });
    const folders = extractItems<Record<string, unknown>>(response.data, ['folders', 'items']).map((folder) => ({
      ...folder,
      name: String(folder.name || folder.file_name || folder.fid || ''),
    })) as QuarkFolderInfo[];
    return withResponseData(response, folders);
  },

  getDefaultFolder: () => api.get('/quark/default-folder'),

  setDefaultFolder: (folderId: string, folderName = '') =>
    api.post('/quark/default-folder', { folder_id: folderId, folder_name: folderName }),

  saveShareToFolder: (payload: {
    share_url: string;
    folder_name?: string;
    target_folder_id?: string;
    receive_code?: string;
    tmdb_id?: string;
  }) => api.post('/quark/share/save-to-folder', payload, { timeout: SAVE_OPERATION_TIMEOUT }),
};
