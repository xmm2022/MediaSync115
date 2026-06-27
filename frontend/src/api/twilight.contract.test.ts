import { twilightApi } from "./twilight";
import type { TwilightConfig, TwilightHealth } from "./types";

type ApiResponse<T> = Promise<{ data: T }>;

const assertResponse = <T,>(_value: ApiResponse<T>) => undefined;

assertResponse<TwilightConfig>(twilightApi.getConfig());
assertResponse<TwilightHealth>(twilightApi.health());
