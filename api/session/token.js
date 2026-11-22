const crypto = require('crypto');
const { getSupabaseServer } = require('../lib/supabaseServer');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const sessionId = req.method === 'GET' ? req.query.session_id : req.body?.session_id;

  if (!sessionId) {
    return res.status(400).json({ ok: false, error: 'Missing session_id' });
  }

  try {
    const supabaseAdmin = getSupabaseServer(true);
    if (!supabaseAdmin) {
      return res.status(500).json({ ok: false, error: 'Supabase configuration missing' });
    }

    // Verify session is active
    const { data: session, error: sessErr } = await supabaseAdmin
      .from('lecture_sessions')
      .select('id, status, ble_session_identifier, expires_at')
      .eq('id', sessionId)
      .maybeSingle();

    if (sessErr || !session) {
      return res.status(404).json({ ok: false, error: 'Lecture session not found' });
    }

    if (session.status !== 'live') {
      return res.status(400).json({ ok: false, error: 'Lecture session is not live' });
    }

    const now = new Date();
    if (new Date(session.expires_at) < now) {
      await supabaseAdmin.from('lecture_sessions').update({ status: 'completed', ended_at: now.toISOString() }).eq('id', sessionId);
      return res.status(400).json({ ok: false, error: 'Lecture session has expired' });
    }

    // Generate new short-lived dynamic token
    const tokenNonce = crypto.randomBytes(12).toString('hex');
    const tokenPlaintext = `${sessionId}:${Math.floor(Date.now() / 1000)}:${tokenNonce}`;
    const tokenHash = crypto.createHash('sha256').update(tokenPlaintext).digest('hex');
    const tokenExpiresAt = new Date(Date.now() + 18000); // 18s validity

    const { error: insErr } = await supabaseAdmin.from('attendance_tokens').insert({
      session_id: sessionId,
      token_hash: tokenHash,
      created_at: now.toISOString(),
      expires_at: tokenExpiresAt.toISOString(),
    });

    if (insErr) {
      return res.status(500).json({ ok: false, error: insErr.message });
    }

    // Prune expired tokens older than 1 minute
    const oneMinAgo = new Date(Date.now() - 60000).toISOString();
    supabaseAdmin.from('attendance_tokens').delete().eq('session_id', sessionId).lt('expires_at', oneMinAgo).then(() => {});

    return res.status(200).json({
      ok: true,
      session_id: sessionId,
      token: tokenPlaintext,
      ble_session_identifier: session.ble_session_identifier,
      ttl: 15,
      expires_at: tokenExpiresAt.toISOString(),
    });
  } catch (err) {
    console.error('Token generation error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
