// ---- Auth ----
export interface SessionResponse {
  authenticated: boolean;
  username: string;
  expires_at: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  success: boolean;
  username: string;
}

export interface ChangeCredentialsRequest {
  current_password: string;
  username?: string;
  new_password?: string;
}

// ---- Common list response ----
export interface PaginatedList<T> {
  items: T[];
  total: number;
  limit?: number;
  offset?: number;
}

// ---- OperationLog (logs) ----
export interface OperationLogItem {
  id: number;
  trace_id?: string;
  source_type?: string;
  module?: string;
  action?: string;
  status: 'success' | 'warning' | 'failed' | 'info';
  http_method?: string;
  path?: string;
  status_code?: number;
  duration_ms?: number;
  message?: string;
  request_summary?: Record<string, unknown>;
  response_summary?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  created_at: string;
}

// ---- Archive ----
export interface ArchiveConfig {
  archive_enabled?: boolean;
  archive_watch_cid?: string;
  archive_output_cid?: string;
  archive_interval_minutes?: number;
  [key: string]: unknown;
}

export interface ArchiveFolder {
  cid: string;
  name: string;
  pid: string;
  [key: string]: unknown;
}

export interface ArchiveTask {
  id: string;
  status?: string;
  [key: string]: unknown;
}

// ---- Subscription ----
export interface SubscriptionItem {
  id: string;
  douban_id?: string;
  tmdb_id?: number;
  imdb_id?: string;
  title: string;
  media_type: 'movie' | 'tv' | 'collection';
  poster_path?: string;
  overview?: string;
  year?: number;
  rating?: number;
  tv_scope?: string;
  tv_season_number?: number;
  tv_episode_start?: number;
  tv_episode_end?: number;
  tv_follow_mode?: string;
  tv_include_specials?: boolean;
  is_active: boolean;
  auto_download?: boolean;
  created_at?: string;
  updated_at?: string;
  sources?: SubscriptionSource[];
}

export interface SubscriptionSource {
  id: number;
  subscription_id: number;
  source_type: string;
  display_name?: string;
  share_url?: string;
  receive_code?: string;
  enabled: boolean;
  last_scanned_at?: string;
  last_scan_status?: string;
  last_error?: string;
  last_found_episode?: string;
  last_transferred_count?: number;
  created_at?: string;
  updated_at?: string;
}

export interface DownloadRecord {
  id: number;
  subscription_id: number;
  resource_name: string;
  resource_url?: string;
  resource_type?: string;
  file_id?: string;
  offline_info_hash?: string;
  offline_task_id?: string;
  offline_status?: string;
  offline_submitted_at?: string;
  offline_completed_at?: string;
  status: string;
  error_message?: string;
  created_at?: string;
  completed_at?: string;
}

// ---- Settings ----
export interface RuntimeSettings {
  [key: string]: unknown;
}

// ---- Scheduler ----
export interface SchedulerTask {
  id: string;
  name: string;
  job_key: string;
  trigger_type?: string;
  cron_expr?: string;
  interval_seconds?: number;
  kwargs?: Record<string, unknown>;
  enabled?: boolean;
  [key: string]: unknown;
}

// ---- Workflow ----
export interface WorkflowItem {
  id: string;
  name?: string;
  description?: string;
  timer?: string;
  trigger_type?: string;
  event_type?: string;
  event_conditions?: Record<string, unknown>;
  actions?: unknown[];
  flows?: unknown[];
  context?: Record<string, unknown>;
  state?: string;
  [key: string]: unknown;
}

// ---- Search ----
export interface ExploreItem {
  rank: number;
  id: number | string;
  douban_id?: string;
  tmdb_id?: number;
  imdb_id?: string;
  media_type: string;
  title: string;
  year?: string;
  poster_url?: string;
  intro?: string;
  rating?: number;
  mapping_status?: string;
  source_url?: string;
  genres?: string[];
}

export interface ExploreSection {
  key: string;
  title: string;
  tag?: string;
  items?: ExploreItem[];
  source_url?: string;
  fetched_at?: string;
  total?: number;
}

export interface ExploreMeta {
  source: string;
  fetched_at?: string;
  sections: ExploreSection[];
}

export interface ExploreHomeResponse {
  source: string;
  fetched_at?: string;
  sections: ExploreSection[];
  emby_status_map?: Record<string, unknown>;
  feiniu_status_map?: Record<string, unknown>;
  errors?: unknown[];
}

export interface ExploreSectionDetailResponse {
  source: string;
  fetched_at?: string;
  key: string;
  title: string;
  tag?: string;
  total?: number;
  items?: ExploreItem[];
  emby_status_map?: Record<string, unknown>;
  feiniu_status_map?: Record<string, unknown>;
}

export interface EmbyStatusMapRequest {
  items: { media_type: string; tmdb_id: number }[];
}

export interface EmbyStatusMapResponse {
  items: Record<string, { exists_in_emby: boolean; status?: string; matched_type?: string }>;
}

export interface FeiniuStatusMapRequest {
  items: { media_type: string; tmdb_id: number }[];
}

export interface FeiniuStatusMapResponse {
  items: Record<string, { exists_in_feiniu: boolean; status?: string }>;
}

export interface ExploreResolvePayload {
  source: string;
  media_type?: string;
  tmdb_id?: number;
  douban_id?: string;
  title?: string;
  [key: string]: unknown;
}

export interface ExploreQueueSubscribeRequest {
  source: string;
  douban_id?: string;
  title?: string;
  media_type?: string;
  tmdb_id?: number;
  [key: string]: unknown;
}

export interface ExploreQueueTask {
  task_id: string;
  status: string;
  [key: string]: unknown;
}

export interface HDHiveUnlockRequest {
  slug: string;
}

export interface SeedhubTaskRequest {
  limit?: number;
  force_refresh?: boolean;
}

// ---- Pan115 ----
export interface Pan115CookieInfo {
  [key: string]: unknown;
}

export interface Pan115UserInfo {
  [key: string]: unknown;
}

export interface Pan115FileInfo {
  fid: string;
  name: string;
  cid?: string;
  pid?: string;
  size?: number;
  [key: string]: unknown;
}

export interface OfflineTask {
  info_hash?: string;
  url?: string;
  title?: string;
  status?: string;
  [key: string]: unknown;
}

export interface ShareFileInfo {
  file_id: string;
  name: string;
  size?: number;
  [key: string]: unknown;
}

// ---- Strm ----
export interface StrmConfig {
  strm_enabled?: boolean;
  strm_output_dir?: string;
  strm_base_url?: string;
  strm_redirect_mode?: string;
  [key: string]: unknown;
}

// ---- Watchlist ----
export interface WatchlistItem {
  id: string;
  name: string;
  description?: string;
  auto_fill_enabled?: boolean;
  [key: string]: unknown;
}

// ---- PersonFollow ----
export interface PersonFollowItem {
  id: string;
  tmdb_person_id: number;
  name: string;
  profile_path?: string;
  known_for_department?: string;
  auto_subscribe_new_works?: boolean;
  [key: string]: unknown;
}

// ---- License ----
export interface LicenseStatus {
  [key: string]: unknown;
}

// ---- Pansou ----
export interface PansouConfig {
  base_url?: string;
  [key: string]: unknown;
}

// ---- Quark ----
export interface QuarkCookieInfo {
  [key: string]: unknown;
}

export interface QuarkFolderInfo {
  fid: string;
  name: string;
  parent_fid?: string;
  [key: string]: unknown;
}
