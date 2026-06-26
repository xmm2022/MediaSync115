import api from './client';
import { extractItems, withResponseData } from './response';

const SAVE_OPERATION_TIMEOUT = 180000;

export const pan115Api = {
  // ---- Cookie 管理 ----
  checkCookie: () => api.get('/pan115/cookie/check'),

  updateCookie: (cookie: string) => api.post('/pan115/cookie/update', { cookie }),

  getCookieInfo: () => api.get('/pan115/cookie'),

  // ---- 扫码登录 ----
  listQrLoginApps: async () => {
    const response = await api.get('/pan115/login/qr/apps');
    return withResponseData(response, extractItems<Record<string, unknown>>(response.data));
  },

  startQrLogin: (app = 'alipaymini') => api.post('/pan115/login/qr/start', { app }),

  getQrImage: (token: string) =>
    api.get('/pan115/login/qr/image', { params: { token }, responseType: 'blob' }),

  checkQrLogin: (token: string) => api.post('/pan115/login/qr/status', { token }),

  cancelQrLogin: (token: string) => api.post('/pan115/login/qr/cancel', { token }),

  // ---- 用户信息 ----
  getUserInfo: () => api.get('/pan115/user'),

  getOfflineQuota: () => api.get('/pan115/offline/quota'),

  getRiskHealth: () => api.get('/pan115/health/risk'),

  // ---- 文件操作 ----
  getFileList: (cid = '0', offset = 0, limit = 50) =>
    api.get('/pan115/files', { params: { cid, offset, limit } }),

  createFolder: (pid: string, name: string) =>
    api.post('/pan115/folder', { pid, name }),

  renameFile: (fid: string, name: string) =>
    api.post('/pan115/rename', { fid, name }),

  deleteFile: (fid: string) =>
    api.delete('/pan115/files', { params: { fid } }),

  copyFile: (fid: string, pid: string) =>
    api.post('/pan115/copy', null, { params: { fid, pid } }),

  moveFile: (fid: string, pid: string) =>
    api.post('/pan115/move', null, { params: { fid, pid } }),

  getFileInfo: (fid: string) =>
    api.get(`/pan115/files/${fid}`),

  searchFile: (searchValue: string, cid = '0') =>
    api.get('/pan115/search', { params: { search_value: searchValue, cid } }),

  getDownloadUrl: (pickCode: string) =>
    api.get(`/pan115/download/${pickCode}`),

  // ---- 离线下载 ----
  addOfflineTask: (url: string, wpPathId = '', title = '') =>
    api.post('/pan115/offline/task', { url, wp_path_id: wpPathId, title }),

  getOfflineTasks: (page = 1, config = {}) =>
    api.get('/pan115/offline/tasks', { params: { page }, ...config }),

  deleteOfflineTasks: (hashList: string[]) => {
    const params = new URLSearchParams();
    hashList.filter(Boolean).forEach((hash) => params.append('hash_list', hash));
    return api.delete('/pan115/offline/tasks', { params });
  },

  restartOfflineTask: (infoHash: string) =>
    api.post('/pan115/offline/restart', null, { params: { info_hash: infoHash } }),

  clearOfflineTasks: (mode = 'completed') =>
    api.post('/pan115/offline/clear', null, { params: { mode } }),

  getOfflineDefaultFolder: () => api.get('/pan115/offline/default-folder'),

  setOfflineDefaultFolder: (folderId: string, folderName = '') =>
    api.post('/pan115/offline/default-folder', { folder_id: folderId, folder_name: folderName }),

  // ---- 分享链接操作 ----
  parseShareLink: (shareUrl: string) =>
    api.post('/pan115/share/parse', null, { params: { share_url: shareUrl } }),

  getShareFileList: (shareCode: string, receiveCode = '', cid = '0', offset = 0, limit = 50) =>
    api.get('/pan115/share/files', { params: { share_code: shareCode, receive_code: receiveCode, cid, offset, limit } }),

  saveShareFile: (shareCode: string, fileId: string, pid = '0', receiveCode = '') =>
    api.post('/pan115/share/save', { share_code: shareCode, file_id: fileId, pid, receive_code: receiveCode }),

  saveShareFiles: (shareCode: string, fileIds: string[], pid = '0', receiveCode = '') =>
    api.post('/pan115/share/save-batch', { share_code: shareCode, file_ids: fileIds, pid, receive_code: receiveCode }),

  saveShareAll: (shareCode: string, pid = '0', receiveCode = '') =>
    api.post('/pan115/share/save-all', null, { params: { share_code: shareCode, pid, receive_code: receiveCode } }),

  saveShareToFolder: (
    shareUrl: string,
    folderName: string,
    parentId = '0',
    receiveCode = '',
    tmdbId: string | null = null,
    requestConfig = {},
  ) =>
    api.post(
      '/pan115/share/save-to-folder',
      { share_url: shareUrl, folder_name: folderName, parent_id: parentId, receive_code: receiveCode, tmdb_id: tmdbId },
      { timeout: SAVE_OPERATION_TIMEOUT, ...requestConfig },
    ),

  extractShareFiles: (shareUrl: string, receiveCode = '') =>
    api.post('/pan115/share/extract-files', { share_url: shareUrl, receive_code: receiveCode }),

  saveShareFilesToFolder: (
    shareUrl: string,
    fileIds: string[],
    folderName: string,
    parentId = '0',
    receiveCode = '',
  ) =>
    api.post(
      '/pan115/share/save-files-to-folder',
      { share_url: shareUrl, file_ids: fileIds, folder_name: folderName, parent_id: parentId, receive_code: receiveCode },
      { timeout: SAVE_OPERATION_TIMEOUT },
    ),

  // ---- 默认转存文件夹 ----
  getDefaultFolder: () => api.get('/pan115/default-folder'),

  setDefaultFolder: (folderId: string, folderName = '') =>
    api.post('/pan115/default-folder', { folder_id: folderId, folder_name: folderName }),
};
