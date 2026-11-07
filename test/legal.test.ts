import "./setup.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { compareRegistry, compareSanctions, parseEntity, saysSanctioned, verdictFor } from "../apps/legal/pack.ts";
import type { LeiRecord, ListMatch, SanctionsScreen } from "../src/primary.ts";

const allLists = ["OFAC SDN", "UN", "EU", "UK"];
const match = (list: string): ListMatch => ({ list, id: "1", name: "X", programs: "P", matchedOn: "X", births: [] });
const clear: SanctionsScreen = { matches: [], checked: allLists, notChecked: [], near: [], ruledOut: [] };
const onOfac: SanctionsScreen = { matches: [match("OFAC SDN")], checked: allLists, notChecked: [], near: [], ruledOut: [] };
const onEuOnly: SanctionsScreen = { matches: [match("EU")], checked: allLists, notChecked: [], near: [], ruledOut: [] };
const ukUnread: SanctionsScreen = { matches: [], checked: ["OFAC SDN", "UN", "EU"], notChecked: ["UK"], near: [], ruledOut: [] };

test("saysSanctioned prefers the yes/no over the score", () => {
  assert.equal(saysSanctioned({ sanctioned: false, match_score: 1 }), false);
});

test("saysSanctioned accepts only a near-certain score", () => {
  assert.equal(saysSanctioned({ match_score: 0.99 }), true);
  assert.equal(saysSanctioned({ match_score: 0.5 }), false);
  assert.equal(saysSanctioned({ match_score: 0.75 }), null);
});

test("a fuzzy candidate is no verdict (LiveCert returned the vessel TELA for Tesla at 0.947)", () => {
  const answer = { match_score: 0.947, matches: [{ name: "TELA", type: "vessel" }] };
  assert.equal(compareSanctions(answer, clear), "unconfirmed");
});

test("agreeing with the lists is confirmed", () => {
  assert.equal(compareSanctions({ sanctioned: false }, clear), "confirmed");
  assert.equal(compareSanctions({ sanctioned: true }, onOfac), "confirmed");
});

test("missing an OFAC listing is contradicted", () => {
  assert.equal(compareSanctions({ sanctioned: false }, onOfac), "contradicted");
});

test("missing a listing that is not on OFAC is unconfirmed, because many miners cover OFAC only", () => {
  assert.equal(compareSanctions({ sanctioned: false }, onEuOnly), "unconfirmed");
});

test("a listing we can't find is contradicted only when every list was read", () => {
  assert.equal(compareSanctions({ sanctioned: true }, clear), "contradicted");
  assert.equal(compareSanctions({ sanctioned: true }, ukUnread), "unconfirmed");
});

test("an answer with no yes/no is unconfirmed", () => {
  assert.equal(compareSanctions({ note: "maybe" }, clear), "unconfirmed");
});

const tesla: LeiRecord = {
  lei: "54930043XZGB27CTOV49",
  legalName: "TESLA, INC.",
  jurisdiction: "US-TX",
  registeredAs: "0805587591",
  entityStatus: "ACTIVE",
  registrationStatus: "ISSUED",
  lastUpdate: "2026-01-01",
};
const query = "Look up Tesla, Inc. in the GLEIF LEI registry.";

test("the LEI or the national company number confirms a registry answer", () => {
  assert.equal(compareRegistry({ registration_id: tesla.lei }, query, tesla), "confirmed");
  assert.equal(compareRegistry({ registration_id: "0805587591" }, query, tesla), "confirmed");
});

test("another company's LEI is contradicted", () => {
  assert.equal(compareRegistry({ registration_id: "969500ABCDEFGHIJKL12" }, query, tesla), "contradicted");
});

test("an empty answer is unconfirmed (DataWire returned a French address and no ID for Tesla)", () => {
  const answer = { legal_name: null, registration_id: null, jurisdiction: "FR", registered_address: "COURBEVOIE, FR-92, FR" };
  assert.equal(compareRegistry(answer, query, tesla), "unconfirmed");
});

test("with no exact-name record, an LEI is not called wrong", () => {
  assert.equal(compareRegistry({ registration_id: "969500ABCDEFGHIJKL12" }, query, null), "unconfirmed");
});

const putin: ListMatch = { list: "OFAC SDN", id: "35096", name: "PUTIN, Vladimir Vladimirovich", programs: "RUSSIA-EO14024", matchedOn: "PUTIN, Vladimir Vladimirovich", births: ["1952-10-07"] };
const screen = (s: Partial<SanctionsScreen>): SanctionsScreen => ({ matches: [], near: [], ruledOut: [], checked: allLists, notChecked: [], ...s });

test("a name match alone is REVIEW; the same birth date or the exact listed name makes it a HIT", () => {
  assert.equal(verdictFor("Vladimir Putin", null, screen({ matches: [putin] }), [], null).level, "REVIEW");
  assert.equal(verdictFor("Vladimir Putin", "1952", screen({ matches: [putin] }), [], null).level, "HIT");
  assert.equal(verdictFor("Vladimir Vladimirovich Putin", null, screen({ matches: [putin] }), [], null).level, "HIT");
});

test("near names, listed owners and unread lists are REVIEW; otherwise CLEAR", () => {
  assert.equal(verdictFor("Vladimir Puttin", null, screen({ near: [putin] }), [], null).level, "REVIEW");
  const owner = { relation: "ultimate parent", lei: "549300WE6TAF5EEWQS81", name: "Sberbank of Russia", matches: [putin] };
  assert.match(verdictFor("SBERBANK CIB (UK) LIMITED", null, screen({}), [owner], null).reasons[0], /^Owner listed: ultimate parent Sberbank of Russia/);
  assert.equal(verdictFor("Tesla, Inc.", null, screen({ notChecked: ["EU"] }), [], null).level, "REVIEW");
  const clear = verdictFor("Vladimir Putin", "1980", screen({ ruledOut: [putin] }), [], null);
  assert.deepEqual([clear.level, clear.reasons[0]], ["CLEAR", "No match on OFAC SDN, UN, EU, UK. 1 same-name entry was ruled out by birth date."]);
});

test("a birth date is read from the input and kept out of the name", () => {
  assert.deepEqual(parseEntity("person:Vladimir Putin, dob:1952-10-07"), { kind: "person", name: "Vladimir Putin", birth: "1952-10-07" });
  assert.deepEqual(parseEntity("Tesla, Inc."), { kind: "company", name: "Tesla, Inc.", birth: null });
  assert.throws(() => parseEntity("person:A B, dob:07/10/1952"), /dob:YYYY-MM-DD/);
});
