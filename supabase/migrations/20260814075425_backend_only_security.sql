DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'schema_migrations',
    'users',
    'destination_packs',
    'rooms',
    'room_members',
    'surveys',
    'personas',
    'date_resolutions',
    'runs',
    'rounds',
    'planning_nodes',
    'candidates',
    'messages',
    'verdicts',
    'scores',
    'concession_ledger',
    'dispatch_decisions',
    'review_decisions',
    'objections',
    'approval_requests',
    'itineraries',
    'data_requests',
    'pack_cache',
    'llm_usage'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
  END LOOP;
END
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
