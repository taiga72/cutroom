// ClickUp → Splice & Co. (one way). Tasks assigned to you in the ClickUp workspaces you link to jobs
// become tasks in the app; ClickUp comments, status and due-date changes land in the task's Activity tab.
//
// ClickUp tokens are per workspace, so each linked workspace keeps its own (teams[{id,name,color,token,uid}], server only).
// Each job links one workspace (job.clickup = {team, mode}):
//   mode 'main' — the main task is the video; its subtasks and ClickUp checklists become checklist steps.
//   mode 'sub'  — main tasks are batches ("W2 Aug Reels"); each assigned subtask without assigned subtasks
//                 of its own is a task. The client comes from the nearest task up the chain with a Client field.
// Nothing is sent back to ClickUp. Fields the app owns are only overwritten when they change in ClickUp.
const { sb } = require('./_lib');

const API = 'https://api.clickup.com/api/v2';
const DAY = 864e5;
const FIRST_DAYS = 60;      // a task new to the app is imported when it was updated in ClickUp in the last 60 days
const WINDOW_DAYS = 180;    // how far back the assigned-task list goes (to tell batches from videos)
const BUDGET = 70;          // ClickUp allows 100 requests a minute per token; stay well under it in one run
const FEED_MAX = 80;

class NeedsToken extends Error {}
class RateLimited extends Error {}   // ClickUp's 100-requests-a-minute limit: stop and come back in a minute

function api(token) {
  return async function cu(path) {
    const r = await fetch(API + path, { headers: { Authorization: token } });
    const j = await r.json().catch(() => null);
    if (r.status === 401) throw new NeedsToken('ClickUp token was rejected');
    if (r.status === 429) throw new RateLimited('ClickUp rate limit');
    if (!r.ok) { const e = new Error(`ClickUp ${path} ${r.status} ${j && j.err || ''}`); e.status = r.status; throw e; }
    return j;
  };
}

const getLink = async uid => (await sb(`clickup_links?user_id=eq.${uid}&select=*`))[0] || null;
const saveLink = (uid, p) => sb(`clickup_links?user_id=eq.${uid}`, { method: 'PATCH', body: JSON.stringify(p) });

// Checks a personal token and lists the workspaces it can see.
async function whoAmI(token) {
  const cu = api(token);
  const { user } = await cu('/user');
  const { teams } = await cu('/team');
  return { user: { id: String(user.id), name: user.username || '', email: user.email || '', tz: user.timezone || '' },
    teams: (teams || []).map(t => ({ id: String(t.id), name: t.name || 'Workspace', color: t.color || '' })) };
}

