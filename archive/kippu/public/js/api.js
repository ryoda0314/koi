/* Talks to Supabase. Every device signs in anonymously; opening a share link joins the space.
   The app sees the same doc/collection calls as before: a live mirror of every document in the
   space, kept current by Realtime, plus presence, ♡, photos and the GPT-5.2 helper. */
import CONFIG from "/config.js";

const sb = window.supabase && CONFIG.supabaseUrl && CONFIG.supabaseKey
  ? window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, { auth: { storageKey: "ftk-auth", persistSession: true, autoRefreshToken: true } })
  : null;
export const configured = () => !!sb;

const KNOWN = ["not_found", "permission_denied", "invalid_argument", "too_large", "quota_exceeded", "resource_exhausted", "bad_passcode", "not_signed_in"];
function errOf(e) {
  if (!e) return { code: "error" };
  if (e.name === "AbortError") return { code: "cancelled" };
  const msg = String(e.message || "");
  if (KNOWN.includes(msg)) return { code: msg, status: /missing/.test(e.details || "") ? 404 : undefined, details: e.details };
  if (/fetch|network|Failed to|Load failed/i.test(msg) || e.status === 0) return { code: "unavailable" };
  return { code: "error", message: msg };
}

let session = null;
async function signIn() {
  if (!sb) throw { code: "not_configured" };
  if (session) return session;
  const cur = await sb.auth.getSession();
  if (cur.data.session) return (session = cur.data.session);
  const r = await sb.auth.signInAnonymously();
  if (r.error) throw r.error.status === 429 ? { code: "resource_exhausted" } : errOf(r.error);
  return (session = r.data.session);
}
sb && sb.auth.onAuthStateChange((_e, s) => { session = s; });

async function rpc(name, args) {
  await signIn();
  const r = await sb.rpc(name, args);
  if (r.error) throw errOf(r.error);
  return r.data;
}

export async function getConfig() {
  const [info, ai] = await Promise.all([
    sb.rpc("app_info").then(r => r.data || {}, () => ({})),
    aiStatus(),
  ]);
  return { needPasscode: !!info.need_passcode, ai };
}
export async function createSpace(passcode) {
  const r = await rpc("create_space", { passcode });
  return { editToken: r.edit_token };
}
/* open a share link: returns { spaceId, role, editToken?, viewToken?, uid, ai } */
export async function getInfo(token) {
  const [r, ai] = await Promise.all([rpc("join_space", { token }), aiStatus()]);
  return { spaceId: r.space_id, role: r.role, editToken: r.edit_token, viewToken: r.view_token, uid: session && session.user.id, ai: ai && r.role === "edit" };
}

const FN = () => `${CONFIG.supabaseUrl}/functions/v1/ai`;
async function aiStatus() {
  try {
    const r = await fetch(FN(), { headers: { apikey: CONFIG.supabaseKey } });
    return r.ok && !!(await r.json()).ai;
  } catch (e) { return false; }
}

