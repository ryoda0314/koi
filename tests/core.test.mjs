// The pure core: dates, when the two can meet, reading the documents, and the AI prompts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, daysBetween, longDay, monthCells, shiftMonth, shortDay, untilLabel } from "../src/lib/dates.ts";
import { dayFree, overlap } from "../src/lib/avail.ts";
import { bothFreeDays, nextMeeting, plansOf, sideOf, upcomingPlans, waitingOnMe, whenLabel, wishesOf } from "../src/lib/model.ts";
import { SCHEMAS, cleanOptions, ideasPrompt, wishesPrompt } from "../src/lib/ai/prompts.ts";

test("dates", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(daysBetween("2026-10-24", "2026-11-08"), 15);
  assert.equal(longDay("2026-11-08"), "11月8日（日）");
  assert.equal(shortDay("2026-11-07"), "11/7（土）");
  assert.equal(untilLabel("2026-10-24", "2026-10-24"), "きょう");
  assert.equal(untilLabel("2026-10-25", "2026-10-24"), "あした");
  assert.equal(untilLabel("2026-11-03", "2026-10-24"), "あと10日");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  const cells = monthCells("2026-11");
  assert.equal(cells.length % 7, 0);
  assert.equal(cells[0], "2026-11-01"); // November 2026 starts on a Sunday
  assert.ok(cells.includes("2026-11-30"));
  // February 2026 starts on a Sunday and fills exactly four weeks
  assert.equal(monthCells("2026-02").length, 28);
});

test("when the two can meet", () => {
  assert.equal(overlap("all", "night"), "night");
  assert.equal(overlap("day", "all"), "day");
  assert.equal(overlap("all", "all"), "all");
  assert.equal(overlap("day", "night"), null);
  assert.equal(overlap("night", "night"), "night");
  assert.equal(overlap("no", "all"), null);
  assert.equal(overlap(null, "all"), null);
  const f = dayFree("2026-11-08", { a: "all", b: "day", nb: "13時から" });
  assert.equal(f.both, "day");
  assert.equal(f.noteB, "13時から");
  assert.equal(dayFree("2026-11-08", { a: "weird" }).a, null);
});

test("free days and the ones waiting on me", () => {
  const avail = {
    "2026-10-25": { a: "all", b: "night" },
    "2026-10-26": { a: "day", b: "night" },
    "2026-10-27": { b: "all" },
    "2026-10-28": { a: "no", b: "all" },
    "2026-10-20": { a: "all", b: "all" }, // already past
  };
  assert.deepEqual(bothFreeDays(avail, "2026-10-24", 30).map((f) => [f.date, f.both]), [["2026-10-25", "night"]]);
  assert.deepEqual(waitingOnMe(avail, "a", "2026-10-24", 30).map((f) => f.date), ["2026-10-27"]);
  assert.deepEqual(waitingOnMe(avail, "b", "2026-10-24", 30).map((f) => f.date), []);
});

test("members: which one this device is", () => {
  const m = { a: { name: "りょう", uids: { u1: true } }, b: { name: "なな", uids: { u2: true, u3: null } } };
  assert.equal(sideOf(m, "u1", null), "a");
  assert.equal(sideOf(m, "u2", "a"), "b");
  assert.equal(sideOf(m, "u3", null), null); // was moved off this side
  assert.equal(sideOf(m, "u9", "b"), "b");    // falls back to what this device chose
  assert.equal(sideOf(null, "u1", "a"), null);
});

const docs = {
  "app/members": { a: { name: "りょう" }, b: { name: "なな" } },
  "plans/p2": { date: "2026-11-08", slot: "", time: "18:00", end: "21:00", title: "夜景", status: "set", by: "a", createdAt: 2 },
  "plans/p1": { date: "2026-11-01", slot: "all", status: "proposed", by: "b", createdAt: 1 },
  "plans/p0": { date: "2026-10-01", slot: "day", status: "set", by: "a", createdAt: 0 },
  "plans/p2/steps/s2": { time: "", text: "ごはん", createdAt: 5 },
  "plans/p2/steps/s1": { time: "18:30", text: "展望台", place: "横浜", createdAt: 9 },
  "wishes/w1": { title: "水族館", kind: "go", likes: { a: true, b: true }, createdAt: 1 },
  "wishes/w2": { title: "パンケーキ", kind: "eat", likes: { b: true }, createdAt: 2 },
  "wishes/w3": { title: "陶芸", kind: "odd", likes: {}, done: true, createdAt: 3 },
};

test("plans and wishes from the documents", () => {
  const plans = plansOf(docs);
  assert.deepEqual(plans.map((p) => p.id), ["p0", "p1", "p2"]);
  const p2 = plans.find((p) => p.id === "p2");
  assert.deepEqual(p2.steps.map((s) => s.text), ["展望台", "ごはん"]); // timed first
  assert.equal(whenLabel(p2), "18:00〜21:00");
  assert.equal(whenLabel(plans.find((p) => p.id === "p1")), "終日");
  assert.equal(nextMeeting(plans, "2026-10-24").id, "p2"); // p1 is only proposed
  assert.deepEqual(upcomingPlans(plans, "2026-10-24").map((p) => p.id), ["p1", "p2"]);
  const wishes = wishesOf(docs);
  assert.deepEqual(wishes.map((w) => w.id), ["w3", "w2", "w1"]);
  assert.equal(wishes[0].kind, "do"); // an unknown kind reads as やりたい
});

test("AI prompts are built from the stored plan, and options are cleaned", () => {
  const o = cleanOptions({ area: "  横浜 ", budget: "10000", moods: ["のんびり", "hack", 3] });
  assert.deepEqual(o, { area: "横浜", budget: "10000", moods: ["のんびり"] });
  assert.equal(cleanOptions({ budget: "999" }).budget, "");
  const plan = plansOf(docs).find((p) => p.id === "p2");
  const p = ideasPrompt(plan, wishesOf(docs), docs["app/members"], o);
  assert.match(p.input, /11月8日（日）（秋）/);
  assert.match(p.input, /18:00〜21:00/);
  assert.match(p.input, /水族館（行きたい・ふたりとも♡）/);
  assert.match(p.input, /ななが♡/);
  assert.doesNotMatch(p.input, /陶芸/); // done wishes are left out
  assert.match(p.input, /18:30 展望台（横浜）/);
  const w = wishesPrompt(wishesOf(docs), { area: "", budget: "", moods: [] });
  assert.match(w.input, /すでにリストにあるもの（出さない）: 陶芸、パンケーキ、水族館/);
  // strict schemas: every property required, nothing extra
  const items = SCHEMAS.ideas.properties.ideas.items;
  assert.deepEqual(items.required, Object.keys(items.properties));
  assert.equal(items.additionalProperties, false);
});
