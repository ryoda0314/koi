import { html, render, useState, useEffect, useLayoutEffect, useRef } from "/vendor/preact.js";
import {
  pad, parseD, iso, todayISO, addDays, diffDays, mdw, mdj, tmin, dur, yen, toNum, clip, byCreated,
  tripDays, nightsDays, monthOf, CATS, SPOT_CATS, MONEY_CATS, cat, mcat, PACK_GROUPS, isBoth, sortPlan,
} from "/shared/trip.js";
import { configured, getConfig, createSpace, getInfo, connect, downloadText } from "/js/api.js";
import { loadLeaflet, TILE_URL, TILE_ATTR, searchPlaces, whereIs } from "/js/geo.js";
import { prepare as preparePhoto, fullName, thumbName } from "/js/photos.js";

const root = document.getElementById("app");

/* ---------- small helpers ---------- */
const store = prefix => ({
  get(k, d) { try { const v = localStorage.getItem(prefix + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(prefix + k); else localStorage.setItem(prefix + k, JSON.stringify(v)); } catch (e) {} },
});
const GLS = store("ftk:"); // per browser

/* the share link is …/#t={token}; the token decides which space (and whether we may edit).
   It sits after "#", so it never reaches any server log or another site's Referer. */
const tokenIn = h => (/(?:^#|&)t=([A-Za-z0-9_-]{16,64})/.exec(h) || [])[1] || null;
if (!tokenIn(location.hash) && !/[?&]new(=|&|$)/.test(location.search) && GLS.get("last", null)) {
  // the home screen: go straight back to the ticket book last opened on this device
  history.replaceState(null, "", location.pathname + "#t=" + GLS.get("last", null));
}
const TOKEN = tokenIn(location.hash);
window.addEventListener("hashchange", () => { if (tokenIn(location.hash) !== TOKEN) location.reload(); });
const LS = store(TOKEN ? "ftk:" + TOKEN.slice(0, 12) + ":" : "ftk:"); // per share link
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const okUrl = u => /^https?:\/\/\S+$/i.test(u || "");
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return "リンク"; } };
const enc = encodeURIComponent;
const initial = s => Array.from(String(s || "").trim() || "?")[0];
const reduceMotion = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
const PAGE_T0 = Date.now();

function defaultDates() {
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  const s = iso(d);
  return [s, addDays(s, 1)];
}

/* links out (open in a new tab) */
const gmapQ = q => "https://www.google.com/maps/search/?api=1&query=" + enc(q);
const gmapDir = (a, b) => "https://www.google.com/maps/dir/?api=1&origin=" + enc(a) + "&destination=" + enc(b) + "&travelmode=transit";
function gmapRoute(stops) {
  const s = stops.slice(0, 10);
  if (s.length < 2) return gmapQ(s[0] || "");
  const w = s.slice(1, -1);
  return "https://www.google.com/maps/dir/?api=1&origin=" + enc(s[0]) + "&destination=" + enc(s[s.length - 1]) + (w.length ? "&waypoints=" + w.map(enc).join("%7C") : "");
}
const weatherUrl = q => "https://www.google.com/search?q=" + enc(q + " 天気");
function gcalUrl({ text, date, end, time, endTime, details, location }) {
  const D = s => s.replace(/-/g, "");
  let dates;
  const t0 = tmin(time);
  if (t0 != null) {
    let t1 = tmin(endTime), d1 = date;
    if (t1 == null || t1 <= t0) t1 = t0 + 60;
    if (t1 >= 1440) { t1 -= 1440; d1 = addDays(date, 1); }
    const T = m => pad(Math.floor(m / 60)) + pad(m % 60) + "00";
    dates = `${D(date)}T${T(t0)}/${D(d1)}T${T(t1)}`;
  } else {
    dates = `${D(date)}/${D(addDays(end || date, 1))}`;
  }
  return "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + enc(text) + "&dates=" + dates +
    (details ? "&details=" + enc(details.slice(0, 1500)) : "") + (location ? "&location=" + enc(location) : "");
}
const tripCal = t => gcalUrl({ text: t.title, date: t.start, end: t.end || t.start, details: (t.from ? t.from + " → " : "") + t.dest + (t.memo ? "\n" + t.memo : ""), location: t.dest });

const TEMPLATES = [
  { key: "todo", label: "やること（予約・手配）", type: "todo", items: [
    ["宿を予約する", "share"], ["行きの交通を予約する", "share"], ["帰りの交通を予約する", "share"],
    ["行きたいお店を予約する", "share"], ["休みを確保する", "each"], ["前日に天気予報を見る", "share"] ] },
  { key: "basic", label: "国内旅行の基本", items: [
    ["着替え", "each", "衣類"], ["下着・靴下", "each", "衣類"], ["パジャマ", "each", "衣類"],
    ["歯ブラシ", "each", "洗面・美容"], ["スキンケア用品", "each", "洗面・美容"], ["常備薬", "each", "洗面・美容"],
    ["スマホの充電器", "each", "電子機器"], ["モバイルバッテリー", "share", "電子機器"],
    ["財布", "each", "貴重品・書類"], ["身分証・保険証", "each", "貴重品・書類"], ["予約確認のスクショ", "share", "貴重品・書類"],
    ["折りたたみ傘", "share", "その他"], ["ハンカチ・ティッシュ", "each", "その他"], ["エコバッグ", "share", "その他"] ] },
  { key: "onsen", label: "温泉・旅館", items: [
    ["浴衣の下に着るインナー", "each", "衣類"], ["ヘアゴム・ヘアクリップ", "share", "洗面・美容"],
    ["湯上がりの保湿クリーム", "share", "洗面・美容"], ["小銭（貸切風呂・自販機用）", "share", "貴重品・書類"] ] },
  { key: "sea", label: "海・夏", items: [
    ["水着", "each", "衣類"], ["ビーチサンダル", "each", "衣類"], ["日焼け止め", "share", "洗面・美容"],
    ["サングラス", "each", "その他"], ["防水スマホケース", "share", "電子機器"], ["タオル", "each", "その他"] ] },
  { key: "abroad", label: "海外旅行", items: [
    ["パスポート", "each", "貴重品・書類"], ["航空券（eチケット）", "share", "貴重品・書類"], ["海外旅行保険の証書", "each", "貴重品・書類"],
    ["クレジットカード", "each", "貴重品・書類"], ["変換プラグ", "share", "電子機器"], ["SIM・Wi-Fiルーター", "share", "電子機器"] ] },
];

/* ---------- app state ---------- */
const TABS = [["cal", "予定"], ["plan", "旅程"], ["spots", "行きたい"], ["money", "お金"], ["prep", "準備"], ["mem", "思い出"]];
const tabName = k => (TABS.find(t => t[0] === k) || [0, "このページ"])[1];
const S = {
  mode: "", readOnly: false, canWrite: null, uid: null, myName: "",
  members: undefined, trips: undefined, tripId: null, loadErr: "",
  spots: [], memories: [], plan: [], money: [], checks: [], tripLoaded: false, scrollToday: false,
  tab: LS.get("tab", "plan"),
  peers: [], meLocal: LS.get("me", null), whoSkip: false,
  sheet: null, toasts: [], ai: null, aiOff: false, dl: null, room: null, prevSeen: 0,
  conn: "connecting", share: null, config: null, spaceId: null, photos: null,
};
if (!TABS.some(t => t[0] === S.tab)) S.tab = "plan";
let DB = null;
const renderers = new Set();
let queued = false;
function changed() {
  if (queued) return;
  queued = true;
  Promise.resolve().then(() => { queued = false; renderers.forEach(f => f()); });
}
function useStore() {
  const [, force] = useState(0);
  // subscribe during the commit, before boot() can report its first change
  useLayoutEffect(() => { const f = () => force(n => n + 1); renderers.add(f); return () => renderers.delete(f); }, []);
}

const KEYS = ["a", "b"];
function meKey() {
  const m = S.members;
  if (!m) return null;
  if (S.uid) for (const k of KEYS) if (m[k] && m[k].uid === S.uid) return k;
  return KEYS.indexOf(S.meLocal) >= 0 ? S.meLocal : null;
}
const other = k => (k === "b" ? "a" : "b");
const nm = k => (S.members && S.members[k] && S.members[k].name) || (k === "b" ? "ふたり目" : "ひとり目");
const curTrip = () => (S.trips || []).find(t => t.id === S.tripId) || null;
const isFresh = s => isBoth(s) && Math.max((s.likedAt && s.likedAt.a) || 0, (s.likedAt && s.likedAt.b) || 0) > PAGE_T0;
const isNew = x => { const k = meKey(); return !!(k && S.prevSeen && x.by && x.by !== k && (x.createdAt || 0) > S.prevSeen); };
const checkDone = c => (c.owner === "each" ? !!(c.checkedBy && c.checkedBy.a && c.checkedBy.b) : !!c.checked);
const tp = (id, c, x) => `trips/${id}/${c}/${x}`;
const placeOf = it => clip(it.place, 80);
const shareUrl = t => location.origin + location.pathname.replace(/index\.html$/, "") + "#t=" + t;
const isDate = t => !!(t && t.kind === "date");
const tripSpots = () => { const t = curTrip(); return t ? (S.spots || []).filter(s => s.tripId === t.id) : []; };
const tripById = id => (S.trips || []).find(t => t.id === id) || null;
const pendingResv = () => S.plan.filter(p => p.resv === "need").length + tripSpots().filter(s => s.resv === "need" && !s.visited).length;
const newestFirst = arr => arr.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
function openTodos(k) {
  return S.checks.filter(c => c.type === "todo" && (c.owner === "each" ? !(c.checkedBy && c.checkedBy[k]) : !c.checked && (c.owner === k || c.owner === "share"))).length;
}

function toast(msg) {
  const id = newId();
  S.toasts = S.toasts.concat({ id, msg }).slice(-3);
  changed();
  setTimeout(() => { S.toasts = S.toasts.filter(t => t.id !== id); changed(); }, 3400);
}
function openSheet(type, props) { S.sheet = { type, props: props || {}, key: newId() }; changed(); }
function closeSheet() { S.sheet = null; changed(); }
function setTab(k) {
  if (S.tab === k) return;
  S.tab = k; LS.set("tab", k); changed();
  const v = document.getElementById("view");
  if (v) {
    const top = v.getBoundingClientRect().top + window.scrollY - 110;
    if (window.scrollY > top) window.scrollTo(0, Math.max(0, top));
  }
}

/* ---------- boot + live subscriptions ---------- */
let REMOTE = null;
async function boot() {
  S.loadErr = "";
  if (!configured()) { S.loadErr = "config"; changed(); return; }
  if (!TOKEN) {
    S.mode = "landing";
    changed();
    try { S.config = await getConfig(); } catch (e) { S.config = { needPasscode: false, ai: false }; }
    changed();
    return;
  }
  let info;
  try { info = await getInfo(TOKEN); } catch (e) {
    if (e.code === "not_found") { if (GLS.get("last", null) === TOKEN) GLS.set("last", null); S.loadErr = "notfound"; }
    else S.loadErr = "error";
    changed();
    return;
  }
  GLS.set("last", TOKEN);
  S.canWrite = info.role === "edit";
  S.readOnly = !S.canWrite;
  S.uid = info.uid || null;
  S.spaceId = info.spaceId;
  if (S.canWrite) S.share = { edit: info.editToken, view: info.viewToken };
  REMOTE = connect(Object.assign({ token: TOKEN }, info), {
    onStatus: s => { if (S.conn !== s) { S.conn = s; changed(); } },
    onFatal: () => { S.loadErr = "notfound"; changed(); },
  });
  DB = REMOTE.db;
  S.photos = REMOTE.photos;
  S.mode = "shared";
  subscribeRoot();
  if (info.ai && S.canWrite) S.ai = REMOTE.ai;
  S.dl = { save: async ({ filename, data }) => downloadText(filename, data) };
  setupRoom(REMOTE.room);
}

let rootUnsubs = [], tripUnsubs = [], retries = 0, settleTimer = 0, slowTimer = 0;
function subscribeRoot() {
  rootUnsubs.forEach(u => u());
  rootUnsubs = [];
  S.loadErr = "";
  let heardMembers = false, heardTrips = false;
  clearTimeout(settleTimer);
  clearTimeout(slowTimer);
  // An empty cached answer is held back briefly in case the server's real answer follows; after that, trust it.
  settleTimer = setTimeout(() => {
    let ch = false;
    if (S.members === undefined && heardMembers) { S.members = null; ch = true; }
    if (S.trips === undefined && heardTrips) { S.trips = []; ch = true; pickTrip(); }
    if (ch) changed();
  }, 4000);
  slowTimer = setTimeout(() => {
    if (S.members === undefined || S.trips === undefined) { S.loadErr = "slow"; changed(); }
  }, 15000);
  rootUnsubs.push(DB.doc("app/members").onSnapshot(snap => {
    heardMembers = true;
    // A first cached snapshot can say "missing" before the server answers; wait for the real one.
    if (!snap.exists && snap.metadata && snap.metadata.fromCache && S.members === undefined) return;
    S.members = snap.exists ? snap.data() : null;
    if (S.loadErr === "slow" && S.trips !== undefined) S.loadErr = "";
    changed();
  }, e => subErr(e, subscribeRoot)));
  rootUnsubs.push(DB.collection("trips").onSnapshot(q => {
    heardTrips = true;
    if (q.empty && q.metadata && q.metadata.fromCache && S.trips === undefined) return;
    S.trips = q.docs.map(d => Object.assign({}, d.data(), { id: d.id }));
    if (S.loadErr === "slow" && S.members !== undefined) S.loadErr = "";
    pickTrip();
    changed();
  }, e => subErr(e, subscribeRoot)));
  // the wish list and the memories belong to the two of them, not to one trip
  ["spots", "memories"].forEach(name => rootUnsubs.push(DB.collection(name).onSnapshot(q => {
    S[name] = q.docs.map(d => Object.assign({}, d.data(), { id: d.id }));
    changed();
  }, e => subErr(e, subscribeRoot))));
}
function subErr(e, again) {
  const c = e && e.code;
  if (c === "unavailable" && retries < 3) { retries++; setTimeout(again, 1500 * retries); return; }
  S.loadErr = c === "revoked" ? "revoked" : "error";
  changed();
}
function pickTrip() {
  const ts = S.trips || [];
  if (S.tripId && ts.some(t => t.id === S.tripId)) return;
  if (!ts.length) { if (S.tripId) selectTrip(null); return; }
  const saved = LS.get("trip", null);
  if (saved && ts.some(t => t.id === saved)) return selectTrip(saved);
  const today = todayISO();
  const upcoming = ts.filter(t => (t.end || t.start || "") >= today).sort((a, b) => (a.start || "").localeCompare(b.start || ""));
  selectTrip((upcoming[0] || ts.slice().sort((a, b) => (b.start || "").localeCompare(a.start || ""))[0]).id);
}
function markSeen() { if (S.tripId) LS.set("seen:" + S.tripId, Date.now()); }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") markSeen(); });
window.addEventListener("pagehide", markSeen);
function selectTrip(id) {
  if (S.tripId === id) return;
  markSeen();
  S.tripId = id;
  if (id) LS.set("trip", id);
  S.prevSeen = id ? LS.get("seen:" + id, 0) : 0;
  subscribeTrip(id);
  changed();
}
function subscribeTrip(id) {
  tripUnsubs.forEach(u => u());
  tripUnsubs = [];
  S.plan = []; S.money = []; S.checks = []; S.tripLoaded = false;
  if (!id) return;
  let got = 0;
  ["plan", "money", "checks"].forEach(name => {
    let first = true;
    tripUnsubs.push(DB.collection(`trips/${id}/${name}`).onSnapshot(q => {
      if (S.tripId !== id) return;
      S[name] = q.docs.map(d => Object.assign({}, d.data(), { id: d.id }));
      if (first) {
        first = false;
        if (++got === 3) {
          S.tripLoaded = true;
          const t = curTrip();
          if (t && tripDays(t).indexOf(todayISO()) >= 0) S.scrollToday = true;
        }
      }
      changed();
    }, e => subErr(e, () => subscribeTrip(id))));
  });
}

/* ---------- writes: one at a time per document ---------- */
const writeQueue = new Map();
function enqueue(path, fn) {
  const prev = writeQueue.get(path) || Promise.resolve();
  const p = prev.catch(() => {}).then(fn);
  writeQueue.set(path, p);
  p.catch(() => {}).then(() => { if (writeQueue.get(path) === p) writeQueue.delete(path); });
  return p;
}
async function wr(kind, path, body) {
  if (S.readOnly) { toast("閲覧のみのため変更できません"); return false; }
  const op = () => { const r = DB.doc(path); return kind === "set" ? r.set(body) : kind === "update" ? r.update(body) : r.delete(); };
  try { await enqueue(path, op); return true; } catch (e) {
    let err = e;
    if (e && e.code === "unavailable") {
      await new Promise(r => setTimeout(r, 400 + Math.random() * 600));
      try { await enqueue(path, op); return true; } catch (e2) { err = e2; }
    }
    writeErr(err, kind);
    return false;
  }
}
async function writeMany(list) {
  let ok = 0;
  for (let i = 0; i < list.length; i += 6) {
    const r = await Promise.all(list.slice(i, i + 6).map(([path, body]) => wr("set", path, body)));
    ok += r.filter(Boolean).length;
  }
  return ok;
}
function writeErr(e, kind) {
  const c = e && e.code;
  if (c === "invalid_argument") {
    if (kind === "update" || (e && e.status === 404)) toast("見つかりませんでした。相手が削除したのかもしれません");
    else toast("保存できませんでした。入力内容を確認してください");
  } else if (c === "permission_denied") { S.readOnly = true; changed(); toast("このリンクでは編集できません（見るだけ）"); }
  else if (c === "too_large") toast("内容が長すぎて保存できませんでした");
  else if (c === "quota_exceeded") toast("保存できる量の上限です。使わない旅を削除してください");
  else if (c === "resource_exhausted") toast("操作が続きすぎました。少し待ってからもう一度どうぞ");
  else if (c === "not_found") toast("このきっぷ帳が見つかりません。リンクを確認してください");
  else toast("保存できませんでした。通信状況を確認してください");
}

/* ---------- who is here (room presence) + hearts ---------- */
let lastPresence = "";
function setupRoom(r) {
  S.room = r;
  try {
    r.onPeers(ch => { S.peers = (ch && ch.peers) || []; changed(); }, () => {});
    r.on("heart", msg => {
      if (msg.sameTab) return;
      const f = msg.data && msg.data.from;
      const k = f === "a" || f === "b" ? f : null;
      floatHearts(k);
      if (k && k !== meKey()) toast(`${nm(k)}から ♡ が届きました`);
    }, () => {});
  } catch (e) {}
  pushPresence();
}
function pushPresence() {
  const r = S.room;
  if (!r) return;
  const p = { m: meKey(), tab: S.tab, trip: S.tripId };
  const j = JSON.stringify(p);
  if (j === lastPresence) return;
  lastPresence = j;
  r.presence(p).catch(() => {});
}
function partnerHere() {
  const k = meKey();
  if (!k) return null;
  const o = other(k);
  return S.peers.find(p => p && !p.isMe && p.kind !== "agent" && p.presence && p.presence.m === o) || null;
}
function sendHeart() {
  const k = meKey();
  floatHearts(k);
  if (S.room) S.room.emit("heart", { from: k }).catch(() => {});
}
function floatHearts(k) {
  const host = document.getElementById("hearts");
  if (!host) return;
  const n = reduceMotion() ? 1 : 7;
  const color = k === "b" ? "var(--m-b)" : k === "a" ? "var(--m-a)" : "var(--both)";
  for (let i = 0; i < n; i++) {
    const el = document.createElement("span");
    el.className = "fh";
    el.style.setProperty("--x", (n === 1 ? 0 : Math.round(Math.random() * 56 - 28)) + "vw");
    el.style.setProperty("--d", i * 110 + "ms");
    el.style.setProperty("--s", (0.8 + Math.random() * 0.8).toFixed(2));
    el.style.color = color;
    el.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 21s-8-4.9-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6.1-8 11-8 11z"/></svg>';
    host.appendChild(el);
    setTimeout(() => el.remove(), 2500 + i * 110);
  }
}

/* copy text; fall back to a sheet with the text selected */
function copyOrShow(text, done) {
  let p;
  try { p = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(text) : Promise.reject(); } catch (e) { p = Promise.reject(e); }
  p.then(() => toast(done || "コピーしました"), () => openSheet("text", { text }));
}

/* ---------- small components ---------- */
const PATHS = {
  plan: '<path d="M7 3v18"/><circle cx="7" cy="6.5" r="2.3"/><circle cx="7" cy="17.5" r="2.3"/><path d="M12 6.5h8M12 12h6M12 17.5h8"/>',
  spots: '<path d="M12 20.5s-7.5-4.6-7.5-10.3A4.2 4.2 0 0 1 12 7.6a4.2 4.2 0 0 1 7.5 2.6c0 5.7-7.5 10.3-7.5 10.3z"/>',
  money: '<circle cx="12" cy="12" r="8.5"/><path d="M8.8 7.8 12 12l3.2-4.2M12 12v5M9.3 12.6h5.4M9.3 15h5.4"/>',
  prep: '<rect x="4.5" y="4.5" width="15" height="15" rx="2.5"/><path d="m8.5 12.2 2.4 2.4 4.6-5"/>',
  book: '<path d="M12 6.5C10 5 7.5 4.6 4.5 5v13c3-.4 5.5 0 7.5 1.5 2-1.5 4.5-1.9 7.5-1.5V5c-3-.4-5.5 0-7.5 1.5zM12 6.5v13"/>',
  chat: '<path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/><path d="M8.5 10.5h7"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  dice: '<rect x="4.5" y="4.5" width="15" height="15" rx="3"/><circle cx="9" cy="9" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="15" cy="15" r="1.2" fill="currentColor"/>',
  cal: '<rect x="4" y="5.5" width="16" height="14" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  down: '<path d="M12 4.5v11M7.5 11l4.5 4.5 4.5-4.5M5 19.5h14"/>',
  warn: '<path d="M12 4 3.5 19h17z"/><path d="M12 10v4.5"/><circle cx="12" cy="17" r=".9" fill="currentColor"/>',
  check: '<path d="m6 12.5 4 4 8-9"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 6.8 11 3.5 3.5 0 0 0 7 18z"/>',
  mem: '<rect x="3.5" y="6.5" width="17" height="13" rx="2.5"/><path d="M8.5 6.5 10 4h4l1.5 2.5"/><circle cx="12" cy="13" r="3.5"/>',
  map: '<path d="M3.5 6.5 9 4l6 2.5 5.5-2.5v13.5L15 20l-6-2.5-5.5 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>',
  list: '<path d="M8.5 7h11M8.5 12h11M8.5 17h11"/><circle cx="4.8" cy="7" r=".9" fill="currentColor"/><circle cx="4.8" cy="12" r=".9" fill="currentColor"/><circle cx="4.8" cy="17" r=".9" fill="currentColor"/>',
  photo: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m5 18 5-5 3 3 2.5-2.5L20 18"/>',
  left: '<path d="m14.5 6-6 6 6 6"/>',
  right: '<path d="m9.5 6 6 6-6 6"/>',
};
PATHS.heart = PATHS.spots;
const Icon = ({ n }) => html`<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: PATHS[n] || "" }}></svg>`;
const Who = ({ k }) => (k === "a" || k === "b" ? html`<span class=${"who who-" + k} title=${nm(k) + "が追加"}>${initial(nm(k))}</span>` : null);
const KB = ({ c }) => html`<span class="kb" title=${c.label}>${c.kanji}</span>`;
const Empty = ({ title, children, actions }) => html`<div class="empty">
  <p class="empty-t">${title}</p><p class="empty-b">${children}</p>
  ${actions ? html`<div class="empty-a">${actions}</div>` : null}
</div>`;
const Field = ({ id, label, hint, children }) => html`<div class="field">
  <label for=${id}>${label}</label>${children}${hint ? html`<small class="hint">${hint}</small>` : null}
</div>`;
const Seg = ({ value, options, onChange, label, small, scroll }) => html`<div class=${"seg" + (small ? " seg-s" : "") + (scroll ? " seg-scroll" : "")} role="group" aria-label=${label}>
  ${options.map(([v, l]) => html`<button type="button" key=${v} aria-pressed=${String(value === v)} onClick=${() => onChange(v)}>${l}</button>`)}
</div>`;
const aiReady = () => !!(S.ai && !S.aiOff && !S.readOnly);
function useNow(ms) {
  const [t, setT] = useState(Date.now());
  useEffect(() => { const h = setInterval(() => setT(Date.now()), ms || 60000); return () => clearInterval(h); }, []);
  return t;
}
function countdown(trip) {
  const days = tripDays(trip);
  if (!days.length) return null;
  const today = todayISO();
  const until = diffDays(today, trip.start);
  if (until > 0) return { label: isDate(trip) ? "デートまで あと" : "出発まで あと", num: until, unit: "日" };
  const idx = days.indexOf(today);
  if (idx >= 0) return isDate(trip) ? { label: "デートは", num: "きょう", unit: "" } : { label: "旅行中", num: idx + 1, unit: "日目" };
  return { label: isDate(trip) ? "デートから" : "帰ってから", num: diffDays(days[days.length - 1], today), unit: "日" };
}

/* ---------- app shell ---------- */
function App() {
  useStore();
  useEffect(() => {
    pushPresence();
    document.body.classList.toggle("me-b", meKey() === "b");
  });
  if (S.loadErr) return html`<${LoadError} />`;
  if (S.mode === "landing") return html`<${Landing} /><${Toasts} />`;
  if (S.members === undefined || S.trips === undefined) return html`<${Loading} />`;
  const trip = curTrip();
  if (!trip || !S.members) return html`<${Onboarding} needNames=${!S.members} /><${Toasts} />${S.sheet ? html`<${SheetHost} key=${S.sheet.key} s=${S.sheet} trip=${trip} />` : null}`;
  const View = { cal: CalendarView, plan: PlanView, spots: SpotsView, money: MoneyView, prep: PrepView, mem: MemoriesView }[S.tab] || PlanView;
  const needWho = !meKey() && !S.readOnly && !S.whoSkip;
  const showTicket = ["plan", "money", "prep"].includes(S.tab) || !TABS.some(t => t[0] === S.tab);
  return html`
    <${TopBar} />
    <main class="wrap">
      <${Banners} />
      ${showTicket ? html`<${Ticket} trip=${trip} />` : null}
      <${News} />
      <${Nav} />
      <section id="view" class="view"><${View} trip=${trip} /></section>
    </main>
    ${aiReady() ? html`<button class="fab" type="button" onClick=${() => openSheet("ai")}><${Icon} n="chat" /><span>AIに相談</span></button>` : null}
    ${needWho ? html`<${WhoSheet} />` : S.sheet ? html`<${SheetHost} key=${S.sheet.key} s=${S.sheet} trip=${trip} />` : null}
    <${Toasts} />`;
}

function Loading() {
  return html`<div class="wrap loading" aria-busy="true">
    <div class="ticket"></div><p>きっぷを発券しています…</p>
  </div>`;
}
function LoadError() {
  if (S.loadErr === "config") {
    return html`<main class="wrap loading">
      <${Empty} title="Supabase の設定がまだです">public/config.js に、Supabase プロジェクトの URL と publishable キーを書いてください。<//>
    </main>`;
  }
  if (S.loadErr === "notfound") {
    return html`<main class="wrap loading">
      <${Empty} title="このリンクのきっぷ帳は見つかりません" actions=${html`<a class="btn" href="./?new">トップへ</a>`}>
        リンクが途中で切れていないか確かめてください。送ってくれた相手に、もう一度リンクをもらうのも手です。
      <//>
    </main>`;
  }
  const msg = S.loadErr === "slow" ? "読み込みに時間がかかっています。通信状況を確認してください。" : "データを読み込めませんでした。通信状況を確認してください。";
  const retry = () => {
    retries = 0;
    if (!DB) boot().catch(() => { S.loadErr = "error"; changed(); });
    else { REMOTE.reconnect(); subscribeRoot(); }
    changed();
  };
  return html`<main class="wrap loading">
    <${Empty} title="うまく読み込めませんでした" actions=${html`<button class="btn" type="button" onClick=${retry}>もう一度読み込む</button>`}>${msg}<//>
  </main>`;
}
function Toasts() {
  return html`<div class="toasts" role="status" aria-live="polite">${S.toasts.map(t => html`<div class="toast" key=${t.id}>${t.msg}</div>`)}</div>`;
}

function TopBar() {
  const k = meKey();
  const here = partnerHere();
  return html`<header class="top">
    <div class="top-in">
      <div class="brand">ふたり旅きっぷ</div>
      <div class="top-r">
        <div class="duo">
          ${KEYS.map(x => html`<span key=${x} class=${"av av-" + x + (x === k ? " me" : "") + (here && x !== k ? " online" : "")}
            title=${nm(x) + (x === k ? "（あなた）" : here ? "（いま見ています）" : "")}>${initial(nm(x))}</span>`)}
        </div>
        ${here ? html`<button class="icon-b heart-send" type="button" onClick=${sendHeart} aria-label=${nm(other(k)) + "に ♡ を送る"} title="♡ を送る"><${Icon} n="heart" /></button>` : null}
        <button class="icon-b" type="button" aria-label="メニュー" onClick=${() => openSheet("menu")}><${Icon} n="menu" /></button>
      </div>
    </div>
    ${here ? html`<div class="top-sub">${nm(other(k))}がいま「${tabName(here.presence.tab)}」を見ています</div>` : null}
  </header>`;
}

function Banners() {
  return html`
    ${S.conn === "offline" ? html`<div class="banner" role="status">通信が切れています。つながりなおしています…（この間の変更は保存されないことがあります）</div>` : null}
    ${S.readOnly ? html`<div class="banner">見るだけのリンクで開いています。書き込むには、編集用のリンクを送ってもらってください。</div>` : null}`;
}

function Ticket({ trip }) {
  const days = tripDays(trip);
  const cd = countdown(trip);
  const via = tripSpots().filter(isBoth).slice(0, 3).map(s => s.name);
  const valid = days.length <= 1 ? `${mdj(trip.start)} 当日限り有効` : `${mdj(trip.start)}から ${days.length}日間有効`;
  return html`<section class=${"ticket" + (isDate(trip) ? " t-date" : "")} aria-label="きっぷ">
    <div class="t-main">
      <div class="t-row">
        <span class="t-kind">${isDate(trip) ? "デート 入場券" : "ふたり旅 乗車券"}</span>
        <span class="t-acts">
          ${!S.readOnly || (S.trips || []).length > 1 ? html`<button class="t-btn" type="button" onClick=${() => openSheet("trips")}>きりかえ</button>` : null}
          ${!S.readOnly ? html`<button class="t-btn" type="button" onClick=${() => openSheet("trip", { id: trip.id })}>編集</button>` : null}
        </span>
      </div>
      <h1 class="t-route">
        ${trip.from ? html`<span>${trip.from}</span><span class="t-arr" aria-label="から">→</span>` : null}
        <span>${trip.dest || "行き先未定"}</span>
      </h1>
      ${via.length ? html`<div class="t-via"><span>経由</span>${via.join("・")}</div>` : null}
      <div class="t-print">${trip.start ? valid : "日にち未定"}</div>
      <div class="t-sub">${trip.title} ・ ${isDate(trip) ? "デート" : nightsDays(trip)} ・ ${nm("a")} と ${nm("b")}</div>
    </div>
    <div class="t-stub">
      ${cd ? html`<div class="t-cd"><span class="t-cd-l">${cd.label}</span><span class="t-cd-n">${cd.num}</span><span class="t-cd-u">${cd.unit}</span></div>` : html`<span></span>`}
      <div class="t-stub-r">
        ${trip.start ? html`<span>${mdw(trip.start)} → ${mdw(trip.end || trip.start)}</span>` : null}
        ${trip.budget ? html`<span>予算 ${yen(trip.budget)}</span>` : null}
      </div>
    </div>
  </section>`;
}

function News() {
  const k = meKey();
  if (!k || !S.prevSeen) return null;
  const o = other(k);
  const items = [
    ["spots", "行きたい", S.spots.filter(isNew).length],
    ["plan", "旅程", S.plan.filter(isNew).length],
    ["money", "お金", S.money.filter(isNew).length],
    ["prep", "準備", S.checks.filter(isNew).length],
  ].filter(x => x[2] > 0);
  if (!items.length) return null;
  return html`<div class="news"><span>前回のあと、${nm(o)}が追加:</span>
    ${items.map(([t, l, n]) => html`<button key=${t} type="button" onClick=${() => setTab(t)}>${l} ${n}件</button>`)}
  </div>`;
}

function Nav() {
  const k = meKey();
  const o = other(k);
  const badge = k ? { spots: S.spots.filter(s => !s.visited && s.likes && s.likes[o] && !s.likes[k]).length, prep: openTodos(k) + pendingResv() } : {};
  return html`<nav class="nav" aria-label="ページの切り替え">
    ${TABS.map(([key, label]) => html`<button key=${key} type="button" class=${"nav-b" + (S.tab === key ? " on" : "")}
      aria-current=${S.tab === key ? "page" : null} onClick=${() => setTab(key)}>
      <${Icon} n=${key} /><span>${label}</span>
      ${badge[key] ? html`<b class="badge" title=${key === "spots" ? "あなたの ♡ 待ち" : "あなたのやること・予約まだ"}>${badge[key]}</b>` : null}
    </button>`)}
  </nav>`;
}

/* ---------- first run ---------- */
function validateTrip(f) {
  const dest = clip(f.dest, 40);
  const date = f.kind === "date";
  if (!dest) return { err: date ? "どこに行くか入れてください" : "行き先を入れてください" };
  const start = f.start, end = date ? f.start : f.end || f.start;
  if (!parseD(start)) return { err: date ? "日にちを入れてください" : "出発日を入れてください" };
  if (!parseD(end) || end < start) return { err: "帰る日は、出発日と同じか後の日にしてください" };
  if (diffDays(start, end) > 30) return { err: "旅の長さは31日以内にしてください" };
  const budget = String(f.budget || "").trim() === "" ? null : toNum(f.budget);
  if (String(f.budget || "").trim() !== "" && budget == null) return { err: "予算は数字で入れてください" };
  return { data: {
    kind: date ? "date" : "trip", dest, from: date ? "" : clip(f.from, 40),
    title: clip(f.title, 40) || `${dest}${date ? "デート" : "旅行"}`, start, end, budget, memo: clip(f.memo, 600),
  } };
}
function tripSetter(setF) {
  return k => e => {
    const v = e.target.value;
    setF(p => {
      const n = Object.assign({}, p, { [k]: v });
      if (k === "start" && v && (!n.end || n.end < v)) n.end = v;
      return n;
    });
  };
}
const TripFields = ({ f, set, setKind }) => html`
  ${setKind ? html`<div class="field"><span class="flabel">なにをする？</span>
    <${Seg} value=${f.kind || "trip"} onChange=${setKind} label="種類" options=${[["trip", "旅行"], ["date", "デート（日帰り）"]]} /></div>` : null}
  ${f.kind === "date" ? html`<div class="grid2">
    <${Field} id="t-dest" label="どこで"><input id="t-dest" value=${f.dest} onInput=${set("dest")} placeholder="例: 横浜" maxlength="40" autocomplete="off" /><//>
    <${Field} id="t-start" label="日にち"><input id="t-start" type="date" value=${f.start} onInput=${set("start")} /><//>
  </div>` : html`<div class="grid2">
    <${Field} id="t-dest" label="行き先"><input id="t-dest" value=${f.dest} onInput=${set("dest")} placeholder="例: 金沢" maxlength="40" autocomplete="off" /><//>
    <${Field} id="t-from" label="出発地"><input id="t-from" value=${f.from} onInput=${set("from")} placeholder="例: 東京" maxlength="40" autocomplete="off" /><//>
  </div>
  <div class="grid2">
    <${Field} id="t-start" label="出発日"><input id="t-start" type="date" value=${f.start} onInput=${set("start")} /><//>
    <${Field} id="t-end" label="帰る日"><input id="t-end" type="date" value=${f.end} min=${f.start} onInput=${set("end")} /><//>
  </div>`}
  <${Field} id="t-title" label=${f.kind === "date" ? "デートの名前" : "旅の名前"} hint=${f.kind === "date" ? "空欄なら「場所＋デート」になります" : "空欄なら「行き先＋旅行」になります"}>
    <input id="t-title" value=${f.title} onInput=${set("title")} placeholder=${(f.dest || (f.kind === "date" ? "横浜" : "金沢")) + (f.kind === "date" ? "デート" : "旅行")} maxlength="40" autocomplete="off" />
  <//>
  <${Field} id="t-budget" label="ふたりの予算（任意）"><input id="t-budget" inputmode="numeric" value=${f.budget} onInput=${set("budget")} placeholder="例: 80000" autocomplete="off" /><//>
  <${Field} id="t-memo" label="メモ（集合場所・宿の住所など）"><textarea id="t-memo" rows="3" value=${f.memo} onInput=${set("memo")} maxlength="600"></textarea><//>`;

function SampleTicket() {
  return html`<section class="ticket" aria-label="きっぷの見本">
    <div class="t-main">
      <div class="t-row"><span class="t-kind">ふたり旅 乗車券</span></div>
      <div class="t-route" aria-hidden="true"><span>東京</span><span class="t-arr">→</span><span>金沢</span></div>
      <div class="t-via"><span>経由</span>兼六園・ひがし茶屋街</div>
      <div class="t-print">11月21日から 2日間有効</div>
      <div class="t-sub">金沢旅行 ・ 1泊2日 ・ りょう と 난경</div>
    </div>
    <div class="t-stub">
      <div class="t-cd"><span class="t-cd-l">出発まで あと</span><span class="t-cd-n">29</span><span class="t-cd-u">日</span></div>
      <div class="t-stub-r"><span>11/21(金) → 11/22(土)</span></div>
    </div>
    <span class="mihon" aria-hidden="true">見本</span>
  </section>`;
}

function Onboarding({ needNames }) {
  const def = defaultDates();
  const [f, setF] = useState(() => ({
    me: clip(String(S.myName || "").split(/\s+/)[0], 12), partner: "",
    kind: "trip", dest: "", from: "", title: "", start: def[0], end: def[1], budget: "", memo: "",
  }));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = tripSetter(setF);
  const setKind = v => setF(p => Object.assign({}, p, { kind: v }));
  async function submit(e) {
    e.preventDefault();
    if (needNames && (!clip(f.me, 12) || !clip(f.partner, 12))) return setErr("ふたりの呼び名を入れてください");
    const v = validateTrip(f);
    if (v.err) return setErr(v.err);
    setErr(""); setBusy(true);
    if (needNames) {
      let exists = false;
      try { exists = (await DB.doc("app/members").get()).exists; } catch (x) {}
      if (!exists) {
        const ok = await wr("set", "app/members", { a: { name: clip(f.me, 12), uid: S.uid || null }, b: { name: clip(f.partner, 12), uid: null } });
        if (!ok) { setBusy(false); return; }
        S.meLocal = "a"; LS.set("me", "a");
      }
    }
    const id = newId();
    if (await wr("set", "trips/" + id, Object.assign({}, v.data, { createdAt: Date.now(), by: meKey() || "a" }))) {
      selectTrip(id);
      if (needNames) openSheet("share", { first: true });
    }
    setBusy(false);
  }
  if (S.readOnly) {
    return html`<main class="wrap onb"><div class="onb-brand">ふたり旅きっぷ</div>
      <${Empty} title="まだ旅がありません">作った人が旅を登録すると、ここに表示されます。<//></main>`;
  }
  return html`<main class="wrap onb">
    <div class="onb-brand">ふたり旅きっぷ</div>
    <h1 class="onb-h">ふたりの旅を、一枚のきっぷに。</h1>
    <p class="onb-lead">このきっぷ帳のリンクを相手に送ると、行きたい場所・旅程・お金・持ち物を、ふたりで同時に書き込めます。</p>
    <${Banners} />
    <${SampleTicket} />
    <form class="onb-card form" onSubmit=${submit}>
      <h2>${needNames ? "最初のきっぷをつくる" : "新しい旅をつくる"}</h2>
      ${needNames ? html`<div class="grid2">
        <${Field} id="o-me" label="あなたの呼び名"><input id="o-me" value=${f.me} onInput=${set("me")} maxlength="12" placeholder="例: りょう" autocomplete="off" /><//>
        <${Field} id="o-partner" label="相手の呼び名"><input id="o-partner" value=${f.partner} onInput=${set("partner")} maxlength="12" placeholder="例: 난경" autocomplete="off" /><//>
      </div>` : null}
      <${TripFields} f=${f} set=${set} setKind=${setKind} />
      ${err ? html`<p class="err" role="alert">${err}</p>` : null}
      <button class="btn big" type="submit" disabled=${busy}>${busy ? "発行しています…" : "きっぷを発行する"}</button>
    </form>
    <${Feats} />
  </main>`;
}

const Feats = () => html`<ul class="feats">
  <li><span class="kb">印</span><b>♡ がそろうとスタンプ</b><span>ふたりとも行きたい場所が、ひと目でわかります</span></li>
  <li><span class="kb">時</span><b>時間の重なりと空き時間</b><span>旅程に時刻を入れるだけで、自動でチェック</span></li>
  <li><span class="kb">割</span><b>割り勘の精算</b><span>立て替えを記録すると、だれがいくら払えばいいか計算</span></li>
  <li><span class="kb">相</span><b>AIに相談</b><span>おすすめの場所、旅程のたたき台、持ち物リストを提案</span></li>
</ul>`;

/* ---------- top page: make a new ticket book (a private space for two) ---------- */
function Landing() {
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const cfg = S.config;
  const last = GLS.get("last", null);
  async function start(e) {
    e.preventDefault();
    if (cfg && cfg.needPasscode && !pass.trim()) return setErr("合言葉を入れてください");
    setErr(""); setBusy(true);
    try {
      const r = await createSpace(pass.trim());
      location.href = location.pathname + "#t=" + r.editToken;
    } catch (x) {
      setBusy(false);
      setErr(x.code === "bad_passcode" ? "合言葉がちがいます"
        : x.code === "resource_exhausted" ? "続けてつくりすぎました。しばらくしてからどうぞ"
        : "つくれませんでした。通信状況を確認してください");
    }
  }
  return html`<main class="wrap onb">
    <div class="onb-brand">ふたり旅きっぷ</div>
    <h1 class="onb-h">ふたりの旅を、一枚のきっぷに。</h1>
    <p class="onb-lead">行きたい場所・旅程・お金・持ち物を、ふたりで同時に書き込める旅のノートです。きっぷ帳をつくって、そのリンクを相手に送るだけ。アカウント登録はいりません。</p>
    <${SampleTicket} />
    <form class="onb-card form" onSubmit=${start}>
      <h2>きっぷ帳をつくる</h2>
      ${cfg && cfg.needPasscode ? html`<${Field} id="l-pass" label="合言葉" hint="このサイトを用意した人から聞いた合言葉を入れてください">
        <input id="l-pass" type="password" value=${pass} onInput=${e => setPass(e.target.value)} autocomplete="off" /><//>` : null}
      ${err ? html`<p class="err" role="alert">${err}</p>` : null}
      <button class="btn big" type="submit" disabled=${busy || !cfg}>${busy ? "つくっています…" : "ふたりのきっぷ帳をつくる"}</button>
      ${last ? html`<a class="link-btn onb-back" href=${"#t=" + last}>前に開いたきっぷ帳にもどる</a>` : null}
      <p class="hint">相手からリンクが届いているときは、新しくつくらずに、そのリンクを開いてください。</p>
    </form>
    <${Feats} />
  </main>`;
}

/* ---------- itinerary ---------- */
function PlanView({ trip }) {
  const now = useNow(60000);
  const days = tripDays(trip);
  const items = sortPlan(S.plan);
  const byDate = {};
  const undated = [];
  items.forEach(it => { if (it.date && days.indexOf(it.date) >= 0) (byDate[it.date] = byDate[it.date] || []).push(it); else undated.push(it); });
  const d = new Date(now);
  const today = iso(d);
  const nowMin = d.getHours() * 60 + d.getMinutes();
  useEffect(() => {
    if (!S.scrollToday) return;
    S.scrollToday = false;
    const el = document.getElementById("d-" + today);
    if (el) el.scrollIntoView({ block: "start" });
  }, [S.tripLoaded]);
  return html`
    <div class="vh">
      <h2>旅程</h2>
      <div class="vh-act">
        <button class="btn small" type="button" onClick=${() => openSheet("book")}><${Icon} n="book" />しおり</button>
        ${trip.dest ? html`<a class="btn ghost small" href=${weatherUrl(trip.dest)} target="_blank" rel="noopener"><${Icon} n="cloud" />${trip.dest}の天気</a>` : null}
        ${trip.start ? html`<a class="btn ghost small" href=${tripCal(trip)} target="_blank" rel="noopener"><${Icon} n="cal" />カレンダーに登録</a>` : null}
      </div>
    </div>
    ${!items.length ? html`<${Empty} title="まだ予定がありません" actions=${html`
        ${!S.readOnly ? html`<button class="btn small" type="button" onClick=${() => openSheet("plan", { date: days[0] || "" })}><${Icon} n="plus" />予定を追加</button>` : null}
        ${aiReady() ? html`<button class="btn ghost small" type="button" onClick=${() => openSheet("ai", { start: "plan" })}>AIにたたき台を頼む</button>` : null}
        ${S.spots.length ? html`<button class="btn ghost small" type="button" onClick=${() => setTab("spots")}>行きたい場所から選ぶ</button>` : null}`}>
        時刻を入れると、予定どうしの空き時間や重なりを自動でお知らせします。行き先どうしの「行き方」もワンタップで調べられます。
      <//>` : null}
    ${days.map((dd, i) => html`<${Day} key=${dd} date=${dd} n=${i + 1} items=${byDate[dd] || []} trip=${trip} today=${dd === today} nowMin=${nowMin} />`)}
    ${undated.length || !days.length ? html`<${Day} key="undated" date="" n=${0} items=${undated} trip=${trip} today=${false} nowMin=${nowMin} />` : null}`;
}

function Day({ date, n, items, today, nowMin }) {
  const stops = items.map(placeOf).filter(Boolean);
  let nextId = null;
  if (today) {
    const nx = items.find(it => tmin(it.time) != null && tmin(it.time) >= nowMin);
    nextId = nx ? nx.id : null;
  }
  const rows = [];
  items.forEach((it, i) => {
    if (i > 0) rows.push(html`<${Leg} key=${"leg-" + it.id} a=${items[i - 1]} b=${it} />`);
    const t = tmin(it.end) != null ? tmin(it.end) : tmin(it.time);
    rows.push(html`<${Stop} key=${it.id} it=${it} past=${today && t != null && t < nowMin && it.id !== nextId} next=${it.id === nextId} nowMin=${nowMin} />`);
  });
  return html`<section class=${"day" + (today ? " is-today" : "")} id=${date ? "d-" + date : "d-undated"}>
    <header class="day-h">
      <span class="day-n">${date ? n + "日目" : "日付未定"}</span>
      ${date ? html`<span class="day-d">${mdw(date)}</span>` : null}
      ${today ? html`<span class="pill pill-now">きょう</span>` : null}
      <span class="day-links">
        ${stops.length >= 2 ? html`<a href=${gmapRoute(stops)} target="_blank" rel="noopener">この日のルート</a>` : null}
      </span>
    </header>
    ${rows.length ? html`<ol class="rail">${rows}</ol>` : html`<p class="day-empty">${date ? "この日はまだ白紙です" : "日付を決めていない予定はここに入ります"}</p>`}
    ${!S.readOnly ? html`<button class="add-line" type="button" onClick=${() => openSheet("plan", { date })}><${Icon} n="plus" />${date ? "この日に予定を追加" : "予定を追加"}</button>` : null}
  </section>`;
}

function Leg({ a, b }) {
  const ae = tmin(a.end), as = tmin(a.time), bs = tmin(b.time);
  const pa = placeOf(a), pb = placeOf(b);
  let note = "", tone = "";
  if (bs != null && ae != null) {
    if (bs < ae) { note = "時間が重なっています"; tone = "warn"; }
    else {
      const g = bs - ae;
      note = g === 0 ? "すぐ次へ" : "あいだ " + dur(g);
      if (g < 15 && pa && pb && pa !== pb) { note += "・移動が間に合うか確認を"; tone = "soft"; }
    }
  } else if (bs != null && as != null && bs === as) { note = "同じ時刻に予定があります"; tone = "warn"; }
  const route = pa && pb && pa !== pb;
  return html`<li class=${"leg" + (tone ? " " + tone : "")}>
    <span></span><span class="lg-rail"></span>
    <span class="lg-body">
      ${note ? html`<span class="lg-note">${tone === "warn" ? html`<${Icon} n="warn" />` : null}${note}</span>` : null}
      ${route ? html`<a class="lg-route" href=${gmapDir(pa, pb)} target="_blank" rel="noopener">行き方を調べる</a>` : null}
    </span>
  </li>`;
}

function Stop({ it, past, next, nowMin }) {
  const c = cat(it.kind);
  const q = clip(it.place || it.title, 80);
  const wait = next && tmin(it.time) != null ? tmin(it.time) - nowMin : null;
  const Main = S.readOnly ? "div" : "button";
  return html`<li class=${"stop" + (past ? " past" : "") + (next ? " next" : "")}>
    <span class="st-time">${it.time || "--:--"}${it.time && it.end ? html`<small>〜${it.end}</small>` : null}</span>
    <span class="st-rail"><i style=${"--c: var(--k-" + c.key + ")"}></i></span>
    <div class="st-card">
      <${Main} class="st-main" type=${S.readOnly ? null : "button"} onClick=${S.readOnly ? null : () => openSheet("plan", { id: it.id })}>
        <span class="st-title"><${KB} c=${c} />${it.title}${isNew(it) ? html`<span class="new">NEW</span>` : null}</span>
        ${it.place && it.place !== it.title ? html`<span class="st-place">${it.place}</span>` : null}
        ${it.note ? html`<span class="st-note">${it.note}</span>` : null}
        ${next || it.cost || it.by || it.resv ? html`<span class="st-meta">
          ${next ? html`<span class="pill pill-next">${wait != null && wait > 0 ? "つぎ・あと" + dur(wait) : "つぎ"}</span>` : null}
          <${ResvBadge} v=${it.resv} />
          ${it.cost ? html`<span class="st-cost">${yen(it.cost)}</span>` : null}
          <${Who} k=${it.by} />
        </span>` : null}
      <//>
      ${q ? html`<a class="st-map" href=${gmapQ(q)} target="_blank" rel="noopener" aria-label=${q + "を地図で見る"} title="地図で見る"><${Icon} n="pin" /></a>` : null}
    </div>
  </li>`;
}

/* ---------- wishlist (shared by the two; a spot can be a candidate for one trip) ---------- */
const RESV = [["", "なし"], ["need", "要予約"], ["done", "予約済み"]];
const ResvBadge = ({ v }) => (v === "need" ? html`<span class="badge-r need">要予約</span>` : v === "done" ? html`<span class="badge-r done">予約済み</span>` : null);
const hasGeo = s => !!(s.geo && typeof s.geo.lat === "number" && typeof s.geo.lng === "number");
const placeLabel = s => [s.city || s.area, s.cc && s.cc !== "JP" ? s.country : ""].filter(Boolean).join("・");
const heartsOf = s => (isBoth(s) ? "♡♡" : s.likes && (s.likes.a || s.likes.b) ? "♡" : "");

function toggleLike(s) {
  const k = meKey();
  if (!k) return;
  const v = !(s.likes && s.likes[k]);
  wr("update", "spots/" + s.id, { likes: { [k]: v }, likedAt: { [k]: v ? Date.now() : 0 } });
}
function tagToTrip(s, tripId) { return wr("update", "spots/" + s.id, { tripId }); }

/* find where a spot is on the map (OpenStreetMap search), one at a time in the background */
const locating = new Set();
async function locateSpots(ids) {
  for (const id of ids) {
    if (locating.has(id)) continue;
    locating.add(id);
    try {
      const s = S.spots.find(x => x.id === id);
      if (!s || hasGeo(s)) continue;
      let r = await searchPlaces([s.name, s.area].filter(Boolean).join(" "), 1);
      if (!r.length && s.area) r = await searchPlaces(s.name, 1);
      const p = r[0];
      await wr("update", "spots/" + id, p
        ? { geo: { lat: p.lat, lng: p.lng, how: "auto" }, city: p.city, country: p.country, cc: p.cc }
        : { geo: { how: "none" } });
    } catch (e) { /* offline or rate-limited: try again next time */ } finally { locating.delete(id); }
  }
}

const GROUPS = [["love", "♡の状態"], ["city", "都市"], ["country", "国"], ["cat", "種類"], ["who", "追加した人"]];
function groupSpots(list, g) {
  if (g === "love") {
    return [
      ["ふたりとも行きたい", newestFirst(list.filter(s => isBoth(s) && !s.visited))],
      ["候補", newestFirst(list.filter(s => !isBoth(s) && !s.visited))],
      ["行った", list.filter(s => s.visited).sort((a, b) => (b.visitedAt || "").localeCompare(a.visitedAt || ""))],
    ].filter(x => x[1].length);
  }
  const keyOf = g === "city" ? s => s.city || s.area || "場所未設定"
    : g === "country" ? s => s.country || (s.cc === "JP" ? "日本" : "国未設定")
    : g === "cat" ? s => cat(s.cat).label
    : s => (s.ai ? "AI提案" : s.by === "a" || s.by === "b" ? nm(s.by) + "が追加" : "その他");
  const m = new Map();
  newestFirst(list).forEach(s => { const k = keyOf(s); if (!m.has(k)) m.set(k, []); m.get(k).push(s); });
  const last = new Set(["場所未設定", "国未設定", "その他"]);
  return [...m.entries()].sort((a, b) => (last.has(a[0]) - last.has(b[0])) || b[1].length - a[1].length);
}

function SpotsView() {
  const k = meKey();
  const o = other(k);
  const trip = curTrip();
  const mine = tripSpots();
  const [scope, setScope] = useState(() => (trip && mine.length ? "trip" : "all"));
  const [view, setView] = useState(() => LS.get("spotsView", "list"));
  const [f, setF] = useState("all");
  const [c, setC] = useState("all");
  const [g, setG] = useState(() => LS.get("spotsGroup", "love"));
  const base = scope === "trip" && trip ? mine : S.spots;
  const waitMe = k ? base.filter(s => !s.visited && s.likes && s.likes[o] && !s.likes[k]) : [];
  const waitThem = k ? base.filter(s => !s.visited && s.likes && s.likes[k] && !s.likes[o]) : [];
  let list = f === "me" ? waitMe : f === "them" ? waitThem
    : f === "todo" ? base.filter(s => !s.visited) : f === "resv" ? base.filter(s => s.resv === "need") : f === "went" ? base.filter(s => s.visited) : base;
  if (c !== "all") list = list.filter(s => (s.cat || "other") === c);
  const filters = [["all", html`すべて<span class="cnt">${base.length}</span>`]];
  if (k) filters.push(["me", html`あなたの♡待ち<span class="cnt">${waitMe.length}</span>`], ["them", html`${nm(o)}の♡待ち<span class="cnt">${waitThem.length}</span>`]);
  filters.push(["todo", "未訪問"], ["resv", "要予約"], ["went", "行った"]);
  const pickView = v => { setView(v); LS.set("spotsView", v); };
  const pickGroup = e => { const v = e.target.value; setG(v); LS.set("spotsGroup", v); };
  const empty = !S.spots.length;
  return html`
    <div class="vh">
      <h2>行きたい</h2>
      <div class="vh-act">
        ${base.length ? html`<button class="btn ghost small" type="button" onClick=${() => openSheet("roulette", { scope })}><${Icon} n="dice" />ルーレット</button>` : null}
        ${!S.readOnly ? html`<button class="btn small" type="button" onClick=${() => openSheet("spot", { tag: scope === "trip" })}><${Icon} n="plus" />追加</button>` : null}
      </div>
    </div>
    ${empty ? html`<${Empty} title="行ってみたい場所を集めよう" actions=${html`
        ${!S.readOnly ? html`<button class="btn small" type="button" onClick=${() => openSheet("spot", { tag: true })}><${Icon} n="plus" />場所を追加</button>` : null}
        ${aiReady() ? html`<button class="btn ghost small" type="button" onClick=${() => openSheet("ai", { start: "spots" })}>AIに提案してもらう</button>` : null}`}>
        見つけた場所やお店を入れて、ふたりで ♡ をつけ合いましょう。♡ がそろうと「ふたりとも行きたい」のスタンプが押されます。地図や都市別でも見られます。
      <//>` : html`<div class="filters">
        <div class="row spread">
          ${trip ? html`<${Seg} small value=${scope} onChange=${setScope} label="範囲"
            options=${[["trip", html`${trip.title}の候補<span class="cnt">${mine.length}</span>`], ["all", html`ぜんぶ<span class="cnt">${S.spots.length}</span>`]]} />` : html`<span></span>`}
          <${Seg} small value=${view} onChange=${pickView} label="表示"
            options=${[["list", html`<${Icon} n="list" />リスト`], ["map", html`<${Icon} n="map" />地図`]]} />
        </div>
        <${Seg} small scroll value=${f} onChange=${setF} label="しぼりこみ" options=${filters} />
        <div class="cats" role="group" aria-label="種類">
          <button type="button" aria-pressed=${String(c === "all")} onClick=${() => setC("all")}>全部</button>
          ${SPOT_CATS.map(x => html`<button type="button" key=${x.key} aria-pressed=${String(c === x.key)} onClick=${() => setC(x.key)}><span class="kb">${x.kanji}</span>${x.label}</button>`)}
        </div>
      </div>`}
    ${!empty && scope === "trip" && !mine.length ? html`<${Empty} title=${`${trip.title}の候補はまだありません`} actions=${html`
        <button class="btn small ghost" type="button" onClick=${() => setScope("all")}>ぜんぶから選ぶ</button>
        ${aiReady() ? html`<button class="btn ghost small" type="button" onClick=${() => openSheet("ai", { start: "spots" })}>AIに提案してもらう</button>` : null}`}>
        「ぜんぶ」の中の場所で「この旅の候補に」を押すと、ここに集まります。
      <//>` : null}
    ${!empty && view === "map" ? html`<${SpotsMap} spots=${list} />` : null}
    ${!empty && view === "list" && list.length ? html`
      <div class="row group-row"><label class="flabel" for="sp-group">まとめ方</label>
        <select id="sp-group" class="mini-select" value=${g} onChange=${pickGroup}>${GROUPS.map(([v, l]) => html`<option key=${v} value=${v}>${l}</option>`)}</select></div>
      ${c === "stay" ? html`<${StayCompare} list=${list} />` : null}
      ${groupSpots(list, g).map(([label, arr]) => html`<div key=${label}>
        <h3 class="sec">${label}<span class="cnt">${arr.length}</span></h3>
        <div class="spots">${arr.map(s => html`<${SpotCard} key=${s.id} s=${s} />`)}</div>
      </div>`)}` : null}
    ${!empty && base.length && !list.length ? html`<p class="muted">この条件に合う場所はありません。</p>` : null}`;
}

/* Notion の「宿泊施設の比較」の代わり: 料金の安い順に、♡ と予約の状態を一列で */
function StayCompare({ list }) {
  const rows = list.slice().sort((a, b) => (a.price || Infinity) - (b.price || Infinity));
  return html`<div class="cmp-wrap"><table class="cmp">
    <caption>宿をくらべる</caption>
    <thead><tr><th scope="col">宿</th><th scope="col" class="num">1泊</th><th scope="col">♡</th><th scope="col">予約</th></tr></thead>
    <tbody>${rows.map(s => html`<tr key=${s.id}>
      <th scope="row"><button class="link-btn" type="button" onClick=${() => openSheet("spot", { id: s.id })}>${s.name}</button>${placeLabel(s) ? html`<small>${placeLabel(s)}</small>` : null}</th>
      <td class="num">${s.price ? yen(s.price) : "—"}</td>
      <td class="hearts">${heartsOf(s)}</td>
      <td><${ResvBadge} v=${s.resv} /></td>
    </tr>`)}</tbody>
  </table></div>`;
}

function SpotCard({ s }) {
  const k = meKey();
  const o = other(k);
  const trip = curTrip();
  const mine = !!(k && s.likes && s.likes[k]);
  const theirs = !!(s.likes && s.likes[o]);
  const both = isBoth(s);
  const c = cat(s.cat);
  const inTrip = !!(trip && s.tripId === trip.id);
  const sched = inTrip ? sortPlan(S.plan.filter(p => p.spotId === s.id))[0] : null;
  const days = tripDays(trip);
  const dayLabel = sched ? (days.indexOf(sched.date) >= 0 ? `${days.indexOf(sched.date) + 1}日目` : "日付未定") + (sched.time ? " " + sched.time : "") : "";
  const q = [s.name, s.area].filter(Boolean).join(" ");
  const tagTrip = s.tripId && !inTrip ? tripById(s.tripId) : null;
  const mem = (S.memories || []).filter(m => m.spotId === s.id && m.photos && m.photos.length).sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0];
  return html`<article class=${"spot" + (both && !s.visited ? " both" : "") + (s.visited ? " went" : "") + (mem ? " has-cover" : "")}>
    ${mem ? html`<button type="button" class="sp-cover" onClick=${() => openSheet("memory", { id: mem.id })} aria-label=${s.name + "の思い出"}><${Photo} id=${mem.photos[0].id} alt="" /></button>` : null}
    ${both && !s.visited ? html`<div class=${"stamp" + (isFresh(s) ? " fresh" : "")} role="img" aria-label="ふたりとも行きたい"><small>ふたりとも</small><b>行きたい</b></div>` : null}
    ${s.visited ? html`<div class="stamp went" role="img" aria-label="行った"><small>${s.visitedAt ? mdw(s.visitedAt) : ""}</small><b>行った</b></div>` : null}
    <div class="sp-top"><${KB} c=${c} /><span>${c.label}</span>${placeLabel(s) ? html`<span class="sp-area">${placeLabel(s)}</span>` : null}
      ${s.ai ? html`<span class="sp-ai">AI提案</span>` : null}${isNew(s) ? html`<span class="new">NEW</span>` : null}</div>
    <h3 class="sp-name">${s.name}</h3>
    ${s.resv || s.price || tagTrip ? html`<div class="sp-tags"><${ResvBadge} v=${s.resv} />
      ${s.price ? html`<span class="sp-price">${c.key === "stay" ? "1泊 " : ""}${yen(s.price)}</span>` : null}
      ${tagTrip ? html`<span class="sp-trip">${tagTrip.title}の候補</span>` : null}</div>` : null}
    ${s.note ? html`<p class="sp-note">${s.note}</p>` : null}
    <div class="sp-links">
      <a href=${hasGeo(s) ? gmapQ(s.geo.lat + "," + s.geo.lng) : gmapQ(q)} target="_blank" rel="noopener">地図で見る</a>
      ${okUrl(s.url) ? html`<a href=${s.url} target="_blank" rel="noopener noreferrer">${hostOf(s.url)}</a>` : null}
      ${!S.readOnly && !s.visited ? html`<button class="link-btn" type="button" onClick=${() => openSheet("memory", { spot: s.id })}>行った！</button>` : null}
      ${!S.readOnly ? html`<button type="button" class="link-btn sp-edit" aria-label=${s.name + "を編集"} onClick=${() => openSheet("spot", { id: s.id })}>編集</button>` : null}
    </div>
    <div class="sp-foot">
      ${k ? html`<button type="button" class=${"heart" + (mine ? " on" : "")} aria-pressed=${String(mine)} disabled=${S.readOnly} onClick=${() => toggleLike(s)}>
        <${Icon} n="heart" />${mine ? "行きたい！" : "行きたい"}</button>` : null}
      <span class=${"their" + (theirs ? " on" : "")}><${Icon} n="heart" />${k ? (theirs ? nm(o) + "も行きたい" : nm(o) + "はまだ") : (s.likes && (s.likes.a || s.likes.b) ? "♡ あり" : "")}</span>
      ${sched ? html`<span class="sp-sched">${dayLabel} に予定済み</span>`
        : S.readOnly || s.visited || !trip ? null
        : inTrip ? html`<button type="button" class="btn ghost small" onClick=${() => openSheet("plan", { spot: s.id })}>旅程に入れる</button>`
        : html`<button type="button" class="btn ghost small" onClick=${() => tagToTrip(s, trip.id).then(ok => ok && toast(`${trip.title}の候補に入れました`))}>${isDate(trip) ? "このデートの候補に" : "この旅の候補に"}</button>`}
    </div>
  </article>`;
}

/* the wish list on a map; tapping a pin shows the name and opens the card */
function SpotsMap({ spots }) {
  const el = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const fitted = useRef("");
  const [err, setErr] = useState("");
  const placed = spots.filter(hasGeo);
  const unknown = spots.filter(s => !hasGeo(s));
  const untried = unknown.filter(s => !s.geo);
  const sig = placed.map(s => s.id + ":" + s.geo.lat + "," + s.geo.lng + ":" + heartsOf(s) + (s.visited ? "v" : "")).join("|");
  useEffect(() => {
    let dead = false;
    loadLeaflet().then(L => {
      if (dead || !el.current) return;
      const m = L.map(el.current, { zoomControl: true, attributionControl: true });
      L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTR }).addTo(m);
      map.current = m;
      layer.current = L.layerGroup().addTo(m);
      draw();
    }, () => setErr("地図を読み込めませんでした。通信状況を確認してください。"));
    return () => { dead = true; if (map.current) map.current.remove(); map.current = null; };
  }, []);
  useEffect(() => { draw(); }, [sig]);
  function draw() {
    const L = window.L, m = map.current;
    if (!L || !m) return;
    layer.current.clearLayers();
    const pts = [];
    placed.forEach(s => {
      const c = cat(s.cat);
      const icon = L.divIcon({ className: "", html: `<span class="pin pin-${c.key}${isBoth(s) ? " both" : ""}${s.visited ? " went" : ""}"><i>${c.kanji}</i></span>`, iconSize: [30, 30], iconAnchor: [15, 36], popupAnchor: [0, -32] });
      // popup built from DOM nodes: names come from people, never inject them as HTML
      const box = document.createElement("div");
      box.className = "pop";
      const b = document.createElement("b"); b.textContent = s.name; box.appendChild(b);
      const meta = document.createElement("span"); meta.textContent = [c.label, placeLabel(s), heartsOf(s), s.visited ? "行った" : ""].filter(Boolean).join(" ・ "); box.appendChild(meta);
      if (!S.readOnly) {
        const open = document.createElement("button"); open.type = "button"; open.className = "link-btn"; open.textContent = "くわしく・編集";
        open.onclick = () => openSheet("spot", { id: s.id });
        box.appendChild(open);
      }
      L.marker([s.geo.lat, s.geo.lng], { icon, title: s.name }).bindPopup(box).addTo(layer.current);
      pts.push([s.geo.lat, s.geo.lng]);
    });
    const key = placed.map(s => s.id).sort().join(",");
    if (fitted.current === key) return;
    fitted.current = key;
    if (pts.length === 1) m.setView(pts[0], 14);
    else if (pts.length) m.fitBounds(pts, { padding: [36, 36], maxZoom: 15 });
    else m.setView([36.2, 138.2], 5);
  }
  return html`<div class="map-box">
    ${err ? html`<p class="err">${err}</p>` : html`<div class="map" ref=${el} role="region" aria-label="行きたい場所の地図"></div>`}
    ${unknown.length ? html`<p class="hint map-note">地図にのっていない場所が${unknown.length}件あります。
      ${untried.length && !S.readOnly ? html`<button class="link-btn" type="button" onClick=${() => { toast("位置を調べています…"); locateSpots(untried.map(s => s.id)); }}>位置を調べる</button>` : "編集画面の「位置」から地図で決められます。"}</p>` : null}
    <p class="hint">地図: © OpenStreetMap の協力者</p>
  </div>`;
}

/* ---------- money ---------- */
function settle(arr) {
  const paid = { a: 0, b: 0 }, share = { a: 0, b: 0 };
  let total = 0;
  arr.forEach(e => {
    const v = Math.max(0, +e.amount || 0);
    total += v;
    paid[e.paidBy === "b" ? "b" : "a"] += v;
    if (e.split === "a" || e.split === "b") share[e.split] += v;
    else { share.a += v / 2; share.b += v / 2; }
  });
  const net = paid.a - share.a;
  return { total, paid, share, amt: Math.round(Math.abs(net)), from: net > 0 ? "b" : "a", to: net > 0 ? "a" : "b" };
}
const splitLabel = s => (s === "a" || s === "b" ? nm(s) + "の分" : "ふたりで半分");

function MoneyView({ trip }) {
  const list = S.money.slice().sort((x, y) => (y.date || "").localeCompare(x.date || "") || (y.createdAt || 0) - (x.createdAt || 0));
  const st = settle(S.money);
  const planned = S.plan.reduce((a, p) => a + (p.cost || 0), 0);
  const byCat = MONEY_CATS.map(c => Object.assign({}, c, { amt: S.money.filter(e => mcat(e.cat).key === c.key).reduce((a, e) => a + (+e.amount || 0), 0) }))
    .filter(x => x.amt > 0).sort((a, b) => b.amt - a.amt);
  const max = byCat.length ? byCat[0].amt : 0;
  const budget = trip.budget || 0;
  const pct = budget ? st.total / budget : 0;
  const tone = pct > 1 ? "danger" : pct >= 0.8 ? "warn" : "ok";
  const settleText = st.amt >= 1 ? `精算: ${nm(st.from)} → ${nm(st.to)} ${yen(st.amt)}（${trip.title}）` : "";
  return html`
    <div class="vh">
      <h2>お金</h2>
      <div class="vh-act">${!S.readOnly ? html`<button class="btn small" type="button" onClick=${() => openSheet("money", {})}><${Icon} n="plus" />記録する</button>` : null}</div>
    </div>
    <div class="sum">
      <div><p class="sum-l">つかった合計</p><p class="hero-n">${yen(st.total)}</p></div>
      ${budget ? html`<div class="field">
        <div class=${"meter " + tone} role="meter" aria-label="予算の使用状況" aria-valuemin="0" aria-valuemax=${budget} aria-valuenow=${st.total}>
          <span style=${"width:" + Math.min(100, pct * 100).toFixed(1) + "%"}></span>
        </div>
        <div class="meter-t"><span>予算 ${yen(budget)}（${Math.round(pct * 100)}%）</span>
          ${st.total > budget ? html`<b class="over">${yen(st.total - budget)} オーバー</b>` : html`<b>のこり ${yen(budget - st.total)}</b>`}</div>
      </div>` : !S.readOnly ? html`<button class="link-btn" type="button" onClick=${() => openSheet("trip", { id: trip.id })}>予算を決めると、のこりがわかります</button>` : null}
      ${planned ? html`<p class="hint">旅程に書いた費用の合計（見積もり）: ${yen(planned)}</p>` : null}
    </div>
    ${S.money.length ? html`<section class="settle" aria-label="精算">
      <div class="settle-h"><h3>精算</h3>
        ${settleText ? html`<button class="btn ghost small" type="button" onClick=${() => copyOrShow(settleText, "精算額をコピーしました")}><${Icon} n="copy" />コピー</button>` : null}</div>
      ${st.amt >= 1 ? html`<div class="settle-main"><span class=${"who who-" + st.from}>${initial(nm(st.from))}</span>${nm(st.from)} →
        <span class=${"who who-" + st.to}>${initial(nm(st.to))}</span>${nm(st.to)}<span class="settle-amt">${yen(st.amt)}</span></div>
        <p class="hint">これを払えば、ちょうど精算できます。</p>`
        : html`<div class="settle-main">精算はいりません</div><p class="hint">いまの記録では、ふたりの負担はちょうど同じです。</p>`}
      <table class="split-t"><thead><tr><th></th><th>払った</th><th>負担する分</th></tr></thead>
        <tbody>${KEYS.map(x => html`<tr key=${x}><td>${nm(x)}</td><td>${yen(st.paid[x])}</td><td>${yen(st.share[x])}</td></tr>`)}</tbody></table>
    </section>` : null}
    ${byCat.length > 1 ? html`<h3 class="sec">カテゴリ別</h3>
      <table class="cat-t"><caption class="sr">カテゴリ別の支出</caption><tbody>
        ${byCat.map(x => html`<tr key=${x.key} title=${x.label + " " + yen(x.amt)}>
          <th scope="row"><span class="kb">${x.kanji}</span>${x.label}</th>
          <td class="bar-c"><span class="bar" style=${"width:" + Math.max(1.5, x.amt / max * 100).toFixed(1) + "%"}></span></td>
          <td class="num">${yen(x.amt)}</td></tr>`)}
      </tbody></table>` : null}
    <h3 class="sec">記録<span class="cnt">${list.length}</span></h3>
    ${!list.length ? html`<${Empty} title="まだお金の記録がありません" actions=${!S.readOnly ? html`<button class="btn small" type="button" onClick=${() => openSheet("money", {})}><${Icon} n="plus" />記録する</button>` : null}>
        旅先で払ったものを記録すると、立て替えた分をふまえて「だれがだれにいくら払えばいいか」を自動で計算します。
      <//>` : html`<ul class="list">${list.map(e => {
        const c = mcat(e.cat);
        const Main = S.readOnly ? "div" : "button";
        return html`<li class="ex" key=${e.id}><${Main} class="ex-b" type=${S.readOnly ? null : "button"} onClick=${S.readOnly ? null : () => openSheet("money", { id: e.id })}>
          <span class="kb" title=${c.label}>${c.kanji}</span>
          <span class="ex-t">${e.title || c.label}${isNew(e) ? html`<span class="new">NEW</span>` : null}</span>
          <span class="ex-a">${yen(e.amount)}</span>
          <span class="ex-m">${e.date ? mdw(e.date) + " ・ " : ""}${nm(e.paidBy === "b" ? "b" : "a")}が支払い ・ ${splitLabel(e.split)}</span>
        <//></li>`;
      })}</ul>`}`;
}

