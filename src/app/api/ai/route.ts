// GPT-5.2, server-side only. The caller's own Supabase session reads the plan (row level security decides whether they
// may) and counts the turn against the daily limit; the prompt is built here from what is stored.
import "server-only";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { SCHEMAS, cleanOptions, ideasPrompt, wishesPrompt } from "@/lib/ai/prompts";
import { membersOf, plansOf, wishesOf, type Docs } from "@/lib/model";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = process.env.AI_MODEL || "gpt-5.2";
const EFFORT = (process.env.AI_EFFORT || "low") as "none" | "low" | "medium" | "high" | "xhigh";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ maxRetries: 1, timeout: 55_000 }) : null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const fail = (status: number, code: string) => Response.json({ error: { code } }, { status });

// a few asks per address per server instance, on top of the per-couple daily limit in the database
const recent = new Map<string, number[]>();
function tooMany(ip: string): boolean {
  const now = Date.now();
  const list = (recent.get(ip) || []).filter((t) => now - t < 10 * 60e3);
  if (list.length >= 20) return true;
  list.push(now);
  recent.set(ip, list);
  if (recent.size > 2000) for (const [k, v] of recent) if (!v.some((t) => now - t < 10 * 60e3)) recent.delete(k);
  return false;
}

export async function GET() {
  return Response.json({ ai: !!openai && !!SUPABASE_URL, model: MODEL });
}

export async function POST(req: Request) {
  if (!openai) return fail(503, "not_configured");
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return fail(401, "not_signed_in");
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "local";
  if (tooMany(ip)) return fail(429, "too_many");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any = await req.json().catch(() => null);
  const task: "ideas" | "wishes" | null = body?.task === "ideas" || body?.task === "wishes" ? body.task : null;
  if (!task) return fail(404, "not_found");
  if (!UUID.test(String(body.spaceId)) || (task === "ideas" && !ID.test(String(body.planId)))) return fail(400, "invalid_argument");
  const options = cleanOptions(body.options);

  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const who = await sb.auth.getUser(jwt);
  if (who.error || !who.data.user) return fail(401, "not_signed_in");

  // what the prompt needs: the two names, this plan and its steps, the wishes (only rows this person may read)
  const docs: Docs = {};
  const rows = (q: PromiseLike<{ data: { path: string; data: unknown }[] | null; error: unknown }>) =>
    Promise.resolve(q).then((r) => { if (r.error) throw r.error; for (const x of r.data || []) docs[x.path] = x.data; });
  const base = () => sb.from("koyomi_docs").select("path,data").eq("space_id", body.spaceId).not("data", "is", null);
  try {
    await Promise.all([
      rows(base().in("path", task === "ideas" ? ["app/members", `plans/${body.planId}`] : ["app/members"])),
      task === "ideas" ? rows(base().like("path", `plans/${body.planId}/steps/%`).limit(200)) : Promise.resolve(),
      rows(base().like("path", "wishes/%").limit(500)),
    ]);
  } catch {
    return fail(502, "error");
  }
  const plan = task === "ideas" ? plansOf(docs).find((p) => p.id === body.planId) : null;
  if (task === "ideas" && !plan) return fail(404, "not_found");

  const turn = await sb.rpc("koyomi_ai_turn", { p_space: body.spaceId });
  if (turn.error) return fail(502, "error");
  if (turn.data) return fail(turn.data === "permission_denied" ? 403 : 429, turn.data);

  const prompt = task === "ideas" ? ideasPrompt(plan!, wishesOf(docs), membersOf(docs), options) : wishesPrompt(wishesOf(docs), options);
  try {
    const r = await openai.responses.create({
      model: MODEL,
      instructions: prompt.instructions,
      input: prompt.input,
      reasoning: { effort: EFFORT },
      max_output_tokens: 8000,
      store: false,
      text: { format: { type: "json_schema", name: task, schema: SCHEMAS[task], strict: true } },
    }, { signal: req.signal });
    if (r.output?.some((o) => o.type === "message" && o.content.some((c) => c.type === "refusal"))) return fail(422, "refused");
    if (r.status === "incomplete" || !r.output_text) return fail(502, "empty");
    const u = r.usage;
    console.log(`[ai] ${task}: in ${u?.input_tokens} / out ${u?.output_tokens}`);
    return Response.json({ result: JSON.parse(r.output_text) });
  } catch (e) {
    if (e instanceof OpenAI.APIUserAbortError) return fail(499, "cancelled");
    if (e instanceof OpenAI.RateLimitError) return fail(429, "rate_limited");
    console.warn("[ai] failed:", (e as Error).message);
    return fail(502, "error");
  }
}
