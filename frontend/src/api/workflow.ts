import api from './client';
import type { WorkflowItem } from './types';

export const workflowApi = {
  list: () => api.get<WorkflowItem[]>('/workflow'),

  get: (id: string) => api.get<WorkflowItem>(`/workflow/${id}`),

  create: (data: Partial<WorkflowItem>) => api.post('/workflow', data),

  update: (id: string, data: Partial<WorkflowItem>) => api.put(`/workflow/${id}`, data),

  delete: (id: string) => api.delete(`/workflow/${id}`),

  run: (id: string) => api.post(`/workflow/${id}/run`),

  start: (id: string) => api.post(`/workflow/${id}/start`),

  pause: (id: string) => api.post(`/workflow/${id}/pause`),

  reset: (id: string) => api.post(`/workflow/${id}/reset`),

  listEventTypes: () => api.get('/workflow/event-types'),

  triggerEvent: (payload: { event_type: string; payload?: Record<string, unknown> }) =>
    api.post('/workflow/events/trigger', payload),
};
