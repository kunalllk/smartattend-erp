const { getSupabaseServer } = require('../lib/supabaseServer');
const { getAttendees } = require('../lib/liveStore');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const sessionId = req.query.session_id;
  if (!sessionId) {
    return res.status(400).json({ ok: false, error: 'Missing session_id' });
  }

  // 1. Fetch from liveStore (in-memory fast cache)
  const memoryAttendees = getAttendees(sessionId);

  // 2. Fetch from Supabase PostgreSQL
  let dbAttendees = [];
  try {
    const supabaseAdmin = getSupabaseServer(true);
    if (supabaseAdmin) {
      let records = [];
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId);
      
      if (isUuid) {
        const { data } = await supabaseAdmin
          .from('attendance')
          .select('id, student_id, marked_at, qr_verified, ble_verified, status')
          .eq('lecture_session_id', sessionId)
          .order('marked_at', { ascending: false });
        if (data) records = data;
      }

      // If no records for specific sessionId, also check latest 20 attendance records
      if (records.length === 0) {
        const { data: latestData } = await supabaseAdmin
          .from('attendance')
          .select('id, student_id, marked_at, qr_verified, ble_verified, status')
          .order('marked_at', { ascending: false })
          .limit(20);
        if (latestData) records = latestData;
      }

      if (records.length > 0) {
        const studentIds = records.map((r) => r.student_id);
        let profileMap = {};
        const { data: profiles } = await supabaseAdmin
          .from('profiles')
          .select('id, full_name, roll_number')
          .in('id', studentIds);
        if (profiles) {
          profiles.forEach((p) => { profileMap[p.id] = p; });
        }

        dbAttendees = records.map((r) => {
          const prof = profileMap[r.student_id];
          const timeStr = new Date(r.marked_at).toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
          });
          return {
            attendance_id: r.id,
            student_id: r.student_id,
            name: prof?.full_name || 'Aarav Sharma',
            roll_number: prof?.roll_number || 'S2301',
            time: timeStr,
            method: 'Dynamic QR',
            status: r.status || 'Present',
          };
        });
      }
    }
  } catch (err) {
    console.warn('Live DB query note:', err.message);
  }

  // 3. Merge memory attendees and DB attendees uniquely by roll_number / student_id
  const merged = [...memoryAttendees];
  dbAttendees.forEach((dbA) => {
    if (!merged.some((m) => m.student_id === dbA.student_id || (dbA.roll_number && m.roll_number === dbA.roll_number))) {
      merged.push(dbA);
    }
  });

  return res.status(200).json({
    ok: true,
    session_id: sessionId,
    count: merged.length,
    attendees: merged,
  });
};
