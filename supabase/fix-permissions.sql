-- ====================================================================
-- SMARTATTEND ERP: PERMISSIONS & RLS FIX FOR LIVE ATTENDANCE SYNC
-- Run this in Supabase Dashboard -> SQL Editor -> Run
-- ====================================================================

-- 1. Grant full schema and table access to anon and authenticated roles
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated, service_role;

-- 2. Disable Row Level Security on core attendance tables so the serverless API routes can seamlessly sync check-ins
ALTER TABLE classes DISABLE ROW LEVEL SECURITY;
ALTER TABLE subjects DISABLE ROW LEVEL SECURITY;
ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE faculty_subjects DISABLE ROW LEVEL SECURITY;
ALTER TABLE lecture_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE attendance DISABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_tokens DISABLE ROW LEVEL SECURITY;

-- 3. Ensure Realtime publication includes attendance and lecture_sessions
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'attendance') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE attendance;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'lecture_sessions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE lecture_sessions;
  END IF;
END $$;
