"""중복 과금 방지와 thread 격리를 위한 Gateway 전용 SQLite 저장소."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path
from typing import Any

from .models import AgentRunRequest, AgentRunResult


class RequestConflictError(ValueError):
    pass


class GatewayStore:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._connection = sqlite3.connect(path, check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        self._connection.executescript(
            """
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS agent_runs (
              run_id TEXT PRIMARY KEY,
              request_hash TEXT NOT NULL,
              response_json TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS agent_threads (
              thread_key TEXT PRIMARY KEY,
              thread_id TEXT NOT NULL UNIQUE,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            """
        )

    @staticmethod
    def request_hash(request: AgentRunRequest) -> str:
        canonical = request.model_dump_json(by_alias=True, exclude_none=True)
        return hashlib.sha256(canonical.encode()).hexdigest()

    def get_cached(self, request: AgentRunRequest) -> AgentRunResult | None:
        row = self._connection.execute(
            "SELECT request_hash, response_json FROM agent_runs WHERE run_id = ?", (request.runId,)
        ).fetchone()
        if row is None:
            return None
        if row["request_hash"] != self.request_hash(request):
            raise RequestConflictError("같은 runId에 다른 요청 payload가 전달되었습니다.")
        return AgentRunResult.model_validate_json(row["response_json"])

    def save_result(self, request: AgentRunRequest, result: AgentRunResult) -> None:
        self._connection.execute(
            "INSERT OR IGNORE INTO agent_runs(run_id, request_hash, response_json) VALUES (?, ?, ?)",
            (request.runId, self.request_hash(request), result.model_dump_json(by_alias=True, exclude_none=True)),
        )
        self._connection.commit()

    @staticmethod
    def thread_key(request: AgentRunRequest) -> str:
        dimensions: dict[str, Any] = {
            "tripId": request.tripId,
            "planVersion": request.planVersion,
            "role": request.agent.role,
            "participantId": request.agent.participantId,
            "debateIssueId": request.agent.debateIssueId,
            "category": request.agent.category,
        }
        return hashlib.sha256(json.dumps(dimensions, sort_keys=True).encode()).hexdigest()

    def validate_continuation(self, request: AgentRunRequest) -> None:
        if request.thread.mode != "CONTINUE":
            return
        row = self._connection.execute(
            "SELECT thread_id FROM agent_threads WHERE thread_key = ?", (self.thread_key(request),)
        ).fetchone()
        if row is None or row["thread_id"] != request.thread.threadId:
            raise RequestConflictError("threadId가 해당 Agent 격리 키와 일치하지 않습니다.")

    def bind_thread(self, request: AgentRunRequest, thread_id: str) -> None:
        key = self.thread_key(request)
        self._connection.execute(
            """
            INSERT INTO agent_threads(thread_key, thread_id) VALUES (?, ?)
            ON CONFLICT(thread_key) DO UPDATE SET thread_id = excluded.thread_id, updated_at = CURRENT_TIMESTAMP
            """,
            (key, thread_id),
        )
        self._connection.commit()

    def close(self) -> None:
        self._connection.close()
