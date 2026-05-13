import re
from datetime import datetime
from typing import Any
from urllib.parse import urlparse

import httpx

from app.services.app_metadata_service import app_metadata_service

from app.core.timezone_utils import beijing_now


_SEMVER_PATTERN = re.compile(r"^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+][0-9A-Za-z.-]+)?$")
_DOCKER_REPOSITORY_PATTERN = re.compile(
    r"^[a-z0-9]+(?:[._-][a-z0-9]+)*/[a-z0-9]+(?:[._-][a-z0-9]+)*$"
)


class UpdateCheckService:
    HUB_API_BASE = "https://hub.docker.com/v2/namespaces"

    def normalize_repository(self, source_type: str, repository: str) -> str:
        normalized_type = str(source_type or "").strip().lower()
        if normalized_type != "custom_dockerhub":
            return app_metadata_service.OFFICIAL_UPDATE_REPOSITORY

        candidate = str(repository or "").strip()
        if not candidate:
            raise ValueError("自定义镜像仓库不能为空")

        parsed = urlparse(candidate)
        if parsed.scheme and parsed.netloc:
            path = parsed.path.strip("/")
            if parsed.netloc in {"hub.docker.com", "www.hub.docker.com"}:
                if path.startswith("r/"):
                    candidate = path[2:]
                else:
                    candidate = path
            elif parsed.netloc in {"docker.io", "index.docker.io"}:
                candidate = path

        candidate = candidate.replace("docker.io/", "").replace("index.docker.io/", "").strip("/")
        candidate = candidate.split("@", 1)[0].split(":", 1)[0].strip()
        if candidate.startswith("r/"):
            candidate = candidate[2:]

        if not _DOCKER_REPOSITORY_PATTERN.fullmatch(candidate):
            raise ValueError("镜像仓库格式无效，请使用 namespace/name")
        return candidate

    @staticmethod
    def _parse_datetime(value: str) -> datetime | None:
        cleaned = str(value or "").strip()
        if not cleaned:
            return None
        try:
            return datetime.fromisoformat(cleaned.replace("Z", "+00:00"))
        except Exception:
            return None

    @staticmethod
    def _parse_semver(value: str) -> tuple[int, int, int] | None:
        match = _SEMVER_PATTERN.fullmatch(str(value or "").strip())
        if not match:
            return None
        return tuple(int(match.group(index)) for index in range(1, 4))

    @staticmethod
    def _extract_digests(tag_payload: dict[str, Any]) -> set[str]:
        images = tag_payload.get("images")
        if not isinstance(images, list):
            return set()
        digests: set[str] = set()
        for item in images:
            digest = str((item or {}).get("digest") or "").strip()
            if digest:
                digests.add(digest)
        return digests

    def _pick_version_tag(
        self,
        tags: list[dict[str, Any]],
        latest_tag: dict[str, Any] | None,
    ) -> str:
        semver_candidates: list[tuple[tuple[int, int, int], str]] = []
        latest_digests = self._extract_digests(latest_tag or {})
        matched_digest_candidates: list[tuple[tuple[int, int, int], str]] = []

        for tag in tags:
            name = str(tag.get("name") or "").strip()
            parsed = self._parse_semver(name)
            if not parsed:
                continue
            semver_candidates.append((parsed, name))
            if latest_digests and self._extract_digests(tag) & latest_digests:
                matched_digest_candidates.append((parsed, name))

        if matched_digest_candidates:
            return max(matched_digest_candidates, key=lambda item: item[0])[1]
        if semver_candidates:
            return max(semver_candidates, key=lambda item: item[0])[1]
        return str((latest_tag or {}).get("name") or "").strip()

    def _compare_versions(
        self,
        current_metadata: dict[str, Any],
        latest_tag_name: str,
        latest_version: str,
        latest_published_at: str,
    ) -> tuple[str, bool | None, str]:
        current_version = str(current_metadata.get("current_version") or "").strip()
        current_tag = str(current_metadata.get("current_image_tag") or "").strip()
        current_build_time = self._parse_datetime(str(current_metadata.get("current_build_time") or ""))
        latest_time = self._parse_datetime(latest_published_at)

        current_semver = self._parse_semver(current_version)
        latest_semver = self._parse_semver(latest_version)
        if current_semver and latest_semver:
            if current_semver < latest_semver:
                return "update_available", True, f"检测到新版本 {latest_version}"
            return "up_to_date", False, "当前已是最新正式版本"

        if current_build_time and latest_time:
            if current_build_time < latest_time:
                return "update_available", True, f"检测到新版本 {latest_tag_name or latest_version}"
            return "up_to_date", False, "当前镜像已与最新构建同步"

        if current_tag and latest_tag_name and current_tag == latest_tag_name and current_tag != "latest":
            return "up_to_date", False, "当前镜像标签已是最新"

        return "unknown", None, "当前构建缺少可比较版本信息，无法精确判断是否需要更新"

    async def check(self, source_type: str, repository: str) -> dict[str, Any]:
        normalized_repository = self.normalize_repository(source_type, repository)
        namespace, repo_name = normalized_repository.split("/", 1)
        url = f"{self.HUB_API_BASE}/{namespace}/repositories/{repo_name}/tags"
        params = {
            "page_size": 100,
            "ordering": "last_updated",
        }

        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(url, params=params)
            response.raise_for_status()
            payload = response.json()

        results = payload.get("results")
        if not isinstance(results, list) or not results:
            raise ValueError("镜像仓库没有可用 tag")

        latest_tag = next((item for item in results if str(item.get("name") or "").strip() == "latest"), results[0])
        latest_tag_name = str((latest_tag or {}).get("name") or "").strip()
        latest_published_at = str((latest_tag or {}).get("last_updated") or "").strip()
        latest_version = self._pick_version_tag(results, latest_tag)

        current_metadata = app_metadata_service.get_current_metadata()
        compare_status, has_update, message = self._compare_versions(
            current_metadata=current_metadata,
            latest_tag_name=latest_tag_name,
            latest_version=latest_version,
            latest_published_at=latest_published_at,
        )

        return {
            **current_metadata,
            "latest_source": "dockerhub",
            "update_source_type": "official" if normalized_repository == app_metadata_service.OFFICIAL_UPDATE_REPOSITORY else "custom_dockerhub",
            "update_repository": normalized_repository,
            "is_official_source": normalized_repository == app_metadata_service.OFFICIAL_UPDATE_REPOSITORY,
            "latest_tag": latest_tag_name or latest_version or "",
            "latest_version": latest_version or latest_tag_name or "",
            "latest_published_at": latest_published_at,
            "checked_at": beijing_now().isoformat().replace("+00:00", "Z"),
            "compare_status": compare_status,
            "has_update": has_update,
            "message": message,
        }


update_check_service = UpdateCheckService()