/* ---------- mapping ---------- */
const norm = s => String(s || '').toLowerCase().replace(/[\s_\-]+/g, ' ').trim();
// ClickUp status name → one of the app's built-in status ids
function statusId(st) {
  const s = norm(st && st.status), type = st && st.type;
  if (type === 'closed' || type === 'done') return 'done';
  if (/client/.test(s) && /approv|accept|sign/.test(s)) return 'done';
  if (/^(approved|complete|completed|done|delivered|posted|published|scheduled|closed|final)$/.test(s)) return 'done';
  if (/revision|changes|feedback|fix/.test(s)) return 'revisions';
  if (/client/.test(s) && /review|sent|ready|waiting|reviewing/.test(s)) return 'client_review';
  if (/approved by team|team approved|approved internally|ready to send/.test(s)) return 'client_review';
  if (/review|qc|check/.test(s)) return 'internal_review';
  if (/progress|editing|working|doing|started|wip/.test(s) && !/not started/.test(s)) return 'in_progress';
  if (/wait|hold|blocked|pending|assets/.test(s)) return 'waiting_client';
  return 'not_started';
}
const PRIO = { urgent: 'urgent', high: 'high', normal: 'normal', low: 'low' };
const prioOf = t => PRIO[t.priority && t.priority.priority] || 'normal';
function ymdIn(ms, tz) {
  if (!ms) return '';
  const d = new Date(+ms);
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }
  catch (e) { return d.toISOString().slice(0, 10); }
}
// value of a "Client" custom field, as a name
function clientField(t) {
  const f = (t.custom_fields || []).find(x => /^client(s)?$/i.test(String(x.name || '').trim()));
  if (!f || f.value == null || f.value === '') return '';
  const v = f.value, opts = (f.type_config && f.type_config.options) || [];
  if (f.type === 'drop_down') { const o = opts.find(o => o.id === v || o.orderindex === v || String(o.orderindex) === String(v)); return o ? o.name : ''; }
  if (f.type === 'labels') { const ids = Array.isArray(v) ? v : [v]; return ids.map(id => (opts.find(o => o.id === id) || {}).label || '').filter(Boolean)[0] || ''; }
  if (Array.isArray(v)) return (v[0] && (v[0].name || v[0].username)) || '';
  return typeof v === 'string' ? v : '';
}
// ClickUp markdown → the app's notes (pictures dropped, links kept)
function notesFrom(t) {
  let s = String(t.markdown_description || t.text_content || t.description || '');
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\\([_*\[\]()#&-])/g, '$1').replace(/^\s*\*\s{2,}/gm, '- ').replace(/\n{3,}/g, '\n\n').trim();
  return s.slice(0, 8000);
}
function formatOf(t, notes, jobTasks) {
  const m = /\b(9:16|16:9|1:1|4:5)\b/.exec(notes) || /\b(9:16|16:9|1:1|4:5)\b/.exec(t.name || '');
  if (m) return m[1];
  if (/\b(reel|reels|short|shorts|tiktok|story)\b/i.test(t.name || '')) return '9:16';
  if (/\b(horizontal|long ?form|youtube)\b/i.test(notes)) return '16:9';
  const c = {}; jobTasks.forEach(x => { if (x.format) c[x.format] = (c[x.format] || 0) + 1; });
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || '16:9';
}
const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/* ---------- data access ---------- */
async function loadDocs(uid) {
  const out = { jobs: {}, clients: {}, tasks: {}, app: null };
  for (let from = 0; ; from += 1000) {
    const rows = await sb(`docs?user_id=eq.${uid}&col=in.(jobs,clients,tasks)&select=col,id,data&order=col,id`, { headers: { Range: `${from}-${from + 999}`, 'Range-Unit': 'items' } });
    rows.forEach(r => { out[r.col][r.id] = r.data; });
    if (rows.length < 1000) break;
  }
  out.app = ((await sb(`docs?user_id=eq.${uid}&col=eq.settings&id=eq.app&select=data`))[0] || {}).data || {};
  return out;
}
const putDocs = (uid, rows) => rows.length ? sb('docs', {
  method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  body: JSON.stringify(rows.map(r => ({ user_id: uid, col: r.col, id: r.id, data: r.data, updated_at: new Date().toISOString() })))
}) : null;

/* ---------- sync ---------- */
async function syncUser(uid) {
  const link = await getLink(uid);
  if (!link) return { connected: false };
  let cu = api(link.token), me = String(link.cu_user_id);
  let calls = 0;
  const call = async p => { calls++; return cu(p); };
  // a request that fails for any reason but the rate limit or the token counts as empty
  const soft = (p, empty) => call(p).catch(e => { if (e instanceof RateLimited || e instanceof NeedsToken) throw e; return empty; });
  const state = Object.assign({ seen: {}, parents: {} }, link.state || {});
  const tz = link.tz || 'UTC';
  const now = Date.now();
  const res = { connected: true, created: 0, updated: 0, more: false, docs: [] };
  try {
    const D = await loadDocs(uid);
    const okStatus = new Set((D.app.statuses && D.app.statuses.length ? D.app.statuses.map(s => s.id) : ['waiting_client', 'not_started', 'in_progress', 'internal_review', 'revisions', 'client_review', 'done']));
    const firstStatus = (D.app.statuses && D.app.statuses[0] && D.app.statuses[0].id) || 'not_started';
    const writes = new Map();
    const put = (col, id, data) => { writes.set(col + '/' + id, { col, id, data }); };
    const jobs = Object.entries(D.jobs).filter(([, j]) => j.clickup && j.clickup.team);

    // a task up the chain (cached between runs); used for the client and for main tasks not assigned to you
    async function parentInfo(id) {
      if (state.parents[id] && state.parents[id].at > now - 7 * DAY) return state.parents[id];
      if (calls >= BUDGET) return null;
      const t = await soft(`/task/${id}?include_markdown_description=true`, null);
      if (!t) return null;
      return (state.parents[id] = { at: now, name: t.name, client: clientField(t), parent: t.parent || null, task: t });
    }
    async function clientNameFor(t) {
      let c = clientField(t), p = t.parent, hops = 0;
      while (!c && p && hops++ < 4) { const info = await parentInfo(p); if (!info) break; c = info.client; p = info.parent; }
      return c;
    }
    function findClient(jobId, name) {
      const k = norm(name).replace(/\s*\(trial\)$/, '');
      if (!k) return null;
      return Object.entries(D.clients).find(([, c]) => c.jobId === jobId && norm(c.name).replace(/\s*\(trial\)$/, '') === k)?.[0] || null;
    }

    state.sum = state.sum || {};
    for (const [jobId, job] of jobs) {
      const team = String(job.clickup.team), mode = job.clickup.mode === 'sub' ? 'sub' : 'main';
      const ti = (link.teams || []).find(x => String(x.id) === team) || {};
      cu = api(ti.token || link.token); me = String(ti.uid || link.cu_user_id);
      const tsum = { at: now, failed: 0 };
      try {
      // every task assigned to you, updated in the window (subtasks included, closed ones too)
      const list = [];
      for (let page = 0; page < 8; page++) {
        const q = new URLSearchParams({ page: String(page), subtasks: 'true', include_closed: 'true', include_markdown_description: 'true', order_by: 'updated', date_updated_gt: String(now - WINDOW_DAYS * DAY) });
        q.append('assignees[]', me);
        const j = await call(`/team/${team}/task?${q}`);
        list.push(...(j.tasks || []));
        if (j.last_page || !(j.tasks || []).length) break;
      }
      const byId = new Map(list.map(t => [t.id, t]));
      const jobTasks = Object.values(D.tasks).filter(t => t.jobId === jobId);

      // which ClickUp tasks become app tasks
      const cands = new Map(); // cuId → {t, upd, kids:[]}
      if (mode === 'sub') {
        const parents = new Set(list.map(t => t.parent).filter(Boolean));
        list.filter(t => !parents.has(t.id)).forEach(t => cands.set(t.id, { t, upd: +t.date_updated, kids: [] }));
      } else {
        for (const t of list) {
          let rootId = t.id, cur = t, hops = 0;
          while (cur.parent && hops++ < 4) { rootId = cur.parent; cur = byId.get(cur.parent) || { id: cur.parent, parent: (state.parents[cur.parent] || {}).parent || null }; }
          const c = cands.get(rootId) || { t: byId.get(rootId) || null, upd: 0, kids: [] };
          c.upd = Math.max(c.upd, +t.date_updated);
          if (rootId !== t.id) c.kids.push(t);
          cands.set(rootId, c);
        }
      }

      for (const [cuId, c] of cands) {
        const linked = Object.entries(D.tasks).find(([, x]) => x.cu && x.cu.id === cuId) || (state.seen[cuId] && D.tasks[state.seen[cuId]] ? [state.seen[cuId], D.tasks[state.seen[cuId]]] : null);
        if (linked && linked[1].cu && linked[1].cu.v === 2 && +(linked[1].cu.at || 0) >= (state.redo || 0) && +linked[1].cu.upd >= c.upd) continue;      // nothing new in ClickUp
        if (!linked && state.seen[cuId]) continue;                              // deleted in the app: don't bring it back
        if (calls >= BUDGET - 3) { res.more = true; continue; }
        if (!c.t) { const info = await parentInfo(cuId); if (!info) { res.more = true; continue; } c.t = info.task; }
        const t = c.t, st = statusId(t.status);
        // a match by name in the same job (added by hand or from the CSV import) is linked instead of duplicated
        let existing = linked;
        if (!existing) {
          existing = Object.entries(D.tasks).find(([, x]) => x.jobId === jobId && !x.cu && !x.deleted && (x.clickupId === cuId || (x.links && String(x.links.task || '').includes(cuId)) || norm(x.name) === norm(t.name)));
          if (!existing && (st === 'done' || +c.upd < now - FIRST_DAYS * DAY)) continue; // old or finished: leave it in ClickUp
        }
        // details: subtasks and checklists for main tasks, comments for the Activity tab
        let detail = t;
        if (mode === 'main') detail = await soft(`/task/${cuId}?include_subtasks=true&include_markdown_description=true`, t);
        let readFail = false;
        const comments = ((await call(`/task/${cuId}/comment`).catch(e => {
          if (e instanceof RateLimited || e instanceof NeedsToken) throw e;
          readFail = true; tsum.failed++; tsum.msg = String(e.message || e).slice(0, 160); return { comments: [] };
        })).comments || []);
        const clientName = job.type === 'agency' ? await clientNameFor(t) : '';

        const prev = (existing && existing[1].cu) || {};
        const due = ymdIn(t.due_date, tz), start = ymdIn(t.start_date, tz), statusName = (t.status && t.status.status) || '';
        const feed = (prev.feed || []).slice();
        const seenC = new Set(feed.filter(f => f.cid).map(f => f.cid));
        const backfill = prev.v !== 2;
        const fresh = comments.filter(m => !seenC.has(String(m.id)) && (backfill || +m.date > (prev.lastComment || 0) || !existing))
          .sort((a, b) => +a.date - +b.date).slice(existing ? -40 : -12);
        for (const m of fresh) feed.push({ at: new Date(+m.date).toISOString(), k: 'comment', cid: String(m.id), who: (m.user && m.user.username) || 'Someone', me: String(m.user && m.user.id) === me, text: String(m.comment_text || '').trim().slice(0, 4000) });
        const iso = new Date(+t.date_updated || now).toISOString();
        if (existing && prev.status && prev.status !== statusName) feed.push({ at: iso, k: 'status', text: `Status in ClickUp: ${prev.status} → ${statusName}` });
        if (existing && prev.due !== undefined && prev.due !== due) feed.push({ at: iso, k: 'due', text: due ? `Due date in ClickUp: ${due}` : 'Due date removed in ClickUp' });
        feed.sort((a, b) => a.at.localeCompare(b.at));
        const lastComment = Math.max(prev.lastComment || 0, ...comments.map(m => +m.date || 0));
        const cuInfo = { v: readFail ? 1 : 2, at: now, id: cuId, team, url: t.url, status: statusName, due, prio: prioOf(t), name: t.name, upd: c.upd, lastComment, feed: feed.slice(-FEED_MAX) };

        // checklist steps from subtasks (main mode) and ClickUp checklists
        const steps = [];
        if (mode === 'main') {
          for (const s of (detail.subtasks || c.kids)) steps.push({ id: 'cu-' + s.id, text: s.name, done: statusId(s.status) === 'done' });
          for (const cl of (detail.checklists || [])) for (const it of (cl.items || [])) steps.push({ id: 'cu-' + it.id, text: it.name, done: !!it.resolved });
        }

        let clientId = null;
        if (clientName) {
          clientId = findClient(jobId, clientName);
          if (!clientId) {
            clientId = rid();
            D.clients[clientId] = { jobId, name: clientName, order: Object.values(D.clients).filter(x => x.jobId === jobId).length * 1000 + 1000, updated: now };
            put('clients', clientId, D.clients[clientId]);
          }
        }

        if (!existing) {
          const notes = notesFrom(detail);
          const id = rid(), mapped = okStatus.has(st) ? st : firstStatus;
          const data = { jobId, clientId, name: t.name, status: mapped, priority: prioOf(t), start, due, format: formatOf(t, notes, jobTasks), length: '', revision: 0,
            links: { task: t.url || '', upload: '', file: '', project: '' }, thumb: null, notes, checklist: steps, created: +t.date_created || now, updated: now, cu: cuInfo };
          if (mapped === 'done') data.doneAt = ymdIn(t.date_closed || t.date_updated, tz);
          D.tasks[id] = data; state.seen[cuId] = id; put('tasks', id, data); res.created++;
        } else {
          const [id, x] = existing, d = { ...x, cu: cuInfo, updated: now };
          if (!x.cu) { // linking a task made by hand: fill only what's missing
            d.links = { ...(x.links || {}), task: (x.links && x.links.task) || t.url || '' };
            if (!x.due && due) d.due = due;
            if (!x.clientId && clientId) d.clientId = clientId;
          } else {
            if (prev.name !== t.name) d.name = t.name;
            if (prev.status !== statusName && okStatus.has(st) && x.status !== st) {
              d.status = st;
              if (st === 'done' && !x.doneAt) d.doneAt = ymdIn(t.date_closed || t.date_updated, tz);
              if (st === 'revisions') d.revision = (x.revision || 0) + 1;
              if (st === 'in_progress' && !x.start) d.start = ymdIn(now, tz);
            }
            if (prev.due !== due) d.due = due;
            if (prev.prio !== cuInfo.prio) d.priority = cuInfo.prio;
          }
          if (steps.length) {
            const list2 = (x.checklist || []).map(s => ({ ...s })), at = new Map(list2.map((s, i) => [s.id, i]));
            for (const s of steps) { if (at.has(s.id)) Object.assign(list2[at.get(s.id)], { text: s.text, done: s.done }); else list2.push(s); }
            d.checklist = list2;
          }
          D.tasks[id] = d; state.seen[cuId] = id; put('tasks', id, d); res.updated++;
        }
      }
      const inApp = [...cands.keys()].filter(k => state.seen[k] && D.tasks[state.seen[k]]);
      const withComments = inApp.filter(k => ((D.tasks[state.seen[k]].cu || {}).feed || []).some(f => f.k === 'comment')).length;
      state.sum[team] = { ...tsum, assigned: list.length, videos: cands.size, inApp: inApp.length, withComments };
      } catch (e) {
        if (e instanceof NeedsToken) { state.sum[team] = { ...(state.sum[team] || {}), at: now, error: 'token' }; res.teamErrors = (res.teamErrors || 0) + 1; continue; }  // other workspaces still sync
        if (!(e instanceof RateLimited)) throw e;
        state.sum[team] = { ...(state.sum[team] || {}), ...tsum, pending: true };
        res.more = true; res.wait = 65; break;     // keep what was done; the page asks again in a minute
      }
    }
    const rows = [...writes.values()];
    await putDocs(uid, rows);
    res.docs = rows;
    // keep the parent cache small
    const pk = Object.keys(state.parents); if (pk.length > 400) pk.sort((a, b) => state.parents[a].at - state.parents[b].at).slice(0, pk.length - 400).forEach(k => delete state.parents[k]);
    for (const k in state.parents) delete state.parents[k].task;
    const allBad = jobs.length && res.teamErrors === jobs.length;
    await saveLink(uid, { state, last_sync: new Date().toISOString(), last_error: allBad ? 'token' : null });
    if (allBad) res.error = 'token';
    return res;
  } catch (e) {
    console.error(e);
    const code = e instanceof NeedsToken ? 'token' : 'failed';
    await saveLink(uid, { last_error: code }).catch(() => {});
    return { connected: true, error: code };
  }
}

module.exports = { RateLimited, api, whoAmI, getLink, saveLink, syncUser, statusId, clientField, notesFrom, ymdIn, NeedsToken };
