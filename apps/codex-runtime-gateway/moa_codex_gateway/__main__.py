from __future__ import annotations

import uvicorn

from .settings import GatewaySettings


def main() -> None:
    settings = GatewaySettings.from_env()
    uvicorn.run("moa_codex_gateway.app:app", host=settings.host, port=settings.port, factory=False)


if __name__ == "__main__":
    main()
