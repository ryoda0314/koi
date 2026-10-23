/* Prompts for the AI helper. They are built here from the stored trip, so the browser can only
   ask for these tasks, never send an arbitrary prompt. */
import { CATS, SPOT_CATS, PACK_GROUPS, cat, clip, isBoth, mdw, monthOf, nightsDays, sortPlan, tripDays, yen } from "../_shared/trip.js";

const nameOf = (members, k) => (members && members[k] && members[k].name) || (k === "b" ? "ふたり目" : "ひとり目");
const isDate = trip => trip.kind === "date";

function tripContext({ trip, members, spots, plan }) {
  const L = [];
  const days = tripDays(trip);
  L.push(`${isDate(trip) ? "デートの行き先" : "行き先"}: ${trip.dest}`);
  if (trip.from) L.push(`出発地: ${trip.from}`);
  if (days.length) L.push(`日程: ${mdw(days[0])}〜${mdw(days[days.length - 1])}（${isDate(trip) ? "日帰りデート" : nightsDays(trip)}。${days.map((d, i) => `${i + 1}日目=${d}`).join("、")}）`);
  L.push(`旅行者: ${nameOf(members, "a")}と${nameOf(members, "b")}の恋人どうし2人`);
  if (trip.budget) L.push(`予算: ふたりで${yen(trip.budget)}`);
  if (trip.memo) L.push(`メモ: ${clip(trip.memo, 300)}`);
  const sp = spots.slice(0, 40);
  if (sp.length) L.push("行きたい場所の候補:\n" + sp.map(s => `- ${s.name}${s.area ? `（${s.area}）` : ""} [${cat(s.cat).label}] ${isBoth(s) ? "ふたりとも行きたい" : s.likes && (s.likes.a || s.likes.b) ? "片方が行きたい" : "まだ♡なし"}${s.visited ? "（行ったことがある）" : ""}`).join("\n"));
  const pl = sortPlan(plan).slice(0, 60);
  if (pl.length) L.push("決まっている予定:\n" + pl.map(p => `- ${p.date || "日付未定"} ${p.time || "時刻未定"}${p.end ? "〜" + p.end : ""} ${p.title}${p.place && p.place !== p.title ? `（${p.place}）` : ""}`).join("\n"));
  return L.join("\n");
}

const PLANNER = "あなたは日本語で答える旅行・デートのプランナーです。恋人どうしのふたりのおでかけを、現実的で楽しい計画にする手伝いをします。";
const str = description => ({ type: "string", description });
const list = (key, props) => ({
  type: "object",
  properties: {
    [key]: {
      type: "array",
      items: { type: "object", properties: props, required: Object.keys(props), additionalProperties: false },
    },
  },
  required: [key],
  additionalProperties: false,
});

