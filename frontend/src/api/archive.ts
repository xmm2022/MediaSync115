import api from './client';
import type { ArchiveConfig, ArchiveFolder, ArchiveTask } from './types';

export const archiveApi = {
  getSubdirOptions: () => api.get('/archive/subdir-options'),

  getNamingOptions: () => api.get('/archive/naming-options'),

  getConfig: () => api.get<ArchiveConfig>('/archive/config'),

  updateConfig: (payload: Partial<ArchiveConfig>) => api.put('/archive/config', payload),

  listFolders: (cid = '0') => api.get<ArchiveFolder[]>('/archive/folders', { params: { cid } }),

  listTasks: (params?: Record<string, unknown>) => api.get<ArchiveTask[]>('/archive/tasks', { params }),

  runScan: () => api.post('/archive/scan', null, { timeout: 300000 }),

  retryTask: (taskId: string) => api.post(`/archive/tasks/${taskId}/retry`, null, { timeout: 300000 }),

  clearTasks: (includeFailed = false) => api.delete('/archive/tasks/clear', { params: { include_failed: includeFailed } }),
};
