import api from './client';
import type { RuntimeSettings } from './types';

const RUNTIME_SAVE_TIMEOUT_MS = 120000;
const TG_BOT_RESTART_TIMEOUT_MS = 45000;

export const settingsApi = {
  // ---- 运行时设置 ----
  getRuntime: () => api.get<RuntimeSettings>('/settings/runtime'),

  getAppInfo: () => api.get('/settings/app-info'),

  updateRuntime: (payload: Partial<RuntimeSettings>, config = {}) =>
    api.put('/settings/runtime', payload, { timeout: RUNTIME_SAVE_TIMEOUT_MS, ...config }),

  checkUpdates: () => api.get('/settings/update-check'),

  // ---- HDHive ----
  checkHdhive: () => api.get('/settings/hdhive/check'),

  hdhiveLogin: (username: string, password: string) =>
    api.post('/settings/hdhive/login', { username, password }, { timeout: 45000 }),

  runHdhiveCheckin: (payload: Record<string, unknown>) =>
    api.post('/settings/hdhive/checkin', payload),

  // ---- TG ----
  checkTg: () => api.get('/settings/tg/check'),

  // ---- TMDB / Pansou ----
  checkTmdb: () => api.get('/settings/tmdb/check'),

  checkPansou: () => api.get('/settings/pansou/check'),

  // ---- Emby ----
  checkEmby: (params?: { emby_url?: string; emby_api_key?: string }) =>
    api.get('/settings/emby/check', { params }),

  getEmbySyncStatus: () => api.get('/settings/emby/sync/status'),

  runEmbySync: () => api.post('/settings/emby/sync/run'),

  // ---- 飞牛 ----
  checkFeiniu: (params?: { feiniu_url?: string; feiniu_secret?: string; feiniu_api_key?: string }) =>
    api.get('/settings/feiniu/check', { params }),

  feiniuLogin: (username: string, password: string, url?: string) =>
    api.post('/settings/feiniu/login', { username, password, url }, { timeout: 45000 }),

  getFeiniuSyncStatus: () => api.get('/settings/feiniu/sync/status'),

  runFeiniuSync: () => api.post('/settings/feiniu/sync/run'),

  // ---- 健康 / 代理 ----
  checkAllHealth: () => api.get('/settings/health/all'),

  getProxy: () => api.get('/settings/proxy'),

  // ---- TG 登录 ----
  tgVerifyPassword: (payload: { password: string; session: string }) =>
    api.post('/settings/tg/login/verify-password', payload),

  tgStartQrLogin: () => api.post('/settings/tg/login/qr/start'),

  tgCheckQrLogin: (token: string) => api.post('/settings/tg/login/qr/status', { token }),

  tgLogout: () => api.post('/settings/tg/logout'),

  // ---- TG 索引 ----
  getTgIndexStatus: () => api.get('/settings/tg/index/status'),

  refreshTgIndexStatus: () => api.post('/settings/tg/index/status/refresh'),

  startTgIndexBackfill: (rebuild = false) =>
    api.post('/settings/tg/index/backfill/start', { rebuild }),

  runTgIndexIncremental: () => api.post('/settings/tg/index/incremental/run'),

  stopTgIndexJob: (jobType: string) =>
    api.post('/settings/tg/index/stop', { job_type: jobType }),

  getTgIndexJob: (jobId: string) =>
    api.get(`/settings/tg/index/jobs/${encodeURIComponent(jobId)}`),

  rebuildTgIndex: () => api.post('/settings/tg/index/rebuild'),

  // ---- TG Bot ----
  getTgBotStatus: () => api.get('/settings/tg-bot/status'),

  restartTgBot: () =>
    api.post('/settings/tg-bot/restart', null, { timeout: TG_BOT_RESTART_TIMEOUT_MS }),

  stopTgBot: () =>
    api.post('/settings/tg-bot/stop', null, { timeout: TG_BOT_RESTART_TIMEOUT_MS }),

  // ---- 榜单订阅 / 演职员关注 ----
  getAvailableCharts: () => api.get('/settings/chart-subscription/charts'),

  runChartSubscription: () =>
    api.post('/settings/chart-subscription/run', null, { timeout: 120000 }),

  runPersonFollow: () =>
    api.post('/settings/person-follow/run', null, { timeout: 120000 }),
};
