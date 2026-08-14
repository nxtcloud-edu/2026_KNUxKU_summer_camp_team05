from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class WorkerSettings:
    host: str
    port: int
    database_path: Path
    gateway_url: str

    @classmethod
    def from_env(cls) -> "WorkerSettings":
        return cls(
            host=os.getenv("MOA_WORKER_HOST", "0.0.0.0"),
            port=int(os.getenv("MOA_WORKER_PORT", "4700")),
            database_path=Path(os.getenv("MOA_WORKER_DB", ".data/worker.sqlite3")).resolve(),
            gateway_url=os.getenv("MOA_CODEX_GATEWAY_URL", "http://127.0.0.1:4600"),
        )
