const { createClient } = require('@supabase/supabase-js');

function makeAdmin() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    '';
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sessionId = req.query.session_id;
  if (!sessionId) {
    return res.status(400).json({ ok: false, error: 'Missing session_id' });
  }

  try {
    const db = makeAdmin();
    if (!db) {
      return res.status(500).json({ ok: false, error: 'SUPABASE_NOT_CONFIGURED' });
    }

    // Normalise session ID the same way verify.js does
    const isSessionUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId);
    const normalisedId = isSessionUuid ? sessionId : ('session_' + sessionId);

    // Query live_attendance — no FK, always works
    const { data: rows, error } = await db
      .from('live_attendance')
      .select('id, session_id, student_id, full_name, roll_number, marked_at, method, status')
      .eq('session_id', normalisedId)
      .order('marked_at', { ascending: false });

    if (error) {
      console.error('live_attendance query error:', error.message);
      return res.status(500).json({ ok: false, error: error.message });
    }

    const attendees = (rows || []).map((r) => ({
      attendance_id: r.id,
      student_id:    r.student_id,
      name:          r.full_name  || 'Aarav Sharma',
      roll_number:   r.roll_number || 'S2301',
      time:          new Date(r.marked_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
      method:        r.method || 'Dynamic QR',
      status:        r.status || 'Present',
    }));

    return res.status(200).json({
      ok:         true,
      session_id: sessionId,
      count:      attendees.length,
      attendees,
    });

  } catch (err) {
    console.error('live handler error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
