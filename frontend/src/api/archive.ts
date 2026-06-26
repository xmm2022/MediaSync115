import api from './client';
import { extractItems, withResponseData } from './response';
import type { ArchiveConfig, ArchiveFolder, ArchiveTask } from './types';

export const archiveApi = {
  getSubdirOptions: () => api.get('/archive/subdir-options'),

  getNamingOptions: () => api.get('/archive/naming-options'),

  getConfig: () => api.get<ArchiveConfig>('/archive/config'),

  updateConfig: (payload: Partial<ArchiveConfig>) => api.put('/archive/config', payload),

  listFolders: async (cid = '0') => {
    const response = await api.get('/archive/folders', { params: { cid } });
    return withResponseData(response, extractItems<ArchiveFolder>(response.data, ['folders', 'items']));
  },

  listTasks: async (params?: Record<string, unknown>) => {
    const response = await api.get('/archive/tasks', { params });
    return withResponseData(response, extractItems<ArchiveTask>(response.data));
  },

  runScan: () => api.post('/archive/scan', null, { timeout: 300000 }),

  retryTask: (taskId: string) => api.post(`/archive/tasks/${taskId}/retry`, null, { timeout: 300000 }),

  clearTasks: (includeFailed = false) => api.delete('/archive/tasks/clear', { params: { include_failed: includeFailed } }),
};
