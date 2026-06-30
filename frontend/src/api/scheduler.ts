import api from './client';
import type { SchedulerJob, SchedulerTask } from './types';
import { extractItems, withResponseData } from './response';

export const schedulerApi = {
  listJobKeys: async () => {
    const response = await api.get('/scheduler/job-keys');
    return withResponseData(response, extractItems<string>(response.data));
  },

  listJobs: async () => {
    const response = await api.get('/scheduler/jobs');
    return withResponseData(response, extractItems<SchedulerJob>(response.data));
  },

  runJob: (jobId: string, force = false) =>
    api.post(`/scheduler/run/${encodeURIComponent(jobId)}`, null, { params: { force } }),

  listTasks: () => api.get<SchedulerTask[]>('/scheduler/tasks'),

  createTask: (data: Partial<SchedulerTask>) => api.post('/scheduler/tasks', data),

  updateTask: (taskId: string, data: Partial<SchedulerTask>) =>
    api.put(`/scheduler/tasks/${taskId}`, data),

  enableTask: (taskId: string) => api.post(`/scheduler/tasks/${taskId}/enable`),

  pauseTask: (taskId: string) => api.post(`/scheduler/tasks/${taskId}/pause`),

  deleteTask: (taskId: string) => api.delete(`/scheduler/tasks/${taskId}`),
};
