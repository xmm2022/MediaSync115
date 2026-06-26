import axios, { type InternalAxiosRequestConfig } from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
  withCredentials: true,
});

// Request interceptor: add timezone header
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  config.headers.set('X-Client-Timezone', 'Asia/Shanghai');
  return config;
});

// Response interceptor: handle 401 redirects
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    if (status !== 401) return Promise.reject(error);

    const requestUrl: string = error?.config?.url || '';

    // Don't redirect for /pan115/ prefixed requests (resource credential issue, not session)
    if (requestUrl.includes('/pan115/')) {
      return Promise.reject(error);
    }

    // Don't redirect for auth endpoints
    if (
      requestUrl.includes('/auth/login') ||
      requestUrl.includes('/auth/logout') ||
      requestUrl.includes('/auth/session')
    ) {
      return Promise.reject(error);
    }

    // Redirect to login page
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.href = '/login';
    }

    return Promise.reject(error);
  },
);

export default api;
