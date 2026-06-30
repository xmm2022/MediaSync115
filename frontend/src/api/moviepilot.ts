import api from './client';
import type {
  MoviePilotConfig,
  MoviePilotCompletionPreview,
  MoviePilotDownloadPayload,
  MoviePilotDownloadResponse,
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

  pushDownload: (payload: MoviePilotDownloadPayload) =>
    api.post<MoviePilotDownloadResponse>('/moviepilot/downloads', payload, { timeout: 120000 }),

  syncSubscriptions: () => api.post<MoviePilotSyncResponse>('/moviepilot/subscriptions/sync'),

  searchSubscription: (externalSubscriptionId: string | number) =>
    api.post<{ result: unknown }>(
      `/moviepilot/subscriptions/${encodeURIComponent(String(externalSubscriptionId))}/search`,
    ),

  previewMissingCompletion: (subscriptionId: string | number, params?: Record<string, unknown>) =>
    api.get<MoviePilotCompletionPreview>(
      `/moviepilot/subscriptions/${encodeURIComponent(String(subscriptionId))}/missing-completion/preview`,
      { params },
    ),

  runMissingCompletion: (
    subscriptionId: string | number,
    payload: { refresh?: boolean; dry_run?: boolean; force?: boolean } = {},
  ) =>
    api.post<MoviePilotCompletionPreview>(
      `/moviepilot/subscriptions/${encodeURIComponent(String(subscriptionId))}/missing-completion/run`,
      payload,
      { timeout: 120000 },
    ),
};
