// Vercel serverless function: emails the master admin when someone signs up.
//
// "Just email me on signup" — called fire-and-forget by /register after a
// successful signUpWithPassword. No auth required (the registrant has no
// session yet), so it's hardened against abuse instead:
//   1. The email must correspond to a profiles row created in the last
//      15 minutes (the db/003 trigger inserts one on auth signup). Random
//      spam POSTs that never signed up send nothing.
//   2. Responses are uniform 200s — the endpoint never reveals whether an
//      email exists.
//
// Env vars (Vercel):
//   RESEND_API_KEY — from resend.com (free tier covers this easily)
//   NOTIFY_EMAIL   — where signup alerts go (the master's inbox)
//   RESEND_FROM    — optional; defaults to Resend's shared onboarding
//                    sender, which delivers to the account owner's email
//                    without domain verification.

import { getServiceClient } from './_supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST required' }); return; }

  // Uniform response — callers can't distinguish outcomes.
  const done = () => res.status(200).json({ ok: true });

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    const email = String(body?.email || '').trim().toLowerCase().slice(0, 200);
    if (!email || !email.includes('@')) { done(); return; }

    const apiKey = process.env.RESEND_API_KEY;
    const to = process.env.NOTIFY_EMAIL;
    if (!apiKey || !to) { done(); return; } // not configured — silent no-op

    const sb = getServiceClient();
    if (!sb) { done(); return; }

    // Abuse guard: only notify for a signup that actually just happened.
    const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { data: rows, error } = await sb.from('profiles')
      .select('id, email, role, created_at')
      .eq('email', email)
      .gte('created_at', cutoff)
      .limit(1);
    if (error || !rows?.length) { done(); return; }
    const profile = rows[0];

    const from = process.env.RESEND_FROM || 'BLW Studio <onboarding@resend.dev>';
    const when = new Date(profile.created_at).toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `New BLW Studio signup: ${email}`,
        text:
          `Someone just created a BLW Studio account.\n\n` +
          `Email: ${email}\n` +
          `Default role: ${profile.role || 'athlete'}\n` +
          `Signed up: ${when} ET\n\n` +
          `Manage their role in People Admin: https://blwstudio.com/settings\n`,
      }),
    }).catch(() => {});

    done();
  } catch {
    done();
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '8kb' } },
};
