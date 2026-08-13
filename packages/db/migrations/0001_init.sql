-- 초기 스키마.
-- 근거: travel-mediation-plan.md 11.1 · agent-architecture.md 12.1
-- 원칙: 스키마가 흔들리는 것(설문 응답, 후보 payload, 판결문)은 jsonb로 두고,
--       조회·집계·제약이 필요한 것만 컬럼으로 뺀다.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id          text PRIMARY KEY,
  provider    text NOT NULL,
  nickname    text NOT NULL,
  avatar_url  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 목적지 Pack은 packs/*.json이 원본이고, 이 테이블은 런타임 캐시다.
CREATE TABLE IF NOT EXISTS destination_packs (
  pack_id     text PRIMARY KEY,
  coverage    text NOT NULL CHECK (coverage IN ('A','B','C')),
  active      boolean NOT NULL DEFAULT false,
  payload     jsonb NOT NULL,
  synced_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rooms (
  id            text PRIMARY KEY,
  host_id       text REFERENCES users(id),
  pack_id       text NOT NULL,
  title         text,
  status        text NOT NULL DEFAULT 'COLLECTING',
  -- 방장이 Setting 단계에서 고른 값 (운송수단·페이스·예산 등). 설문 v3 초안.
  setting       jsonb NOT NULL DEFAULT '{}'::jsonb,
  deadline_at   timestamptz,
  run_count     integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);

CREATE INDEX IF NOT EXISTS rooms_status_idx ON rooms (status);

CREATE TABLE IF NOT EXISTS room_members (
  id                    bigserial PRIMARY KEY,
  room_id               text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id               text NOT NULL,
  role                  text NOT NULL DEFAULT 'member',
  survey_status         text NOT NULL DEFAULT 'pending',
  persona_confirmed_at  timestamptz,
  joined_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, user_id)
);

-- 설문 응답 전문. 스키마가 자주 바뀌므로 payload는 jsonb로 두고 버전만 컬럼으로 뺀다.
CREATE TABLE IF NOT EXISTS surveys (
  id              text PRIMARY KEY,
  room_id         text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id         text NOT NULL,
  schema_version  integer NOT NULL,
  payload         jsonb NOT NULL,
  -- 안전 축은 별도 컬럼으로 승격한다. 코드 레벨 실격의 입력이며 조회가 잦다.
  allergens       text[] NOT NULL DEFAULT '{}',
  submitted_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, user_id)
);

CREATE TABLE IF NOT EXISTS personas (
  id            text PRIMARY KEY,
  room_id       text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id       text NOT NULL,
  card          jsonb NOT NULL,
  style         text,
  is_default    boolean NOT NULL DEFAULT false,
  revision      integer NOT NULL DEFAULT 1,
  confirmed_at  timestamptz,
  UNIQUE (room_id, user_id, revision)
);

CREATE TABLE IF NOT EXISTS date_resolutions (
  id                text PRIMARY KEY,
  room_id           text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  method            text NOT NULL,
  candidates        jsonb NOT NULL,
  chosen_start      date,
  chosen_end        date,
  nights            integer,
  attendees         jsonb NOT NULL DEFAULT '[]'::jsonb,
  absentees         jsonb NOT NULL DEFAULT '[]'::jsonb,
  score_breakdown   jsonb,
  resolved_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runs (
  id              text PRIMARY KEY,
  room_id         text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  seq             integer NOT NULL,
  trigger         text NOT NULL,
  status          text NOT NULL DEFAULT 'QUEUED',
  -- 이의로 시작된 재실행이면 어떤 이의인지
  objection_id    text,
  failure_reason  text,
  total_cost_usd  numeric(10,4) NOT NULL DEFAULT 0,
  started_at      timestamptz,
  finished_at     timestamptz,
  UNIQUE (room_id, seq)
);

CREATE TABLE IF NOT EXISTS rounds (
  id                text PRIMARY KEY,
  run_id            text NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  round_id          text NOT NULL,
  category          text NOT NULL,
  seq               integer NOT NULL,
  phase             text NOT NULL DEFAULT 'PENDING',
  budget_allocated  integer,
  rerun_count       integer NOT NULL DEFAULT 0,
  started_at        timestamptz,
  ended_at          timestamptz
);

CREATE INDEX IF NOT EXISTS rounds_run_idx ON rounds (run_id, seq);

-- Planning Graph. 상위 노드가 바뀌면 하위 노드는 삭제하지 않고 STALE로 전환한다.
CREATE TABLE IF NOT EXISTS planning_nodes (
  id                    bigserial PRIMARY KEY,
  run_id                text NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  node_id               text NOT NULL,
  version               integer NOT NULL DEFAULT 1,
  input_hash            text NOT NULL,
  dependency_versions   jsonb NOT NULL DEFAULT '{}'::jsonb,
  status                text NOT NULL DEFAULT 'PROVISIONAL',
  confidence            text NOT NULL DEFAULT 'unknown',
  evidence_refs         jsonb NOT NULL DEFAULT '[]'::jsonb,
  locked                boolean NOT NULL DEFAULT false,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, node_id, version)
);

CREATE INDEX IF NOT EXISTS planning_nodes_status_idx ON planning_nodes (run_id, status);

CREATE TABLE IF NOT EXISTS candidates (
  id                  text PRIMARY KEY,
  round_id            text NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  external_id         text NOT NULL,
  provider            text NOT NULL,
  payload             jsonb NOT NULL,
  disqualified        boolean NOT NULL DEFAULT false,
  disqualify_reason   text
);

CREATE TABLE IF NOT EXISTS messages (
  id            bigserial PRIMARY KEY,
  round_id      text NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  seq           integer NOT NULL,
  speaker_type  text NOT NULL CHECK (speaker_type IN ('persona','referee','supervisor','system')),
  speaker_id    text,
  content       text NOT NULL,
  refs          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (round_id, seq)
);

CREATE TABLE IF NOT EXISTS verdicts (
  id                text PRIMARY KEY,
  round_id          text NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  payload           jsonb NOT NULL,
  min_satisfaction  numeric(4,2),
  satisfaction_gap  numeric(4,2),
  review_result     text,
  review_reasons    jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scores (
  id            bigserial PRIMARY KEY,
  round_id      text NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  candidate_id  text NOT NULL,
  user_id       text NOT NULL,
  satisfaction  numeric(4,2) NOT NULL,
  breakdown     jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS concession_ledger (
  id        bigserial PRIMARY KEY,
  room_id   text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id   text NOT NULL,
  round_id  text,
  delta     numeric(5,3) NOT NULL,
  cc_after  numeric(5,3) NOT NULL
);

-- Supervisor 제안과 검증 결과. 폴백률 추적에 쓴다.
CREATE TABLE IF NOT EXISTS dispatch_decisions (
  id                 bigserial PRIMARY KEY,
  run_id             text NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  seq                integer NOT NULL,
  legal_moves        jsonb NOT NULL,
  proposal           jsonb,
  validation_result  jsonb,
  rejected_rules     jsonb NOT NULL DEFAULT '[]'::jsonb,
  fallback_used      boolean NOT NULL DEFAULT false,
  decided_by         text NOT NULL CHECK (decided_by IN ('supervisor','default')),
  latency_ms         integer,
  cost_usd           numeric(10,4),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS review_decisions (
  id             bigserial PRIMARY KEY,
  round_id       text NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  triggered      jsonb NOT NULL DEFAULT '[]'::jsonb,
  decision       text NOT NULL,
  instruction    text,
  machine_check  jsonb,
  -- Supervisor 판단이 기계 판정과 다른 경우. 프롬프트 회귀 추적용
  mismatch       boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- 이의 제기. 상한 계산에 쓰이므로 status를 컬럼으로 둔다.
CREATE TABLE IF NOT EXISTS objections (
  id                text PRIMARY KEY,
  room_id           text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id           text NOT NULL,
  target_round_id   text NOT NULL,
  target_category   text NOT NULL,
  kind              text NOT NULL,
  reason            text NOT NULL,
  request           jsonb NOT NULL,
  impact            jsonb,
  status            text NOT NULL DEFAULT 'submitted',
  reject_reason     text,
  run_id            text,
  outcome           jsonb,
  submitted_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz
);

CREATE INDEX IF NOT EXISTS objections_room_idx ON objections (room_id, status);
-- 같은 사용자가 같은 라운드에 중복 이의를 낼 수 없다 (거부·만료된 건은 제외)
CREATE UNIQUE INDEX IF NOT EXISTS objections_unique_target
  ON objections (room_id, user_id, target_round_id)
  WHERE status NOT IN ('rejected', 'expired');

CREATE TABLE IF NOT EXISTS approval_requests (
  id            text PRIMARY KEY,
  room_id       text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  type          text NOT NULL,
  options       jsonb NOT NULL DEFAULT '[]'::jsonb,
  objection_id  text,
  raised_at     timestamptz NOT NULL DEFAULT now(),
  responded_at  timestamptz,
  response      jsonb
);

CREATE TABLE IF NOT EXISTS itineraries (
  id                 text PRIMARY KEY,
  room_id            text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  run_id             text NOT NULL,
  version            integer NOT NULL DEFAULT 1,
  plan               jsonb NOT NULL,
  budget_summary     jsonb,
  validation_report  jsonb,
  published_at       timestamptz
);

-- Data Agent 호출 로그. 캐시 적중률·폴백률·fail-closed 차단 추적.
CREATE TABLE IF NOT EXISTS data_requests (
  id               bigserial PRIMARY KEY,
  run_id           text,
  round_id         text,
  caller_id        text NOT NULL,
  query_class      text NOT NULL,
  purpose          text NOT NULL,
  canonical_hash   text NOT NULL,
  cache_hit        boolean NOT NULL DEFAULT false,
  confidence       text,
  degraded         boolean NOT NULL DEFAULT false,
  fallback_reason  text,
  provider         text,
  latency_ms       integer,
  cost_usd         numeric(10,4),
  response_hash    text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS data_requests_class_idx ON data_requests (query_class, created_at);

-- 방 간 공유 캐시. 같은 Pack·같은 시기 조회를 재사용한다.
CREATE TABLE IF NOT EXISTS pack_cache (
  cache_key      text PRIMARY KEY,
  pack_id        text NOT NULL,
  query_class    text NOT NULL,
  payload        jsonb NOT NULL,
  source         text NOT NULL,
  confidence     text NOT NULL,
  terms_ref      text,
  raw_ref        text,
  retrieved_at   timestamptz NOT NULL DEFAULT now(),
  valid_until    timestamptz
);

CREATE INDEX IF NOT EXISTS pack_cache_expiry_idx ON pack_cache (query_class, valid_until);

CREATE TABLE IF NOT EXISTS llm_usage (
  id              bigserial PRIMARY KEY,
  room_id         text,
  run_id          text,
  round_id        text,
  purpose         text NOT NULL,
  model           text NOT NULL,
  prompt_version  text,
  input_tokens    integer NOT NULL DEFAULT 0,
  output_tokens   integer NOT NULL DEFAULT 0,
  cache_tokens    integer NOT NULL DEFAULT 0,
  latency_ms      integer,
  cost_usd        numeric(10,4) NOT NULL DEFAULT 0,
  batch           boolean NOT NULL DEFAULT false,
  fallback_reason text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS llm_usage_room_idx ON llm_usage (room_id, created_at);
