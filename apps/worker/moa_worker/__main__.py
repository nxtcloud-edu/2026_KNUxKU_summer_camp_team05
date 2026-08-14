from __future__ import annotations

import uvicorn

from .settings import WorkerSettings


def main() -> None:
    settings = WorkerSettings.from_env()
    uvicorn.run("moa_worker.app:app", host=settings.host, port=settings.port, factory=False)


if __name__ == "__main__":
    main()
