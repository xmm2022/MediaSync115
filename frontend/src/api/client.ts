import axios, { type InternalAxiosRequestConfig } from 'axios';
import { AUTH_REQUIRED_EVENT, getApiErrorMessage, isWebSessionAuthError } from './errors';

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

// Response interceptor: surface session expiry through the SPA auth flow.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    if (status !== 401) return Promise.reject(error);

    const requestUrl: string = error?.config?.url || '';

    // Auth endpoints and external service credential failures must not log out
    // the Web session. Only the backend session middleware returns "请先登录".
    if (
      requestUrl.includes('/auth/login') ||
      requestUrl.includes('/auth/logout') ||
      requestUrl.includes('/auth/session') ||
      !isWebSessionAuthError(error)
    ) {
      return Promise.reject(error);
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent(AUTH_REQUIRED_EVENT, {
          detail: { message: getApiErrorMessage(error) },
        }),
      );
    }

    return Promise.reject(error);
  },
);

export default api;
