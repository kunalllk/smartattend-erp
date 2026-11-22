const { createClient } = require('@supabase/supabase-js');

function getSupabaseServer(useServiceRole = true) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = useServiceRole
    ? (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '')
    : (process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '');

  if (!supabaseUrl || !key) {
    return null;
  }

  return createClient(supabaseUrl, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

// Extract bearer token from Authorization header
function getBearerToken(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader) return null;
  const parts = authHeader.split(' ');
  return parts.length === 2 && parts[0].toLowerCase() === 'bearer' ? parts[1] : null;
}

// Authenticate caller from JWT
async function authenticateUser(req) {
  const token = getBearerToken(req);
  if (!token) return { user: null, error: 'Authorization header with Bearer token missing' };

  const supabase = getSupabaseServer(false);
  if (!supabase) return { user: null, error: 'Supabase configuration missing on server' };

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return { user: null, error: error ? error.message : 'Invalid user token' };
  }

  return { user, error: null };
}

module.exports = {
  getSupabaseServer,
  getBearerToken,
  authenticateUser,
};
