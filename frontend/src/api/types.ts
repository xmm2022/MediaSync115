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
  provider?: string;
  external_system?: string;
  external_subscription_id?: string;
  external_status?: string;
  sources?: SubscriptionSource[];
  source_summary?: {
    total: number;
    enabled: number;
  };
}

export interface SubscriptionSource {
  id: number;
  subscription_id: number;
  source_type: string;
  display_name?: string;
  share_url?: string;
  receive_code?: string;
  selected_file_ids?: string[];
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

// ---- MoviePilot ----
export interface MoviePilotConfig {
  enabled: boolean;
  base_url: string;
  username: string;
  password_configured: boolean;
  access_token_configured: boolean;
  save_path: string;
}

export interface MoviePilotHealth {
  ok: boolean;
  subscription_count?: number;
  [key: string]: unknown;
}

export interface MoviePilotSubscriptionCreatePayload {
  title: string;
  media_type: string;
  tmdb_id?: number;
  douban_id?: string;
  poster_path?: string;
  overview?: string;
  year?: string | number;
  rating?: number;
  auto_download?: boolean;
  tv_scope?: string;
  tv_season_number?: number;
  tv_episode_start?: number;
  tv_episode_end?: number;
  tv_follow_mode?: string;
  tv_include_specials?: boolean;
  moviepilot_quality?: string;
  moviepilot_resolution?: string;
  moviepilot_include?: string;
  moviepilot_exclude?: string;
  moviepilot_save_path?: string;
  [key: string]: unknown;
}

export interface MoviePilotSubscriptionResponse {
  id?: string | number;
  title?: string;
  media_type?: string;
  tmdb_id?: number;
  douban_id?: string;
  provider?: string;
  external_system?: string;
  external_subscription_id?: string | number;
  external_status?: string;
}

export interface MoviePilotDownloadPayload {
  item?: Record<string, unknown>;
  torrent?: Record<string, unknown>;
  torrent_info?: Record<string, unknown>;
  media?: Record<string, unknown>;
  media_info?: Record<string, unknown>;
  title?: string;
  media_type?: string;
  tmdb_id?: number;
  douban_id?: string;
  downloader?: string;
  save_path?: string;
  moviepilot_save_path?: string;
}

export interface MoviePilotDownloadResponse {
  success: boolean;
  message?: string | null;
  data?: Record<string, unknown> | unknown[] | null;
}

export interface MoviePilotSyncResponse {
  subscriptions?: {
    items?: unknown[];
    updated_count?: number;
  };
  downloads?: {
    items?: unknown[];
    created_count?: number;
    updated_count?: number;
    skipped_count?: number;
  };
  transfer_history?: {
    items?: unknown[];
    created_count?: number;
    updated_count?: number;
    skipped_count?: number;
  };
  updated_count: number;
  download_created_count?: number;
  download_updated_count?: number;
  transfer_created_count?: number;
  transfer_updated_count?: number;
}

export interface TwilightConfig {
  enabled: boolean;
  base_url: string;
  web_url: string;
  api_key_configured: boolean;
}

export interface TwilightHealth {
  ok: boolean;
  health?: unknown;
  api_key_status?: unknown;
}

// ---- Anime / Bangumi / ANI-RSS ----
export interface BangumiSubject {
  id: number;
  name: string;
  name_cn?: string;
  date?: string;
  image?: string;
  images?: {
    small?: string;
    grid?: string;
    large?: string;
    medium?: string;
    common?: string;
  };
  summary?: string;
  score?: number;
  rating?: {
    score?: number;
    total?: number;
  };
  eps?: number;
  total_episodes?: number;
  platform?: string;
  tags?: { name?: string; count?: number }[];
  [key: string]: unknown;
}

export interface BangumiSearchResponse {
  data: BangumiSubject[];
  total: number;
  limit: number;
  offset: number;
}

export interface AniRssConfig {
  enabled: boolean;
  base_url: string;
  api_key_configured: boolean;
  mikan_base_url?: string;
  default_download_path?: string;
  download_path_presets?: string[];
}

export type AniRssCandidateSource = "mikan" | "ani-bt" | "anime-garden" | string;

export interface AniRssRssCandidate {
  source: AniRssCandidateSource;
  provider?: "anirss" | string;
  source_id?: string | null;
  mikan_id?: string | null;
  anibt_id?: string | null;
  anime_garden_id?: string | null;
  title: string;
  rss_url: string;
  rss_type?: string;
  subgroup_id?: string | null;
  subgroup?: string;
  mikan_url?: string;
  source_url?: string | null;
  bgm_url?: string;
  bangumi_id?: string | null;
  [key: string]: unknown;
}

export type MikanRssCandidate = AniRssRssCandidate;

export interface AniRssRssCandidatesResponse {
  source: "anirss" | "mikan";
  provider?: "anirss" | string;
  discovery?: "anirss-api" | string;
  sources?: AniRssCandidateSource[];
  keyword: string;
  search_text?: string;
  queries?: { text?: string; source?: string; bgm_url?: string; season?: Record<string, unknown>; items?: number }[];
  base_url: string;
  matched: boolean;
  matched_mikan_id?: string | null;
  matched_source_count?: number;
  source_results?: {
    source?: string;
    matched?: boolean;
    candidate_count?: number;
    item_count?: number;
    queries?: unknown[];
    errors?: string[];
  }[];
  items?: unknown[];
  candidates: AniRssRssCandidate[];
  errors?: string[];
}

export type MikanRssCandidatesResponse = AniRssRssCandidatesResponse;

export interface AniRssSubscriptionCreatePayload {
  rss_url: string;
  rss_type?: string;
  bgm_url?: string;
  bangumi_id?: string;
  subgroup?: string;
  title?: string;
  poster_path?: string;
  overview?: string;
  year?: string | number;
  rating?: number;
  enable?: boolean;
  auto_download?: boolean;
  download_path?: string;
}

export interface AniRssSubscriptionResponse {
  id?: string | number;
  title?: string;
  media_type?: string;
  provider?: string;
  external_system?: string;
  external_subscription_id?: string | number;
  external_status?: string;
}

export interface AniRssPreviewSummaryItem {
  title?: string;
  episode?: string | null;
  subgroup?: string | null;
  info_hash?: string | null;
  pub_date?: string | null;
}

export interface AniRssSubscriptionStatus {
  id?: string;
  external_subscription_id?: string;
  local_subscription_id?: number | null;
  title?: string;
  jp_title?: string | null;
  subgroup?: string | null;
  enabled?: boolean;
  enable?: boolean;
  status?: "tracking" | "paused" | "error" | "missing" | string;
  status_text?: string;
  current_episode?: number | null;
  total_episodes?: number | null;
  currentEpisodeNumber?: number | null;
  totalEpisodeNumber?: number | null;
  rss_url?: string;
  url?: string;
  bangumi_url?: string | null;
  bgmUrl?: string | null;
  download_path?: string;
  downloadPath?: string;
  custom_download_path?: boolean;
  customDownloadPath?: boolean;
  download_new?: boolean;
  downloadNew?: boolean;
  last_download_time?: number | null;
  lastDownloadTime?: number | null;
  image?: string | null;
  cover?: string | null;
  completed?: boolean;
  matched_count?: number;
  duplicate_ignored_count?: number;
  matched_items?: AniRssPreviewSummaryItem[];
  duplicate_ignored_items?: AniRssPreviewSummaryItem[];
  preview_download_path?: string | null;
  recent_hit?: AniRssPreviewSummaryItem | null;
  recent_error?: string | null;
  local_external_status?: string | null;
  raw?: unknown;
  [key: string]: unknown;
}

export interface AniRssSubscriptionListResponse {
  total?: number;
  items?: AniRssSubscriptionStatus[];
  weekList?: { items?: AniRssSubscriptionStatus[] }[];
  releaseDateList?: unknown[];
  sync?: {
    remote_count?: number;
    local_count?: number;
    include_preview?: boolean;
    updated_local?: boolean;
  };
  [key: string]: unknown;
}

export interface AniRssDownloadClientStatus {
  ok: boolean;
  ready?: boolean;
  message?: string;
  config_path?: string;
  desired?: Record<string, unknown>;
  actual?: {
    download_tool_type?: string;
    download_tool_host?: string;
    download_tool_username?: string;
    download_tool_password_configured?: boolean;
    download_tool_password_matches_default?: boolean;
    qb_use_download_path?: boolean;
    rss?: boolean;
    download_new?: boolean;
    auto_start?: boolean;
    download_count?: number | null;
    download_path_template?: string;
  };
  qbittorrent?: {
    ok?: boolean;
    message?: string;
    base_url?: string;
    version?: string;
    login_status?: number | null;
    torrent_count?: number | null;
    torrents_status?: number;
  };
  issues?: string[];
  unsafe_flags?: string[];
}

export interface AniRssDownloadClientApplyResponse {
  ok: boolean;
  changed?: boolean;
  changed_fields?: string[];
  before?: AniRssDownloadClientStatus["actual"];
  after?: AniRssDownloadClientStatus["actual"];
  status?: AniRssDownloadClientStatus;
  restart_required?: boolean;
  message?: string;
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

export interface SchedulerJob {
  id: string;
  name?: string;
  next_run_time?: string | null;
  running?: boolean;
  kind?: string | null;
  [key: string]: unknown;
}

// ---- Workflow ----
export interface WorkflowItem {
  id: number;
  name: string;
  description: string | null;
  timer: string | null;
  trigger_type: string; // "timer" | "event"
  event_type: string | null;
  event_conditions: string | null; // JSON string
  actions: string | null; // JSON string
  flows: string | null; // JSON string
  context: string | null; // JSON string
  state: string; // "W"=运行中, "P"=已暂停
  run_count: number;
  current_action: string | null;
  last_result: string | null;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
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

export interface RecommendationItem extends ExploreItem {
  name?: string;
  poster_path?: string;
  overview?: string;
  vote_average?: number;
  release_date?: string;
  first_air_date?: string;
}

export interface RecommendationResponse {
  items: RecommendationItem[];
  results?: RecommendationItem[];
  page: number;
  total_pages: number;
  total_results?: number;
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
  tmdb_configured?: boolean;
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
  strm_refresh_emby_after_generate?: boolean;
  strm_refresh_feiniu_after_generate?: boolean;
  strm_proxy_enabled?: boolean;
  strm_proxy_port?: number;
  archive_output_cid?: string;
  archive_output_name?: string;
  mount_paths?: unknown;
  suggested_base_url?: string;
  runtime?: Record<string, unknown>;
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

export interface PersonFollowFeedItem {
  id: string;
  person_follow_id: string;
  tmdb_person_id: number;
  person_name: string;
  person_profile_path?: string | null;
  tmdb_id: number;
  media_type: string;
  title: string;
  poster_path?: string | null;
  credit_date?: string | null;
  discovered_at?: string | null;
  subscribed?: boolean;
  [key: string]: unknown;
}

// ---- License ----
export interface LicenseStatus {
  tier?: string;
  has_license_key?: boolean;
  features?: Record<string, boolean>;
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
