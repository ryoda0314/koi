// The couple's space in the browser. Every device signs in anonymously; opening the invite link makes it a member.
// Keeps a live copy of every document (Realtime: database changes, and who is here) and writes through
// koyomi_write(), showing a change at once and letting the database's copy win when it arrives.
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { useSyncExternalStore } from "react";
import type { Docs } from "../model.ts";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const LAST = "koyomi:space";

let sb: SupabaseClient | null = null;
function client(): SupabaseClient | null {
  if (!sb && URL && KEY && typeof window !== "undefined") {
    sb = createClient(URL, KEY, { auth: { storageKey: "koyomi-auth", persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  }
  return sb;
}
export const configured = () => !!(URL && KEY);

export type Phase = "boot" | "none" | "ready" | "error" | "config";
export interface Snap {
  phase: Phase;
  spaceId: string | null;
  uid: string | null;
  conn: "connecting" | "online" | "offline";
  loaded: boolean;
  docs: Docs;
  /** presence: the sides (a / b) of the other devices open right now */
  here: string[];
  ai: boolean;
  v: number;
}
const initial: Snap = { phase: "boot", spaceId: null, uid: null, conn: "connecting", loaded: false, docs: {}, here: [], ai: false, v: 0 };
let snap: Snap = initial;
const listeners = new Set<() => void>();
let queued = false;
function set(patch: Partial<Snap>) {
  snap = { ...snap, ...patch, v: snap.v + 1 };
  if (queued) return;
  queued = true;
  queueMicrotask(() => { queued = false; listeners.forEach((l) => l()); });
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useSpace = () => useSyncExternalStore(subscribe, () => snap, () => initial);
export const getSnap = () => snap;

/* ---------- errors and toasts ---------- */
export interface Fail { code: string; status?: number; details?: string }
const KNOWN = ["not_found", "permission_denied", "invalid_argument", "too_large", "quota_exceeded", "resource_exhausted", "bad_passcode", "not_signed_in", "full"];
function failOf(e: unknown): Fail {
  const x = (e || {}) as { message?: string; details?: string; status?: number; name?: string };
  const msg = String(x.message || "");
  if (KNOWN.includes(msg)) return { code: msg, details: x.details || "" };
  if (x.name === "AbortError") return { code: "cancelled" };
  if (/fetch|network|Failed to|Load failed/i.test(msg)) return { code: "unavailable" };
  return { code: "error" };
}

type Toast = { id: number; text: string };
let toasts: Toast[] = [];
const toastListeners = new Set<() => void>();
export function toast(text: string) {
  const id = Date.now() + Math.random();
  toasts = [...toasts, { id, text }].slice(-3);
  toastListeners.forEach((l) => l());
  setTimeout(() => { toasts = toasts.filter((t) => t.id !== id); toastListeners.forEach((l) => l()); }, 3200);
}
export const useToasts = () =>
  useSyncExternalStore((l) => { toastListeners.add(l); return () => { toastListeners.delete(l); }; }, () => toasts, () => toasts);

/* ---------- signing in, making and joining a space ---------- */
async function signedIn(): Promise<string> {
  const c = client();
  if (!c) throw { code: "config" };
  const cur = await c.auth.getSession();
  if (cur.data.session) return cur.data.session.user.id;
  const r = await c.auth.signInAnonymously();
  if (r.error || !r.data.session) throw r.error?.status === 429 ? { code: "resource_exhausted" } : failOf(r.error);
  return r.data.session.user.id;
}

export async function needPasscode(): Promise<boolean> {
  const c = client();
  if (!c) return false;
  const r = await c.rpc("koyomi_app_info");
  return !!(r.data && r.data.need_passcode);
}

/** Whether this device is already in a space (without signing in). */
export async function hasSpace(): Promise<boolean> {
  const c = client();
  if (!c) return false;
  const s = await c.auth.getSession();
  if (!s.data.session) return false;
  const m = await c.from("koyomi_members").select("space_id").limit(1);
  return !!(m.data && m.data.length);
}

export async function createSpace(passcode: string): Promise<void> {
  await signedIn();
  const r = await client()!.rpc("koyomi_create_space", { passcode });
  if (r.error) throw failOf(r.error);
  localStorage.setItem(LAST, r.data.space_id);
}

export async function joinSpace(invite: string): Promise<void> {
  await signedIn();
  const r = await client()!.rpc("koyomi_join", { invite });
  if (r.error) throw failOf(r.error);
  localStorage.setItem(LAST, r.data.space_id);
}

/* ---------- boot: find this device's space and open it ---------- */
let booting: Promise<void> | null = null;
export function boot(): Promise<void> {
  if (booting) return booting;
  booting = (async () => {
    const c = client();
    if (!c) return set({ phase: "config" });
    const s = await c.auth.getSession();
    if (!s.data.session) return set({ phase: "none" });
    const uid = s.data.session.user.id;
    const m = await c.from("koyomi_members").select("space_id, joined_at").order("joined_at", { ascending: false });
    if (m.error) { booting = null; return set({ phase: "error" }); }
    const ids = (m.data || []).map((r) => r.space_id as string);
    if (!ids.length) return set({ phase: "none", uid });
    const want = localStorage.getItem(LAST);
    const spaceId = want && ids.includes(want) ? want : ids[0];
    localStorage.setItem(LAST, spaceId);
    set({ phase: "ready", uid, spaceId });
    open();
    fetch("/api/ai").then((r) => r.json()).then((j) => set({ ai: !!j.ai }), () => {});
  })();
  return booting;
}
export function retryBoot() { booting = null; set({ phase: "boot" }); return boot(); }

/* ---------- the live copy ---------- */
let data: Docs = {};
const rev: Record<string, number> = {};
let loading = false;
let buffer: { path: string; data: unknown; rev: number }[] = [];
let channel: RealtimeChannel | null = null;
const me = Math.random().toString(36).slice(2, 10);
let myPresence: { m: string | null } | null = null;
let notifyTimer: ReturnType<typeof setTimeout> | null = null;

function publish() {
  if (notifyTimer) return;
  notifyTimer = setTimeout(() => { notifyTimer = null; set({ docs: { ...data } }); }, 0);
}
function apply(row: { path: string; data: unknown; rev: number }) {
  if (!row || !row.path) return;
  const n = Number(row.rev);
  if ((rev[row.path] || 0) >= n) return;
  rev[row.path] = n;
  if (row.data == null) delete data[row.path];
  else data[row.path] = row.data;
}

// Only the newest read counts: an older one finishing later would put back a copy from before changes that arrived
// in the meantime. Changes that come in while a read is under way wait in `buffer` and are applied on top of it.
let loadGen = 0;
async function loadAll(spaceId: string) {
  const c = client()!;
  const gen = ++loadGen;
  loading = true;
  buffer = [];
  const next: Docs = {};
  const revs: Record<string, number> = {};
  try {
    for (let from = 0; ; from += 1000) {
      const r = await c.from("koyomi_docs").select("path,data,rev").eq("space_id", spaceId).not("data", "is", null).order("path").range(from, from + 999);
      if (r.error) throw r.error;
      for (const row of r.data) { next[row.path] = row.data; revs[row.path] = Number(row.rev); }
      if (r.data.length < 1000) break;
    }
  } catch {
    if (gen !== loadGen) return;
    loading = false;
    set({ conn: "offline" });
    setTimeout(() => { if (gen === loadGen) loadAll(spaceId); }, 4000);
    return;
  }
  if (gen !== loadGen) return;
  data = next;
  for (const k in rev) delete rev[k];
  Object.assign(rev, revs);
  buffer.forEach(apply);
  buffer = [];
  loading = false;
  set({ conn: "online", loaded: true, docs: { ...data } });
}

let retryTimer: ReturnType<typeof setTimeout> | null = null;
let opening = false;
async function open() {
  if (opening) return;
  opening = true;
  try { await openChannel(); } finally { opening = false; }
}
async function openChannel() {
  const c = client()!;
  const spaceId = snap.spaceId!;
  if (retryTimer) clearTimeout(retryTimer);
  if (channel) { const old = channel; channel = null; await c.removeChannel(old); }
  await c.realtime.setAuth();
  const ch = c.channel(`koyomi:${spaceId}`, { config: { private: true, presence: { key: me } } });
  channel = ch;
  let ready = false;
  let fallback: ReturnType<typeof setTimeout> | null = null;
  const start = () => { if (!ready) { ready = true; if (fallback) clearTimeout(fallback); loadAll(spaceId); } };
  ch.on("postgres_changes", { event: "*", schema: "public", table: "koyomi_docs", filter: `space_id=eq.${spaceId}` }, (p) => {
    const row = p.new as { path: string; data: unknown; rev: number };
    if (!row || !row.path) return;
    if (loading) buffer.push(row);
    else { apply(row); publish(); }
  });
  // database changes flow only once Postgres is hooked up: read everything after that, so nothing slips between
  ch.on("system", {}, (m: { extension?: string }) => { if (m && m.extension === "postgres_changes") start(); });
  ch.on("presence", { event: "sync" }, () => {
    if (ch !== channel) return;
    const st = ch.presenceState<{ m?: string | null }>();
    const here: string[] = [];
    for (const k in st) if (k !== me) for (const p of st[k]) if (p.m) here.push(p.m);
    set({ here });
  });
  ch.subscribe((s) => {
    if (ch !== channel) return;
    if (s === "SUBSCRIBED") {
      // also after an automatic rejoin: read everything again, since changes may have been missed
      ready = false;
      lastTracked = "";
      sendPresence();
      if (fallback) clearTimeout(fallback);
      fallback = setTimeout(start, 6000);
    } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") {
      set({ conn: "offline" });
      if (s !== "CLOSED") retryTimer = setTimeout(open, 4000);
    }
  });
}
// Back from the background (a phone may have dropped the connection meanwhile): reconnect, or at least read
// everything again, so nothing the other one did in between is missed.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || snap.phase !== "ready" || !channel) return;
    if (channel.state !== "joined") open();
    else if (snap.spaceId) loadAll(snap.spaceId);
  });
}