/* ---------- prep: to-dos + packing ---------- */
function togglePunch(c, x) {
  const path = tp(S.tripId, "checks", c.id);
  if (x) wr("update", path, { checkedBy: { [x]: !(c.checkedBy && c.checkedBy[x]) } });
  else wr("update", path, { checked: !c.checked });
}
function dueInfo(d) {
  const n = diffDays(todayISO(), d);
  if (n < 0) return { text: `${-n}日すぎています`, tone: "late" };
  if (n === 0) return { text: "きょうまで", tone: "soon" };
  if (n <= 3) return { text: `あと${n}日（${mdw(d)}まで）`, tone: "soon" };
  return { text: `${mdw(d)}まで`, tone: "" };
}
const ownerLabel = c => (c.owner === "each" ? "各自" : c.owner === "share" ? (c.type === "todo" ? "ふたりで" : "どちらか") : nm(c.owner));
const Punch = ({ on, who, label, onToggle }) => html`<button type="button" class=${"punch p-" + who + (on ? " on" : "")}
  aria-pressed=${String(on)} aria-label=${label + (on ? "（済み）" : "（まだ）")} title=${label} disabled=${S.readOnly} onClick=${onToggle}>
  ${who === "a" || who === "b" ? initial(nm(who)) : on ? html`<${Icon} n="check" />` : null}
</button>`;

