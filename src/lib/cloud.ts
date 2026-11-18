import type { SupabaseClient } from '@supabase/supabase-js';

// Sign-in and sync go through JobBoard's own Supabase project (docs/SETUP.md). The publishable key
// is meant to be public: it only allows what the database's row-level security allows a signed-in
// person to do with their own board.
//
// While the key is empty, sign-in is switched off: the Settings section is hidden and the page
// works exactly as before, with everything in this browser only.
export const SUPABASE_URL: string = '';
export const SUPABASE_PUBLISHABLE_KEY: string = '';

export const cloudConfigured = SUPABASE_URL !== '' && SUPABASE_PUBLISHABLE_KEY !== '';

/** The project's short id, which Supabase uses to name what it keeps in this browser. */
const projectRef = (() => {
  try { return new URL(SUPABASE_URL).hostname.split('.')[0]; } catch { return ''; }
})();

/**
 * Has this browser ever started signing in here (a session, or a sign-in link on its way)?
 * Until it has, the page doesn't load the Supabase code or contact Supabase at all.
 */
export function signInStarted(): boolean {
  if (!cloudConfigured) return false;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      if (localStorage.key(i)?.startsWith(`sb-${projectRef}-`)) return true;
    }
  } catch { /* storage blocked */ }
  return false;
}

let client: Promise<SupabaseClient> | null = null;

/** The Supabase client, loaded on first use so people who never sign in don't download it. */
export function cloud(): Promise<SupabaseClient> {
  return (client ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, detectSessionInUrl: true, flowType: 'pkce' },
    })));
}
