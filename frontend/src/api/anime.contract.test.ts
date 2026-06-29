import { animeApi } from "./anime";
import type {
  AniRssConfig,
  AniRssSubscriptionCreatePayload,
  AniRssSubscriptionResponse,
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
  season: 1,
  enable: true,
};

assertResponse<BangumiSearchResponse>(animeApi.searchBangumi("Test Anime"));
assertResponse<BangumiSubject>(animeApi.getBangumiSubject(3828));
assertResponse<MikanRssCandidatesResponse>(animeApi.getMikanRssCandidates("Test Anime", 3828));
assertResponse<AniRssConfig>(animeApi.getAniRssConfig());
assertResponse<{ ok?: boolean }>(animeApi.checkAniRssHealth());
assertResponse<unknown>(animeApi.listAniRssSubscriptions());
assertResponse<unknown>(animeApi.previewAniRssSubscription(payload));
assertResponse<AniRssSubscriptionResponse>(animeApi.createAniRssSubscription(payload));
assertResponse<unknown>(animeApi.refreshAniRssSubscription("external-id"));
assertResponse<unknown>(animeApi.setAniRssSubscriptionEnabled("external-id", true));
