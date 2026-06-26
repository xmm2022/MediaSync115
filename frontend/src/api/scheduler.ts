import api from './client';
import type { SchedulerTask } from './types';

export const schedulerApi = {
  listJobKeys: () => api.get<string[]>('/scheduler/job-keys'),

  listJobs: () => api.get('/scheduler/jobs'),

  runJob: (jobId: string) => api.post(`/scheduler/run/${encodeURIComponent(jobId)}`),

  listTasks: () => api.get<SchedulerTask[]>('/scheduler/tasks'),

  createTask: (data: Partial<SchedulerTask>) => api.post('/scheduler/tasks', data),

  updateTask: (taskId: string, data: Partial<SchedulerTask>) =>
    api.put(`/scheduler/tasks/${taskId}`, data),

  enableTask: (taskId: string) => api.post(`/scheduler/tasks/${taskId}/enable`),

  pauseTask: (taskId: string) => api.post(`/scheduler/tasks/${taskId}/pause`),

  deleteTask: (taskId: string) => api.delete(`/scheduler/tasks/${taskId}`),
};
