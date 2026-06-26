import api from './client';
import type { StrmConfig } from './types';

export const strmApi = {
  getConfig: () => api.get<StrmConfig>('/strm/config'),

  updateConfig: (payload: Partial<StrmConfig>) => api.put('/strm/config', payload),

  generate: () => api.post('/strm/generate', null, { timeout: 300000 }),

  diagnose: () => api.get('/strm/diagnose', { timeout: 30000 }),
};
