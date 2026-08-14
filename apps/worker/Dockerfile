FROM python:3.12-slim

WORKDIR /opt/moa
COPY packages/agents packages/agents
COPY apps/worker apps/worker
RUN python -m pip install --no-cache-dir ./packages/agents ./apps/worker

EXPOSE 4700
CMD ["python", "-m", "moa_worker"]