function CheckRow({ c }) {
  const each = c.owner === "each";
  const done = checkDone(c);
  const due = c.type === "todo" && c.due && !done ? dueInfo(c.due) : null;
  const Main = S.readOnly ? "div" : "button";
  return html`<li class=${"chk" + (done ? " done" : "")}>
    <span class="punches">
      ${each ? KEYS.map(x => html`<${Punch} key=${x} who=${x} on=${!!(c.checkedBy && c.checkedBy[x])} label=${nm(x)} onToggle=${() => togglePunch(c, x)} />`)
        : html`<${Punch} who=${c.owner === "a" || c.owner === "b" ? c.owner : "s"} on=${!!c.checked} label=${ownerLabel(c)} onToggle=${() => togglePunch(c, null)} />`}
    </span>
    <${Main} class="chk-main" type=${S.readOnly ? null : "button"} onClick=${S.readOnly ? null : () => openSheet("check", { id: c.id })}>
      <span class="chk-t">${c.text}${isNew(c) ? html`<span class="new">NEW</span>` : null}</span>
      <span class="chk-meta"><span>${ownerLabel(c)}</span>${due ? html`<span class=${"due " + due.tone}>${due.text}</span>` : null}</span>
    <//>
  </li>`;
}

function QuickAdd({ type }) {
  const k = meKey() || "a";
  const o = other(k);
  const [text, setText] = useState("");
  const [owner, setOwner] = useState(type === "pack" ? "each" : "share");
  const opts = type === "pack" ? [["each", "各自"], ["share", "どちらか"], [k, nm(k)], [o, nm(o)]] : [["share", "ふたりで"], [k, nm(k)], [o, nm(o)]];
  async function add(e) {
    e.preventDefault();
    const t = clip(text, 80);
    if (!t) return;
    setText("");
    await wr("set", tp(S.tripId, "checks", newId()), {
      text: t, type, owner, group: type === "pack" ? "その他" : "", due: "",
      checked: false, checkedBy: { a: false, b: false }, by: meKey(), createdAt: Date.now(),
    });
  }
  return html`<form class="qa" onSubmit=${add}>
    <input id=${"qa-" + type} value=${text} onInput=${e => setText(e.target.value)} maxlength="80" enterkeyhint="done" autocomplete="off"
      aria-label=${type === "pack" ? "持ち物を追加" : "やることを追加"} placeholder=${type === "pack" ? "持ち物を追加（例: モバイルバッテリー）" : "やることを追加（例: 宿を予約する）"} />
    <div class="qa-row">
      <${Seg} small value=${owner} onChange=${setOwner} label="担当" options=${opts} />
      <button class="btn small" type="submit" disabled=${!text.trim()}>追加</button>
    </div>
  </form>`;
}

