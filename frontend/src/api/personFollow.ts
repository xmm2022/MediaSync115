import api from './client';
import type { PersonFollowItem } from './types';

export const personFollowApi = {
  list: () => api.get<PersonFollowItem[]>('/person-follows'),

  getStatusMap: () => api.get('/person-follows/status-map'),

  getFeed: (limit = 30) => api.get('/person-follows/feed', { params: { limit } }),

  create: (data: {
    tmdb_person_id: number;
    name: string;
    profile_path?: string;
    known_for_department?: string;
    auto_subscribe_new_works?: boolean;
  }) => api.post('/person-follows', data),

  toggle: (data: {
    tmdb_person_id: number;
    name?: string;
    profile_path?: string;
    [key: string]: unknown;
  }) => api.post('/person-follows/toggle', data),

  update: (id: string, data: { auto_subscribe_new_works?: boolean }) =>
    api.put(`/person-follows/${id}`, data),

  delete: (id: string) => api.delete(`/person-follows/${id}`),

  sync: () => api.post('/person-follows/sync', null, { timeout: 120000 }),
};
