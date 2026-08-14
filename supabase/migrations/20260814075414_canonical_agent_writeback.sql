-- 에이전트 결과 기록 경로에 필요한 멱등성 제약과 조회 인덱스.
-- 근거: agent-architecture.md 12.1 · llm-runtime-config.md 3.3
--
-- 0001은 테이블만 만들었다. 잡이 재시도되면 같은 결과가 두 번 들어오는데,
-- 원가 원장과 양보 크레딧은 두 번 세면 값 자체가 틀린다. 여기서 막는다.

-- LLM 원가 원장 멱등 키. 같은 호출이 재시도로 두 번 기록되면 원가 실측이 무의미해진다.
ALTER TABLE llm_usage ADD COLUMN IF NOT EXISTS request_id text;

CREATE UNIQUE INDEX IF NOT EXISTS llm_usage_request_idx
  ON llm_usage (request_id)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS llm_usage_run_idx ON llm_usage (run_id);

-- 디스패치 결정은 (run, seq)로 유일하다. 폴백률 집계가 재시도로 부풀지 않게 한다.
CREATE UNIQUE INDEX IF NOT EXISTS dispatch_decisions_run_seq_idx
  ON dispatch_decisions (run_id, seq);

-- 양보 크레딧: 같은 방·사용자·라운드는 한 번만. round_id가 NULL인 수동 조정은 예외로 둔다.
CREATE UNIQUE INDEX IF NOT EXISTS concession_ledger_round_idx
  ON concession_ledger (room_id, user_id, round_id)
  WHERE round_id IS NOT NULL;

-- 후보는 라운드 안에서 external_id로 유일하다. 재조달이 행을 늘리지 않고 갱신한다.
CREATE UNIQUE INDEX IF NOT EXISTS candidates_round_external_idx
  ON candidates (round_id, external_id);

CREATE INDEX IF NOT EXISTS candidates_round_idx ON candidates (round_id);
CREATE INDEX IF NOT EXISTS messages_round_seq_idx ON messages (round_id, seq);
CREATE INDEX IF NOT EXISTS scores_round_idx ON scores (round_id);

-- 계획서는 방마다 버전이 올라간다. 같은 버전이 두 번 저장되지 않게 한다.
CREATE UNIQUE INDEX IF NOT EXISTS itineraries_room_version_idx
  ON itineraries (room_id, version);

CREATE INDEX IF NOT EXISTS approval_requests_room_idx
  ON approval_requests (room_id, responded_at);
