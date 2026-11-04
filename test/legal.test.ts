import "./setup.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { compareRegistry, compareSanctions, saysSanctioned } from "../apps/legal/pack.ts";
import type { LeiRecord, ListMatch, SanctionsScreen } from "../src/primary.ts";

const allLists = ["OFAC SDN", "UN", "EU", "UK"];
const match = (list: string): ListMatch => ({ list, id: "1", name: "X", programs: "P", matchedOn: "X" });
const clear: SanctionsScreen = { matches: [], checked: allLists, notChecked: [] };
const onOfac: SanctionsScreen = { matches: [match("OFAC SDN")], checked: allLists, notChecked: [] };
const onEuOnly: SanctionsScreen = { matches: [match("EU")], checked: allLists, notChecked: [] };
const ukUnread: SanctionsScreen = { matches: [], checked: ["OFAC SDN", "UN", "EU"], notChecked: ["UK"] };

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
