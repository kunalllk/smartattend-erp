const { getSupabaseServer } = require('../lib/supabaseServer');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const sessionId = req.body?.session_id;
  if (!sessionId) {
    return res.status(400).json({ ok: false, error: 'Missing session_id' });
  }

  try {
    const supabaseAdmin = getSupabaseServer(true);
    if (!supabaseAdmin) {
      return res.status(500).json({ ok: false, error: 'Supabase configuration missing' });
    }

    const now = new Date();
    const { error: updErr } = await supabaseAdmin
      .from('lecture_sessions')
      .update({
        status: 'completed',
        ended_at: now.toISOString(),
      })
      .eq('id', sessionId);

    if (updErr) {
      return res.status(500).json({ ok: false, error: updErr.message });
    }

    // Invalidate tokens
    await supabaseAdmin.from('attendance_tokens').delete().eq('session_id', sessionId);

    // Count attendance
    const { count } = await supabaseAdmin
      .from('attendance')
      .select('*', { count: 'exact', head: true })
      .eq('lecture_session_id', sessionId);

    return res.status(200).json({
      ok: true,
      session_id: sessionId,
      ended_at: now.toISOString(),
      present_count: count || 0,
      message: 'Lecture session ended successfully.',
    });
  } catch (err) {
    console.error('End session error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
