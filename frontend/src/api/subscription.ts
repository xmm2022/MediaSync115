import api from './client';
import type { SubscriptionItem, DownloadRecord, SubscriptionSource } from './types';
import { extractItems, withResponseData } from './response';

export const subscriptionApi = {
  // ---- 订阅 CRUD ----
  list: async (params?: Record<string, unknown>) => {
    const response = await api.get('/subscriptions', { params });
    return withResponseData(response, extractItems<SubscriptionItem>(response.data));
  },

  listForStatus: (params?: Record<string, unknown>) =>
    api.get('/subscriptions/status-map', {
      params: { is_active: true, ...(params || {}) },
    }),

  get: (id: string) => api.get<SubscriptionItem>(`/subscriptions/${id}`),

  create: (data: {
    douban_id?: string;
    tmdb_id?: number;
    title: string;
    media_type: string;
    poster_path?: string;
    tv_scope?: string;
    tv_season_number?: number;
    tv_episode_start?: number;
    tv_episode_end?: number;
    [key: string]: unknown;
  }) => api.post('/subscriptions', data),

  update: (id: string, data: {
    title?: string;
    is_active?: boolean;
    tv_scope?: string;
    auto_download?: boolean;
    [key: string]: unknown;
  }) => api.put(`/subscriptions/${id}`, data),

  delete: (id: string) => api.delete(`/subscriptions/${id}`),

  deleteByType: (mediaType: string) => api.delete(`/subscriptions/batch/${mediaType}`),

  toggle: (data: {
    douban_id?: string;
    tmdb_id?: number;
    title: string;
    media_type: string;
    [key: string]: unknown;
  }) => api.post('/subscriptions/toggle', data),

  cleanupAll: () => api.post('/subscriptions/cleanup'),

  cleanup: (id: string) => api.post(`/subscriptions/${id}/cleanup`),

  // ---- TV 缺集 ----
  getTvMissingStatus: (params?: Record<string, unknown>) =>
    api.get('/subscriptions/missing-status/tv', { params }),

  getSubscriptionTvMissingStatus: (id: string, params?: Record<string, unknown>) =>
    api.get(`/subscriptions/${id}/tv/missing-status`, { params }),

  getTvMissingPreview: (tmdbId: number, params?: Record<string, unknown>) =>
    api.get(`/subscriptions/missing-status/tv/preview/${tmdbId}`, { params }),

  // ---- 来源管理 ----
  listSources: async (id: string) => {
    const response = await api.get(`/subscriptions/${id}/sources`);
    return withResponseData(response, extractItems<SubscriptionSource>(response.data));
  },

  createSource: (id: string, data: {
    share_url: string;
    receive_code?: string;
    display_name?: string;
    selected_file_ids?: string[];
  }) => api.post(`/subscriptions/${id}/sources`, data),

  updateSource: (id: string, sourceId: string, data: {
    enabled?: boolean;
    display_name?: string;
    selected_file_ids?: string[];
  }) => api.patch(`/subscriptions/${id}/sources/${sourceId}`, data),

  deleteSource: (id: string, sourceId: string) =>
    api.delete(`/subscriptions/${id}/sources/${sourceId}`),

  scanSource: (id: string, sourceId: string) =>
    api.post(`/subscriptions/${id}/sources/${sourceId}/scan`, null, { timeout: 300000 }),

  // ---- 下载记录 ----
  getDownloads: (id: string, status?: string | null) =>
    api.get<DownloadRecord[]>(`/subscriptions/${id}/downloads`, { params: { status } }),

  createDownload: (id: string, data: {
    resource_name: string;
    resource_url: string;
    resource_type?: string;
    file_id?: string;
  }) => api.post(`/subscriptions/${id}/downloads`, data),

  getDownload: (id: string, recordId: string) =>
    api.get<DownloadRecord>(`/subscriptions/${id}/downloads/${recordId}`),

  updateDownload: (id: string, recordId: string, data: {
    status?: string;
    error_message?: string;
    offline_info_hash?: string;
    [key: string]: unknown;
  }) => api.put(`/subscriptions/${id}/downloads/${recordId}`, data),

  deleteDownload: (id: string, recordId: string) =>
    api.delete(`/subscriptions/${id}/downloads/${recordId}`),

  markDownloadComplete: (id: string, recordId: string) =>
    api.post(`/subscriptions/${id}/downloads/${recordId}/complete`),

  markDownloadFailed: (id: string, recordId: string, errorMessage?: string | null) =>
    api.post(`/subscriptions/${id}/downloads/${recordId}/fail`, null, {
      params: { error_message: errorMessage },
    }),

  // ---- 频道检查 ----
  runChannelCheck: (channel: string) =>
    api.post('/subscriptions/system/run', { channel }, { timeout: 300000 }),

  runChannelCheckBackground: (channel: string, forceAutoDownload = false) =>
    api.post('/subscriptions/system/run/background', { channel, force_auto_download: forceAutoDownload }),

  runAllChannelsCheckBackground: (forceAutoDownload = false) =>
    api.post('/subscriptions/system/run/background', { channel: 'all', force_auto_download: forceAutoDownload }),

  getRunTask: (taskId: string) =>
    api.get(`/subscriptions/system/run/tasks/${taskId}`),

  // ---- 执行日志 (含旧路由兼容) ----
  listLogs: async (params?: Record<string, unknown>) => {
    try {
      return await api.get('/subscriptions/system/logs', { params });
    } catch (error: unknown) {
      if ((error as { response?: { status?: number } })?.response?.status === 404) {
        return api.get('/subscriptions/actions/logs', { params });
      }
      throw error;
    }
  },

  listStepLogs: async (params?: Record<string, unknown>) => {
    try {
      return await api.get('/subscriptions/system/logs/steps', { params });
    } catch (error: unknown) {
      if ((error as { response?: { status?: number } })?.response?.status === 404) {
        return api.get('/subscriptions/actions/logs/steps', { params });
      }
      throw error;
    }
  },
};
