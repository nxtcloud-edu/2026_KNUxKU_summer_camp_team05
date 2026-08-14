"""환경변수 기반 Gateway 설정. 모델 이름은 코드가 아니라 운영 allowlist에 둔다."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class GatewaySettings:
    host: str
    port: int
    database_path: Path
    workspace: Path
    model_profiles: dict[str, tuple[str, ...]]
    catalog_ttl_seconds: int
    auth_boundary_id: str
    workspace_id: str | None

    @classmethod
    def from_env(cls) -> "GatewaySettings":
        profiles_json = os.getenv("MOA_MODEL_PROFILES_JSON")
        if profiles_json:
            raw = json.loads(profiles_json)
            profiles = {key: tuple(value) for key, value in raw.items()}
        else:
            profiles = {
                "FAST": _csv("MOA_MODEL_PROFILE_FAST"),
                "BALANCED": _csv("MOA_MODEL_PROFILE_BALANCED"),
                "DEEP_REASONING": _csv("MOA_MODEL_PROFILE_DEEP_REASONING"),
            }
        return cls(
            host=os.getenv("MOA_GATEWAY_HOST", "127.0.0.1"),
            port=int(os.getenv("MOA_GATEWAY_PORT", "4600")),
            database_path=Path(os.getenv("MOA_GATEWAY_DB", ".data/gateway.sqlite3")).resolve(),
            workspace=Path(os.getenv("MOA_AGENT_WORKSPACE", ".")).resolve(),
            model_profiles=profiles,
            catalog_ttl_seconds=int(os.getenv("MOA_MODEL_CATALOG_TTL_SECONDS", "300")),
            auth_boundary_id=os.getenv("MOA_AUTH_BOUNDARY_ID", "moa-codex-runtime"),
            workspace_id=os.getenv("MOA_WORKSPACE_ID") or None,
        )


def _csv(name: str) -> tuple[str, ...]:
    return tuple(item.strip() for item in os.getenv(name, "").split(",") if item.strip())