function PrepView({ trip }) {
  const k = meKey();
  const todos = S.checks.filter(c => c.type === "todo").sort(byCreated);
  const packs = S.checks.filter(c => c.type !== "todo").sort(byCreated);
  const units = c => (c.owner === "each" ? 2 : 1);
  const doneUnits = c => (c.owner === "each" ? (c.checkedBy && c.checkedBy.a ? 1 : 0) + (c.checkedBy && c.checkedBy.b ? 1 : 0) : c.checked ? 1 : 0);
  const packTotal = packs.reduce((a, c) => a + units(c), 0);
  const packDone = packs.reduce((a, c) => a + doneUnits(c), 0);
  const groups = PACK_GROUPS.map(g => ({ g, items: packs.filter(c => (PACK_GROUPS.indexOf(c.group) >= 0 ? c.group : "その他") === g) })).filter(x => x.items.length);
  return html`
    <div class="vh">
      <h2>準備</h2>
      <div class="vh-act">
        ${!S.readOnly ? html`<button class="btn ghost small" type="button" onClick=${() => openSheet("tmpl")}>テンプレートから追加</button>` : null}
        ${aiReady() ? html`<button class="btn ghost small" type="button" onClick=${() => openSheet("ai", { start: "pack" })}>AIで持ち物リスト</button>` : null}
      </div>
    </div>
    <${ResvBlock} trip=${trip} />
    <section class="block">
      <header class="block-h"><h3>やること</h3><span class="prog">${todos.filter(checkDone).length}/${todos.length}</span>
        ${k ? html`<span class="hint">あなたの分 のこり ${openTodos(k)}</span>` : null}</header>
      ${!S.readOnly ? html`<${QuickAdd} type="todo" />` : null}
      ${todos.length ? html`<ul class="list">${todos.map(c => html`<${CheckRow} key=${c.id} c=${c} />`)}</ul>`
        : html`<p class="hint">宿や交通の予約など、出発までにやることを書いておきましょう。期限を入れると近づいたときに目立ちます。</p>`}
    </section>
    <section class="block">
      <header class="block-h"><h3>持ち物</h3><span class="prog">${packDone}/${packTotal}</span></header>
      ${!S.readOnly ? html`<${QuickAdd} type="pack" />` : null}
      ${groups.map(x => html`<div key=${x.g}><h4 class="grp">${x.g}</h4><ul class="list">${x.items.map(c => html`<${CheckRow} key=${c.id} c=${c} />`)}</ul></div>`)}
      ${!packs.length ? html`<p class="hint">「各自」はふたりそれぞれ、「どちらか」はどちらかひとりが持てばいいもの。チェック欄はあなたと相手で別々です。</p>` : null}
    </section>`;
}

/* ---------- booklet ---------- */
function buildText(trip) {
  const L = [];
  const days = tripDays(trip);
  const plan = sortPlan(S.plan);
  const line = p => `${p.time ? p.time + (p.end ? "〜" + p.end : "") : "時刻未定"}　${p.title}${p.place && p.place !== p.title ? "（" + p.place + "）" : ""}${p.note ? " ※" + p.note : ""}`;
  L.push(`【${trip.title}】`);
  L.push(`${trip.from ? trip.from + " → " : ""}${trip.dest}`);
  if (trip.start) L.push(`${mdw(trip.start)}〜${mdw(trip.end || trip.start)}（${nightsDays(trip)}）`);
  L.push(`${nm("a")} と ${nm("b")}`);
  if (trip.memo) { L.push(""); L.push("■ メモ"); L.push(trip.memo); }
  days.forEach((d, i) => {
    const its = plan.filter(p => p.date === d);
    L.push(""); L.push(`■ ${i + 1}日目 ${mdw(d)}`);
    if (!its.length) L.push("（予定なし）");
    its.forEach(p => L.push(line(p)));
  });
  const und = plan.filter(p => days.indexOf(p.date) < 0);
  if (und.length) { L.push(""); L.push("■ 日付未定"); und.forEach(p => L.push(line(p))); }
  const both = tripSpots().filter(isBoth);
  if (both.length) { L.push(""); L.push("■ ふたりとも行きたい"); both.forEach(s => L.push("・" + s.name + (s.area ? "（" + s.area + "）" : ""))); }
  const todos = S.checks.filter(c => c.type === "todo" && !checkDone(c));
  if (todos.length) { L.push(""); L.push("■ まだのやること"); todos.forEach(c => L.push(`・${c.text}（${ownerLabel(c)}${c.due ? "・" + mdw(c.due) + "まで" : ""}）`)); }
  const packs = S.checks.filter(c => c.type !== "todo");
  if (packs.length) { L.push(""); L.push("■ 持ち物"); packs.forEach(c => L.push(`${checkDone(c) ? "☑" : "☐"} ${c.text}（${ownerLabel(c)}）`)); }
  if (S.money.length || trip.budget) {
    const st = settle(S.money);
    L.push(""); L.push("■ お金");
    L.push(`つかった合計 ${yen(st.total)}${trip.budget ? `／予算 ${yen(trip.budget)}` : ""}`);
    if (st.amt >= 1) L.push(`精算: ${nm(st.from)} → ${nm(st.to)} ${yen(st.amt)}`);
  }
  return L.join("\n");
}
async function saveText(trip, text) {
  try {
    await S.dl.save({ filename: (String(trip.title || "旅").replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40) || "旅") + "_しおり.txt", data: text });
    toast("保存しました");
  } catch (e) {
    const c = e && e.code;
    if (c === "declined") return;
    toast(c === "rate_limited" ? "少し待ってからもう一度どうぞ" : "保存できませんでした");
  }
}