/* Presence may change only 5 times in 30 s per device: it carries just who this is, and only when that changes. */
let lastTracked = "";
let lastTrackAt = 0;
let trackTimer: ReturnType<typeof setTimeout> | null = null;
function sendPresence() {
  trackTimer = null;
  if (!channel || channel.state !== "joined" || !myPresence) return;
  const j = JSON.stringify(myPresence);
  if (j === lastTracked) return;
  lastTracked = j;
  lastTrackAt = Date.now();
  channel.track(myPresence).catch(() => {});
}
export function announce(side: string | null) {
  myPresence = { m: side };
  if (JSON.stringify(myPresence) !== lastTracked && !trackTimer) {
    trackTimer = setTimeout(sendPresence, Math.max(0, lastTrackAt + 8000 - Date.now()));
  }
}

/* ---------- writing ---------- */
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
function merge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out = { ...a };
  for (const k of Object.keys(b)) { const v = b[k], o = out[k]; out[k] = isObj(v) && isObj(o) ? merge(o, v) : v; }
  return out;
}
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export type Op = "set" | "update" | "merge" | "delete";
const queues = new Map<string, Promise<unknown>>();

/** Write one document; shows it at once. Returns false (after a toast) when the database refused. */
export async function write(op: Op, path: string, body?: Record<string, unknown>): Promise<boolean> {
  const prev = queues.get(path) || Promise.resolve();
  const run = prev.catch(() => {}).then(() => writeNow(op, path, body));
  queues.set(path, run);
  run.finally(() => { if (queues.get(path) === run) queues.delete(path); }).catch(() => {});
  try { await run; return true; } catch (e) { toast(failText(e as Fail)); return false; }
}
async function writeNow(op: Op, path: string, body?: Record<string, unknown>) {
  const c = client();
  if (!c || !snap.spaceId) throw { code: "error" };
  const before = data[path];
  if (op === "update" && !before) throw { code: "invalid_argument", details: "missing document" };
  const next = op === "set" ? clone(body!) : op === "update" || op === "merge" ? merge(before || {}, clone(body!)) : undefined;
  if (next === undefined) delete data[path];
  else data[path] = next;
  publish();
  let r: { error: unknown } | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { r = await c.rpc("koyomi_write", { p_space: snap.spaceId, p_op: op, p_path: path, p_body: body ?? null }); }
    catch (e) { r = { error: e }; }
    if (!r.error || failOf(r.error).code !== "unavailable") break;
    await new Promise((res) => setTimeout(res, 600));
  }
  if (r && r.error) {
    if (data[path] === next) { if (before === undefined) delete data[path]; else data[path] = before; publish(); }
    throw failOf(r.error);
  }
}
function failText(e: Fail): string {
  if (e.code === "invalid_argument" && /missing/.test(e.details || "")) return "見つかりませんでした。相手が消したのかもしれません";
  if (e.code === "permission_denied") return "このこよみに書き込めません。招待リンクを開き直してください";
  if (e.code === "too_large") return "長すぎて保存できませんでした";
  if (e.code === "quota_exceeded") return "保存できる量の上限です";
  if (e.code === "unavailable") return "つながりませんでした。電波のよいところで、もう一度";
  return "保存できませんでした";
}

/* ---------- the invite link ---------- */
export async function inviteToken(fresh = false): Promise<string> {
  const r = await client()!.rpc(fresh ? "koyomi_new_invite" : "koyomi_invite", { p_space: snap.spaceId });
  if (r.error) throw failOf(r.error);
  return r.data as string;
}

/* ---------- AI (GPT-5.2 on the server, /api/ai) ---------- */
export async function askAi<T>(task: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const c = client()!;
  const s = await c.auth.getSession();
  const token = s.data.session?.access_token;
  if (!token) throw { code: "not_signed_in" };
  let r: Response;
  try {
    r = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ task, spaceId: snap.spaceId, ...payload }),
      signal,
    });
  } catch (e) {
    throw (e as Error)?.name === "AbortError" ? { code: "cancelled" } : { code: "unavailable" };
  }
  const j = await r.json().catch(() => null);
  if (!r.ok) throw { code: j?.error?.code || (r.status >= 500 ? "unavailable" : "error") };
  return j.result as T;
}

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
