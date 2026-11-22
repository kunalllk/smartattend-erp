const { getSupabaseServer } = require('./lib/supabaseServer');

const DEMO_USERS = {
  student: {
    email: 'aarav.sharma@smartattend.edu',
    password: 'DemoStudentPassword2026!',
    full_name: 'Aarav Sharma',
    roll_number: 'S2301',
    role: 'student',
  },
  faculty: {
    email: 'meera.kulkarni@smartattend.edu',
    password: 'DemoFacultyPassword2026!',
    full_name: 'Dr. Meera Kulkarni',
    roll_number: null,
    role: 'faculty',
  },
  admin: {
    email: 'rohan.deshmukh@smartattend.edu',
    password: 'DemoAdminPassword2026!',
    full_name: 'Prof. Rohan Deshmukh',
    roll_number: null,
    role: 'admin',
  },
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const role = req.query.role || req.body?.role || 'student';
  const target = DEMO_USERS[role];

  if (!target) {
    return res.status(400).json({ ok: false, error: 'Invalid role specified' });
  }

  try {
    const supabaseAdmin = getSupabaseServer(true);
    if (!supabaseAdmin) {
      // In offline / preview environment without Supabase credentials yet,
      // return a synthetic authenticated profile so frontend runs seamlessly
      return res.status(200).json({
        ok: true,
        offline_demo: true,
        user: {
          id: role === 'student' ? '11111111-1111-1111-1111-111111111111' : role === 'faculty' ? '22222222-2222-2222-2222-222222222222' : '33333333-3333-3333-3333-333333333333',
          email: target.email,
          user_metadata: {
            full_name: target.full_name,
            roll_number: target.roll_number,
            role: target.role,
          },
        },
        profile: {
          id: role === 'student' ? '11111111-1111-1111-1111-111111111111' : role === 'faculty' ? '22222222-2222-2222-2222-222222222222' : '33333333-3333-3333-3333-333333333333',
          full_name: target.full_name,
          roll_number: target.roll_number,
          role: target.role,
          class_section: 'CSE-3A',
        },
      });
    }

    // Try signing in
    const { data: signInData, error: signInErr } = await supabaseAdmin.auth.signInWithPassword({
      email: target.email,
      password: target.password,
    });

    if (signInData?.session) {
      return res.status(200).json({
        ok: true,
        session: signInData.session,
        user: signInData.user,
      });
    }

    // If sign in fails, create user via Admin API
    const { data: createData, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: target.email,
      password: target.password,
      email_confirm: true,
      user_metadata: {
        full_name: target.full_name,
        roll_number: target.roll_number,
        role: target.role,
      },
    });

    if (createErr && !createErr.message.includes('already registered')) {
      console.warn('Could not create user, falling back to simulated profile:', createErr.message);
      return res.status(200).json({
        ok: true,
        user: {
          id: role === 'student' ? '11111111-1111-1111-1111-111111111111' : role === 'faculty' ? '22222222-2222-2222-2222-222222222222' : '33333333-3333-3333-3333-333333333333',
          email: target.email,
          user_metadata: {
            full_name: target.full_name,
            roll_number: target.roll_number,
            role: target.role,
          },
        },
        profile: {
          id: role === 'student' ? '11111111-1111-1111-1111-111111111111' : role === 'faculty' ? '22222222-2222-2222-2222-222222222222' : '33333333-3333-3333-3333-333333333333',
          full_name: target.full_name,
          roll_number: target.roll_number,
          role: target.role,
          class_section: 'CSE-3A',
        },
      });
    }

    // Ensure profile entry exists
    const userId = createData?.user?.id;
    if (userId) {
      try {
        await supabaseAdmin.from('profiles').upsert({
          id: userId,
          full_name: target.full_name,
          roll_number: target.roll_number,
          role: target.role,
          email: target.email,
        });
      } catch (e) {}
    }

    // Now sign in to get valid session tokens
    const { data: newSession, error: newSessionErr } = await supabaseAdmin.auth.signInWithPassword({
      email: target.email,
      password: target.password,
    });

    return res.status(200).json({
      ok: true,
      session: newSession?.session,
      user: newSession?.user || {
        id: userId || '11111111-1111-1111-1111-111111111111',
        email: target.email,
        user_metadata: { full_name: target.full_name, role: target.role },
      },
      profile: {
        id: userId || '11111111-1111-1111-1111-111111111111',
        full_name: target.full_name,
        roll_number: target.roll_number,
        role: target.role,
        class_section: 'CSE-3A',
      },
    });
  } catch (err) {
    console.warn('Demo auth fallback on error:', err.message);
    return res.status(200).json({
      ok: true,
      offline_demo: true,
      user: {
        id: role === 'student' ? '11111111-1111-1111-1111-111111111111' : role === 'faculty' ? '22222222-2222-2222-2222-222222222222' : '33333333-3333-3333-3333-333333333333',
        email: target.email,
        user_metadata: { full_name: target.full_name, role: target.role },
      },
      profile: {
        id: role === 'student' ? '11111111-1111-1111-1111-111111111111' : role === 'faculty' ? '22222222-2222-2222-2222-222222222222' : '33333333-3333-3333-3333-333333333333',
        full_name: target.full_name,
        roll_number: target.roll_number,
        role: target.role,
        class_section: 'CSE-3A',
      },
    });
  }
};