const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
const clone = v => JSON.parse(JSON.stringify(v));
function merge(a, b) {
  const out = Object.assign({}, a);
  Object.keys(b).forEach(k => { const v = b[k], o = out[k]; out[k] = isObj(v) && isObj(o) ? merge(o, v) : v; });
  return out;
}
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* hooks: onStatus("online"|"offline"), onFatal(code) */
export function connect(info, hooks) {
  const space = info.spaceId;
  let data = {};          // path -> document
  const rev = {};         // path -> last revision applied
  let loaded = false;
  let loading = false;
  let buffer = [];
  let channel = null;
  let lastPresence = null;
  let peersCb = null;
  const where = {}; // presence key -> { m, tab, trip } as last announced
  const me = newId();
  const topics = {};
  const listeners = new Set();
  const meta = { fromCache: false, hasPendingWrites: false };

  let pending = false;
  const notify = () => {
    if (pending) return;
    pending = true;
    setTimeout(() => { pending = false; listeners.forEach(f => f()); }, 0);
  };
  const watch = fn => { listeners.add(fn); if (loaded) setTimeout(fn, 0); return () => listeners.delete(fn); };
  const status = s => hooks.onStatus && hooks.onStatus(s);

  /* one change from the database; older news never overwrites newer */
  function apply(row) {
    if (!row || !row.path) return;
    if ((rev[row.path] || 0) >= row.rev) return;
    rev[row.path] = row.rev;
    if (row.data == null) delete data[row.path]; else data[row.path] = row.data;
  }

  async function loadAll() {
    loading = true;
    buffer = [];
    const next = {};
    const revs = {};
    try {
      for (let from = 0; ; from += 1000) {
        const r = await sb.from("docs").select("path,data,rev").eq("space_id", space).not("data", "is", null)
          .order("path").range(from, from + 999);
        if (r.error) throw r.error;
        r.data.forEach(row => { next[row.path] = row.data; revs[row.path] = row.rev; });
        if (r.data.length < 1000) break;
      }
    } catch (e) {
      loading = false;
      status("offline");
      setTimeout(loadAll, 4000);
      return;
    }
    data = next;
    Object.keys(rev).forEach(k => delete rev[k]);
    Object.assign(rev, revs);
    buffer.forEach(apply);
    buffer = [];
    loading = false;
    loaded = true;
    status("online");
    notify();
  }

  /* ---------- live channel: database changes, who is here, ♡ ---------- */
  let retryTimer = 0;
  async function open() {
    clearTimeout(retryTimer);
    if (channel) { const old = channel; channel = null; await sb.removeChannel(old); }
    await sb.realtime.setAuth();
    const ch = sb.channel(`space:${space}`, { config: { private: true, broadcast: { self: false }, presence: { key: me } } });
    channel = ch;
    let pgReady = false;
    let fallback = 0;
    ch.on("postgres_changes", { event: "*", schema: "public", table: "docs", filter: `space_id=eq.${space}` }, p => {
      const row = p.new;
      if (!row || !row.path) return;
      if (loading) buffer.push(row);
      else { apply(row); notify(); }
    });
    // changes only flow once Postgres is hooked up; read the snapshot after that so nothing slips between
    ch.on("system", {}, m => {
      if (m && m.extension === "postgres_changes" && !pgReady) { pgReady = true; clearTimeout(fallback); loadAll(); }
    });
    const emitPeers = () => {
      if (!peersCb || ch !== channel) return;
      const st = ch.presenceState();
      const peers = [];
      Object.keys(st).forEach(k => st[k].forEach((p, i) =>
        peers.push({ conn: k + ":" + i, isMe: k === me, kind: "user", presence: Object.assign({}, p, where[k] || {}) })));
      peersCb({ peers });
    };
    ch.on("presence", { event: "sync" }, emitPeers);
    // someone new arrived: tell them which page we are on
    ch.on("presence", { event: "join" }, ({ key }) => { if (key !== me) sendWhere(true); });
    ch.on("presence", { event: "leave" }, ({ key }) => { delete where[key]; });
    ch.on("broadcast", { event: "where" }, m => {
      const d = m.payload || {};
      if (typeof d.key !== "string") return;
      where[d.key] = { m: d.m === "a" || d.m === "b" ? d.m : null, tab: String(d.tab || ""), trip: d.trip || null };
      emitPeers();
    });
    ch.on("broadcast", { event: "heart" }, m => (topics.heart || []).forEach(f => f({ data: m.payload, sameTab: false })));
    ch.subscribe(s => {
      if (ch !== channel) return;
      if (s === "SUBSCRIBED") {
        // also after an automatic rejoin: read everything again, since changes may have been missed
        pgReady = false;
        lastStable = "";
        sendPresence();
        sendWhere(true);
        // if the "ready" notice never comes, load anyway
        clearTimeout(fallback);
        fallback = setTimeout(() => { if (!pgReady) { pgReady = true; loadAll(); } }, 6000);
      } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") {
        status("offline");
        if (s === "CHANNEL_ERROR") {
          // a removed membership shows up here; check the link still works before retrying
          getInfo(info.token).then(() => { retryTimer = setTimeout(open, 3000); }, e => {
            if (e.code === "not_found") hooks.onFatal && hooks.onFatal("not_found");
            else retryTimer = setTimeout(open, 5000);
          });
        } else if (s === "TIMED_OUT") retryTimer = setTimeout(open, 3000);
      }
    });
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !channel) return;
    if (channel.state !== "joined") open();
  });
  open();

  /* ---------- documents ---------- */
  async function write(op, path, body) {
    const prev = data[path];
    if (op === "update" && !prev) throw { code: "invalid_argument", status: 404, details: "missing document" };
    // show the change right away; the database's copy arrives over Realtime and wins
    const next = op === "set" ? clone(body) : op === "update" ? merge(prev, clone(body)) : undefined;
    if (next === undefined) delete data[path]; else data[path] = next;
    notify();
    let r;
    try {
      r = await sb.rpc("doc_write", { p_space: space, p_op: op, p_path: path, p_body: body === undefined ? null : body });
    } catch (e) { r = { error: e }; }
    if (r.error) {
      if (data[path] === next) { if (prev === undefined) delete data[path]; else data[path] = prev; notify(); }
      throw errOf(r.error);
    }
  }
  const snap = path => {
    const body = data[path];
    return { id: path.split("/").pop(), exists: !!body, data: () => (body ? clone(body) : undefined), metadata: meta };
  };
  function doc(path) {
    return {
      id: path.split("/").pop(), path,
      get: async () => snap(path),
      set: body => write("set", path, body),
      update: body => write("update", path, body),
      delete: () => write("delete", path),
      onSnapshot: next => watch(() => next(snap(path))),
      collection: sub => collection(path + "/" + sub),
    };
  }
  function collection(path) {
    const depth = path.split("/").length + 1;
    const query = () => {
      const docs = Object.keys(data).filter(k => k.indexOf(path + "/") === 0 && k.split("/").length === depth).sort().map(snap);
      return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: meta };
    };
    return {
      path,
      doc: id => doc(path + "/" + (id || newId())),
      add: async body => { const r = doc(path + "/" + newId()); await r.set(body); return r; },
      get: async () => query(),
      onSnapshot: next => watch(() => next(query())),
    };
  }

  /* ---------- who is here + ♡ ----------
     Presence may change only 5 times in 30 s per device, so it carries just who this is.
     Which page each one is looking at changes often and goes over Broadcast instead. */
  let trackTimer = 0, lastTrack = 0, lastStable = "";
  let whereTimer = 0, lastWhere = "";
  function sendPresence() {
    trackTimer = 0;
    if (!channel || channel.state !== "joined" || !lastPresence) return;
    const stable = { m: lastPresence.m || null };
    const j = JSON.stringify(stable);
    if (j === lastStable) return;
    lastStable = j;
    lastTrack = Date.now();
    channel.track(stable).catch(() => {});
  }
  function sendWhere(force) {
    if (!channel || channel.state !== "joined" || !lastPresence) return;
    const j = JSON.stringify(lastPresence);
    if (!force && j === lastWhere) return;
    lastWhere = j;
    channel.send({ type: "broadcast", event: "where", payload: Object.assign({ key: me }, lastPresence) }).catch(() => {});
  }
  const room = {
    presence: p => {
      lastPresence = p;
      if (JSON.stringify({ m: p.m || null }) !== lastStable && !trackTimer) {
        trackTimer = setTimeout(sendPresence, Math.max(0, lastTrack + 8000 - Date.now()));
      }
      clearTimeout(whereTimer);
      whereTimer = setTimeout(() => sendWhere(false), 300);
      return Promise.resolve();
    },
    onPeers: cb => { peersCb = cb; },
    on: (topic, cb) => { (topics[topic] = topics[topic] || []).push(cb); },
    emit: (topic, d) => (channel ? channel.send({ type: "broadcast", event: topic, payload: d }) : Promise.resolve()),
  };

  /* ---------- photos (private bucket, files under {space}/) ---------- */
  const bucket = () => sb.storage.from("photos");
  const urlCache = new Map(); // path -> { url, until }
  const photos = {
    async upload(name, blob) {
      const r = await bucket().upload(`${space}/${name}`, blob, { contentType: blob.type || "image/jpeg", cacheControl: "31536000", upsert: false });
      if (r.error) throw errOf(r.error);
    },
    async remove(names) {
      if (!names.length) return;
      const r = await bucket().remove(names.map(n => `${space}/${n}`));
      if (r.error) throw errOf(r.error);
    },
    /* signed links last an hour; ask for many at once */
    async urls(names) {
      const now = Date.now();
      const want = names.filter(n => { const c = urlCache.get(n); return !c || c.until < now; });
      if (want.length) {
        const r = await bucket().createSignedUrls(want.map(n => `${space}/${n}`), 3600);
        if (r.error) throw errOf(r.error);
        r.data.forEach((x, i) => { if (x.signedUrl) urlCache.set(want[i], { url: x.signedUrl, until: now + 3300e3 }); });
      }
      const out = {};
      names.forEach(n => { const c = urlCache.get(n); if (c) out[n] = c.url; });
      return out;
    },
    cached: name => { const c = urlCache.get(name); return c && c.until > Date.now() ? c.url : null; },
  };

  /* ---------- AI (GPT-5.2 in the "ai" Edge Function) ---------- */
  async function aiFetch(task, tripId, options, signal) {
    const s = await signIn();
    let r;
    try {
      r = await fetch(FN(), {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: CONFIG.supabaseKey, Authorization: "Bearer " + s.access_token },
        body: JSON.stringify({ task, spaceId: space, tripId, options }),
        signal, cache: "no-store",
      });
    } catch (e) {
      throw e && e.name === "AbortError" ? { code: "cancelled" } : { code: "unavailable" };
    }
    if (!r.ok) {
      let b = null;
      try { b = await r.json(); } catch (e) {}
      throw { code: (b && b.error && b.error.code) || (r.status >= 500 ? "unavailable" : "error"), status: r.status };
    }
    return r;
  }
  const ai = {
    /* structured result for "spots" | "plan" | "pack" */
    json: async (task, tripId, options, { signal } = {}) => (await (await aiFetch(task, tripId, options, signal)).json()).result,
    /* streamed text for "review" | "chat"; onText gets { text } with everything so far */
    text: async (task, tripId, options, { signal, onText } = {}) => {
      const r = await aiFetch(task, tripId, options, signal);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "", text = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (!line) continue;
            const m = JSON.parse(line);
            if (m.error) throw { code: m.error, text };
            if (typeof m.d === "string") { text += m.d; if (onText) onText({ text }); }
          }
        }
      } catch (e) {
        if (e && e.code) throw e;
        throw e && e.name === "AbortError" ? { code: "cancelled", text } : { code: "unavailable", text };
      }
      return { text };
    },
  };

  return { db: { doc, collection }, room, ai, photos, reconnect: open };
}

/* hand the browser a text file */
export function downloadText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
