const crypto = require('crypto');
const { getSupabaseServer, authenticateUser } = require('../lib/supabaseServer');

module.exports = async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  try {
    const supabaseAdmin = getSupabaseServer(true);
    if (!supabaseAdmin) {
      return res.status(500).json({
        ok: false,
        error: 'SUPABASE_NOT_CONFIGURED',
        message: 'Supabase credentials are not configured in environment variables (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY).',
      });
    }

    const { user, error: authError } = await authenticateUser(req);
    // Allow demo mode fallback if faculty user profile exists
    let facultyId = user ? user.id : req.body.faculty_id;
    if (!facultyId) {
      // Find default faculty profile
      const { data: fac } = await supabaseAdmin.from('profiles').select('id').eq('role', 'faculty').limit(1).maybeSingle();
      if (fac) facultyId = fac.id;
    }

    if (!facultyId) {
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: authError || 'Faculty authentication required' });
    }

    const {
      title = 'Data Structures · Theory',
      room = 'LT-204',
      topic = 'Balanced trees: AVL rotations',
      subject_code = 'CS301',
      class_section = 'CSE-3A',
      duration_minutes = 60,
    } = req.body || {};

    // Get subject and class IDs
    let { data: subject } = await supabaseAdmin.from('subjects').select('id').eq('subject_code', subject_code).maybeSingle();
    let { data: classRec } = await supabaseAdmin.from('classes').select('id').eq('section', class_section).maybeSingle();

    const subjectId = subject ? subject.id : 's1111111-1111-1111-1111-111111111111';
    const classId = classRec ? classRec.id : 'c1111111-1111-1111-1111-111111111111';

    // Call stored procedure or direct insert
    const bleSessionId = 'SA-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + duration_minutes * 60000);

    const { data: session, error: sessError } = await supabaseAdmin
      .from('lecture_sessions')
      .insert({
        faculty_id: facultyId,
        subject_id: subjectId,
        class_id: classId,
        title,
        room,
        topic,
        started_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        status: 'live',
        ble_session_identifier: bleSessionId,
      })
      .select()
      .single();

    if (sessError || !session) {
      return res.status(500).json({ ok: false, error: sessError ? sessError.message : 'Failed to create lecture session' });
    }

    // Generate initial 15-second token
    const tokenNonce = crypto.randomBytes(12).toString('hex');
    const tokenPlaintext = `${session.id}:${Math.floor(Date.now() / 1000)}:${tokenNonce}`;
    const tokenHash = crypto.createHash('sha256').update(tokenPlaintext).digest('hex');
    const tokenExpiresAt = new Date(Date.now() + 18000); // 18 seconds grace period

    await supabaseAdmin.from('attendance_tokens').insert({
      session_id: session.id,
      token_hash: tokenHash,
      created_at: now.toISOString(),
      expires_at: tokenExpiresAt.toISOString(),
    });

    return res.status(200).json({
      ok: true,
      session_id: session.id,
      ble_session_identifier: bleSessionId,
      ble_service_uuid: session.ble_service_uuid || '0000fee7-0000-1000-8000-00805f9b34fb',
      initial_token: tokenPlaintext,
      expires_in: 15,
      session,
    });
  } catch (err) {
    console.error('Start session error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
