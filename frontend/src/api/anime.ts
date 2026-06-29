import api from './client';
import type {
  AniRssConfig,
  AniRssSubscriptionCreatePayload,
  AniRssSubscriptionResponse,
  BangumiSearchResponse,
  BangumiSubject,
  MikanRssCandidatesResponse,
} from './types';

export const animeApi = {
  searchBangumi: (keyword: string, limit = 12, offset = 0) =>
    api.get<BangumiSearchResponse>('/anime/bangumi/search', { params: { keyword, limit, offset } }),

  getBangumiSubject: (subjectId: number | string) =>
    api.get<BangumiSubject>(`/anime/bangumi/subjects/${encodeURIComponent(String(subjectId))}`),

  getMikanRssCandidates: (keyword: string, bangumiId?: string | number, limit = 24) =>
    api.get<MikanRssCandidatesResponse>('/anime/mikan/rss-candidates', {
      params: { keyword, bangumi_id: bangumiId, limit },
      timeout: 60000,
    }),

  getAniRssConfig: () => api.get<AniRssConfig>('/anime/anirss/config'),

  checkAniRssHealth: () => api.get('/anime/anirss/health'),

  listAniRssSubscriptions: () => api.get('/anime/anirss/subscriptions'),

  previewAniRssSubscription: (payload: AniRssSubscriptionCreatePayload) =>
    api.post('/anime/anirss/preview', payload, { timeout: 120000 }),

  createAniRssSubscription: (payload: AniRssSubscriptionCreatePayload) =>
    api.post<AniRssSubscriptionResponse>('/anime/anirss/subscriptions', payload, { timeout: 120000 }),

  refreshAniRssSubscription: (externalSubscriptionId: string | number) =>
    api.post(`/anime/anirss/subscriptions/${encodeURIComponent(String(externalSubscriptionId))}/refresh`),

  setAniRssSubscriptionEnabled: (externalSubscriptionId: string | number, enable: boolean) =>
    api.post(`/anime/anirss/subscriptions/${encodeURIComponent(String(externalSubscriptionId))}/enabled`, { enable }),
};
