import api from './client';
import type { AxiosResponse } from 'axios';
import type {
  ExploreMeta,
  ExploreSection,
  EmbyStatusMapRequest,
  EmbyStatusMapResponse,
  FeiniuStatusMapRequest,
  FeiniuStatusMapResponse,
  ExploreResolvePayload,
  ExploreQueueSubscribeRequest,
  ExploreQueueTask,
  HDHiveUnlockRequest,
} from './types';
import { extractRecord, withResponseData } from './response';

function normalizeStatusMapResponse(response: AxiosResponse<unknown>) {
  const statusMap = extractRecord(response.data, ['status_map', 'items']);
  return withResponseData(response, {
    ...(typeof response.data === 'object' && response.data !== null ? response.data : {}),
    items: statusMap,
    status_map: statusMap,
  });
}

export const searchApi = {
  // ---- 搜索 ----
  search: (query: string, page = 1) =>
    api.get('/search', { params: { query, page } }),

  // ---- 探索 ----
  getExploreMeta: (source = 'douban') =>
    api.get<ExploreMeta>('/search/explore/meta', { params: { source } }),

  getExploreHome: (source: string, refresh?: boolean) =>
    api.get('/search/explore/home', { params: { source, refresh } }),

  getExploreSections: (source = 'douban', limit = 24, refresh = false) =>
    api.get('/search/explore/sections', { params: { source, limit, refresh } }),

  getExploreSection: (source = 'douban', sectionKey: string, limit = 30, refresh = false, start = 0) =>
    api.get<ExploreSection>(`/search/explore/section/${sectionKey}`, { params: { source, limit, refresh, start } }),

  getExplorePoster: (url: string, size?: string) =>
    api.get('/search/explore/poster', { params: { url, size } }),

  // ---- Emby / 飞牛 状态 ----
  getEmbyStatusMap: async (items: { media_type: string; tmdb_id: number }[]) =>
    normalizeStatusMapResponse(await api.post<EmbyStatusMapResponse>('/search/emby/status-map', { items })),

  getFeiniuStatusMap: async (items: { media_type: string; tmdb_id: number }[]) =>
    normalizeStatusMapResponse(await api.post<FeiniuStatusMapResponse>('/search/feiniu/status-map', { items })),

  // ---- 探索 resolve / queue ----
  resolveExploreItem: (payload: ExploreResolvePayload) =>
    api.post('/search/explore/resolve', payload),

  enqueueExploreSubscribeTask: (payload: ExploreQueueSubscribeRequest) =>
    api.post('/search/explore/queue/subscribe', payload),

  enqueueExploreSaveTask: (payload: ExploreQueueSubscribeRequest) =>
    api.post('/search/explore/queue/save', payload),

  getExploreQueueTask: (taskId: string) =>
    api.get<ExploreQueueTask>(`/search/explore/queue/tasks/${encodeURIComponent(taskId)}`),

  getExploreActiveQueueTasks: (queueType = 'all') =>
    api.get('/search/explore/queue/active', { params: { queue_type: queueType } }),

  // ---- 豆瓣 ----
  getDoubanSubject: (doubanId: string, mediaType = 'movie') =>
    api.get(`/search/douban/subject/${encodeURIComponent(doubanId)}`, { params: { media_type: mediaType } }),

  getExploreDoubanSections: (limit = 24, refresh = false) =>
    api.get('/search/explore/douban-sections', { params: { limit, refresh } }),

  getExploreDoubanSection: (sectionKey: string, limit = 30, refresh = false, start = 0) =>
    api.get(`/search/explore/douban-section/${sectionKey}`, { params: { limit, refresh, start } }),

  // ---- 热门 ----
  getExplorePopularMovies: (limit = 30, refresh = false) =>
    api.get('/search/explore/popular', { params: { limit, refresh } }),

  getExplorePopularSections: (limit = 24, refresh = false) =>
    api.get('/search/explore/popular-sections', { params: { limit, refresh } }),

  // ---- 电影 ----
  getMovie: (tmdbId: number) => api.get(`/search/movie/${tmdbId}`),

  getMoviePan115: (tmdbId: number, page = 1, refresh = false) =>
    api.get(`/search/movie/${tmdbId}/115`, { params: { page, refresh } }),

  getMoviePan115Pansou: (tmdbId: number, page = 1, refresh = false) =>
    api.get(`/search/movie/${tmdbId}/115/pansou`, { params: { page, refresh } }),

  getMoviePan115Hdhive: (tmdbId: number, page = 1, refresh = false) =>
    api.get(`/search/movie/${tmdbId}/115/hdhive`, { params: { page, refresh } }),

  getMoviePan115Tg: (tmdbId: number, page = 1, refresh = false) =>
    api.get(`/search/movie/${tmdbId}/115/tg`, { params: { page, refresh } }),

  getMovieQuarkPansou: (tmdbId: number, page = 1, refresh = false) =>
    api.get(`/search/movie/${tmdbId}/quark/pansou`, { params: { page, refresh } }),

  getMovieQuarkHdhive: (tmdbId: number, page = 1, refresh = false) =>
    api.get(`/search/movie/${tmdbId}/quark/hdhive`, { params: { page, refresh } }),

  getMovieQuarkTg: (tmdbId: number, page = 1, refresh = false) =>
    api.get(`/search/movie/${tmdbId}/quark/tg`, { params: { page, refresh } }),

  getMovieMagnet: (tmdbId: number) =>
    api.get(`/search/movie/${tmdbId}/magnet`),

  getMovieMagnetSeedhub: (tmdbId: number, limit = 80) =>
    api.get(`/search/movie/${tmdbId}/magnet/seedhub`, { params: { limit } }),

  getMovieMagnetButailing: (tmdbId: number) =>
    api.get(`/search/movie/${tmdbId}/magnet/butailing`),

  createMovieSeedhubMagnetTask: (tmdbId: number, limit = 40, forceRefresh = false) =>
    api.post(`/search/movie/${tmdbId}/magnet/seedhub/tasks`, null, { params: { limit, force_refresh: forceRefresh } }),

  // ---- 剧集 ----
  getTv: (tmdbId: number) => api.get(`/search/tv/${tmdbId}`),

  getTvPan115: (tmdbId: number, page = 1, refresh = false, season: number | null = null) =>
    api.get(`/search/tv/${tmdbId}/115`, { params: { page, refresh, season } }),

  getTvPan115Pansou: (tmdbId: number, page = 1, refresh = false, season: number | null = null) =>
    api.get(`/search/tv/${tmdbId}/115/pansou`, { params: { page, refresh, season } }),

  getTvPan115Hdhive: (tmdbId: number, page = 1, refresh = false, season: number | null = null) =>
    api.get(`/search/tv/${tmdbId}/115/hdhive`, { params: { page, refresh, season } }),

  getTvPan115Tg: (tmdbId: number, page = 1, refresh = false, season: number | null = null) =>
    api.get(`/search/tv/${tmdbId}/115/tg`, { params: { page, refresh, season } }),

  getTvQuarkPansou: (tmdbId: number, page = 1, refresh = false, season: number | null = null) =>
    api.get(`/search/tv/${tmdbId}/quark/pansou`, { params: { page, refresh, season } }),

  getTvQuarkHdhive: (tmdbId: number, page = 1, refresh = false, season: number | null = null) =>
    api.get(`/search/tv/${tmdbId}/quark/hdhive`, { params: { page, refresh, season } }),

  getTvQuarkTg: (tmdbId: number, page = 1, refresh = false, season: number | null = null) =>
    api.get(`/search/tv/${tmdbId}/quark/tg`, { params: { page, refresh, season } }),

  getTvSeason: (tmdbId: number, seasonNumber: number) =>
    api.get(`/search/tv/${tmdbId}/season/${seasonNumber}`),

  getTvEpisode: (tmdbId: number, seasonNumber: number, episodeNumber: number) =>
    api.get(`/search/tv/${tmdbId}/season/${seasonNumber}/episode/${episodeNumber}`),

  getTvMagnet: (tmdbId: number, season?: number, episode?: number) =>
    api.get(`/search/tv/${tmdbId}/magnet`, { params: { season, episode } }),

  getTvMagnetSeedhub: (tmdbId: number, season: number | null = null, limit = 80) =>
    api.get(`/search/tv/${tmdbId}/magnet/seedhub`, { params: { season, limit } }),

  getTvMagnetButailing: (tmdbId: number, season: number | null = null) =>
    api.get(`/search/tv/${tmdbId}/magnet/butailing`, { params: { season } }),

  createTvSeedhubMagnetTask: (tmdbId: number, season: number | null = null, limit = 40, forceRefresh = false) =>
    api.post(`/search/tv/${tmdbId}/magnet/seedhub/tasks`, null, { params: { season, limit, force_refresh: forceRefresh } }),

  // ---- 统一资源 ----
  getMediaResources: (tmdbId: number, mediaType: string, season: number | null = null, refresh = false) =>
    api.get(`/search/${mediaType}/${tmdbId}/resources`, { params: { season, refresh } }),

  // ---- 磁力任务 ----
  getSeedhubMagnetTask: (taskId: string) =>
    api.get(`/search/magnet/seedhub/tasks/${taskId}`),

  cancelSeedhubMagnetTask: (taskId: string) =>
    api.delete(`/search/magnet/seedhub/tasks/${taskId}`),

  // ---- 关键词搜索 ----
  getHdhivePan115ByKeyword: (keyword: string, mediaType = 'movie') =>
    api.get('/search/hdhive/115/by-keyword', { params: { keyword, media_type: mediaType } }),

  getTgPan115ByKeyword: (keyword: string, mediaType = 'movie') =>
    api.get('/search/tg/115/by-keyword', { params: { keyword, media_type: mediaType } }),

  getSeedhubMagnetByKeyword: (keyword: string, mediaType = 'movie', limit = 80) =>
    api.get(`/search/seedhub/${mediaType}/magnet/by-keyword`, { params: { keyword, limit } }),

  unlockHdhiveResource: (slug: string) =>
    api.post('/search/hdhive/resource/unlock', { slug }, { timeout: 90000 }),

  // ---- 桥接 ----
  getBridgeByImdbId: (imdbId: string, mediaType = 'movie') =>
    api.get(`/search/bridge/imdb/${imdbId}`, { params: { media_type: mediaType } }),

  getCollection: (collectionId: string) =>
    api.get(`/search/collection/${collectionId}`),

  getPerson: (personId: number) =>
    api.get(`/persons/${personId}`),
};
