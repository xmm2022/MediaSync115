import api from './client';
import type { WorkflowItem } from './types';

export interface WorkflowSavePayload {
  name: string;
  description?: string | null;
  timer?: string | null;
  trigger_type: 'timer' | 'event';
  event_type?: string | null;
  event_conditions?: Record<string, unknown>;
  actions?: Record<string, unknown>[];
  flows?: Record<string, unknown>[];
  context?: Record<string, unknown>;
  state?: string;
}

export const workflowApi = {
  list: () => api.get<WorkflowItem[]>('/workflow'),

  get: (id: string) => api.get<WorkflowItem>(`/workflow/${id}`),

  create: (data: WorkflowSavePayload) => api.post<WorkflowItem>('/workflow', data),

  update: (id: string, data: Partial<WorkflowSavePayload>) => api.put<WorkflowItem>(`/workflow/${id}`, data),

  delete: (id: string) => api.delete(`/workflow/${id}`),

  run: (id: string) => api.post(`/workflow/${id}/run`),

  start: (id: string) => api.post(`/workflow/${id}/start`),

  pause: (id: string) => api.post(`/workflow/${id}/pause`),

  reset: (id: string) => api.post(`/workflow/${id}/reset`),

  listEventTypes: () => api.get('/workflow/event-types'),

  triggerEvent: (payload: { event_type: string; payload?: Record<string, unknown> }) =>
    api.post('/workflow/events/trigger', payload),
};
