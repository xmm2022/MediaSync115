import api from './client';
import type { PansouConfig } from './types';

export const pansouApi = {
  health: () => api.get('/pansou/health'),

  search: (keyword: string, cloudTypes: string[] = ['115'], res = 'results', refresh = false) =>
    api.post('/pansou/search', { keyword, cloud_types: cloudTypes, res, refresh }),

  getConfig: () => api.get<PansouConfig>('/pansou/config'),

  updateConfig: (baseUrl: string) => api.put('/pansou/config', { base_url: baseUrl }),
};
