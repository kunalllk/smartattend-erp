-- ====================================================================
-- SMARTATTEND ERP: COMPLETE POSTGRESQL DATABASE SCHEMA
-- Two-Factor Attendance (Dynamic QR + Bluetooth Low Energy)
-- Compatible with Supabase Database, Auth & Realtime
-- ====================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Clean existing if re-running
DROP TABLE IF EXISTS attendance_tokens CASCADE;
DROP TABLE IF EXISTS attendance CASCADE;
DROP TABLE IF EXISTS lecture_sessions CASCADE;
DROP TABLE IF EXISTS faculty_subjects CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;
DROP TABLE IF EXISTS subjects CASCADE;
DROP TABLE IF EXISTS classes CASCADE;

-- ====================================================================
-- 2. TABLES
-- ====================================================================

-- Academic Classes / Sections
CREATE TABLE classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,                  -- e.g. 'Computer Science & Engineering'
  section TEXT NOT NULL UNIQUE,        -- e.g. 'CSE-3A'
  academic_year TEXT NOT NULL,         -- e.g. '2026-2027'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Academic Subjects
CREATE TABLE subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_code TEXT NOT NULL UNIQUE,   -- e.g. 'CS301'
  subject_name TEXT NOT NULL,          -- e.g. 'Data Structures'
  department TEXT NOT NULL DEFAULT 'CSE',
  credits INT NOT NULL DEFAULT 4,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User Profiles (linked directly to Supabase auth.users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  roll_number TEXT UNIQUE,             -- e.g. 'S2301' (null for faculty/admin)
  role TEXT NOT NULL CHECK (role IN ('student', 'faculty', 'admin')),
  class_id UUID REFERENCES classes(id) ON DELETE SET NULL,
  email TEXT UNIQUE,
  phone TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Faculty-Subject-Class Allocations
CREATE TABLE faculty_subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  faculty_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_faculty_allocation UNIQUE (faculty_id, subject_id, class_id)
);

-- Active & Historical Lecture Sessions
CREATE TABLE lecture_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  faculty_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  title TEXT NOT NULL,                 -- e.g. 'Data Structures · Theory'
  room TEXT NOT NULL,                  -- e.g. 'LT-204'
  topic TEXT,                          -- e.g. 'Balanced trees: AVL rotations'
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,     -- Session hard-stop time
  status TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('upcoming', 'live', 'completed', 'cancelled')),
  ble_session_identifier TEXT NOT NULL,-- Ephemeral UUID or beacon identifier for this lecture
  ble_service_uuid TEXT NOT NULL DEFAULT '0000fee7-0000-1000-8000-00805f9b34fb',
  ble_rssi_threshold INT NOT NULL DEFAULT -75, -- Minimum RSSI in dBm (~5-10 meters proximity)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dynamic Short-Lived QR Tokens (15-second rotating validity)
CREATE TABLE attendance_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES lecture_sessions(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,            -- SHA256 hash of plaintext token
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,     -- Valid for ~15-20 seconds
  used BOOLEAN NOT NULL DEFAULT false
);

-- Verified Attendance Records
CREATE TABLE attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  lecture_session_id UUID NOT NULL REFERENCES lecture_sessions(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  marked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  qr_verified BOOLEAN NOT NULL DEFAULT true,
  ble_verified BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'Present' CHECK (status IN ('Present', 'Absent', 'Late')),
  verification_metadata JSONB DEFAULT '{}'::jsonb, -- Stores RSSI, client user-agent, IP, device info
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- CRITICAL CONSTRAINT: Prevent duplicate attendance marking
  CONSTRAINT unique_student_session UNIQUE (lecture_session_id, student_id)
);

-- ====================================================================
-- 3. INDEXES FOR PERFORMANCE
-- ====================================================================
CREATE INDEX idx_attendance_student ON attendance(student_id);
CREATE INDEX idx_attendance_session ON attendance(lecture_session_id);
CREATE INDEX idx_attendance_subject ON attendance(subject_id);
CREATE INDEX idx_sessions_faculty ON lecture_sessions(faculty_id);
CREATE INDEX idx_sessions_class ON lecture_sessions(class_id);
CREATE INDEX idx_sessions_status ON lecture_sessions(status);
CREATE INDEX idx_tokens_session_hash ON attendance_tokens(session_id, token_hash);
CREATE INDEX idx_tokens_expires ON attendance_tokens(expires_at);

-- ====================================================================
-- 4. REALTIME REPLICATION SETUP
-- ====================================================================
-- Enable Realtime publication so faculty screen automatically syncs
ALTER PUBLICATION supabase_realtime ADD TABLE attendance;
ALTER PUBLICATION supabase_realtime ADD TABLE lecture_sessions;

