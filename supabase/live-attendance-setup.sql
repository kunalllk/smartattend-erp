-- ============================================================
-- SmartAttend: Live Attendance Table (No FK Constraints)
-- Run this in Supabase SQL Editor → Run
-- ============================================================

-- Drop old blocked tables from memory approach
-- This table has ZERO foreign key constraints intentionally
-- It is the source of truth for the faculty live dashboard

CREATE TABLE IF NOT EXISTS live_attendance (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  TEXT NOT NULL,         -- the QR session UUID (stored as text, no FK)
  student_id  TEXT NOT NULL,         -- student UUID or roll number (stored as text, no FK)
  full_name   TEXT NOT NULL DEFAULT 'Unknown Student',
  roll_number TEXT NOT NULL DEFAULT 'N/A',
  marked_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  method      TEXT NOT NULL DEFAULT 'Dynamic QR',
  status      TEXT NOT NULL DEFAULT 'Present',
  CONSTRAINT unique_live_session_student UNIQUE (session_id, student_id)
);

-- Disable RLS so service-role key can always read/write
ALTER TABLE live_attendance DISABLE ROW LEVEL SECURITY;

-- Allow anon + authenticated + service_role full access
GRANT ALL ON TABLE live_attendance TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- Also fix permissions on existing tables
ALTER TABLE IF EXISTS attendance        DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS lecture_sessions  DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS attendance_tokens DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS profiles          DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS classes           DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS subjects          DISABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE attendance        TO anon, authenticated, service_role;
GRANT ALL ON TABLE lecture_sessions  TO anon, authenticated, service_role;
GRANT ALL ON TABLE attendance_tokens TO anon, authenticated, service_role;
GRANT ALL ON TABLE profiles          TO anon, authenticated, service_role;
GRANT ALL ON TABLE classes           TO anon, authenticated, service_role;
GRANT ALL ON TABLE subjects          TO anon, authenticated, service_role;

-- Done. The live_attendance table has no FK constraints and is fully open.
