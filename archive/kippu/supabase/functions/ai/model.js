/* GPT-5.2 through the OpenAI Responses API. The key lives in the function's secrets. */
import OpenAI from "npm:openai@7.42.0";

const env = k => Deno.env.get(k) || "";
export const MODEL = env("OPENAI_MODEL") || "gpt-5.2";
const EFFORT = env("OPENAI_REASONING_EFFORT") || "low";
const WEB_SEARCH = env("OPENAI_WEB_SEARCH") === "1";

const client = env("OPENAI_API_KEY")
  ? new OpenAI({ apiKey: env("OPENAI_API_KEY"), baseURL: env("OPENAI_BASE_URL") || undefined, maxRetries: 1, timeout: 140_000 })
  : null;
export const aiEnabled = () => !!client;

class AiError extends Error {
  constructor(code, message, text) {
    super(message || code);
    this.code = code;
    if (text) this.text = text;
  }
}

function logUsage(task, usage) {
  if (!usage) return;
  const r = usage.output_tokens_details?.reasoning_tokens || 0;
  console.log(`[ai] ${task}: in ${usage.input_tokens} / out ${usage.output_tokens} (reasoning ${r})`);
}

function baseRequest(task, { instructions, input }, maxTokens) {
  const req = { model: MODEL, instructions, input, reasoning: { effort: EFFORT }, max_output_tokens: maxTokens, store: false };
  // live search helps avoid suggesting places that have since closed; costs more and is slower
  if (WEB_SEARCH && (task === "spots" || task === "review")) req.tools = [{ type: "web_search" }];
  return req;
}

/* structured output: the reply is guaranteed to match the task's JSON schema */
export async function askJson(task, prompt, schema, maxTokens, signal) {
  if (!client) throw new AiError("not_configured");
  const r = await client.responses.create(Object.assign(baseRequest(task, prompt, maxTokens), {
    text: { format: { type: "json_schema", name: task, schema, strict: true } },
  }), { signal });
  logUsage(task, r.usage);
  for (const item of r.output || []) {
    if (item.type === "message" && (item.content || []).some(c => c.type === "refusal")) throw new AiError("refused");
  }
  if (r.status === "incomplete") throw new AiError(r.incomplete_details?.reason === "max_output_tokens" ? "too_long" : "empty");
  try { return JSON.parse(r.output_text); } catch (e) { throw new AiError("invalid_json"); }
}

/* plain text, streamed: onDelta gets each new piece */
export async function askStream(task, prompt, maxTokens, signal, onDelta) {
  if (!client) throw new AiError("not_configured");
  const stream = await client.responses.create(Object.assign(baseRequest(task, prompt, maxTokens), {
    text: { verbosity: "low" },
    stream: true,
  }), { signal });
  let text = "";
  for await (const ev of stream) {
    if (ev.type === "response.output_text.delta") { text += ev.delta; onDelta(ev.delta); }
    else if (ev.type === "response.refusal.delta" || ev.type === "response.refusal.done") throw new AiError("refused", "", text);
    else if (ev.type === "response.completed") logUsage(task, ev.response?.usage);
    else if (ev.type === "response.incomplete") { logUsage(task, ev.response?.usage); if (!text) throw new AiError("empty"); }
    else if (ev.type === "response.failed" || ev.type === "error") throw new AiError("error", ev.response?.error?.message || ev.message, text);
  }
  if (!text.trim()) throw new AiError("empty");
  return text;
}

/* map anything thrown above to one of the short codes the browser understands */
export function aiErrorCode(e) {
  if (e instanceof AiError) return e.code;
  if (e instanceof OpenAI.APIUserAbortError || (e && e.name === "AbortError")) return "cancelled";
  if (e instanceof OpenAI.RateLimitError) return e.code === "insufficient_quota" ? "quota" : "rate_limited";
  if (e instanceof OpenAI.AuthenticationError || e instanceof OpenAI.PermissionDeniedError) return "auth";
  if (e instanceof OpenAI.NotFoundError) return "model";
  if (e instanceof OpenAI.BadRequestError) return /context|too long|maximum|too large/i.test(e.message) ? "prompt_too_large" : "bad_request";
  if (e instanceof OpenAI.APIConnectionError) return "unavailable";
  return "error";
}