-- ====================================================================
-- 5. ROW LEVEL SECURITY (RLS) POLICIES
-- ====================================================================
ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE faculty_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE lecture_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_tokens ENABLE ROW LEVEL SECURITY;

-- Profiles: Authenticated users can read all profiles; only own user can edit profile
CREATE POLICY "Profiles readable by authenticated users"
  ON profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id);

-- Classes & Subjects: Read-only for authenticated users
CREATE POLICY "Classes readable by authenticated"
  ON classes FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Subjects readable by authenticated"
  ON subjects FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Faculty subjects readable by authenticated"
  ON faculty_subjects FOR SELECT
  TO authenticated
  USING (true);

-- Lecture Sessions:
-- 1. Anyone authenticated can read active sessions
-- 2. Faculty can create/update sessions they own
CREATE POLICY "Sessions readable by authenticated"
  ON lecture_sessions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Faculty can insert own sessions"
  ON lecture_sessions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = faculty_id);

CREATE POLICY "Faculty can update own sessions"
  ON lecture_sessions FOR UPDATE
  TO authenticated
  USING (auth.uid() = faculty_id);

-- Attendance:
-- 1. Students can view their own attendance
-- 2. Faculty can view attendance for sessions they taught
-- 3. Service role / verification endpoint inserts records
CREATE POLICY "Students can view own attendance"
  ON attendance FOR SELECT
  TO authenticated
  USING (
    auth.uid() = student_id OR
    EXISTS (
      SELECT 1 FROM lecture_sessions ls
      WHERE ls.id = attendance.lecture_session_id AND ls.faculty_id = auth.uid()
    ) OR
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

CREATE POLICY "Service and faculty can insert attendance"
  ON attendance FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM lecture_sessions ls
      WHERE ls.id = lecture_session_id AND ls.faculty_id = auth.uid()
    )
  );

-- Tokens: Highly restricted, managed by server functions
CREATE POLICY "Tokens readable by session faculty"
  ON attendance_tokens FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM lecture_sessions ls
      WHERE ls.id = attendance_tokens.session_id AND ls.faculty_id = auth.uid()
    )
  );

-- ====================================================================
-- 6. STORED PROCEDURES & BUSINESS LOGIC
-- ====================================================================

