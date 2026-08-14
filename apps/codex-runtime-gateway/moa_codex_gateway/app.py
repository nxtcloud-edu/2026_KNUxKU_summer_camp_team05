from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request

from .backend import SdkCodexBackend
from .models import AgentRunRequest, AgentRunResult
from .service import GatewayService
from .settings import GatewaySettings
from .store import GatewayStore, RequestConflictError


def create_app(
    *,
    service: GatewayService | None = None,
    settings: GatewaySettings | None = None,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        owned = service is None
        config = settings or GatewaySettings.from_env()
        runtime_service = service or GatewayService(
            config,
            SdkCodexBackend(),
            GatewayStore(config.database_path),
        )
        application.state.gateway = runtime_service
        yield
        if owned:
            await runtime_service.close()

    application = FastAPI(
        title="MOA Codex Runtime Gateway",
        version="0.1.0",
        lifespan=lifespan,
    )

    @application.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @application.get("/readyz")
    async def readyz(request: Request) -> dict[str, object]:
        result = await request.app.state.gateway.ready()
        if not result["ready"]:
            raise HTTPException(status_code=503, detail=result)
        return result

    @application.get("/internal/v1/models")
    async def models(request: Request) -> dict[str, object]:
        return await request.app.state.gateway.list_models()

    @application.post("/internal/v1/agent-runs", response_model=AgentRunResult)
    async def agent_run(payload: AgentRunRequest, request: Request) -> AgentRunResult:
        try:
            return await request.app.state.gateway.run(payload)
        except RequestConflictError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error

    return application


app = create_app()
