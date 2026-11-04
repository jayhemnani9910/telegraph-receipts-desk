import assert from "node:assert/strict";
import { test } from "node:test";
import { flagValue, leaves, listValue, MATCH_LIST_KEYS, mentions, numberValue, SANCTIONED_KEYS } from "../src/answers.ts";

test("leaves finds values nested in objects and lists", () => {
  assert.deepEqual(leaves({ a: [{ b: 1 }, { c: "x" }] }), [["b", 1], ["c", "x"]]);
});

test("flagValue reads the ways miners say yes and no", () => {
  for (const yes of [true, 1, "true", "yes"]) assert.equal(flagValue({ sanctioned: yes }, SANCTIONED_KEYS), true);
  for (const no of [false, 0, "false", "no"]) assert.equal(flagValue({ sanctioned: no }, SANCTIONED_KEYS), false);
});

test("flagValue treats an empty field as no answer, not as no", () => {
  for (const empty of [null, undefined, ""]) assert.equal(flagValue({ sanctioned: empty }, SANCTIONED_KEYS), null);
  assert.equal(flagValue({ other: true }, SANCTIONED_KEYS), null);
});

test("flagValue gives no answer when fields disagree", () => {
  assert.equal(flagValue({ sanctioned: true, listed: false }, SANCTIONED_KEYS), null);
});

test("listValue tells an empty list from a missing one", () => {
  assert.equal(listValue({ matches: [] }, MATCH_LIST_KEYS), false);
  assert.equal(listValue({ data: { hits: [{ name: "x" }] } }, MATCH_LIST_KEYS), true);
  assert.equal(listValue({ other: [] }, MATCH_LIST_KEYS), null);
});

test("numberValue ignores text under the same key", () => {
  assert.equal(numberValue({ match_score: 0.7 }, ["match_score"]), 0.7);
  assert.equal(numberValue({ match_score: "0.7" }, ["match_score"]), null);
});

test("mentions does not count the question echoed back", () => {
  const query = "What is the LEI of ABC123?";
  assert.equal(mentions({ echo: "ABC123" }, query, "ABC123"), false);
  assert.equal(mentions({ id: "LEI ABC123 active" }, query, "abc123"), true);
});
