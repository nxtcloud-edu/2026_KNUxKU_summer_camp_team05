FROM python:3.12-slim

WORKDIR /opt/moa
COPY packages/agents packages/agents
COPY apps/codex-runtime-gateway apps/codex-runtime-gateway
RUN python -m pip install --no-cache-dir ./packages/agents ./apps/codex-runtime-gateway

ENV CODEX_HOME=/var/lib/moa-codex
EXPOSE 4600
CMD ["python", "-m", "moa_codex_gateway"]
