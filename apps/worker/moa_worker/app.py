"""Worker Job 제출·조회·재개 API."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Request

from moa_agents.runtime import CodexAgentRuntime, HttpCodexGatewayClient

from .models import ResumeRequest, WorkflowJob, WorkflowRecord
from .orchestrator import WorkflowOrchestrator
from .settings import WorkerSettings
from .store import JobConflictError, JobNotFoundError, WorkerStore


def create_app(
    *,
    orchestrator: WorkflowOrchestrator | None = None,
    gateway_client: HttpCodexGatewayClient | None = None,
    settings: WorkerSettings | None = None,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(application: FastAPI):
        config = settings or WorkerSettings.from_env()
        owned = orchestrator is None
        client = gateway_client
        if orchestrator is None:
            client = client or HttpCodexGatewayClient(config.gateway_url)
            runtime = CodexAgentRuntime(client)
            runtime_orchestrator = WorkflowOrchestrator(runtime, WorkerStore(config.database_path))
        else:
            runtime_orchestrator = orchestrator
        application.state.orchestrator = runtime_orchestrator
        application.state.gateway_client = client
        application.state.tasks = set()
        if owned:
            for job_id in runtime_orchestrator.store.recoverable_job_ids():
                task = asyncio.create_task(runtime_orchestrator.process(job_id), name=f"moa-recovery:{job_id}")
                application.state.tasks.add(task)
                task.add_done_callback(application.state.tasks.discard)
        yield
        tasks = list(application.state.tasks)
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        if owned:
            runtime_orchestrator.store.close()
            if client is not None:
                await client.aclose()

    application = FastAPI(title="MOA Agent Worker", version="0.1.0", lifespan=lifespan)

    @application.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @application.get("/readyz")
    async def readyz(request: Request) -> dict[str, object]:
        client = request.app.state.gateway_client
        ready = True if client is None else await client.ready()
        if not ready:
            raise HTTPException(status_code=503, detail={"ready": False, "gateway": False})
        return {"ready": True, "gateway": True}

    @application.post("/internal/v1/jobs", response_model=WorkflowRecord)
    async def submit_job(
        payload: WorkflowJob,
        request: Request,
        wait: bool = Query(default=False, description="로컬 검증용 동기 대기"),
    ) -> WorkflowRecord:
        worker: WorkflowOrchestrator = request.app.state.orchestrator
        try:
            record = worker.store.create(payload)
        except JobConflictError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        if record.status != "QUEUED":
            return record
        if wait:
            return await worker.process(payload.job_id)
        task = asyncio.create_task(worker.process(payload.job_id), name=f"moa-job:{payload.job_id}")
        request.app.state.tasks.add(task)
        task.add_done_callback(request.app.state.tasks.discard)
        return record

    @application.get("/internal/v1/jobs/{job_id}", response_model=WorkflowRecord)
    async def get_job(job_id: str, request: Request) -> WorkflowRecord:
        try:
            return request.app.state.orchestrator.store.get(job_id)
        except JobNotFoundError as error:
            raise HTTPException(status_code=404, detail="Job을 찾을 수 없습니다.") from error

    @application.post("/internal/v1/jobs/{job_id}/resume", response_model=WorkflowRecord)
    async def resume_job(job_id: str, payload: ResumeRequest, request: Request) -> WorkflowRecord:
        try:
            return await request.app.state.orchestrator.resume(job_id, payload)
        except JobNotFoundError as error:
            raise HTTPException(status_code=404, detail="Job을 찾을 수 없습니다.") from error
        except ValueError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error

    return application


app = create_app()
