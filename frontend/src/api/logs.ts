import api from './client';
import type { PaginatedList, OperationLogItem } from './types';

export const logsApi = {
  list: (params?: Record<string, unknown>) =>
    api.get<PaginatedList<OperationLogItem>>('/logs', { params }),

  modules: () => api.get<Record<string, string[]>>('/logs/modules'),

  prune: (days = 30) => api.post('/logs/prune', null, { params: { days } }),

  clear: () => api.delete('/logs/clear'),
};
