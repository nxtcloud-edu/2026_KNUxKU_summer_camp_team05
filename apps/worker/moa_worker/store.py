"""Worker 재시작 후에도 Job 상태와 사용자 대기를 보존하는 SQLite 저장소."""

from __future__ import annotations

import hashlib
import sqlite3
from pathlib import Path

from .models import WorkflowJob, WorkflowRecord, WorkflowStatus


class JobConflictError(ValueError):
    pass


class JobNotFoundError(KeyError):
    pass


class WorkerStore:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._connection = sqlite3.connect(path, check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        self._connection.executescript(
            """
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS workflow_jobs (
              job_id TEXT PRIMARY KEY,
              request_hash TEXT NOT NULL,
              request_json TEXT NOT NULL,
              status TEXT NOT NULL,
              result_json TEXT,
              pending_action_json TEXT,
              error_json TEXT,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            """
        )

    @staticmethod
    def _hash(job: WorkflowJob) -> str:
        return hashlib.sha256(job.model_dump_json(by_alias=True).encode()).hexdigest()

    def create(self, job: WorkflowJob) -> WorkflowRecord:
        row = self._connection.execute(
            "SELECT request_hash FROM workflow_jobs WHERE job_id = ?", (job.job_id,)
        ).fetchone()
        if row is not None:
            if row["request_hash"] != self._hash(job):
                raise JobConflictError("같은 jobId에 다른 요청 payload가 전달되었습니다.")
            return self.get(job.job_id)
        self._connection.execute(
            "INSERT INTO workflow_jobs(job_id, request_hash, request_json, status) VALUES (?, ?, ?, 'QUEUED')",
            (job.job_id, self._hash(job), job.model_dump_json(by_alias=True)),
        )
        self._connection.commit()
        return self.get(job.job_id)

    def get_job(self, job_id: str) -> WorkflowJob:
        row = self._connection.execute(
            "SELECT request_json FROM workflow_jobs WHERE job_id = ?", (job_id,)
        ).fetchone()
        if row is None:
            raise JobNotFoundError(job_id)
        return WorkflowJob.model_validate_json(row["request_json"])

    def get(self, job_id: str) -> WorkflowRecord:
        row = self._connection.execute(
            "SELECT * FROM workflow_jobs WHERE job_id = ?", (job_id,)
        ).fetchone()
        if row is None:
            raise JobNotFoundError(job_id)
        import json
        return WorkflowRecord(
            job_id=job_id,
            status=row["status"],
            result=json.loads(row["result_json"]) if row["result_json"] else None,
            pending_action=json.loads(row["pending_action_json"]) if row["pending_action_json"] else None,
            error=json.loads(row["error_json"]) if row["error_json"] else None,
        )

    def transition(
        self,
        job_id: str,
        status: WorkflowStatus,
        *,
        result: dict[str, object] | None = None,
        pending_action: dict[str, object] | None = None,
        error: dict[str, object] | None = None,
    ) -> WorkflowRecord:
        import json
        cursor = self._connection.execute(
            """
            UPDATE workflow_jobs
               SET status = ?, result_json = ?, pending_action_json = ?, error_json = ?, updated_at = CURRENT_TIMESTAMP
             WHERE job_id = ?
            """,
            (
                status,
                json.dumps(result, ensure_ascii=False) if result is not None else None,
                json.dumps(pending_action, ensure_ascii=False) if pending_action is not None else None,
                json.dumps(error, ensure_ascii=False) if error is not None else None,
                job_id,
            ),
        )
        if cursor.rowcount != 1:
            raise JobNotFoundError(job_id)
        self._connection.commit()
        return self.get(job_id)

    def recoverable_job_ids(self) -> list[str]:
        rows = self._connection.execute(
            "SELECT job_id FROM workflow_jobs WHERE status IN ('QUEUED', 'RUNNING') ORDER BY created_at"
        ).fetchall()
        return [row["job_id"] for row in rows]

    def close(self) -> None:
        self._connection.close()
