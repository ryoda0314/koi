// AI helper for ふたり旅きっぷ (GPT-5.2). The browser sends a task name, the space and trip ids and a
// few options; this function reads the trip with the caller's own permissions (row level security),
// counts the turn against the daily limit, builds the prompt and asks OpenAI.
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { TASKS, cleanMessages } from "./prompts.js";
import { MODEL, aiEnabled, askJson, askStream, aiErrorCode } from "./model.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const PUBLIC_KEY = Deno.env.get("SUPABASE_ANON_KEY") ||
  (Object.values(JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}"))[0] as string) || "";
const CORS = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = /^[A-Za-z0-9_-]{1,40}$/;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const fail = (status: number, code: string) => json(status, { error: { code } });

// the trip, the two names, its plan/money/checks, and the wish-list spots that belong to it
// deno-lint-ignore no-explicit-any
async function loadTrip(sb: any, spaceId: string, tripId: string) {
  const docs = () => sb.from("docs").select("path,data").eq("space_id", spaceId).not("data", "is", null);
  const [head, parts, spots] = await Promise.all([
    docs().in("path", ["app/members", `trips/${tripId}`]),
    docs().like("path", `trips/${tripId}/%`).limit(1000),
    docs().like("path", "spots/%").limit(1000),
  ]);
  if (head.error || parts.error || spots.error) throw new Error((head.error || parts.error || spots.error).message);
  // deno-lint-ignore no-explicit-any
  const find = (p: string) => head.data.find((r: any) => r.path === p)?.data;
  const trip = find(`trips/${tripId}`);
  if (!trip) return null;
  // deno-lint-ignore no-explicit-any
  const out: any = { trip: { ...trip, id: tripId }, members: find("app/members") || null, plan: [], money: [], checks: [] };
  for (const r of parts.data) {
    const [, , part, id] = r.path.split("/");
    if (out[part]) out[part].push({ ...r.data, id });
  }
  const dest = String(trip.dest || "");
  // deno-lint-ignore no-explicit-any
  out.spots = spots.data.map((r: any) => ({ ...r.data, id: r.path.split("/")[1] })).filter((s: any) =>
    s.tripId === tripId || (dest && [s.area, s.city].some((x: string) => x && (x.includes(dest) || dest.includes(x)))));
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method === "GET") return json(200, { ai: aiEnabled(), model: MODEL });
  if (req.method !== "POST") return fail(405, "invalid_argument");

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return fail(401, "not_signed_in");
  const sb = createClient(SUPABASE_URL, PUBLIC_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: who, error: whoErr } = await sb.auth.getUser(jwt);
  if (whoErr || !who?.user) return fail(401, "not_signed_in");
  if (!aiEnabled()) return fail(503, "not_configured");

  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return fail(400, "invalid_argument"); }
  const name = body && body.task;
  if (typeof name !== "string" || !Object.hasOwn(TASKS, name)) return fail(404, "not_found");
  if (!UUID.test(String(body.spaceId)) || !ID.test(String(body.tripId))) return fail(400, "invalid_argument");
  // deno-lint-ignore no-explicit-any
  const task = (TASKS as any)[name];
  const o = body.options && typeof body.options === "object" ? body.options : {};
  let opts;
  if (name === "chat") {
    const messages = cleanMessages(o.messages);
    if (!messages) return fail(400, "invalid_argument");
    opts = { messages };
  } else {
    opts = { hint: String(o.hint || ""), pace: String(o.pace || ""), pool: String(o.pool || ""), req: String(o.req || "") };
  }

  let bundle;
  try { bundle = await loadTrip(sb, body.spaceId, body.tripId); } catch (e) {
    console.warn("[ai] load failed:", (e as Error).message);
    return fail(502, "error");
  }
  if (!bundle) return fail(404, "not_found");
  const { data: turn, error: turnErr } = await sb.rpc("ai_take_turn", { p_space: body.spaceId });
  if (turnErr) return fail(502, "error");
  if (turn) return fail(turn === "permission_denied" ? 403 : 429, turn);

  const ctl = new AbortController();
  req.signal.addEventListener("abort", () => ctl.abort());
  const prompt = task.build(bundle, opts);

  if (task.stream) {
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      async start(c) {
        const send = (o: unknown) => c.enqueue(enc.encode(JSON.stringify(o) + "\n"));
        try {
          await askStream(name, prompt, task.maxTokens, ctl.signal, (d: string) => send({ d }));
          send({ done: true });
        } catch (e) {
          const code = aiErrorCode(e);
          if (code !== "cancelled") console.warn(`[ai] ${name} failed: ${code} ${(e as Error).message || ""}`);
          try { send({ error: code }); } catch { /* the browser went away */ }
        } finally {
          try { c.close(); } catch { /* already closed */ }
        }
      },
      cancel() { ctl.abort(); },
    });
    return new Response(stream, { headers: { ...CORS, "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" } });
  }

  try {
    return json(200, { result: await askJson(name, prompt, task.schema, task.maxTokens, ctl.signal) });
  } catch (e) {
    const code = aiErrorCode(e);
    if (code !== "cancelled") console.warn(`[ai] ${name} failed: ${code} ${(e as Error).message || ""}`);
    return fail(code === "rate_limited" || code === "quota" ? 429 : 502, code);
  }
});
