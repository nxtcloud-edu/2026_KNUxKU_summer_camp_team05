from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any


_LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost"}


@dataclass(frozen=True, slots=True)
class GatewaySettings:
    host: str
    port: int
    database_path: str
    workspace: Path
    model_profiles: dict[str, tuple[str, ...]]
    catalog_ttl_seconds: int
    auth_boundary_id: str
    workspace_id: str | None

    @classmethod
    def from_env(cls) -> "GatewaySettings":
        host = os.getenv("MOA_GATEWAY_HOST", "127.0.0.1")
        if host not in _LOOPBACK_HOSTS:
            raise ValueError("MVP Gateway는 loopback 주소에만 바인딩할 수 있습니다.")

        profiles_json = os.getenv("MOA_MODEL_PROFILES_JSON")
        if profiles_json:
            raw: Any = json.loads(profiles_json)
            if not isinstance(raw, dict):
                raise ValueError("MOA_MODEL_PROFILES_JSON은 객체여야 합니다.")
            profiles = {
                str(key): tuple(str(item).strip() for item in value if str(item).strip())
                for key, value in raw.items()
                if isinstance(value, list)
            }
        else:
            profiles = {
                "FAST": _csv("MOA_MODEL_PROFILE_FAST"),
                "BALANCED": _csv("MOA_MODEL_PROFILE_BALANCED"),
                "DEEP_REASONING": _csv("MOA_MODEL_PROFILE_DEEP_REASONING"),
            }

        default_workspace = Path(tempfile.gettempdir()) / "moa-codex-runtime"
        return cls(
            host=host,
            port=_positive_int("MOA_GATEWAY_PORT", 4600),
            database_path=os.getenv("MOA_GATEWAY_DB", ":memory:"),
            workspace=Path(os.getenv("MOA_AGENT_WORKSPACE", str(default_workspace))).resolve(),
            model_profiles=profiles,
            catalog_ttl_seconds=_positive_int("MOA_MODEL_CATALOG_TTL_SECONDS", 300),
            auth_boundary_id=os.getenv("MOA_AUTH_BOUNDARY_ID", "moa-local-codex-runtime"),
            workspace_id=os.getenv("MOA_WORKSPACE_ID") or None,
        )


def _csv(name: str) -> tuple[str, ...]:
    return tuple(item.strip() for item in os.getenv(name, "").split(",") if item.strip())


def _positive_int(name: str, default: int) -> int:
    value = int(os.getenv(name, str(default)))
    if value <= 0:
        raise ValueError(f"{name}은 양수여야 합니다.")
    return value
