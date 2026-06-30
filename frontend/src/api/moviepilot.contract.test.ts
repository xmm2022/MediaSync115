import { moviepilotApi } from "./moviepilot";
import type {
  MoviePilotConfig,
  MoviePilotCompletionPreview,
  MoviePilotHealth,
  MoviePilotSyncResponse,
  MoviePilotSubscriptionCreatePayload,
  MoviePilotSubscriptionResponse,
} from "./types";

type ApiResponse<T> = Promise<{ data: T }>;

const assertResponse = <T,>(_value: ApiResponse<T>) => undefined;

const createPayload: MoviePilotSubscriptionCreatePayload = {
  title: "Test Movie",
  media_type: "movie",
  auto_download: true,
  moviepilot_quality: "WEB-DL",
  moviepilot_resolution: "1080p",
  moviepilot_include: "中字",
  moviepilot_exclude: "枪版",
  moviepilot_save_path: "/incoming/pt",
};

assertResponse<MoviePilotConfig>(moviepilotApi.getConfig());
assertResponse<MoviePilotHealth>(moviepilotApi.health());
assertResponse<{ items: unknown[] }>(moviepilotApi.search("Test Movie"));
assertResponse<MoviePilotSubscriptionResponse>(
  moviepilotApi.createSubscription(createPayload),
);
assertResponse<MoviePilotSyncResponse>(moviepilotApi.syncSubscriptions());
assertResponse<{ result: unknown }>(moviepilotApi.searchSubscription(88));
assertResponse<MoviePilotCompletionPreview>(
  moviepilotApi.previewMissingCompletion(88, { refresh: true }),
);
assertResponse<MoviePilotCompletionPreview>(
  moviepilotApi.runMissingCompletion(88, { dry_run: true }),
);
