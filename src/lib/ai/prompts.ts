// What the AI is asked. Built on the server from the stored plan and wishes, so the browser can only choose a task and a
// few options, never send its own prompt. Pure; tested in tests/prompts.test.mjs.
import { longDay, parseDay } from "../dates.ts";
import { bothLike, nameOf, wishKindLabel, whenLabel, type Members, type Plan, type Wish } from "../model.ts";

export const MOODS = ["のんびり", "アクティブ", "おいしいもの", "雨でも大丈夫", "はじめての場所", "記念日っぽく"];
export const BUDGETS: Record<string, string> = { "5000": "ふたりで5千円くらいまで", "10000": "ふたりで1万円くらいまで", "20000": "ふたりで2万円くらいまで", "40000": "ふたりで2万円以上でもよい" };

export interface Options { area: string; budget: string; moods: string[] }

export function cleanOptions(raw: unknown): Options {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    area: String(o.area || "").trim().slice(0, 40),
    budget: Object.hasOwn(BUDGETS, String(o.budget)) ? String(o.budget) : "",
    moods: Array.isArray(o.moods) ? o.moods.filter((m): m is string => typeof m === "string" && MOODS.includes(m)).slice(0, 6) : [],
  };
}

const str = (description: string) => ({ type: "string", description });
const object = (props: Record<string, unknown>) => ({ type: "object", properties: props, required: Object.keys(props), additionalProperties: false });

export const SCHEMAS = {
  ideas: object({
    ideas: {
      type: "array",
      items: object({
        title: str("この過ごし方の名前（12字以内）"),
        summary: str("どんな一日か（40字以内）"),
        budget: str("ふたり分の費用のめやす。例：1万円くらい"),
        steps: {
          type: "array",
          items: object({
            time: str("HH:MM。決めにくければ空文字"),
            text: str("すること（20字以内）"),
            place: str("地図で探せる場所の名前。なければ空文字"),
          }),
        },
      }),
    },
  }),
  wishes: object({
    wishes: {
      type: "array",
      items: object({
        title: str("したいこと（20字以内）"),
        kind: { type: "string", enum: ["eat", "go", "do"], description: "eat=食べたい, go=行きたい, do=やりたい" },
        area: str("場所・エリア。なければ空文字"),
        note: str("おすすめの理由（30字以内）"),
      }),
    },
  }),
};

const PLANNER =
  "あなたは日本語で答える、恋人どうしのためのデートプランナーです。ふたりがその日を楽しく過ごせる、現実的で具体的な案を考えます。" +
  "場所は広く知られた実在のものだけにし、営業時間や料金は断定しすぎないでください。マークダウンや絵文字は使いません。";

function season(date: string): string {
  const d = parseDay(date);
  if (!d) return "";
  const m = d.getMonth() + 1;
  return m <= 2 || m === 12 ? "冬" : m <= 5 ? "春" : m <= 8 ? "夏" : "秋";
}

function wishLines(wishes: Wish[], members: Members | null): string {
  const open = wishes.filter((w) => !w.done);
  const ranked = [...open.filter(bothLike), ...open.filter((w) => !bothLike(w) && (w.likes.a || w.likes.b)), ...open.filter((w) => !w.likes.a && !w.likes.b)];
  return ranked.slice(0, 24).map((w) => {
    const who = bothLike(w) ? "ふたりとも♡" : w.likes.a ? `${nameOf(members, "a")}が♡` : w.likes.b ? `${nameOf(members, "b")}が♡` : "♡なし";
    return `- ${w.title}（${wishKindLabel(w.kind)}${w.area ? "・" + w.area : ""}・${who}）`;
  }).join("\n");
}

export function ideasPrompt(plan: Plan, wishes: Wish[], members: Members | null, o: Options) {
  const area = o.area || plan.place;
  const lines = [
    `日にち: ${longDay(plan.date)}（${season(plan.date)}）`,
    `時間帯: ${whenLabel(plan) || "決まっていない"}`,
    `場所・エリア: ${area || "決まっていない（ふたりの「したいこと」から考えてよい）"}`,
    `予算: ${BUDGETS[o.budget] || "とくに決めていない"}`,
  ];
  if (o.moods.length) lines.push(`気分: ${o.moods.join("、")}`);
  if (plan.title) lines.push(`この日の名前: ${plan.title}`);
  const w = wishLines(wishes, members);
  if (w) lines.push("ふたりの「したいこと」:\n" + w);
  if (plan.steps.length) lines.push("すでに決まっていること（重ねないで、組みこむ）:\n" + plan.steps.map((s) => `- ${s.time || "時刻未定"} ${s.text}${s.place ? `（${s.place}）` : ""}`).join("\n"));
  return {
    instructions: PLANNER,
    input: `次の日の過ごし方を3つ考えてください。

${lines.join("\n")}

条件:
- 3つの案は、雰囲気がちがうものにする
- 時間帯の中に収まるようにし、移動は現実的に、近い場所どうしをまとめる
- ふたりの「したいこと」で合うものがあれば、♡がそろったものから入れる
- steps は3〜6個。食事やお茶の時間も入れる`,
  };
}

export function wishesPrompt(wishes: Wish[], o: Options) {
  const have = wishes.slice(0, 60).map((w) => w.title).join("、");
  return {
    instructions: PLANNER,
    input: `恋人どうしのふたりの「いつかしたいことリスト」に入れる案を6つ考えてください。

${o.area ? `場所・エリア: ${o.area}\n` : ""}${o.moods.length ? `気分: ${o.moods.join("、")}\n` : ""}${have ? `すでにリストにあるもの（出さない）: ${have}\n` : ""}
条件:
- 食べたい・行きたい・やりたい をバランスよく
- 季節や、ふたりで行く楽しさが伝わるものに`,
  };
}
