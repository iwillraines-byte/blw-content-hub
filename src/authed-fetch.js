// Small helper for calling our /api/ endpoints WITH the user's JWT attached.
//
// Endpoints that implement requireUser() in api/_supabase.js will reject
// requests missing the Authorization header with 401. For public / legacy
// endpoints that still use the service_role directly this header is simply
// ignored — so using authedFetch is always safe.

import { supabase, supabaseConfigured } from './supabase-client';

export async function authedFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (supabaseConfigured) {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(url, { ...options, headers });
}

// JSON convenience — parses the body, throws Error(detail) on non-2xx.
export async function authedJson(url, options = {}) {
  const res = await authedFetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body && typeof options.body !== 'string'
      ? JSON.stringify(options.body)
      : options.body,
  });
  let body = null;
  try { body = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const msg = body?.error || body?.detail || `${res.status} ${res.statusText}`;
    const err = new Error(msg);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}