-- Function: Start Lecture Session
CREATE OR REPLACE FUNCTION start_lecture(
  p_faculty_id UUID,
  p_subject_id UUID,
  p_class_id UUID,
  p_title TEXT,
  p_room TEXT,
  p_topic TEXT,
  p_duration_minutes INT DEFAULT 60
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session_id UUID;
  v_ble_id TEXT;
  v_token TEXT;
  v_token_hash TEXT;
  v_now TIMESTAMPTZ := now();
  v_expires_at TIMESTAMPTZ := v_now + (p_duration_minutes || ' minutes')::INTERVAL;
  v_token_expires TIMESTAMPTZ := v_now + INTERVAL '18 seconds';
BEGIN
  -- Generate unique BLE session identifier
  v_ble_id := 'SA-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  -- Insert lecture session
  INSERT INTO lecture_sessions (
    faculty_id, subject_id, class_id, title, room, topic,
    started_at, expires_at, status, ble_session_identifier
  ) VALUES (
    p_faculty_id, p_subject_id, p_class_id, p_title, p_room, p_topic,
    v_now, v_expires_at, 'live', v_ble_id
  )
  RETURNING id INTO v_session_id;

  -- Generate initial QR token string (format: session_id:timestamp:random_nonce)
  v_token := v_session_id || ':' || extract(epoch from v_now)::bigint || ':' || encode(gen_random_bytes(12), 'hex');
  v_token_hash := encode(digest(v_token, 'sha256'), 'hex');

  -- Store token hash
  INSERT INTO attendance_tokens (session_id, token_hash, created_at, expires_at)
  VALUES (v_session_id, v_token_hash, v_now, v_token_expires);

  RETURN jsonb_build_object(
    'session_id', v_session_id,
    'ble_session_identifier', v_ble_id,
    'initial_token', v_token,
    'expires_in_seconds', 18,
    'status', 'live'
  );
END;
$$;

-- Function: Generate Rotating Dynamic QR Token (Called every 15s by faculty screen)
CREATE OR REPLACE FUNCTION generate_next_qr_token(
  p_session_id UUID,
  p_faculty_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session lecture_sessions%ROWTYPE;
  v_token TEXT;
  v_token_hash TEXT;
  v_now TIMESTAMPTZ := now();
  v_token_expires TIMESTAMPTZ := v_now + INTERVAL '18 seconds';
BEGIN
  -- Validate session exists, is owned by faculty, and is currently live
  SELECT * INTO v_session FROM lecture_sessions
  WHERE id = p_session_id AND faculty_id = p_faculty_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found or unauthorized';
  END IF;

  IF v_session.status <> 'live' THEN
    RAISE EXCEPTION 'Session is not live';
  END IF;

  IF v_session.expires_at < v_now THEN
    UPDATE lecture_sessions SET status = 'completed', ended_at = v_now WHERE id = p_session_id;
    RAISE EXCEPTION 'Session has expired';
  END IF;

  -- Generate new token plaintext
  v_token := p_session_id || ':' || extract(epoch from v_now)::bigint || ':' || encode(gen_random_bytes(12), 'hex');
  v_token_hash := encode(digest(v_token, 'sha256'), 'hex');

  -- Insert token hash
  INSERT INTO attendance_tokens (session_id, token_hash, created_at, expires_at)
  VALUES (p_session_id, v_token_hash, v_now, v_token_expires);

  -- Cleanup old expired tokens for this session
  DELETE FROM attendance_tokens
  WHERE session_id = p_session_id AND expires_at < (v_now - INTERVAL '1 minute');

  RETURN jsonb_build_object(
    'session_id', p_session_id,
    'token', v_token,
    'ble_session_identifier', v_session.ble_session_identifier,
    'expires_at', v_token_expires,
    'ttl_seconds', 18
  );
END;
$$;

-- Function: Verify Two-Factor Attendance (Server-side validation)
CREATE OR REPLACE FUNCTION verify_two_factor_attendance(
  p_student_id UUID,
  p_token_string TEXT,
  p_detected_ble_identifier TEXT,
  p_detected_rssi INT,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session_id UUID;
  v_token_hash TEXT;
  v_session lecture_sessions%ROWTYPE;
  v_student profiles%ROWTYPE;
  v_now TIMESTAMPTZ := now();
  v_token_rec attendance_tokens%ROWTYPE;
  v_already_marked BOOLEAN;
BEGIN
  -- 1. Extract session_id from token string (format: session_id:timestamp:nonce)
  BEGIN
    v_session_id := split_part(p_token_string, ':', 1)::UUID;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'INVALID_TOKEN_FORMAT', 'message', 'Invalid QR code structure.');
  END;

  -- 2. Validate Student Profile & Class Enrollment
  SELECT * INTO v_student FROM profiles WHERE id = p_student_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'STUDENT_NOT_FOUND', 'message', 'Student profile not found.');
  END IF;

  IF v_student.role <> 'student' THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'NOT_A_STUDENT', 'message', 'Only students can mark attendance.');
  END IF;

  -- 3. Validate Lecture Session Exists and is Active
  SELECT * INTO v_session FROM lecture_sessions WHERE id = v_session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'SESSION_NOT_FOUND', 'message', 'Attendance session does not exist.');
  END IF;

  IF v_session.status <> 'live' THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'SESSION_INACTIVE', 'message', 'This lecture has already ended or is not live.');
  END IF;

  IF v_session.expires_at < v_now THEN
    UPDATE lecture_sessions SET status = 'completed', ended_at = v_now WHERE id = v_session_id;
    RETURN jsonb_build_object('ok', false, 'error_code', 'SESSION_EXPIRED', 'message', 'This lecture session has expired.');
  END IF;

  -- 4. Validate Student belongs to the Class/Section
  IF v_student.class_id IS NOT NULL AND v_session.class_id IS NOT NULL AND v_student.class_id <> v_session.class_id THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'WRONG_CLASS', 'message', 'This lecture belongs to a different class section.');
  END IF;

  -- 5. Check if Attendance already marked (Duplicate Prevention)
  SELECT EXISTS (
    SELECT 1 FROM attendance WHERE lecture_session_id = v_session_id AND student_id = p_student_id
  ) INTO v_already_marked;

  IF v_already_marked THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'ALREADY_MARKED', 'message', 'Attendance has already been recorded for this lecture.');
  END IF;

  -- 6. FACTOR 1: Validate Dynamic QR Code Token & Expiry
  v_token_hash := encode(digest(p_token_string, 'sha256'), 'hex');

  SELECT * INTO v_token_rec FROM attendance_tokens
  WHERE session_id = v_session_id AND token_hash = v_token_hash;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'INVALID_QR_TOKEN', 'message', 'Invalid QR token. Ensure you scanned the live faculty screen.');
  END IF;

  IF v_token_rec.expires_at < v_now THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'EXPIRED_QR_TOKEN', 'message', 'QR token expired (older than 15 seconds). Scan the current code.');
  END IF;

  -- 7. FACTOR 2: Validate Bluetooth Low Energy (BLE) Proximity
  IF p_detected_ble_identifier IS NULL OR p_detected_ble_identifier = '' THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'BLE_MISSING', 'message', 'Bluetooth Low Energy signal not detected. Classroom beacon required.');
  END IF;

  IF p_detected_ble_identifier <> v_session.ble_session_identifier THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'BLE_MISMATCH', 'message', 'Detected Bluetooth beacon belongs to a different classroom.');
  END IF;

  -- Validate RSSI proximity threshold (e.g. >= -80 dBm indicates within ~10m)
  IF p_detected_rssi IS NOT NULL AND p_detected_rssi < v_session.ble_rssi_threshold THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'BLE_TOO_FAR', 'message', 'BLE signal too weak (' || p_detected_rssi || ' dBm). You must be inside the classroom.');
  END IF;

  -- 8. RECORD ATTENDANCE
  INSERT INTO attendance (
    student_id, lecture_session_id, subject_id, marked_at,
    qr_verified, ble_verified, status, verification_metadata
  ) VALUES (
    p_student_id, v_session_id, v_session.subject_id, v_now,
    true, true, 'Present',
    jsonb_build_object(
      'rssi', p_detected_rssi,
      'ble_identifier', p_detected_ble_identifier,
      'verified_at', v_now,
      'client_meta', p_metadata
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'message', 'Attendance marked successfully.',
    'session_id', v_session_id,
    'marked_at', to_char(v_now, 'HH12:MI AM'),
    'room', v_session.room,
    'title', v_session.title,
    'factor1', 'QR Verified',
    'factor2', 'BLE Proximity Verified (' || COALESCE(p_detected_rssi::text, 'OK') || ' dBm)'
  );
END;
$$;

-- Function: End Lecture
CREATE OR REPLACE FUNCTION end_lecture(
  p_session_id UUID,
  p_faculty_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_present_count INT;
  v_total_class INT;
BEGIN
  -- Mark session completed
  UPDATE lecture_sessions
  SET status = 'completed', ended_at = v_now
  WHERE id = p_session_id AND faculty_id = p_faculty_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found or unauthorized';
  END IF;

  -- Invalidate all active tokens for this session
  DELETE FROM attendance_tokens WHERE session_id = p_session_id;

  -- Calculate summary stats
  SELECT count(*) INTO v_present_count FROM attendance WHERE lecture_session_id = p_session_id;
  SELECT count(*) INTO v_total_class FROM profiles WHERE class_id = (SELECT class_id FROM lecture_sessions WHERE id = p_session_id);

  RETURN jsonb_build_object(
    'ok', true,
    'session_id', p_session_id,
    'ended_at', v_now,
    'present_count', v_present_count,
    'total_students', v_total_class
  );
END;
$$;

-- ====================================================================
-- 7. SEED DATA (Academic Structure & Demonstration Accounts)
-- ====================================================================

-- Seed Classes
INSERT INTO classes (id, name, section, academic_year) VALUES
  ('c1111111-1111-1111-1111-111111111111', 'Computer Science & Engineering', 'CSE-3A', '2026-2027'),
  ('c2222222-2222-2222-2222-222222222222', 'Computer Science & Engineering', 'CSE-3B', '2026-2027'),
  ('c3333333-3333-3333-3333-333333333333', 'Information Technology', 'IT-3A', '2026-2027')
ON CONFLICT (section) DO NOTHING;

-- Seed Subjects
INSERT INTO subjects (id, subject_code, subject_name, department) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'CS301', 'Data Structures', 'CSE'),
  ('a2222222-2222-2222-2222-222222222222', 'CS302', 'Database Management Systems', 'CSE'),
  ('a3333333-3333-3333-3333-333333333333', 'CS303', 'Operating Systems', 'CSE'),
  ('a4444444-4444-4444-4444-444444444444', 'CS304', 'Computer Networks', 'CSE'),
  ('a5555555-5555-5555-5555-555555555555', 'CS305', 'Software Engineering', 'CSE')
ON CONFLICT (subject_code) DO NOTHING;

-- Trigger: When a new auth.users record is created, automatically generate corresponding profile
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_role TEXT := COALESCE(new.raw_user_meta_data->>'role', 'student');
  v_full_name TEXT := COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1));
  v_roll_number TEXT := new.raw_user_meta_data->>'roll_number';
  v_class_id UUID := (SELECT id FROM classes WHERE section = 'CSE-3A' LIMIT 1);
BEGIN
  INSERT INTO public.profiles (id, full_name, roll_number, role, class_id, email)
  VALUES (new.id, v_full_name, v_roll_number, v_role, v_class_id, new.email)
  ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      roll_number = EXCLUDED.roll_number,
      role = EXCLUDED.role,
      class_id = EXCLUDED.class_id;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