function BookView({ trip }) {
  const days = tripDays(trip);
  const plan = sortPlan(S.plan);
  const stays = plan.filter(p => p.kind === "stay");
  const both = tripSpots().filter(isBoth);
  const resv = S.plan.filter(p => p.resv).concat(tripSpots().filter(sp => sp.resv && !sp.visited).map(sp => ({ id: sp.id, title: sp.name, resv: sp.resv })));
  const todos = S.checks.filter(c => c.type === "todo" && !checkDone(c));
  const packLeft = S.checks.filter(c => c.type !== "todo" && !checkDone(c));
  const st = settle(S.money);
  const dayNo = d => (days.indexOf(d) >= 0 ? `${days.indexOf(d) + 1}日目` : "日付未定");
  return html`
    <div class="book-acts">
      <button class="btn small" type="button" onClick=${() => copyOrShow(buildText(trip), "しおりをコピーしました。LINEなどに貼れます")}><${Icon} n="copy" />テキストでコピー</button>
      ${S.dl ? html`<button class="btn ghost small" type="button" onClick=${() => saveText(trip, buildText(trip))}><${Icon} n="down" />ファイルに保存</button>` : null}
      ${trip.start ? html`<a class="btn ghost small" href=${tripCal(trip)} target="_blank" rel="noopener"><${Icon} n="cal" />カレンダーに登録</a>` : null}
    </div>
    <article class="book">
      <header class="bk-cover">
        <p class="bk-kicker">旅のしおり</p>
        <h3 class="bk-title">${trip.title}</h3>
        <p class="bk-route">${trip.from ? trip.from + " → " : ""}${trip.dest}</p>
        <p class="bk-date">${trip.start ? `${mdw(trip.start)}〜${mdw(trip.end || trip.start)}　${nightsDays(trip)}` : "日にち未定"}</p>
        <p class="bk-who">${nm("a")} と ${nm("b")}</p>
      </header>
      ${trip.memo ? html`<section class="bk-sec"><h4>メモ</h4><p class="pre">${trip.memo}</p></section>` : null}
      ${days.map((d, i) => {
        const its = plan.filter(p => p.date === d);
        return html`<section class="bk-sec" key=${d}><h4>${i + 1}日目<small>${mdw(d)}</small></h4>
          ${its.length ? html`<ul class="bk-list">${its.map(p => html`<li key=${p.id}><span class="bk-time">${p.time || "--:--"}</span>
            <span>${p.title}${p.place && p.place !== p.title ? html`<small>${p.place}</small>` : null}</span></li>`)}</ul>`
            : html`<p class="muted">予定はまだありません</p>`}
        </section>`;
      })}
      ${stays.length ? html`<section class="bk-sec"><h4>宿</h4><ul class="bk-plain">${stays.map(p => html`<li key=${p.id}>${dayNo(p.date)}　${p.title}${p.place && p.place !== p.title ? "（" + p.place + "）" : ""}</li>`)}</ul></section>` : null}
      ${resv.length ? html`<section class="bk-sec"><h4>予約</h4><ul class="bk-plain">${resv.map(r => html`<li key=${r.id}>${r.resv === "done" ? "☑" : "☐"} ${r.title}（${r.resv === "done" ? "予約済み" : "要予約"}）</li>`)}</ul></section>` : null}
      ${both.length ? html`<section class="bk-sec"><h4>ふたりとも行きたい</h4><ul class="bk-plain">${both.map(s => html`<li key=${s.id}>・${s.name}</li>`)}</ul></section>` : null}
      ${todos.length ? html`<section class="bk-sec"><h4>まだのやること</h4><ul class="bk-plain">${todos.map(c => html`<li key=${c.id}>・${c.text}（${ownerLabel(c)}）</li>`)}</ul></section>` : null}
      ${packLeft.length ? html`<section class="bk-sec"><h4>まだの持ち物</h4><ul class="bk-plain">${packLeft.map(c => html`<li key=${c.id}>・${c.text}（${ownerLabel(c)}）</li>`)}</ul></section>` : null}
      ${S.money.length || trip.budget ? html`<section class="bk-sec"><h4>お金</h4><ul class="bk-plain">
        <li>つかった合計 ${yen(st.total)}${trip.budget ? `／予算 ${yen(trip.budget)}` : ""}</li>
        ${st.amt >= 1 ? html`<li>精算: ${nm(st.from)} → ${nm(st.to)} ${yen(st.amt)}</li>` : null}
      </ul></section>` : null}
    </article>`;
}

/* ---------- sheets (bottom sheet on phones, dialog on wide screens) ---------- */
function Sheet({ title, onClose, children, wide }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement;
    document.body.classList.add("lock");
    if (ref.current) try { ref.current.focus({ preventScroll: true }); } catch (e) {}
    const onKey = e => { if (e.key === "Escape" && closeRef.current) closeRef.current(); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("lock");
      if (prev && prev.focus && document.contains(prev)) try { prev.focus({ preventScroll: true }); } catch (e) {}
    };
  }, []);
  return html`<div class="sheet-bg" onClick=${e => { if (e.target === e.currentTarget && onClose) onClose(); }}>
    <div class=${"sheet" + (wide ? " wide" : "")} role="dialog" aria-modal="true" aria-label=${title} tabindex="-1" ref=${ref}>
      <div class="sheet-h"><h2>${title}</h2>
        ${onClose ? html`<button class="icon-b" type="button" aria-label="閉じる" onClick=${onClose}><${Icon} n="close" /></button>` : null}</div>
      <div class="sheet-b">${children}</div>
    </div>
  </div>`;
}
function SheetHost({ s, trip }) {
  const C = {
    trip: TripSheet, trips: TripsSheet, spot: SpotSheet, plan: PlanSheet, money: MoneySheet, check: CheckSheet,
    tmpl: TemplateSheet, roulette: RouletteSheet, ai: AiSheet, menu: MenuSheet, who: WhoSheet, text: TextSheet, share: ShareSheet,
    memory: MemorySheet, book: BookSheet,
  }[s.type];
  if (!C) return null;
  if (!trip && ["trips", "trip", "who", "menu", "text", "share", "memory"].indexOf(s.type) < 0) return null;
  return html`<${C} ...${s.props} trip=${trip} />`;
}
function DeleteZone({ label, warning, onDelete }) {
  const [ask, setAsk] = useState(false);
  return html`<div class="danger-zone">
    ${ask ? html`<p>${warning}</p><div class="row">
        <button type="button" class="btn danger small" onClick=${onDelete}>削除する</button>
        <button type="button" class="btn ghost small" onClick=${() => setAsk(false)}>やめる</button></div>`
      : html`<button type="button" class="link-danger" onClick=${() => setAsk(true)}>${label}</button>`}
  </div>`;
}

function TripSheet({ id, kind, date }) {
  const t = id ? (S.trips || []).find(x => x.id === id) : null;
  const def = defaultDates();
  const [f, setF] = useState(() => (t
    ? { kind: t.kind || "trip", dest: t.dest || "", from: t.from || "", title: t.title || "", start: t.start || "", end: t.end || "", budget: t.budget ? String(t.budget) : "", memo: t.memo || "" }
    : { kind: kind || "trip", dest: "", from: (curTrip() && curTrip().from) || "", title: "", start: date || def[0], end: date || def[1], budget: "", memo: "" }));
  const [err, setErr] = useState("");
  const set = tripSetter(setF);
  const setKind = v => setF(p => Object.assign({}, p, { kind: v }));
  const word = f.kind === "date" ? "デート" : "旅";
  async function save(e) {
    e.preventDefault();
    const v = validateTrip(f);
    if (v.err) return setErr(v.err);
    if (t) { if (await wr("update", "trips/" + t.id, v.data)) { toast("保存しました"); closeSheet(); } return; }
    const nid = newId();
    if (await wr("set", "trips/" + nid, Object.assign({}, v.data, { createdAt: Date.now(), by: meKey() }))) {
      selectTrip(nid); closeSheet(); setTab("plan"); toast(f.kind === "date" ? "デートのきっぷを発行しました" : "新しいきっぷを発行しました");
    }
  }
  async function del() {
    if (!t) return;
    // the database removes its plan, money and checks; wish-list spots stay, just no longer tied to it
    const tagged = S.spots.filter(s => s.tripId === t.id);
    for (let i = 0; i < tagged.length; i += 6) await Promise.all(tagged.slice(i, i + 6).map(s => wr("update", "spots/" + s.id, { tripId: "" })));
    if (await wr("delete", "trips/" + t.id)) { if (LS.get("trip", null) === t.id) LS.set("trip", null); closeSheet(); toast(`${word}を削除しました`); }
  }
  return html`<${Sheet} title=${t ? `${word}を編集` : f.kind === "date" ? "デートを入れる" : "新しい旅"} onClose=${closeSheet}>
    <form class="form" onSubmit=${save}>
      <${TripFields} f=${f} set=${set} setKind=${t ? null : setKind} />
      ${err ? html`<p class="err" role="alert">${err}</p>` : null}
      <button class="btn big" type="submit">${t ? "保存する" : "きっぷを発行する"}</button>
    </form>
    ${t ? html`<${DeleteZone} label=${`この${word}を削除…`} warning=${`この${word}の予定・お金・準備の記録がすべて消えます。行きたい場所と思い出は残ります。相手の画面からも消え、元に戻せません。`} onDelete=${del} />` : null}
  <//>`;
}

const outingWhen = t => (isDate(t) ? `${mdw(t.start)} ・ デート` : `${mdw(t.start)}〜${mdw(t.end || t.start)} ・ ${nightsDays(t)}`);
function OutingStub({ t, onPick }) {
  const n = (S.memories || []).filter(m => m.tripId === t.id).length;
  return html`<button type="button" class=${"stub" + (t.id === S.tripId ? " on" : "") + (isDate(t) ? " stub-date" : "")}
    aria-current=${t.id === S.tripId ? "true" : null} onClick=${onPick}>
    <span class="stub-r">${t.from ? t.from + " → " : ""}${t.dest}</span>
    <span class="stub-t">${t.title}</span>
    <span class="stub-d">${outingWhen(t)}${n ? ` ・ 思い出 ${n}` : ""}</span>
  </button>`;
}

function TripsSheet() {
  const today = todayISO();
  const all = (S.trips || []).slice().sort((a, b) => (a.start || "").localeCompare(b.start || ""));
  const soon = all.filter(t => (t.end || t.start || "") >= today);
  const past = all.filter(t => (t.end || t.start || "") < today).reverse();
  const pick = t => () => { selectTrip(t.id); closeSheet(); };
  return html`<${Sheet} title="きりかえ" onClose=${closeSheet}>
    ${soon.length ? html`<h3 class="sec">これから</h3><ul class="trip-list">${soon.map(t => html`<li key=${t.id}><${OutingStub} t=${t} onPick=${pick(t)} /></li>`)}</ul>` : null}
    ${past.length ? html`<h3 class="sec">行ってきた</h3><ul class="trip-list">${past.map(t => html`<li key=${t.id}><${OutingStub} t=${t} onPick=${pick(t)} /></li>`)}</ul>` : null}
    ${!S.readOnly ? html`<div class="row">
      <button class="btn" type="button" onClick=${() => openSheet("trip", { kind: "trip" })}><${Icon} n="plus" />旅行をつくる</button>
      <button class="btn ghost" type="button" onClick=${() => openSheet("trip", { kind: "date" })}><${Icon} n="plus" />デートを入れる</button>
    </div>` : null}
  <//>`;
}

function WhoSheet({ fromMenu }) {
  const m = S.members || {};
  async function pick(k) {
    S.meLocal = k; LS.set("me", k); S.whoSkip = false;
    if (S.uid && !S.readOnly) {
      const patch = {};
      const o = other(k);
      if (m[o] && m[o].uid === S.uid) patch[o] = { uid: null };
      if (!(m[k] && m[k].uid)) patch[k] = { uid: S.uid };
      if (Object.keys(patch).length) await wr("update", "app/members", patch);
    }
    closeSheet();
    changed();
  }
  const skip = () => { S.whoSkip = true; closeSheet(); changed(); };
  return html`<${Sheet} title="あなたはどちらですか？" onClose=${fromMenu ? closeSheet : skip}>
    <p>このきっぷは「${nm("a")}」と「${nm("b")}」のふたり用です。どちらとして使うか選んでください。♡ やチェックが、選んだ人の分として記録されます。</p>
    <div class="who-pick">${KEYS.map(k => html`<button key=${k} type="button" class="who-btn" onClick=${() => pick(k)}>
      <span class=${"av av-" + k}>${initial(nm(k))}</span><span>${nm(k)}です</span>
      ${m[k] && m[k].uid && m[k].uid !== S.uid ? html`<small>別のアカウントで使用中</small>` : null}</button>`)}</div>
    <p class="hint">選びなおしは、右上のメニューからいつでもできます。${fromMenu ? "" : "閉じると、見るだけのモードになります。"}</p>
  <//>`;
}

function MenuSheet() {
  const k = meKey();
  const [names, setNames] = useState({ a: nm("a"), b: nm("b") });
  async function saveNames(e) {
    e.preventDefault();
    const a = clip(names.a, 12), b = clip(names.b, 12);
    if (!a || !b) return toast("ふたりの呼び名を入れてください");
    if (await wr("update", "app/members", { a: { name: a }, b: { name: b } })) toast("呼び名を保存しました");
  }
  return html`<${Sheet} title="メニュー" onClose=${closeSheet}>
    <section class="m-sec">
      <h3>あなた</h3>
      <p>${k ? html`いまは「<b>${nm(k)}</b>」として使っています。` : "まだ選んでいません（見るだけのモード）。"}</p>
      <div class="row"><button class="btn ghost small" type="button" onClick=${() => openSheet("who", { fromMenu: true })}>選びなおす</button></div>
    </section>
    ${!S.readOnly && S.members ? html`<form class="m-sec" onSubmit=${saveNames}>
      <h3>ふたりの呼び名</h3>
      <div class="grid2">
        <${Field} id="n-a" label="ひとり目"><input id="n-a" value=${names.a} maxlength="12" onInput=${e => { const v = e.target.value; setNames(p => Object.assign({}, p, { a: v })); }} /><//>
        <${Field} id="n-b" label="ふたり目"><input id="n-b" value=${names.b} maxlength="12" onInput=${e => { const v = e.target.value; setNames(p => Object.assign({}, p, { b: v })); }} /><//>
      </div>
      <div class="row"><button class="btn small" type="submit">保存</button></div>
    </form>` : null}
    <section class="m-sec">
      <h3>ふたりで使うには</h3>
      <ol class="howto">
        <li>このきっぷ帳のリンクを相手に送ります（LINE など）。</li>
        <li>相手がリンクを開き、最初に自分の名前を選べば準備完了です。</li>
        <li>ホーム画面に追加しておくと、アプリのようにすぐ開けます。</li>
      </ol>
      <div class="row"><button class="btn small" type="button" onClick=${() => openSheet("share")}>リンクを共有…</button></div>
    </section>
    <section class="m-sec">
      <h3>AIについて</h3>
      <p class="hint">AIの提案は目安です。営業時間・料金・予約状況は公式の情報で確かめてください。AI機能は OpenAI の GPT-5.2 を使っていて、相談するときに旅の情報（行き先・日程・候補・予定）が送られます。</p>
    </section>
    <section class="m-sec">
      <h3>地図について</h3>
      <p class="hint">地図と場所の検索は OpenStreetMap を使っています。位置を調べるとき、場所の名前とエリアが OpenStreetMap に送られます。写真は、ふたりのきっぷ帳のメンバーだけが見られる場所に保存されます。</p>
    </section>
  <//>`;
}

/* invite the partner: the edit link (the secret that lets them write) and a view-only link */
function LinkBox({ kind, url, title, note, invite, qr, setQr }) {
  const canShare = typeof navigator.share === "function";
  return html`<section class="m-sec">
    <h3>${title}</h3>
    <p class="hint">${note}</p>
    <input class="share-url" readonly value=${url} onFocus=${e => e.target.select()} aria-label=${title} />
    <div class="row">
      ${canShare ? html`<button class="btn small" type="button" onClick=${() => navigator.share({ title: "ふたり旅きっぷ", text: invite, url }).catch(() => {})}>送る</button>` : null}
      <button class=${"btn small" + (canShare ? " ghost" : "")} type="button" onClick=${() => copyOrShow(url, "リンクをコピーしました")}><${Icon} n="copy" />コピー</button>
      ${setQr ? html`<button class="btn ghost small" type="button" aria-pressed=${String(qr === kind)} onClick=${() => setQr(qr === kind ? "" : kind)}>QRコード</button>` : null}
    </div>
    ${setQr && qr === kind ? html`<${QrCode} text=${url} label=${title + "のQRコード"} />` : null}
  </section>`;
}
/* QR code drawn in the browser, so the link never leaves the device */
function QrCode({ text, label }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    let dead = false;
    import("/vendor/qrcode.mjs").then(({ default: qrcode }) => {
      const q = qrcode(0, "M");
      q.addData(text);
      q.make();
      if (!dead) setSvg(q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }));
    }, () => setSvg(""));
    return () => { dead = true; };
  }, [text]);
  return html`<div class="qr" role="img" aria-label=${label} dangerouslySetInnerHTML=${{ __html: svg }}></div>`;
}

function ShareSheet({ first }) {
  const sh = S.share;
  const [qr, setQr] = useState(first ? "edit" : "");
  const k = meKey();
  const them = k ? nm(other(k)) : "相手";
  return html`<${Sheet} title=${first ? "相手を招待しましょう" : "リンクを共有"} onClose=${closeSheet}>
    ${first ? html`<p>きっぷを発行しました。下のリンクを${them}に送ると、ふたりで同じきっぷ帳に書き込めます。そばにいるなら、相手のスマホでQRコードを読み取るのが早いです。</p>` : null}
    ${sh ? html`
      <${LinkBox} kind="edit" url=${shareUrl(sh.edit)} title=${`編集できるリンク（${them}用）`} qr=${qr} setQr=${setQr}
        note=${`このリンクを知っている人は、だれでも書き込めます。ふたりの間だけで送ってください。開いたら「${them}です」を選んでもらいます。`}
        invite="ふたり旅きっぷで、旅の計画をいっしょに書こう！" />
      <${LinkBox} kind="view" url=${shareUrl(sh.view)} title="見るだけのリンク" qr=${qr} setQr=${setQr}
        note="旅程やしおりを家族や友だちに見せたいときに。このリンクからは書き込めません。"
        invite="ふたり旅の予定です" />`
    : html`<${LinkBox} kind="view" url=${shareUrl(TOKEN)} title="このきっぷ帳のリンク" note="見るだけのリンクです。" invite="ふたり旅の予定です" />`}
  <//>`;
}

function TextSheet({ text }) {
  return html`<${Sheet} title="コピー用のテキスト" onClose=${closeSheet}>
    <p class="hint">自動でコピーできませんでした。下のテキストを長押し（パソコンなら全選択）してコピーしてください。</p>
    <textarea class="copy-area" readonly value=${text} onFocus=${e => e.target.select()} aria-label="コピー用のテキスト"></textarea>
  <//>`;
}

function KindPicker({ value, onChange, cats, label }) {
  return html`<div class="field"><span class="flabel">${label || "種類"}</span>
    <div class="seg" role="group" aria-label=${label || "種類"}>
      ${cats.map(c => html`<button type="button" key=${c.key} aria-pressed=${String(value === c.key)} onClick=${() => onChange(c.key)}><span class="kb">${c.kanji}</span>${c.label}</button>`)}
    </div></div>`;
}
const formSetter = setF => k => e => { const v = e.target.value; setF(p => Object.assign({}, p, { [k]: v })); };

