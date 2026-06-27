import api from './client';
import type { TwilightConfig, TwilightHealth } from './types';

export const twilightApi = {
  getConfig: () => api.get<TwilightConfig>('/twilight/config'),

  health: () => api.get<TwilightHealth>('/twilight/health'),
};
