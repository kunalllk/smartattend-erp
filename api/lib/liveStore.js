// Shared in-memory active session and attendee store across serverless calls
global.__SMARTATTEND_LIVE_SESSIONS__ = global.__SMARTATTEND_LIVE_SESSIONS__ || {};
global.__SMARTATTEND_ATTENDEES__ = global.__SMARTATTEND_ATTENDEES__ || {};
global.__SMARTATTEND_RECENT_ATTENDEES__ = global.__SMARTATTEND_RECENT_ATTENDEES__ || [];

function recordAttendee(sessionId, attendee) {
  if (!sessionId || !attendee) return;
  
  if (!global.__SMARTATTEND_ATTENDEES__[sessionId]) {
    global.__SMARTATTEND_ATTENDEES__[sessionId] = [];
  }
  
  // Prevent duplicate insertion in memory
  const exists = global.__SMARTATTEND_ATTENDEES__[sessionId].some(
    (a) => a.student_id === attendee.student_id || (attendee.roll_number && a.roll_number === attendee.roll_number)
  );
  if (!exists) {
    global.__SMARTATTEND_ATTENDEES__[sessionId].unshift(attendee);
  }

  // Also maintain in global recent pool
  const recentExists = global.__SMARTATTEND_RECENT_ATTENDEES__.some(
    (a) => a.student_id === attendee.student_id && a.time === attendee.time
  );
  if (!recentExists) {
    global.__SMARTATTEND_RECENT_ATTENDEES__.unshift({
      ...attendee,
      sessionId,
      markedAtMs: Date.now(),
    });
    if (global.__SMARTATTEND_RECENT_ATTENDEES__.length > 50) {
      global.__SMARTATTEND_RECENT_ATTENDEES__.pop();
    }
  }
}

function getAttendees(sessionId) {
  const list = (sessionId && global.__SMARTATTEND_ATTENDEES__[sessionId]) ? global.__SMARTATTEND_ATTENDEES__[sessionId] : [];
  
  // Also include any attendee recorded in the last 15 minutes
  const now = Date.now();
  const recent = global.__SMARTATTEND_RECENT_ATTENDEES__.filter(
    (a) => now - (a.markedAtMs || now) < 15 * 60 * 1000
  );

  const merged = [...list];
  recent.forEach((r) => {
    if (!merged.some((m) => m.student_id === r.student_id || (r.roll_number && m.roll_number === r.roll_number))) {
      merged.push({
        attendance_id: r.attendance_id,
        student_id: r.student_id,
        name: r.name,
        roll_number: r.roll_number,
        time: r.time,
        method: r.method,
        status: r.status || 'Present',
      });
    }
  });

  return merged;
}

function setActiveSession(session) {
  if (!session || !session.id) return;
  global.__SMARTATTEND_LIVE_SESSIONS__[session.id] = session;
  global.__SMARTATTEND_ACTIVE_SESSION__ = session;
}

function getActiveSession(sessionId) {
  if (sessionId && global.__SMARTATTEND_LIVE_SESSIONS__[sessionId]) {
    return global.__SMARTATTEND_LIVE_SESSIONS__[sessionId];
  }
  return global.__SMARTATTEND_ACTIVE_SESSION__ || null;
}

module.exports = {
  recordAttendee,
  getAttendees,
  setActiveSession,
  getActiveSession,
};