function SpotSheet({ id, tag }) {
  const s = id ? S.spots.find(x => x.id === id) : null;
  const trip = curTrip();
  const [f, setF] = useState(() => ({
    name: s ? s.name : "", cat: s ? s.cat || "other" : "see", area: s ? s.area || "" : "", note: s ? s.note || "" : "", url: s ? s.url || "" : "",
    resv: s ? s.resv || "" : "", price: s && s.price ? String(s.price) : "",
    inTrip: s ? !!(trip && s.tripId === trip.id) : !!(tag && trip),
    visited: s ? !!s.visited : false, visitedAt: s ? s.visitedAt || "" : "",
  }));
  const [loc, setLoc] = useState(() => (s && hasGeo(s) ? { lat: s.geo.lat, lng: s.geo.lng, city: s.city || "", country: s.country || "", cc: s.cc || "", how: s.geo.how || "auto" } : null));
  const [locTouched, setLocTouched] = useState(false);
  const [tagTouched, setTagTouched] = useState(!!s);
  const [err, setErr] = useState("");
  const set = formSetter(setF);
  const pick = key => v => setF(p => Object.assign({}, p, { [key]: v }));
  // a new place in the trip's destination counts as a candidate for it, unless unticked
  const inTrip = tagTouched ? f.inTrip : !!(trip && (f.inTrip || (trip.dest && (f.area + " " + f.name).includes(trip.dest))));
  async function save(e) {
    e.preventDefault();
    const name = clip(f.name, 60);
    if (!name) return setErr("場所の名前を入れてください");
    const url = f.url.trim();
    if (url && !okUrl(url)) return setErr("URLは https:// から始まる形で入れてください");
    const price = String(f.price).trim() === "" ? null : toNum(f.price);
    if (String(f.price).trim() !== "" && price == null) return setErr("料金は数字で入れてください");
    const body = {
      name, cat: f.cat, area: clip(f.area, 40), note: clip(f.note, 300), url: url.slice(0, 500),
      resv: f.resv, price, visited: f.visited, visitedAt: f.visited ? f.visitedAt || todayISO() : "",
    };
    if (trip) body.tripId = inTrip ? trip.id : s && s.tripId !== trip.id ? s.tripId || "" : "";
    else if (!s) body.tripId = "";
    if (locTouched && loc) Object.assign(body, { geo: { lat: loc.lat, lng: loc.lng, how: "pin" }, city: loc.city, country: loc.country, cc: loc.cc });
    // a renamed spot that was placed automatically gets looked up again
    const moved = s && !locTouched && (s.name !== name || (s.area || "") !== body.area) && !(s.geo && s.geo.how === "pin");
    if (moved) Object.assign(body, { geo: null, city: "", country: "", cc: "" });
    const k = meKey();
    const nid = s ? s.id : newId();
    const ok = s ? await wr("update", "spots/" + s.id, body)
      : await wr("set", "spots/" + nid, Object.assign(body, {
          by: k, likes: { a: k === "a", b: k === "b" }, likedAt: k ? { [k]: Date.now() } : {}, createdAt: Date.now() }));
    if (!ok) return;
    closeSheet();
    if (!s) toast(k ? "追加して ♡ をつけました" : "追加しました");
    if ((!s || moved) && !(locTouched && loc)) locateSpots([nid]);
  }
  async function del() { if (await wr("delete", "spots/" + s.id)) { closeSheet(); toast("削除しました"); } }
  return html`<${Sheet} title=${s ? "行きたい場所を編集" : "行きたい場所を追加"} onClose=${closeSheet}>
    <form class="form" onSubmit=${save}>
      <${Field} id="s-name" label="場所・お店の名前"><input id="s-name" value=${f.name} onInput=${set("name")} maxlength="60" placeholder="例: ひがし茶屋街" autocomplete="off" /><//>
      <${KindPicker} value=${f.cat} onChange=${pick("cat")} cats=${SPOT_CATS} />
      <${Field} id="s-area" label="エリア（任意）" hint="地図で探すときに使います"><input id="s-area" value=${f.area} onInput=${set("area")} maxlength="40" placeholder="例: 金沢" autocomplete="off" /><//>
      <${LocationPicker} loc=${loc} query=${[f.name, f.area].filter(Boolean).join(" ")} onChange=${l => { setLoc(l); setLocTouched(true); }} />
      ${trip ? html`<label class="check-line"><input type="checkbox" checked=${inTrip} onChange=${e => { const v = e.target.checked; setTagTouched(true); setF(p => Object.assign({}, p, { inTrip: v })); }} />
        「${trip.title}」の候補にする</label>` : null}
      <div class="grid2">
        <div class="field"><span class="flabel">予約</span><${Seg} small value=${f.resv} onChange=${pick("resv")} label="予約" options=${RESV} /></div>
        <${Field} id="s-price" label=${f.cat === "stay" ? "1泊の料金（ふたり）" : "料金のめやす"}><input id="s-price" inputmode="numeric" value=${f.price} onInput=${set("price")} placeholder=${f.cat === "stay" ? "例: 24000" : "例: 3000"} autocomplete="off" /><//>
      </div>
      <${Field} id="s-note" label="ひとこと（任意）"><textarea id="s-note" rows="3" value=${f.note} onInput=${set("note")} maxlength="300" placeholder="例: 金箔ソフトを食べたい"></textarea><//>
      <${Field} id="s-url" label="参考リンク（任意）"><input id="s-url" type="url" inputmode="url" value=${f.url} onInput=${set("url")} maxlength="500" placeholder="https://" autocomplete="off" /><//>
      <div class="grid2">
        <label class="check-line"><input type="checkbox" checked=${f.visited} onChange=${e => { const v = e.target.checked; setF(p => Object.assign({}, p, { visited: v, visitedAt: v && !p.visitedAt ? todayISO() : p.visitedAt })); }} />行った</label>
        ${f.visited ? html`<${Field} id="s-went" label="行った日"><input id="s-went" type="date" value=${f.visitedAt} onInput=${set("visitedAt")} /><//>` : html`<span></span>`}
      </div>
      ${err ? html`<p class="err" role="alert">${err}</p>` : null}
      <button class="btn big" type="submit">${s ? "保存する" : "追加する"}</button>
    </form>
    ${s ? html`<div class="links">
        ${trip && s.tripId === trip.id && !s.visited ? html`<button class="link-btn" type="button" onClick=${() => openSheet("plan", { spot: s.id })}>旅程に入れる</button>` : null}
        <button class="link-btn" type="button" onClick=${() => openSheet("memory", { spot: s.id })}>思い出を残す</button>
      </div>
      <${DeleteZone} label="この場所を削除…" warning="この場所と、ふたりの ♡ が消えます。旅程に入れた予定と思い出は残ります。" onDelete=${del} />` : null}
  <//>`;
}

/* pick where a place is: search OpenStreetMap, or tap the map */
function LocationPicker({ loc, query, onChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const el = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);
  const locRef = useRef(loc);
  locRef.current = loc;
  useEffect(() => {
    if (!open) return;
    setQ(query);
    let dead = false;
    loadLeaflet().then(L => {
      if (dead || !el.current) return;
      const m = L.map(el.current);
      L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTR }).addTo(m);
      map.current = m;
      m.on("click", e => pickPoint(e.latlng.lat, e.latlng.lng));
      place(locRef.current, true);
    }, () => setMsg("地図を読み込めませんでした"));
    return () => { dead = true; if (map.current) map.current.remove(); map.current = null; marker.current = null; };
  }, [open]);
  useEffect(() => { place(loc, false); }, [loc && loc.lat, loc && loc.lng]);
  function place(l, first) {
    const L = window.L, m = map.current;
    if (!L || !m) return;
    if (!l) { if (first) m.setView([36.2, 138.2], 5); return; }
    if (!marker.current) {
      marker.current = L.marker([l.lat, l.lng], { icon: L.divIcon({ className: "", html: '<span class="pin pin-pick"></span>', iconSize: [30, 30], iconAnchor: [15, 36] }) }).addTo(m);
    } else marker.current.setLatLng([l.lat, l.lng]);
    m.setView([l.lat, l.lng], Math.max(m.getZoom() || 0, 14));
  }
  async function search() {
    if (!q.trim()) return;
    setBusy(true); setMsg("");
    try {
      const r = await searchPlaces(q, 5);
      setRes(r);
      if (!r.length) setMsg("見つかりませんでした。名前を短くするか、地図をタップして決めてください。");
    } catch (e) { setMsg("検索できませんでした。少し待ってからもう一度どうぞ。"); }
    setBusy(false);
  }
  async function pickPoint(lat, lng) {
    const base = { lat: +lat.toFixed(6), lng: +lng.toFixed(6), city: "", country: "", cc: "", how: "pin" };
    onChange(base);
    try { const w = await whereIs(base.lat, base.lng); onChange(Object.assign({}, base, { city: w.city, country: w.country, cc: w.cc })); } catch (e) { /* keep the bare point */ }
  }
  const choose = r => { onChange({ lat: r.lat, lng: r.lng, city: r.city, country: r.country, cc: r.cc, how: "pin" }); setRes(null); };
  return html`<div class="field loc">
    <span class="flabel">位置（地図と都市別に使います）</span>
    <div class="loc-now">
      <span class=${loc ? "" : "muted"}><${Icon} n="pin" />${loc ? [loc.city, loc.country].filter(Boolean).join("、") || `${loc.lat}, ${loc.lng}` : "保存すると名前から自動で調べます"}</span>
      <button class="link-btn" type="button" onClick=${() => setOpen(!open)}>${open ? "とじる" : loc ? "地図で直す" : "地図で決める"}</button>
    </div>
    ${open ? html`<div class="loc-box">
      <div class="chat-form">
        <input value=${q} onInput=${e => setQ(e.target.value)} aria-label="場所を検索" placeholder="名前や住所で探す" autocomplete="off"
          onKeyDown=${e => { if (e.key === "Enter") { e.preventDefault(); search(); } }} />
        <button class="btn small" type="button" disabled=${busy || !q.trim()} onClick=${search}>${busy ? "…" : "探す"}</button>
      </div>
      ${res && res.length ? html`<ul class="loc-res">${res.map((r, i) => html`<li key=${i}><button type="button" onClick=${() => choose(r)}><b>${r.label}</b><small>${r.detail}</small></button></li>`)}</ul>` : null}
      ${msg ? html`<p class="hint">${msg}</p>` : null}
      <div class="map map-s" ref=${el}></div>
      <p class="hint">地図をタップしても位置を決められます。場所の検索には OpenStreetMap を使います。</p>
    </div>` : null}
  </div>`;
}

function PlanSheet({ id, date, spot, trip }) {
  const it = id ? S.plan.find(x => x.id === id) : null;
  const sp = !it && spot ? S.spots.find(x => x.id === spot) : null;
  const days = tripDays(trip);
  const [f, setF] = useState(() => (it
    ? { title: it.title || "", kind: it.kind || "see", date: it.date || "", time: it.time || "", end: it.end || "", place: it.place || "", cost: it.cost != null ? String(it.cost) : "", note: it.note || "", spotId: it.spotId || "", resv: it.resv || "" }
    : { title: sp ? sp.name : "", kind: sp ? (sp.cat === "other" ? "see" : sp.cat) : "see", date: date != null ? date : days[0] || "",
        time: "", end: "", place: sp ? [sp.name, sp.area].filter(Boolean).join(" ") : "", cost: sp && sp.price ? String(sp.price) : "", note: "", spotId: sp ? sp.id : "", resv: sp ? sp.resv || "" : "" }));
  const [err, setErr] = useState("");
  const set = formSetter(setF);
  const dateOpts = [["", "日付未定"]].concat(days.map((d, i) => [d, `${i + 1}日目 ${mdw(d)}`]));
  if (f.date && days.indexOf(f.date) < 0) dateOpts.push([f.date, `${mdw(f.date)}（旅の期間外）`]);
  async function save(e) {
    e.preventDefault();
    const title = clip(f.title, 60);
    if (!title) return setErr("予定の名前を入れてください");
    if (f.time && f.end && tmin(f.end) <= tmin(f.time)) return setErr("終わりの時刻は、始まりより後にしてください");
    const cost = String(f.cost).trim() === "" ? null : toNum(f.cost);
    if (String(f.cost).trim() !== "" && cost == null) return setErr("費用は数字で入れてください");
    const body = { title, kind: f.kind, date: f.date, time: f.time, end: f.time ? f.end : "", place: clip(f.place, 80), cost, note: clip(f.note, 300), spotId: f.spotId || "", resv: f.resv };
    const ok = it ? await wr("update", tp(S.tripId, "plan", it.id), body)
      : await wr("set", tp(S.tripId, "plan", newId()), Object.assign(body, { by: meKey(), createdAt: Date.now() }));
    // a wish-list place put into this trip's plan becomes one of its candidates
    const spt = f.spotId && S.spots.find(x => x.id === f.spotId);
    if (ok && spt && !spt.tripId) tagToTrip(spt, trip.id);
    if (ok) {
      closeSheet();
      if (!it) toast(`${f.date && days.indexOf(f.date) >= 0 ? days.indexOf(f.date) + 1 + "日目" : "日付未定"}${f.time ? " " + f.time : ""} に入れました`);
    }
  }
  async function del() { if (await wr("delete", tp(S.tripId, "plan", it.id))) { closeSheet(); toast("削除しました"); } }
  const q = clip(f.place || f.title, 80);
  return html`<${Sheet} title=${it ? "予定を編集" : "予定を追加"} onClose=${closeSheet}>
    <form class="form" onSubmit=${save}>
      <${Field} id="p-title" label="予定"><input id="p-title" value=${f.title} onInput=${set("title")} maxlength="60" placeholder="例: 兼六園を散歩" autocomplete="off" /><//>
      <${KindPicker} value=${f.kind} onChange=${v => setF(p => Object.assign({}, p, { kind: v }))} cats=${CATS} />
      <${Field} id="p-date" label="日にち"><select id="p-date" value=${f.date} onChange=${set("date")}>
        ${dateOpts.map(([v, l]) => html`<option key=${v || "none"} value=${v}>${l}</option>`)}</select><//>
      <div class="grid2">
        <${Field} id="p-time" label="はじまり"><input id="p-time" type="time" value=${f.time} onInput=${set("time")} /><//>
        <${Field} id="p-end" label="おわり（任意）"><input id="p-end" type="time" value=${f.end} onInput=${set("end")} disabled=${!f.time} /><//>
      </div>
      <${Field} id="p-place" label="場所（地図で検索する名前）"><input id="p-place" value=${f.place} onInput=${set("place")} maxlength="80" placeholder="例: 兼六園" autocomplete="off" /><//>
      <div class="grid2">
        <${Field} id="p-cost" label="費用のめやす（ふたり分）"><input id="p-cost" inputmode="numeric" value=${f.cost} onInput=${set("cost")} placeholder="例: 640" autocomplete="off" /><//>
        <div class="field"><span class="flabel">予約</span><${Seg} small value=${f.resv} onChange=${v => setF(p => Object.assign({}, p, { resv: v }))} label="予約" options=${RESV} /></div>
      </div>
      <${Field} id="p-note" label="メモ（予約番号・持ち物など）"><textarea id="p-note" rows="2" value=${f.note} onInput=${set("note")} maxlength="300"></textarea><//>
      ${err ? html`<p class="err" role="alert">${err}</p>` : null}
      <button class="btn big" type="submit">${it ? "保存する" : "旅程に入れる"}</button>
    </form>
    ${it ? html`<div class="links">
        ${q ? html`<a href=${gmapQ(q)} target="_blank" rel="noopener">地図で見る</a>` : null}
        ${it.date ? html`<a href=${gcalUrl({ text: it.title, date: it.date, time: it.time, endTime: it.end, details: it.note, location: it.place })} target="_blank" rel="noopener">カレンダーに追加</a>` : null}
      </div>
      <${DeleteZone} label="この予定を削除…" warning="この予定を旅程から消します。" onDelete=${del} />` : null}
  <//>`;
}

function MoneySheet({ id, trip }) {
  const e0 = id ? S.money.find(x => x.id === id) : null;
  const k = meKey() || "a";
  const days = tripDays(trip);
  const today = todayISO();
  const [f, setF] = useState(() => (e0
    ? { amount: String(e0.amount || ""), title: e0.title || "", paidBy: e0.paidBy || k, split: e0.split || "half", cat: e0.cat || "eat", date: e0.date || "" }
    : { amount: "", title: "", paidBy: k, split: "half", cat: "eat", date: days.indexOf(today) >= 0 ? today : trip.start || today }));
  const [err, setErr] = useState("");
  const set = formSetter(setF);
  const pick = key => v => setF(p => Object.assign({}, p, { [key]: v }));
  async function save(e) {
    e.preventDefault();
    const amount = toNum(f.amount);
    if (!amount) return setErr("金額を入れてください");
    const body = { amount, title: clip(f.title, 40), paidBy: f.paidBy, split: f.split, cat: f.cat, date: f.date };
    const ok = e0 ? await wr("update", tp(S.tripId, "money", e0.id), body)
      : await wr("set", tp(S.tripId, "money", newId()), Object.assign(body, { by: meKey(), createdAt: Date.now() }));
    if (ok) { closeSheet(); if (!e0) toast("記録しました"); }
  }
  async function del() { if (await wr("delete", tp(S.tripId, "money", e0.id))) { closeSheet(); toast("削除しました"); } }
  return html`<${Sheet} title=${e0 ? "記録を編集" : "お金を記録"} onClose=${closeSheet}>
    <form class="form" onSubmit=${save}>
      <${Field} id="m-amount" label="金額（円）"><input id="m-amount" class="amount" inputmode="numeric" value=${f.amount} onInput=${set("amount")} placeholder="0" autocomplete="off" /><//>
      <${Field} id="m-title" label="なにに"><input id="m-title" value=${f.title} onInput=${set("title")} maxlength="40" placeholder="例: 新幹線（往復）" autocomplete="off" /><//>
      <${KindPicker} label="カテゴリ" value=${f.cat} onChange=${pick("cat")} cats=${MONEY_CATS} />
      <div class="field"><span class="flabel">払った人</span><${Seg} value=${f.paidBy} onChange=${pick("paidBy")} label="払った人" options=${KEYS.map(x => [x, nm(x)])} /></div>
      <div class="field"><span class="flabel">だれの分？</span>
        <${Seg} value=${f.split} onChange=${pick("split")} label="だれの分" options=${[["half", "ふたりで半分"], ["a", nm("a") + "の分"], ["b", nm("b") + "の分"]]} />
        <small class="hint">相手の分を立て替えたときは「${nm(other(k))}の分」を選ぶと、精算に反映されます。</small></div>
      <${Field} id="m-date" label="日にち"><input id="m-date" type="date" value=${f.date} onInput=${set("date")} /><//>
      ${err ? html`<p class="err" role="alert">${err}</p>` : null}
      <button class="btn big" type="submit">${e0 ? "保存する" : "記録する"}</button>
    </form>
    ${e0 ? html`<${DeleteZone} label="この記録を削除…" warning="この記録を消します。精算額も計算しなおされます。" onDelete=${del} />` : null}
  <//>`;
}

function CheckSheet({ id }) {
  const c = S.checks.find(x => x.id === id);
  const [f, setF] = useState(() => ({ text: c ? c.text : "", type: c ? c.type || "pack" : "pack", owner: c ? c.owner || "share" : "share", due: c ? c.due || "" : "", group: c ? c.group || "その他" : "その他" }));
  const [err, setErr] = useState("");
  if (!c) return html`<${Sheet} title="見つかりません" onClose=${closeSheet}><p>この項目は削除されたようです。</p><//>`;
  const pick = key => v => setF(p => Object.assign({}, p, { [key]: v }));
  async function save(e) {
    e.preventDefault();
    const text = clip(f.text, 80);
    if (!text) return setErr("内容を入れてください");
    if (await wr("update", tp(S.tripId, "checks", c.id), { text, type: f.type, owner: f.owner, due: f.type === "todo" ? f.due : "", group: f.type === "todo" ? "" : f.group })) { closeSheet(); toast("保存しました"); }
  }
  async function del() { if (await wr("delete", tp(S.tripId, "checks", c.id))) { closeSheet(); toast("削除しました"); } }
  const owners = [["share", f.type === "todo" ? "ふたりで" : "どちらか"], ["each", "各自"], ["a", nm("a")], ["b", nm("b")]];
  return html`<${Sheet} title="準備の項目を編集" onClose=${closeSheet}>
    <form class="form" onSubmit=${save}>
      <${Field} id="c-text" label="内容"><input id="c-text" value=${f.text} onInput=${e => { const v = e.target.value; setF(p => Object.assign({}, p, { text: v })); }} maxlength="80" autocomplete="off" /><//>
      <div class="field"><span class="flabel">リスト</span><${Seg} value=${f.type} onChange=${pick("type")} label="リスト" options=${[["todo", "やること"], ["pack", "持ち物"]]} /></div>
      <div class="field"><span class="flabel">担当</span><${Seg} value=${f.owner} onChange=${pick("owner")} label="担当" options=${owners} /></div>
      ${f.type === "todo" ? html`<${Field} id="c-due" label="期限（任意）"><input id="c-due" type="date" value=${f.due} onInput=${e => { const v = e.target.value; setF(p => Object.assign({}, p, { due: v })); }} /><//>`
        : html`<div class="field"><span class="flabel">分類</span><${Seg} small value=${f.group} onChange=${pick("group")} label="分類" options=${PACK_GROUPS.map(g => [g, g])} /></div>`}
      ${err ? html`<p class="err" role="alert">${err}</p>` : null}
      <button class="btn big" type="submit">保存する</button>
    </form>
    <${DeleteZone} label="この項目を削除…" warning="この項目を消します。" onDelete=${del} />
  <//>`;
}

