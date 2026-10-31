// api/_cc-planned.js — planned posts that live only on the Command Center.
//
// These are posts the team intends to make that are NOT in Metricool (yet):
// they show on the Command Center calendar and nowhere else. Nothing here is
// ever sent to Metricool or any social network.
//
// Stored as one JSON row in the existing app_settings table
// (key "cc-planned-posts"), so no migration is needed. Writes are applied as
// small operations (add / update / delete one post) against a fresh read, so
// two people editing different posts at once don't overwrite each other.
//
// Roles: master_admin, admin and content may read and write (the same roles
// that can open the Command Center).

const KEY = 'cc-planned-posts';
const NETS = ['instagram', 'tiktok', 'facebook', 'twitter', 'youtube', 'linkedin', 'threads'];
const TYPES = ['POST', 'REEL', 'CAROUSEL', 'STORY', 'VIDEO', 'SHORT', 'THREAD'];
const STATUSES = ['idea', 'in-progress', 'ready'];
const KEEP_DAYS = 60; // planned posts older than this are dropped on the next write

async function readAll(sb) {
  const { data, error } = await sb.from('app_settings').select('value, updated_at').eq('key', KEY).maybeSingle();
  if (error) throw new Error(error.message);
  const posts = data && data.value && Array.isArray(data.value.posts) ? data.value.posts : [];
  return { posts, updatedAt: data ? data.updated_at : null };
}

function clean(input, existing) {
  const p = input || {};
  const date = String(p.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('date must be YYYY-MM-DD');
  const time = p.time ? String(p.time) : '';
  if (time && !/^\d{2}:\d{2}$/.test(time)) throw new Error('time must be HH:MM');
  const blogId = String(p.blogId || '');
  if (!/^\d{3,12}$/.test(blogId)) throw new Error('pick a brand');
  const networks = (Array.isArray(p.networks) ? p.networks : []).map(String).filter(n => NETS.includes(n));
  const type = TYPES.includes(String(p.type || '').toUpperCase()) ? String(p.type).toUpperCase() : 'POST';
  const status = STATUSES.includes(p.status) ? p.status : 'idea';
  const text = String(p.text || '').slice(0, 1500);
  const title = String(p.title || '').slice(0, 120);
  return { ...(existing || {}), blogId, date, time, networks, type, status, title, text };
}

export async function plannedHandler(req, res, ctx) {
  const sb = ctx.sb;
  if (!sb) { res.status(503).json({ error: 'Supabase not configured' }); return; }
  try {
    if (req.method === 'GET') {
      const { posts } = await readAll(sb);
      res.status(200).json({ posts });
      return;
    }
    if (req.method !== 'POST') { res.status(405).json({ error: 'GET or POST' }); return; }
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const op = String((body && body.op) || '');
    const who = (ctx.profile && (ctx.profile.display_name || ctx.profile.email)) || 'someone';
    const nowIso = new Date().toISOString();
    const { posts } = await readAll(sb);
    let next = posts.slice(), saved = null;
    if (op === 'add') {
      saved = { id: `pp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, ...clean(body.post), createdBy: who, createdAt: nowIso, updatedAt: nowIso };
      next.push(saved);
    } else if (op === 'update') {
      const i = next.findIndex(p => p.id === (body.post && body.post.id));
      if (i < 0) { res.status(404).json({ error: 'That planned post no longer exists' }); return; }
      saved = { ...clean(body.post, next[i]), id: next[i].id, updatedBy: who, updatedAt: nowIso };
      next[i] = saved;
    } else if (op === 'delete') {
      next = next.filter(p => p.id !== String(body.id || ''));
    } else {
      res.status(400).json({ error: 'op must be add, update or delete' });
      return;
    }
    const cutoff = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
    next = next.filter(p => p.date >= cutoff).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
    const { error } = await sb.from('app_settings').upsert(
      { key: KEY, value: { posts: next }, updated_at: nowIso, updated_by: ctx.user.id },
      { onConflict: 'key' },
    );
    if (error) throw new Error(error.message);
    res.status(200).json({ posts: next, saved });
  } catch (e) {
    res.status(400).json({ error: String((e && e.message) || e) });
  }
}
