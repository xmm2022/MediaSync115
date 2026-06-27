import api from './client';
import type {
  MoviePilotConfig,
  MoviePilotHealth,
  MoviePilotSyncResponse,
  MoviePilotSubscriptionCreatePayload,
  MoviePilotSubscriptionResponse,
} from './types';

export const moviepilotApi = {
  getConfig: () => api.get<MoviePilotConfig>('/moviepilot/config'),

  health: () => api.get<MoviePilotHealth>('/moviepilot/health'),

  search: (keyword: string) => api.post<{ items: unknown[] }>('/moviepilot/search', { keyword }),

  createSubscription: (payload: MoviePilotSubscriptionCreatePayload) =>
    api.post<MoviePilotSubscriptionResponse>('/moviepilot/subscriptions', payload),

  syncSubscriptions: () => api.post<MoviePilotSyncResponse>('/moviepilot/subscriptions/sync'),

  searchSubscription: (externalSubscriptionId: string | number) =>
    api.post<{ result: unknown }>(
      `/moviepilot/subscriptions/${encodeURIComponent(String(externalSubscriptionId))}/search`,
    ),
};