function TemplateSheet() {
  const [sel, setSel] = useState({ todo: !S.checks.some(c => c.type === "todo"), basic: !S.checks.some(c => c.type !== "todo") });
  const [busy, setBusy] = useState(false);
  const have = new Set(S.checks.map(c => c.text));
  const fresh = t => t.items.filter(x => !have.has(x[0])).length;
  async function add() {
    setBusy(true);
    const k = meKey();
    const seen = new Set(have);
    const list = [];
    let n = 0;
    TEMPLATES.forEach(t => {
      if (!sel[t.key]) return;
      t.items.forEach(([text, owner, group]) => {
        if (seen.has(text)) return;
        seen.add(text);
        list.push([tp(S.tripId, "checks", newId()), { text, type: t.type || "pack", owner, group: group || "", due: "",
          checked: false, checkedBy: { a: false, b: false }, by: k, createdAt: Date.now() + n++ }]);
      });
    });
    const ok = list.length ? await writeMany(list) : 0;
    setBusy(false);
    closeSheet();
    toast(ok ? `${ok}件を追加しました` : "追加できる新しい項目はありませんでした");
  }
  return html`<${Sheet} title="テンプレートから追加" onClose=${closeSheet}>
    <p class="hint">すでにある項目は追加されません。あとから担当や内容を変えられます。</p>
    <ul class="pick">${TEMPLATES.map(t => html`<li key=${t.key}><label class="pick-row">
      <input type="checkbox" checked=${!!sel[t.key]} onChange=${e => { const v = e.target.checked; setSel(p => Object.assign({}, p, { [t.key]: v })); }} />
      <span class="pick-c"><b>${t.label}</b><small>${t.items.slice(0, 4).map(x => x[0]).join("、")}… 新しく${fresh(t)}件</small></span>
    </label></li>`)}</ul>
    <button class="btn big" type="button" disabled=${busy || !Object.keys(sel).some(x => sel[x])} onClick=${add}>${busy ? "追加しています…" : "選んだテンプレートを追加"}</button>
  <//>`;
}

function RouletteSheet({ scope }) {
  const pool0 = (scope === "trip" ? tripSpots() : S.spots).filter(s => !s.visited);
  const anyBoth = pool0.some(isBoth);
  const anyLiked = pool0.some(s => s.likes && (s.likes.a || s.likes.b));
  const [pool, setPool] = useState(anyBoth ? "both" : anyLiked ? "liked" : "all");
  const [c, setC] = useState("all");
  const [shown, setShown] = useState(null);
  const [done, setDone] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const cand = pool0.filter(s => (pool === "both" ? isBoth(s) : pool === "liked" ? s.likes && (s.likes.a || s.likes.b) : true))
    .filter(s => c === "all" || (s.cat || "other") === c);
  function spin() {
    if (!cand.length) return;
    clearTimeout(timer.current);
    const pick = cand[Math.floor(Math.random() * cand.length)];
    setDone(false);
    if (reduceMotion() || cand.length === 1) { setShown(pick); setDone(true); return; }
    let i = 0, delay = 55;
    const tick = () => {
      i++;
      if (i >= 16) { setShown(pick); setDone(true); return; }
      setShown(cand[Math.floor(Math.random() * cand.length)]);
      delay *= 1.16;
      timer.current = setTimeout(tick, delay);
    };
    tick();
  }
  return html`<${Sheet} title="迷ったらルーレット" onClose=${closeSheet}>
    <${Seg} value=${pool} onChange=${v => { setPool(v); setDone(false); setShown(null); }} label="どこから選ぶ"
      options=${[["both", "ふたりとも ♡"], ["liked", "♡ があるもの"], ["all", "候補ぜんぶ"]]} />
    <div class="cats" role="group" aria-label="種類">
      <button type="button" aria-pressed=${String(c === "all")} onClick=${() => setC("all")}>全部</button>
      ${SPOT_CATS.map(x => html`<button type="button" key=${x.key} aria-pressed=${String(c === x.key)} onClick=${() => setC(x.key)}><span class="kb">${x.kanji}</span>${x.label}</button>`)}
    </div>
    <div class="board" aria-live="polite">
      ${shown ? html`<small>${done ? "きまり！" : "えらんでいます"}</small><span>${shown.name}</span>`
        : html`<small>${cand.length}件から選びます</small><span>${cand.length ? "？" : "候補がありません"}</span>`}
    </div>
    <div class="row">
      <button class="btn" type="button" disabled=${!cand.length} onClick=${spin}>${done ? "もう一回" : "回す"}</button>
      ${done && shown && !S.readOnly && curTrip() ? html`<button class="btn ghost" type="button" onClick=${() => openSheet("plan", { spot: shown.id })}>旅程に入れる</button>` : null}
    </div>
  <//>`;
}

/* ---------- AI helper (GPT-5.2 on the server; prompts are built there from the stored trip) ---------- */
const tidy = t => String(t || "").replace(/\*\*/g, "").replace(/^#{1,6}\s*/gm, "");
const asList = (out, key) => (Array.isArray(out) ? out : out && Array.isArray(out[key]) ? out[key] : []);
const normT = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "").trim()); return m ? pad(Math.min(23, +m[1])) + ":" + pad(Math.min(59, +m[2])) : ""; };
function normSpots(out) {
  return asList(out, "spots").map(x => {
    if (!x || typeof x !== "object") return null;
    const name = clip(x.name, 60);
    if (!name || S.spots.some(s => s.name === name)) return null;
    return { name, cat: SPOT_CATS.some(c => c.key === x.cat) ? x.cat : "other", area: clip(x.area, 40), note: clip(x.note, 120) };
  }).filter(Boolean).slice(0, 12);
}
function normPlan(out, days) {
  return asList(out, "plan").map(x => {
    if (!x || typeof x !== "object") return null;
    const title = clip(x.title, 60);
    if (!title) return null;
    const time = normT(x.time), end = normT(x.end);
    return {
      date: days.indexOf(x.date) >= 0 ? x.date : "", time, end: time && end && tmin(end) > tmin(time) ? end : "",
      title, kind: CATS.some(c => c.key === x.kind) ? x.kind : "other", place: clip(x.place, 80), note: clip(x.note, 120), spot: clip(x.spot, 60),
    };
  }).filter(Boolean).slice(0, 40);
}
function normPack(out) {
  const have = new Set(S.checks.map(c => c.text));
  return asList(out, "items").map(x => {
    if (!x || typeof x !== "object") return null;
    const text = clip(x.text, 80);
    if (!text || have.has(text)) return null;
    have.add(text);
    return { text, owner: String(x.owner || "").indexOf("share") === 0 ? "share" : "each", group: PACK_GROUPS.indexOf(x.group) >= 0 ? x.group : "その他" };
  }).filter(Boolean).slice(0, 30);
}
function aiErrMsg(e) {
  const c = e && e.code;
  if (c === "cancelled") return "";
  if (c === "not_configured" || c === "permission_denied") {
    S.aiOff = true; changed();
    return c === "not_configured" ? "このサーバーでは AI 機能がまだ設定されていません（APIキーが未設定）。" : "見るだけのリンクでは AI 機能を使えません。";
  }
  if (c === "rate_limited") return "AI が混み合っています。少し時間をおいてからどうぞ。";
  if (c === "busy") return "ほかの相談に答えている途中です。終わってからもう一度どうぞ。";
  if (c === "daily_limit") return "きょうの AI の利用回数の上限に達しました。また明日どうぞ。";
  if (c === "quota") return "AI の利用枠（OpenAI のクレジット）が足りません。サイトを用意した人に確認してください。";
  if (c === "auth" || c === "model") return "AI の設定（APIキーまたはモデル名）に問題があります。サイトを用意した人に確認してください。";
  if (c === "invalid_json" || c === "empty") return "うまく結果を読み取れませんでした。もう一度ためしてください。";
  if (c === "too_long") return "答えが長くなりすぎました。条件をしぼってもう一度ためしてください。";
  if (c === "refused") return "この内容には答えられませんでした。言い方を変えてみてください。";
  if (c === "prompt_too_large") return "情報が多すぎました。候補や予定を減らしてからためしてください。";
  if (c === "not_found") return "この旅が見つかりませんでした。削除されたのかもしれません。";
  return "AI につながりませんでした。もう一度ためしてください。";
}
const PickList = ({ items, sel, setSel, render }) => html`<ul class="pick">${items.map((x, i) => html`<li key=${i}>
  <label class="pick-row"><input type="checkbox" checked=${!!sel[i]} onChange=${e => { const v = e.target.checked; setSel(p => Object.assign({}, p, { [i]: v })); }} />
  <span class="pick-c">${render(x)}</span></label></li>`)}</ul>`;
const countSel = sel => Object.keys(sel).filter(k => sel[k]).length;
const AI_MENU = [
  ["spots", "おすすめの場所を提案", "行き先と季節から8件。気に入ったものだけ「行きたい」に追加できます。"],
  ["plan", "旅程のたたき台をつくる", "♡ をつけた場所をもとに、時刻つきの旅程案をつくります。"],
  ["review", "旅程をチェック", "移動の無理や、予約が必要そうなところを見てもらいます。"],
  ["pack", "持ち物リストをつくる", "季節・行き先・日数に合わせて提案します。"],
  ["chat", "自由に相談", "「雨の日はどうする？」など、なんでも。"],
];

function AiSheet({ start, trip }) {
  const [mode, setMode] = useState(start || "menu");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [res, setRes] = useState(null);
  const [sel, setSel] = useState({});
  const [text, setText] = useState("");
  const [hint, setHint] = useState("");
  const [pace, setPace] = useState("ふつう");
  const [pool, setPool] = useState(tripSpots().some(isBoth) ? "both" : tripSpots().length ? "liked" : "any");
  const [chat, setChat] = useState([]);
  const [msg, setMsg] = useState("");
  const ctl = useRef(null);
  useEffect(() => () => { if (ctl.current) ctl.current.abort(); }, []);
  const days = tripDays(trip);
  function go(m) { if (ctl.current) ctl.current.abort(); setMode(m); setErr(""); setRes(null); setText(""); setSel({}); }
  async function run(fn) {
    if (busy || !S.ai) return;
    setErr(""); setBusy(true);
    const c = new AbortController();
    ctl.current = c;
    try { await fn(c.signal); } catch (e) {
      const m = aiErrMsg(e);
      if (m) setErr(m);
      if (e && e.code === "refused") setText("");
      else if (e && typeof e.text === "string" && e.text && (mode === "review" || mode === "chat")) setText(e.text);
    } finally {
      if (ctl.current === c) ctl.current = null;
      setBusy(false);
    }
  }
  const selectAll = arr => setSel(Object.fromEntries(arr.map((_, i) => [i, true])));
  const askSpots = e => { e.preventDefault(); run(async signal => {
    const arr = normSpots(await S.ai.json("spots", trip.id, { hint: clip(hint, 120) }, { signal }));
    if (!arr.length) throw { code: "empty" };
    setRes(arr); selectAll(arr);
  }); };
  const askPlan = e => { e.preventDefault(); run(async signal => {
    const arr = sortPlan(normPlan(await S.ai.json("plan", trip.id, { pace, pool, req: clip(hint, 200) }, { signal }), days));
    if (!arr.length) throw { code: "empty" };
    setRes(arr); selectAll(arr);
  }); };
  const askPack = () => run(async signal => {
    const arr = normPack(await S.ai.json("pack", trip.id, {}, { signal }));
    if (!arr.length) throw { code: "empty" };
    setRes(arr); selectAll(arr);
  });
  const askReview = () => run(async signal => {
    setText("");
    const r = await S.ai.text("review", trip.id, {}, { signal, onText: u => setText(tidy(u.text)) });
    setText(tidy(r.text));
  });
  function sendChat(e) {
    e.preventDefault();
    const m = clip(msg, 600);
    if (!m || busy) return;
    const next = chat.concat({ role: "user", content: m });
    setChat(next); setMsg("");
    run(async signal => {
      setText("");
      const r = await S.ai.text("chat", trip.id, { messages: next.slice(-12) }, { signal, onText: u => setText(tidy(u.text)) });
      setChat(next.concat({ role: "assistant", content: tidy(r.text) }));
      setText("");
    });
  }
  async function addPicked() {
    const k = meKey();
    const items = (res || []).filter((_, i) => sel[i]);
    if (!items.length) return;
    let n = 0;
    const list = items.map(x => {
      if (mode === "spots") return ["spots/" + newId(), { name: x.name, cat: x.cat, area: x.area, note: x.note, url: "", ai: true, tripId: S.tripId, resv: "", by: k, likes: { a: false, b: false }, likedAt: {}, createdAt: Date.now() + n++ }];
      if (mode === "plan") {
        const sp = S.spots.find(s => s.name === x.spot || s.name === x.title);
        return [tp(S.tripId, "plan", newId()), { title: x.title, kind: x.kind, date: x.date, time: x.time, end: x.end, place: x.place, cost: null, note: x.note, spotId: sp ? sp.id : "", resv: "", by: k, createdAt: Date.now() + n++ }];
      }
      return [tp(S.tripId, "checks", newId()), { text: x.text, type: "pack", owner: x.owner, group: x.group, due: "", checked: false, checkedBy: { a: false, b: false }, by: k, createdAt: Date.now() + n++ }];
    });
    setBusy(true);
    const ok = await writeMany(list);
    setBusy(false);
    closeSheet();
    if (mode === "spots") locateSpots(list.map(([path]) => path.split("/")[1]));
    if (ok) { toast(`${ok}件を追加しました`); setTab(mode === "spots" ? "spots" : mode === "plan" ? "plan" : "prep"); }
  }
  const titles = { menu: "AIに相談", spots: "おすすめの場所", plan: "旅程のたたき台", review: "旅程をチェック", pack: "持ち物リスト", chat: "自由に相談" };
  const dayLabel = d => (days.indexOf(d) >= 0 ? `${days.indexOf(d) + 1}日目 ${mdw(d)}` : "日付未定");
  let body = null;
  if (mode === "menu") {
    body = html`<div class="ai-menu">${AI_MENU.map(([m, t, d]) => html`<button key=${m} type="button" class="ai-item" onClick=${() => go(m)}><b>${t}</b><span>${d}</span></button>`)}</div>
      <p class="hint">AIの提案は目安です。営業時間・料金・予約状況は公式の情報で確かめてください。AI は OpenAI の GPT-5.2 を使っています。</p>`;
  } else if ((mode === "spots" || mode === "plan" || mode === "pack") && res) {
    const render = mode === "spots" ? x => html`<b>${x.name}</b><small>${cat(x.cat).label}${x.area ? "・" + x.area : ""}</small>${x.note ? html`<span>${x.note}</span>` : null}`
      : mode === "plan" ? x => html`<b>${x.time || "--:--"}${x.end ? "〜" + x.end : ""}　${x.title}</b><small>${cat(x.kind).label}${x.place && x.place !== x.title ? "・" + x.place : ""}${x.note ? "・" + x.note : ""}</small>`
      : x => html`<b>${x.text}</b><small>${x.owner === "share" ? "どちらか" : "各自"}・${x.group}</small>`;
    const groups = mode === "plan" ? days.concat("").map(d => ({ d, idx: res.map((x, i) => (x.date === d ? i : -1)).filter(i => i >= 0) })).filter(g => g.idx.length) : null;
    body = html`
      ${groups ? groups.map(g => html`<div key=${g.d || "none"}><p class="pick-day">${dayLabel(g.d)}</p>
          <ul class="pick">${g.idx.map(i => html`<li key=${i}><label class="pick-row"><input type="checkbox" checked=${!!sel[i]} onChange=${e => { const v = e.target.checked; setSel(p => Object.assign({}, p, { [i]: v })); }} /><span class="pick-c">${render(res[i])}</span></label></li>`)}</ul></div>`)
        : html`<${PickList} items=${res} sel=${sel} setSel=${setSel} render=${render} />`}
      <div class="row">
        <button class="btn" type="button" disabled=${busy || !countSel(sel)} onClick=${addPicked}>選んだ${countSel(sel)}件を${mode === "spots" ? "「行きたい」" : mode === "plan" ? "旅程" : "持ち物"}に追加</button>
        <button class="btn ghost" type="button" disabled=${busy} onClick=${() => { setRes(null); setSel({}); }}>やりなおす</button>
      </div>
      ${mode === "plan" ? html`<p class="hint">いまの旅程は消えずに、選んだ予定が追加されます。</p>` : null}`;
  } else if (mode === "spots") {
    body = html`<form class="form" onSubmit=${askSpots}>
      <${Field} id="ai-hint" label="ふたりの好み・希望（任意）"><input id="ai-hint" value=${hint} onInput=${e => setHint(e.target.value)} maxlength="120" placeholder="例: 甘いもの、写真映え、雨でも楽しめる" autocomplete="off" /><//>
      <button class="btn" type="submit" disabled=${busy}>提案してもらう</button></form>`;
  } else if (mode === "plan") {
    body = html`<form class="form" onSubmit=${askPlan}>
      <div class="field"><span class="flabel">どこを入れる？</span><${Seg} value=${pool} onChange=${setPool} label="どこを入れる" options=${[["both", "ふたりとも ♡ を優先"], ["liked", "♡ があるもの"], ["any", "おまかせ"]]} /></div>
      <div class="field"><span class="flabel">ペース</span><${Seg} value=${pace} onChange=${setPace} label="ペース" options=${[["ゆったり", "ゆったり"], ["ふつう", "ふつう"], ["ぎっしり", "ぎっしり"]]} /></div>
      <${Field} id="ai-req" label="ほかの希望（任意）"><input id="ai-req" value=${hint} onInput=${e => setHint(e.target.value)} maxlength="200" placeholder="例: 1日目は14時ごろ到着、夜はゆっくりしたい" autocomplete="off" /><//>
      <button class="btn" type="submit" disabled=${busy || !days.length}>たたき台をつくる</button>
      ${!days.length ? html`<p class="hint">先に旅の日にちを決めてください。</p>` : null}</form>`;
  } else if (mode === "pack") {
    body = html`<p>${trip.dest}・${nightsDays(trip)}・${monthOf(trip)}月ごろに合わせて提案します。いまのリストにあるものは除きます。</p>
      <div class="row"><button class="btn" type="button" disabled=${busy} onClick=${askPack}>持ち物リストをつくる</button></div>`;
  } else if (mode === "review") {
    body = html`<p>旅程（${S.plan.length}件の予定）を見て、気をつけたほうがよい点を教えてもらいます。</p>
      ${text ? html`<div class="ai-out" aria-live="polite">${text}</div>` : null}
      <div class="row"><button class="btn" type="button" disabled=${busy || !S.plan.length} onClick=${askReview}>${text ? "もう一度チェック" : "チェックしてもらう"}</button></div>
      ${!S.plan.length ? html`<p class="hint">先に旅程に予定を入れてください。</p>` : null}`;
  } else if (mode === "chat") {
    body = html`<div class="bubbles" aria-live="polite">
        ${!chat.length && !text ? html`<p class="hint">例: 「雨だったらどこに行く？」「記念日っぽいディナーのお店は？」「2日目の午後が空いたら？」</p>` : null}
        ${chat.map((m, i) => html`<div key=${i} class=${"bub " + (m.role === "user" ? "u" : "a")}>${m.content}</div>`)}
        ${text ? html`<div class="bub a">${text}</div>` : null}
      </div>
      <form class="chat-form" onSubmit=${sendChat}>
        <textarea id="ai-chat" rows="2" value=${msg} onInput=${e => setMsg(e.target.value)} maxlength="600" aria-label="相談する内容" placeholder="ききたいことを書く"
          onKeyDown=${e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendChat(e); }}></textarea>
        <button class="btn" type="submit" disabled=${busy || !msg.trim()}>送る</button>
      </form>`;
  }
  return html`<${Sheet} title=${titles[mode]} onClose=${closeSheet} wide=${true}>
    ${mode !== "menu" ? html`<button class="back" type="button" onClick=${() => go("menu")}>← AIメニューへ</button>` : null}
    ${body}
    ${busy ? html`<div class="ai-busy"><span>${text ? "書いています…" : "考えています…（30秒ほどかかることがあります）"}</span>
      ${ctl.current ? html`<button class="btn ghost small" type="button" onClick=${() => ctl.current && ctl.current.abort()}>止める</button>` : null}</div>` : null}
    ${err ? html`<p class="err" role="alert">${err}</p>` : null}
  <//>`;
}

