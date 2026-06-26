import api from './client';

export const authApi = {
  getSession: (config = {}) => api.get('/auth/session', { timeout: 5000, ...config }),
  login: (payload: { username: string; password: string }) => api.post('/auth/login', payload),
  logout: () => api.post('/auth/logout'),
  changeCredentials: (payload: { current_password: string; username?: string; new_password?: string }) =>
    api.post('/auth/change-credentials', payload),
};
