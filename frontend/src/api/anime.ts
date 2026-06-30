import api from './client';
import type {
  AniRssConfig,
  AniRssDownloadClientApplyResponse,
  AniRssDownloadClientStatus,
  AniRssSubscriptionDeleteResponse,
  AniRssSubscriptionListResponse,
  AniRssSubscriptionCreatePayload,
  AniRssSubscriptionPreviewResponse,
  AniRssSubscriptionResponse,
  AniRssRssCandidatesResponse,
  BangumiSearchResponse,
  BangumiSubject,
  MikanRssCandidatesResponse,
} from './types';

export const animeApi = {
  searchBangumi: (keyword: string, limit = 12, offset = 0) =>
    api.get<BangumiSearchResponse>('/anime/bangumi/search', { params: { keyword, limit, offset } }),

  getBangumiSubject: (subjectId: number | string) =>
    api.get<BangumiSubject>(`/anime/bangumi/subjects/${encodeURIComponent(String(subjectId))}`),

  getMikanRssCandidates: (keyword: string, bangumiId?: string | number, limit = 24, airDate?: string) =>
    api.get<MikanRssCandidatesResponse>('/anime/mikan/rss-candidates', {
      params: { keyword, bangumi_id: bangumiId, limit, air_date: airDate },
      timeout: 60000,
    }),

  getAniRssRssCandidates: (keyword: string, bangumiId?: string | number, limit = 48, airDate?: string) =>
    api.get<AniRssRssCandidatesResponse>('/anime/anirss/rss-candidates', {
      params: { keyword, bangumi_id: bangumiId, limit, air_date: airDate },
      timeout: 60000,
    }),

  getAniRssConfig: () => api.get<AniRssConfig>('/anime/anirss/config'),

  checkAniRssHealth: () => api.get('/anime/anirss/health'),

  getAniRssDownloadClientStatus: () =>
    api.get<AniRssDownloadClientStatus>('/anime/anirss/download-client/status', { timeout: 30000 }),

  applyAniRssDownloadClientDefaults: () =>
    api.post<AniRssDownloadClientApplyResponse>('/anime/anirss/download-client/apply-defaults', null, { timeout: 30000 }),

  listAniRssSubscriptions: (options?: { includePreview?: boolean; previewLimit?: number; syncLocal?: boolean }) =>
    api.get<AniRssSubscriptionListResponse>('/anime/anirss/subscriptions', {
      params: {
        include_preview: options?.includePreview ?? true,
        preview_limit: options?.previewLimit ?? 5,
        sync_local: options?.syncLocal ?? true,
      },
      timeout: 120000,
    }),

  syncAniRssSubscriptions: (options?: { includePreview?: boolean; previewLimit?: number; syncLocal?: boolean }) =>
    api.post<AniRssSubscriptionListResponse>('/anime/anirss/subscriptions/sync', null, {
      params: {
        include_preview: options?.includePreview ?? true,
        preview_limit: options?.previewLimit ?? 5,
        sync_local: options?.syncLocal ?? true,
      },
      timeout: 120000,
    }),

  previewAniRssSubscription: (payload: AniRssSubscriptionCreatePayload) =>
    api.post('/anime/anirss/preview', payload, { timeout: 120000 }),

  createAniRssSubscription: (payload: AniRssSubscriptionCreatePayload) =>
    api.post<AniRssSubscriptionResponse>('/anime/anirss/subscriptions', payload, { timeout: 120000 }),

  refreshAniRssSubscription: (externalSubscriptionId: string | number) =>
    api.post(`/anime/anirss/subscriptions/${encodeURIComponent(String(externalSubscriptionId))}/refresh`),

  previewExistingAniRssSubscription: (externalSubscriptionId: string | number, previewLimit = 5) =>
    api.post<AniRssSubscriptionPreviewResponse>(
      `/anime/anirss/subscriptions/${encodeURIComponent(String(externalSubscriptionId))}/preview`,
      null,
      { params: { preview_limit: previewLimit }, timeout: 120000 },
    ),

  deleteAniRssSubscription: (externalSubscriptionId: string | number) =>
    api.delete<AniRssSubscriptionDeleteResponse>(
      `/anime/anirss/subscriptions/${encodeURIComponent(String(externalSubscriptionId))}`,
      { timeout: 120000 },
    ),

  setAniRssSubscriptionEnabled: (externalSubscriptionId: string | number, enable: boolean) =>
    api.post(`/anime/anirss/subscriptions/${encodeURIComponent(String(externalSubscriptionId))}/enabled`, { enable }),
};