/* ---------- photos ---------- */
/* signed links for private photos, fetched together in one request per moment */
let urlWant = new Map();
let urlTimer = 0;
function photoUrl(name) {
  const hit = S.photos && S.photos.cached(name);
  if (hit) return Promise.resolve(hit);
  return new Promise(res => {
    if (!urlWant.has(name)) urlWant.set(name, []);
    urlWant.get(name).push(res);
    clearTimeout(urlTimer);
    urlTimer = setTimeout(async () => {
      const batch = urlWant;
      urlWant = new Map();
      let got = {};
      try { got = await S.photos.urls([...batch.keys()]); } catch (e) { /* show placeholders */ }
      batch.forEach((cbs, n) => cbs.forEach(cb => cb(got[n] || "")));
    }, 30);
  });
}
const localPreview = new Map(); // photo id -> object URL of a just-picked thumbnail
function Photo({ id, full, alt }) {
  const name = full ? fullName(id) : thumbName(id);
  const [url, setUrl] = useState(() => (!full && localPreview.get(id)) || (S.photos && S.photos.cached(name)) || "");
  useEffect(() => {
    if (url) return;
    let dead = false;
    photoUrl(name).then(u => { if (!dead) setUrl(u || "x"); });
    return () => { dead = true; };
  }, [name]);
  return url && url !== "x" ? html`<img src=${url} alt=${alt || ""} loading="lazy" decoding="async" />`
    : html`<span class=${"ph-wait" + (url === "x" ? " ph-miss" : "")} aria-hidden="true"></span>`;
}

/* ---------- memories ---------- */
const monthLabel = d => { const x = parseD(d); return x ? `${x.getFullYear()}年${x.getMonth() + 1}月` : "日付なし"; };
function MemoriesView() {
  const trip = curTrip();
  const mineCount = trip ? S.memories.filter(m => m.tripId === trip.id).length : 0;
  const [scope, setScope] = useState("all");
  const list = S.memories.filter(m => scope !== "trip" || (trip && m.tripId === trip.id))
    .sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || 0) - (a.createdAt || 0));
  const groups = [];
  list.forEach(m => { const k = monthLabel(m.date); const g = groups[groups.length - 1]; if (g && g[0] === k) g[1].push(m); else groups.push([k, [m]]); });
  const went = S.spots.filter(s => s.visited).length;
  return html`
    <div class="vh">
      <h2>思い出</h2>
      <div class="vh-act">${!S.readOnly ? html`<button class="btn small" type="button" onClick=${() => openSheet("memory", {})}><${Icon} n="plus" />思い出を残す</button>` : null}</div>
    </div>
    ${S.memories.length ? html`<div class="filters"><${Seg} small value=${scope} onChange=${setScope} label="範囲"
      options=${[["all", html`ぜんぶ<span class="cnt">${S.memories.length}</span>`]].concat(trip ? [["trip", html`${trip.title}<span class="cnt">${mineCount}</span>`]] : [])} /></div>` : null}
    ${!S.memories.length ? html`<${Empty} title="写真とひとことを残そう" actions=${!S.readOnly ? html`<button class="btn small" type="button" onClick=${() => openSheet("memory", {})}><${Icon} n="photo" />写真をえらぶ</button>` : null}>
        行った場所の写真と、そのときのひとことを残しておけます。「行きたい」の場所で「行った！」を押すと、その場所の思い出になります。
      <//>` : null}
    ${groups.map(([label, arr]) => html`<section key=${label}>
      <h3 class="sec">${label}<span class="cnt">${arr.length}</span></h3>
      <div class="mems">${arr.map(m => html`<${MemoryCard} key=${m.id} m=${m} />`)}</div>
    </section>`)}
    ${went ? html`<p class="hint mem-foot">行った場所 ${went}件 ・ 写真 ${S.memories.reduce((a, m) => a + ((m.photos && m.photos.length) || 0), 0)}枚</p>` : null}`;
}
function MemoryCard({ m }) {
  const sp = m.spotId ? S.spots.find(s => s.id === m.spotId) : null;
  const t = m.tripId ? tripById(m.tripId) : null;
  const n = (m.photos && m.photos.length) || 0;
  return html`<button type="button" class="mem" onClick=${() => openSheet("memory", { id: m.id })}>
    <span class="mem-img">${n ? html`<${Photo} id=${m.photos[0].id} alt="" />` : html`<span class="mem-none">思</span>`}
      ${n > 1 ? html`<span class="mem-n">${n}枚</span>` : null}</span>
    <span class="mem-t">${m.title || (sp && sp.name) || "思い出"}${isNew(m) ? html`<span class="new">NEW</span>` : null}</span>
    <span class="mem-d">${m.date ? mdw(m.date) : ""}${t ? " ・ " + t.title : ""}</span>
  </button>`;
}

const MAX_PHOTOS = 30;
function MemorySheet({ id, spot }) {
  const m0 = id ? S.memories.find(x => x.id === id) : null;
  const sp0 = !m0 && spot ? S.spots.find(s => s.id === spot) : null;
  const trip = curTrip();
  const today = todayISO();
  const inTrip = trip && tripDays(trip).indexOf(today) >= 0;
  const [mid] = useState(() => (m0 ? m0.id : newId()));
  const [f, setF] = useState(() => (m0
    ? { title: m0.title || "", date: m0.date || "", note: m0.note || "", tripId: m0.tripId || "", spotId: m0.spotId || "" }
    : { title: sp0 ? sp0.name : "", date: inTrip || !trip ? today : trip.end && trip.end < today ? trip.start : today, note: "",
        tripId: sp0 ? sp0.tripId || (trip ? trip.id : "") : trip ? trip.id : "", spotId: sp0 ? sp0.id : "" }));
  const [photos, setPhotos] = useState(() => (m0 && m0.photos ? m0.photos.slice() : []));
  const [up, setUp] = useState(0);
  const [err, setErr] = useState("");
  const [view, setView] = useState(-1);
  const fresh = useRef([]);      // uploaded in this sheet, not saved yet
  const dropped = useRef([]);    // saved photos taken out, removed from storage on save
  const saved = useRef(false);
  const fileRef = useRef(null);
  const set = formSetter(setF);
  useEffect(() => () => {
    // closed without saving: tidy up what was uploaded
    if (!saved.current && fresh.current.length && S.photos) S.photos.remove(fresh.current.flatMap(p => [fullName(p), thumbName(p)])).catch(() => {});
  }, []);
  async function addFiles(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    const room = MAX_PHOTOS - photos.length;
    if (files.length > room) toast(`写真は1つの思い出に${MAX_PHOTOS}枚までです`);
    let bad = 0;
    for (const file of files.slice(0, Math.max(0, room))) {
      setUp(n => n + 1);
      try {
        const p = await preparePhoto(file);
        const pid = newId();
        await S.photos.upload(fullName(pid), p.full);
        await S.photos.upload(thumbName(pid), p.thumb);
        localPreview.set(pid, URL.createObjectURL(p.thumb));
        fresh.current.push(pid);
        setPhotos(arr => arr.concat({ id: pid, w: p.w, h: p.h }));
      } catch (x) {
        bad++;
        if (x && x.code === "unsupported") setErr("読めない形式の写真がありました（パソコンの HEIC など）。JPEG で選びなおしてください。");
        else setErr("アップロードできない写真がありました。通信状況を確認してください。");
      } finally { setUp(n => n - 1); }
    }
    if (!bad) setErr("");
  }
  function dropPhoto(pid) {
    setPhotos(arr => arr.filter(p => p.id !== pid));
    if (fresh.current.includes(pid)) {
      fresh.current = fresh.current.filter(x => x !== pid);
      S.photos.remove([fullName(pid), thumbName(pid)]).catch(() => {});
    } else dropped.current.push(pid);
  }
  async function save(e) {
    e.preventDefault();
    if (up) return setErr("写真のアップロードが終わるまで待ってください");
    if (!photos.length && !f.note.trim() && !f.title.trim()) return setErr("写真かひとことを入れてください");
    const body = { title: clip(f.title, 60), date: f.date, note: clip(f.note, 1000), tripId: f.tripId, spotId: f.spotId, photos };
    const ok = m0 ? await wr("update", "memories/" + mid, body)
      : await wr("set", "memories/" + mid, Object.assign(body, { by: meKey(), createdAt: Date.now() }));
    if (!ok) return;
    saved.current = true;
    if (dropped.current.length) S.photos.remove(dropped.current.flatMap(p => [fullName(p), thumbName(p)])).catch(() => {});
    const sp = f.spotId && S.spots.find(s => s.id === f.spotId);
    if (sp && !sp.visited) wr("update", "spots/" + sp.id, { visited: true, visitedAt: f.date || todayISO() });
    closeSheet();
    toast(m0 ? "保存しました" : "思い出を残しました");
  }
  async function del() {
    if (!(await wr("delete", "memories/" + mid))) return;
    saved.current = true;
    const all = photos.map(p => p.id).concat(dropped.current);
    if (all.length) S.photos.remove(all.flatMap(p => [fullName(p), thumbName(p)])).catch(() => {});
    closeSheet();
    toast("削除しました");
  }
  const trips = (S.trips || []).slice().sort((a, b) => (b.start || "").localeCompare(a.start || ""));
  const spots = S.spots.slice().sort((a, b) => a.name.localeCompare(b.name, "ja"));
  const ro = S.readOnly;
  return html`<${Sheet} title=${m0 ? (ro ? m0.title || "思い出" : "思い出を編集") : "思い出を残す"} onClose=${closeSheet} wide=${true}>
    <div class="ph-grid">
      ${photos.map((p, i) => html`<div class="ph" key=${p.id}>
        <button type="button" class="ph-open" onClick=${() => setView(i)} aria-label=${`写真 ${i + 1} を大きく見る`}><${Photo} id=${p.id} alt="" /></button>
        ${!ro ? html`<button type="button" class="ph-x" aria-label="この写真をはずす" onClick=${() => dropPhoto(p.id)}><${Icon} n="close" /></button>` : null}
      </div>`)}
      ${Array.from({ length: up }, (_, i) => html`<div class="ph" key=${"up" + i}><span class="ph-wait busy"></span></div>`)}
      ${!ro && photos.length + up < MAX_PHOTOS ? html`<button type="button" class="ph ph-add" onClick=${() => fileRef.current && fileRef.current.click()}>
        <${Icon} n="photo" /><span>写真を追加</span></button>` : null}
    </div>
    <input ref=${fileRef} type="file" accept="image/*" multiple hidden onChange=${addFiles} />
    ${ro ? html`
      ${m0 && m0.note ? html`<p class="pre">${m0.note}</p>` : null}
      <p class="hint">${m0 && m0.date ? mdw(m0.date) : ""}</p>`
    : html`<form class="form" onSubmit=${save}>
      <div class="grid2">
        <${Field} id="mm-title" label="タイトル"><input id="mm-title" value=${f.title} onInput=${set("title")} maxlength="60" placeholder="例: 兼六園の紅葉" autocomplete="off" /><//>
        <${Field} id="mm-date" label="日にち"><input id="mm-date" type="date" value=${f.date} onInput=${set("date")} /><//>
      </div>
      <${Field} id="mm-note" label="ひとこと"><textarea id="mm-note" rows="3" value=${f.note} onInput=${set("note")} maxlength="1000" placeholder="例: 雪吊りがきれいだった。また冬に来たい"></textarea><//>
      <div class="grid2">
        <${Field} id="mm-spot" label="場所（行きたいリスト）"><select id="mm-spot" value=${f.spotId} onChange=${set("spotId")}>
          <option value="">えらばない</option>${spots.map(s => html`<option key=${s.id} value=${s.id}>${s.name}</option>`)}</select><//>
        <${Field} id="mm-trip" label="旅・デート"><select id="mm-trip" value=${f.tripId} onChange=${set("tripId")}>
          <option value="">えらばない</option>${trips.map(t => html`<option key=${t.id} value=${t.id}>${t.title}</option>`)}</select><//>
      </div>
      ${f.spotId ? html`<p class="hint">保存すると、この場所に「行った」のスタンプが押されます。</p>` : null}
      ${err ? html`<p class="err" role="alert">${err}</p>` : null}
      <button class="btn big" type="submit" disabled=${up > 0}>${up ? `写真をアップロード中…（のこり${up}枚）` : m0 ? "保存する" : "思い出を残す"}</button>
    </form>
    ${m0 ? html`<${DeleteZone} label="この思い出を削除…" warning="この思い出と写真がすべて消えます。相手の画面からも消え、元に戻せません。" onDelete=${del} />` : null}`}
    ${view >= 0 && photos[view] ? html`<${PhotoViewer} photos=${photos} index=${view} onIndex=${setView} onClose=${() => setView(-1)} />` : null}
  <//>`;
}

function PhotoViewer({ photos, index, onIndex, onClose }) {
  const n = photos.length;
  const go = d => onIndex((index + d + n) % n);
  useEffect(() => {
    const k = e => {
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    document.addEventListener("keydown", k, true);
    return () => document.removeEventListener("keydown", k, true);
  }, [index]);
  const touch = useRef(null);
  return html`<div class="viewer" role="dialog" aria-modal="true" aria-label="写真"
    onTouchStart=${e => { touch.current = e.touches[0].clientX; }}
    onTouchEnd=${e => { const d = e.changedTouches[0].clientX - (touch.current || 0); if (Math.abs(d) > 50 && n > 1) go(d < 0 ? 1 : -1); }}>
    <div class="viewer-img"><${Photo} key=${photos[index].id} id=${photos[index].id} full=${true} alt=${`写真 ${index + 1} / ${n}`} /></div>
    <div class="viewer-bar">
      ${n > 1 ? html`<button type="button" class="icon-b" aria-label="前の写真" onClick=${() => go(-1)}><${Icon} n="left" /></button>` : null}
      <span>${index + 1} / ${n}</span>
      ${n > 1 ? html`<button type="button" class="icon-b" aria-label="次の写真" onClick=${() => go(1)}><${Icon} n="right" /></button>` : null}
      <button type="button" class="icon-b" aria-label="閉じる" onClick=${onClose}><${Icon} n="close" /></button>
    </div>
  </div>`;
}

/* ---------- calendar of trips and dates ---------- */
function CalendarView() {
  const today = todayISO();
  const [ym, setYm] = useState(() => {
    const t = curTrip();
    const base = t && t.start && t.start >= today.slice(0, 7) ? t.start : today;
    return base.slice(0, 7);
  });
  const [sel, setSel] = useState("");
  const all = (S.trips || []).slice().sort((a, b) => (a.start || "").localeCompare(b.start || ""));
  const [y, mo] = ym.split("-").map(Number);
  const first = new Date(y, mo - 1, 1);
  const startCell = addDays(iso(first), -first.getDay());
  const weeks = Math.ceil((first.getDay() + new Date(y, mo, 0).getDate()) / 7);
  const cells = Array.from({ length: weeks * 7 }, (_, i) => addDays(startCell, i));
  const on = d => all.filter(t => t.start && d >= t.start && d <= (t.end || t.start));
  const shift = n => { const d = new Date(y, mo - 1 + n, 1); setYm(iso(d).slice(0, 7)); setSel(""); };
  const soon = all.filter(t => (t.end || t.start || "") >= today);
  const past = all.filter(t => (t.end || t.start || "") < today).reverse();
  const open = t => () => { selectTrip(t.id); setTab("plan"); };
  const selOn = sel ? on(sel) : [];
  return html`
    <div class="vh">
      <h2>予定</h2>
      <div class="vh-act">${!S.readOnly ? html`
        <button class="btn ghost small" type="button" onClick=${() => openSheet("trip", { kind: "date", date: sel || "" })}><${Icon} n="plus" />デート</button>
        <button class="btn small" type="button" onClick=${() => openSheet("trip", { kind: "trip", date: sel || "" })}><${Icon} n="plus" />旅行</button>` : null}</div>
    </div>
    <section class="cal" aria-label=${`${y}年${mo}月`}>
      <div class="cal-h">
        <button type="button" class="icon-b" aria-label="前の月" onClick=${() => shift(-1)}><${Icon} n="left" /></button>
        <b>${y}年${mo}月</b>
        <button type="button" class="icon-b" aria-label="次の月" onClick=${() => shift(1)}><${Icon} n="right" /></button>
        ${ym !== today.slice(0, 7) ? html`<button type="button" class="link-btn" onClick=${() => { setYm(today.slice(0, 7)); setSel(today); }}>今月</button>` : null}
      </div>
      <div class="cal-g" role="grid">
        ${"日月火水木金土".split("").map((w, i) => html`<span key=${"w" + i} class=${"cal-w" + (i === 0 ? " sun" : i === 6 ? " sat" : "")} role="columnheader">${w}</span>`)}
        ${cells.map(d => {
          const evs = on(d);
          const dt = parseD(d);
          return html`<button type="button" key=${d} role="gridcell"
            class=${"cal-d" + (d.slice(0, 7) !== ym ? " out" : "") + (d === today ? " today" : "") + (d === sel ? " sel" : "") + (dt.getDay() === 0 ? " sun" : dt.getDay() === 6 ? " sat" : "")}
            aria-label=${`${mdw(d)}${evs.length ? "、" + evs.map(t => t.title).join("、") : ""}`} onClick=${() => setSel(d === sel ? "" : d)}>
            <span class="cal-n">${dt.getDate()}</span>
            ${evs.slice(0, 2).map(t => html`<span key=${t.id} class=${"cal-ev " + (isDate(t) ? "ev-date" : "ev-trip") + (t.id === S.tripId ? " cur" : "")
              + (d === t.start ? " ev-s" : "") + (d === (t.end || t.start) ? " ev-e" : "")}>${d === t.start || dt.getDay() === 0 ? t.title : ""}</span>`)}
            ${evs.length > 2 ? html`<span class="cal-more">+${evs.length - 2}</span>` : null}
          </button>`;
        })}
      </div>
      <p class="cal-key"><span class="ev-trip"></span>旅行 <span class="ev-date"></span>デート</p>
    </section>
    ${sel ? html`<section class="cal-sel">
      <h3 class="sec">${mdw(sel)}</h3>
      ${selOn.length ? html`<ul class="trip-list">${selOn.map(t => html`<li key=${t.id}><${OutingStub} t=${t} onPick=${open(t)} /></li>`)}</ul>`
        : html`<p class="muted">この日の予定はありません。</p>`}
    </section>` : null}
    ${soon.length ? html`<h3 class="sec">これから<span class="cnt">${soon.length}</span></h3>
      <ul class="trip-list">${soon.map(t => html`<li key=${t.id}><${OutingStub} t=${t} onPick=${open(t)} /></li>`)}</ul>` : null}
    ${past.length ? html`<h3 class="sec">行ってきた<span class="cnt">${past.length}</span></h3>
      <ul class="trip-list">${past.map(t => html`<li key=${t.id}><${OutingStub} t=${t} onPick=${open(t)} /></li>`)}</ul>` : null}`;
}

/* ---------- reservations for the selected outing ---------- */
function setResv(kind, id, v) { return wr("update", (kind === "plan" ? tp(S.tripId, "plan", id) : "spots/" + id), { resv: v }); }
function ResvBlock({ trip }) {
  const days = tripDays(trip);
  const dayNo = d => (days.indexOf(d) >= 0 ? `${days.indexOf(d) + 1}日目` : "");
  const rows = sortPlan(S.plan.filter(p => p.resv)).map(p => ({ kind: "plan", id: p.id, text: p.title, sub: [dayNo(p.date), p.time].filter(Boolean).join(" "), resv: p.resv }))
    .concat(tripSpots().filter(s => s.resv && !s.visited).map(s => ({ kind: "spot", id: s.id, text: s.name, sub: cat(s.cat).label + (s.price ? " ・ " + yen(s.price) : ""), resv: s.resv })));
  const done = rows.filter(r => r.resv === "done").length;
  return html`<section class="block">
    <header class="block-h"><h3>予約</h3><span class="prog">${done}/${rows.length}</span></header>
    ${rows.length ? html`<ul class="list">${rows.map(r => html`<li key=${r.kind + r.id} class=${"chk" + (r.resv === "done" ? " done" : "")}>
      <span class="punches"><${Punch} who="s" on=${r.resv === "done"} label=${r.resv === "done" ? "予約済み" : "要予約"} onToggle=${() => setResv(r.kind, r.id, r.resv === "done" ? "need" : "done")} /></span>
      <${S.readOnly ? "div" : "button"} class="chk-main" type=${S.readOnly ? null : "button"} onClick=${S.readOnly ? null : () => openSheet(r.kind === "plan" ? "plan" : "spot", { id: r.id })}>
        <span class="chk-t">${r.text}</span>
        <span class="chk-meta"><${ResvBadge} v=${r.resv} />${r.sub ? html`<span>${r.sub}</span>` : null}</span>
      <//>
    </li>`)}</ul>`
    : html`<p class="hint">旅程の予定や行きたい場所で「要予約」にしたものが、ここに並びます。済んだらチェックをつけましょう。</p>`}
  </section>`;
}

/* the booklet opens over the itinerary */
function BookSheet({ trip }) {
  return html`<${Sheet} title="しおり" onClose=${closeSheet} wide=${true}><${BookView} trip=${trip} /><//>`;
}

/* ---------- start ---------- */
root.textContent = "";
render(html`<${App} />`, root);
boot().catch(() => { S.loadErr = "error"; changed(); });
