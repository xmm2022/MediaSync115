import { animeApi } from "./anime";
import type {
  AniRssConfig,
  AniRssDownloadClientApplyResponse,
  AniRssDownloadClientStatus,
  AniRssSubscriptionListResponse,
  AniRssSubscriptionCreatePayload,
  AniRssSubscriptionResponse,
  AniRssRssCandidatesResponse,
  BangumiSearchResponse,
  BangumiSubject,
  MikanRssCandidatesResponse,
} from "./types";

type ApiResponse<T> = Promise<{ data: T }>;

const assertResponse = <T,>(_value: ApiResponse<T>) => undefined;

const payload: AniRssSubscriptionCreatePayload = {
  rss_url: "https://mikanani.me/RSS/Bangumi?bangumiId=3828&subgroupid=370",
  rss_type: "mikan",
  bangumi_id: "3828",
  bgm_url: "https://bgm.tv/subject/3828",
  subgroup: "测试字幕组",
  title: "Test Anime",
  enable: true,
};

assertResponse<BangumiSearchResponse>(animeApi.searchBangumi("Test Anime"));
assertResponse<BangumiSubject>(animeApi.getBangumiSubject(3828));
assertResponse<MikanRssCandidatesResponse>(animeApi.getMikanRssCandidates("Test Anime", 3828, 24, "2024-01-01"));
assertResponse<AniRssRssCandidatesResponse>(animeApi.getAniRssRssCandidates("Test Anime", 3828, 48, "2024-01-01"));
assertResponse<AniRssConfig>(animeApi.getAniRssConfig());
assertResponse<{ ok?: boolean }>(animeApi.checkAniRssHealth());
assertResponse<AniRssDownloadClientStatus>(animeApi.getAniRssDownloadClientStatus());
assertResponse<AniRssDownloadClientApplyResponse>(animeApi.applyAniRssDownloadClientDefaults());
assertResponse<AniRssSubscriptionListResponse>(animeApi.listAniRssSubscriptions());
assertResponse<AniRssSubscriptionListResponse>(animeApi.syncAniRssSubscriptions());
assertResponse<unknown>(animeApi.previewAniRssSubscription(payload));
assertResponse<AniRssSubscriptionResponse>(animeApi.createAniRssSubscription(payload));
assertResponse<unknown>(animeApi.refreshAniRssSubscription("external-id"));
assertResponse<unknown>(animeApi.setAniRssSubscriptionEnabled("external-id", true));
