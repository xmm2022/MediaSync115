import api from './client';
import type {
  WatchlistFillResult,
  WatchlistImportPayload,
  WatchlistImportPreviewPayload,
  WatchlistItem,
} from './types';

export const watchlistApi = {
  list: () => api.get<WatchlistItem[]>('/watchlists'),

  get: (id: string) => api.get<WatchlistItem>(`/watchlists/${id}`),

  create: (data: { name: string; description?: string; auto_fill_enabled?: boolean }) =>
    api.post('/watchlists', data),

  update: (id: string, data: { name?: string; description?: string; auto_fill_enabled?: boolean }) =>
    api.put(`/watchlists/${id}`, data),

  delete: (id: string) => api.delete(`/watchlists/${id}`),

  addItem: (id: string, data: {
    tmdb_id: number;
    media_type: string;
    title: string;
    poster_path?: string;
    year?: number;
    rating?: number;
    notes?: string;
  }) => api.post(`/watchlists/${id}/items`, data),

  removeItem: (id: string, itemId: string) => api.delete(`/watchlists/${id}/items/${itemId}`),

  fill: (id: string) => api.post<WatchlistFillResult>(`/watchlists/${id}/fill`, null, { timeout: 120000 }),

  listForStatus: () => api.get('/watchlists/status-map'),

  getImportCatalog: () => api.get('/watchlists/import/catalog'),

  getImportSources: () => api.get('/watchlists/import/sources'),

  previewImport: (data: WatchlistImportPreviewPayload) =>
    api.post('/watchlists/import/preview', data),

  importFromTmdb: (data: WatchlistImportPayload) =>
    api.post('/watchlists/import', data, { timeout: 120000 }),
};