export const TASKS = {
  spots: {
    schema: list("spots", {
      name: str("場所・お店の名前"),
      cat: { type: "string", enum: SPOT_CATS.map(c => c.key) },
      area: str("エリア名（市区町村や地区）"),
      note: str("おすすめの理由（40字以内）"),
    }),
    maxTokens: 6000,
    build: (b, { hint }) => ({
      instructions: PLANNER,
      input: `次のおでかけのために、行き先とその周辺で「行ってみたい」と思える場所を8件提案してください。

${tripContext(b)}
${hint ? "ふたりの希望: " + clip(hint, 120) + "\n" : ""}
条件:
- 候補にすでにある場所は出さない
- 実在する場所・お店だけ。閉業や長期休業のおそれがあるものは避ける
- ${monthOf(b.trip)}月ごろの季節に合うものを優先し、見る・食べる・体験をバランスよく
- 地図で検索しやすいよう、name は正式な名前にする
- cat は see=見る, eat=食べる, play=遊ぶ・体験, shop=買う, stay=泊まる, other=その他`,
    }),
  },

  plan: {
    schema: list("plan", {
      date: str("YYYY-MM-DD。日程の日付のどれか"),
      time: str("HH:MM"),
      end: str("HH:MM。わからなければ空文字"),
      title: str("予定の名前"),
      kind: { type: "string", enum: CATS.map(c => c.key) },
      place: str("地図で検索できる場所名"),
      note: str("ひとこと（30字以内）"),
      spot: str("候補リストの名前と同じならその名前、ちがえば空文字"),
    }),
    maxTokens: 12000,
    build: (b, { pace, pool, req }) => {
      const p = ["ゆったり", "ふつう", "ぎっしり"].includes(pace) ? pace : "ふつう";
      return {
        instructions: PLANNER,
        input: `次の${isDate(b.trip) ? "デート" : "旅"}のプランのたたき台を作ってください。

${tripContext(b)}

方針:
- ペース: ${p}（ゆったり=1日に見どころ3つ前後、ふつう=4〜5つ、ぎっしり=6つ以上）
- ${pool === "both" ? "「ふたりとも行きたい」の場所は必ず入れる。ほかの候補も合えば入れる" : pool === "liked" ? "♡のついた候補を中心に入れる" : "候補にこだわらず、行き先の定番とおすすめで組む"}
- ${isDate(b.trip) ? "集合から解散まで。ごはんやお茶の時間も入れる" : "昼ごはんと夜ごはんを入れる。初日の行きと最終日の帰りの移動も入れる"}
- 移動時間は現実的に見込み、近い場所どうしをまとめる
- 決まっている予定と時間が重ならないようにし、決まっている予定そのものは出力しない
${req ? "- 追加の希望: " + clip(req, 200) + "\n" : ""}- kind は see=見る, eat=食べる, play=遊ぶ・体験, shop=買う, stay=泊まる, move=移動, other=その他`,
      };
    },
  },

  pack: {
    schema: list("items", {
      text: str("持ち物"),
      owner: { type: "string", enum: ["each", "share"], description: "ふたりそれぞれに必要なら each、ふたりで1つあればよいなら share" },
      group: { type: "string", enum: PACK_GROUPS },
    }),
    maxTokens: 5000,
    build: ({ trip, checks }) => {
      const days = tripDays(trip);
      const have = checks.filter(c => c.type !== "todo").map(c => c.text).slice(0, 80);
      return {
        instructions: "あなたは日本語で答える旅行の準備アシスタントです。",
        input: `次のおでかけの持ち物リストを作ってください。季節・行き先・日数に合わせ、忘れがちなものも入れてください。${isDate(trip) ? "日帰りなので10〜15個" : "20〜28個"}。

行き先: ${trip.dest}
日程: ${days.length ? mdw(days[0]) + "〜" + mdw(days[days.length - 1]) : "未定"}（${isDate(trip) ? "日帰り" : nightsDays(trip)}）
${trip.memo ? "メモ: " + clip(trip.memo, 200) + "\n" : ""}${have.length ? "すでにリストにあるもの（出さない）: " + have.join("、") + "\n" : ""}`,
      };
    },
  },

  review: {
    stream: true,
    maxTokens: 4000,
    build: b => ({
      instructions: PLANNER,
      input: `次のおでかけの予定を見て、気をつけたほうがよい点を教えてください。

${tripContext(b)}

観点: 移動時間に無理がないか、定休日や営業時間で気をつけること（一般的な傾向でよく、断定しすぎない）、予約したほうがよさそうなもの、食事の時間、雨の日の代わりの案。
書き方: 気になる点を5つ以内、行頭に「・」をつけて短く。最後に、よくできている点をひとこと。マークダウンの記号（#や**）は使わない。`,
    }),
  },

  chat: {
    stream: true,
    maxTokens: 4000,
    build: (b, { messages }) => ({
      instructions: `あなたはふたりの旅行やデートの相談にのるアシスタントです。次の情報をふまえて、やさしく、具体的に、短めの日本語で答えてください。マークダウンの記号（#や**）は使わず、箇条書きは「・」で。営業時間や料金のように変わりやすい情報は、確認をすすめてください。旅やおでかけと関係のない依頼には、やんわり話を戻してください。

${tripContext(b)}`,
      input: messages,
    }),
  },
};

/* chat history from the browser: only user/assistant turns, short, last 12 */
export function cleanMessages(raw) {
  if (!Array.isArray(raw)) return null;
  const out = raw.slice(-12).map(m => (m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string"
    ? { role: m.role, content: m.content.slice(0, 2000) } : null));
  if (!out.length || out.some(m => !m) || out[out.length - 1].role !== "user") return null;
  return out;
}
