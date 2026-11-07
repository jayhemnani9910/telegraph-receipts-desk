import "./setup.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { nameHit, nameMatch, normalize, ofacBirthDates, parseCsv, parseEu, parseFaa, parseUk, parseUn, sameBirth, sameName } from "../src/primary.ts";

test("normalize ignores case, accents and punctuation", () => {
  assert.equal(normalize("TESLA, INC."), normalize("Tesla Inc"));
  assert.equal(normalize("José"), "jose");
});

test("nameHit needs every word, in any order", () => {
  assert.equal(nameHit("Vladimir Putin")("PUTIN, Vladimir Vladimirovich"), true);
  assert.equal(nameHit("Vladimir Putin")("Vladimir Popov"), false);
});

test("nameHit needs whole words, so Tesla does not match the vessel TELA or TESLAS", () => {
  assert.equal(nameHit("Tesla")("TELA"), false);
  assert.equal(nameHit("Tesla")("TESLAS"), false);
});

test("an empty name matches nothing", () => {
  assert.equal(nameHit("")("anything"), false);
  assert.equal(nameHit(" , ")("anything"), false);
});

test("parseCsv handles quotes, commas and doubled quotes", () => {
  assert.deepEqual(parseCsv('1,"PUTIN, Vladimir","a ""b"""\r\n2,x,y\n'), [["1", "PUTIN, Vladimir", 'a "b"'], ["2", "x", "y"]]);
});

// The list samples below follow the official files' structure.
test("parseUn reads people and entities with their aliases", () => {
  const list = parseUn(`<CONSOLIDATED_LIST dateGenerated="2026-11-03T23:00:03.370Z"><INDIVIDUALS>
    <INDIVIDUAL><FIRST_NAME>ERIC</FIRST_NAME><SECOND_NAME>BADEGE</SECOND_NAME><UN_LIST_TYPE>DRC</UN_LIST_TYPE><REFERENCE_NUMBER>CDi.001</REFERENCE_NUMBER>
      <INDIVIDUAL_ALIAS><ALIAS_NAME>E. B.</ALIAS_NAME></INDIVIDUAL_ALIAS>
      <INDIVIDUAL_DATE_OF_BIRTH><TYPE_OF_DATE>EXACT</TYPE_OF_DATE><DATE>1971-01-01</DATE></INDIVIDUAL_DATE_OF_BIRTH>
      <INDIVIDUAL_DATE_OF_BIRTH><TYPE_OF_DATE>EXACT</TYPE_OF_DATE><YEAR>1972</YEAR></INDIVIDUAL_DATE_OF_BIRTH>
      <INDIVIDUAL_DATE_OF_BIRTH><TYPE_OF_DATE>APPROXIMATELY</TYPE_OF_DATE><YEAR>1960</YEAR></INDIVIDUAL_DATE_OF_BIRTH></INDIVIDUAL></INDIVIDUALS>
    <ENTITIES><ENTITY><FIRST_NAME>ALLIED DEMOCRATIC FORCES &amp; CO</FIRST_NAME><UN_LIST_TYPE>DRC</UN_LIST_TYPE><REFERENCE_NUMBER>CDe.001</REFERENCE_NUMBER></ENTITY></ENTITIES></CONSOLIDATED_LIST>`);
  assert.equal(list.generated, "2026-11-03");
  assert.deepEqual(list.entries, [
    { id: "CDi.001", programs: "DRC", names: ["ERIC BADEGE", "E. B."], births: ["1971-01-01", "1972"] },
    { id: "CDe.001", programs: "DRC", names: ["ALLIED DEMOCRATIC FORCES & CO"], births: [] },
  ]);
});

test("parseEu reads every alias and drops repeats", () => {
  const list = parseEu(`<export generationDate="2026-10-23T17:05:43.888+02:00">
    <sanctionEntity euReferenceNumber="EU.27.28" logicalId="13">
      <regulation programme="IRQ" logicalId="348"/><regulation programme="IRQ" logicalId="349"/>
      <nameAlias wholeName="Saddam Hussein Al-Tikriti" logicalId="17"/><nameAlias wholeName="Abu Ali" logicalId="19"/><nameAlias wholeName="Abu Ali" logicalId="20"/>
      <birthdate circa="false" birthdate="1937-04-28" dayOfMonth="28" monthOfYear="4" year="1937" logicalId="14"><regulationSummary/></birthdate>
      <birthdate circa="false" year="1938" logicalId="15"></birthdate><birthdate circa="true" year="1939" logicalId="16"></birthdate>
    </sanctionEntity></export>`);
  assert.equal(list.generated, "2026-10-23");
  assert.deepEqual(list.entries, [{ id: "EU.27.28", programs: "IRQ", names: ["Saddam Hussein Al-Tikriti", "Abu Ali"], births: ["1937-04-28", "1938"] }]);
});

test("parseUk joins name parts and keeps aliases", () => {
  const list = parseUk(`<Designations><DateGenerated>03/11/2026</DateGenerated><Designation><UniqueID>AFG0001</UniqueID>
    <RegimeName>Afghanistan</RegimeName><Names>
      <Name><Name1>Haji</Name1><Name6>Khairullah</Name6><NameType>Primary Name</NameType></Name>
      <Name><Name6>Haji Alim Hawala</Name6><NameType>Alias</NameType></Name></Names>
      <IndividualDetails><Individual><DOBs><DOB>07/10/1952</DOB><DOB>dd/mm/1960</DOB></DOBs></Individual></IndividualDetails></Designation></Designations>`);
  assert.equal(list.generated, "03/11/2026");
  assert.deepEqual(list.entries, [{ id: "AFG0001", programs: "Afghanistan", names: ["Haji Khairullah", "Haji Alim Hawala"], births: ["1952-10-07", "1960"] }]);
});

const feed = (name: string, entry: string) => `<AIRPORT_STATUS_INFORMATION><Update_Time>Wed Nov 4 10:58:40 2026 GMT</Update_Time><Delay_type><Name>${name}</Name>${entry}</Delay_type></AIRPORT_STATUS_INFORMATION>`;

test("a closure only for private planes does not count as disruption (the real LAS notice)", () => {
  const xml = feed("Airport Closures", "<Airport><ARPT>LAS</ARPT><Reason>!LAS 10/160 LAS AD AP CLSD TO NON SKED TRANSIENT GA ACFT</Reason><Reopen>Jan 27 at 23:00 UTC.</Reopen></Airport>");
  const status = parseFaa(xml, "las");
  assert.equal(status.disrupted, false);
  assert.equal(status.events.length, 1);
});

test("a full closure and a ground delay both count as disruption", () => {
  assert.equal(parseFaa(feed("Airport Closures", "<Airport><ARPT>JFK</ARPT><Reason>RUNWAY CONSTRUCTION</Reason></Airport>"), "JFK").disrupted, true);
  const status = parseFaa(feed("Ground Delay Programs", "<Ground_Delay><ARPT>JFK</ARPT><Reason>weather</Reason><Avg>45 minutes</Avg></Ground_Delay>"), "JFK");
  assert.equal(status.disrupted, true);
  assert.match(status.events[0].detail, /avg 45 minutes/);
});

test("another airport's event does not count", () => {
  const status = parseFaa(feed("Ground Delay Programs", "<Ground_Delay><ARPT>EWR</ARPT><Reason>weather</Reason></Ground_Delay>"), "JFK");
  assert.deepEqual([status.disrupted, status.events.length, status.feedUpdated], [false, 0, "Wed Nov 4 10:58:40 2026 GMT"]);
});

test("a near match allows one typo in a long word, never in a short one, and needs one exact word", () => {
  const m = nameMatch("Vladimir Puttin");
  assert.equal(m("PUTIN, Vladimir Vladimirovich"), "near");
  assert.equal(nameMatch("Vladimir Putin")("PUTIN, Vladimir Vladimirovich"), "exact");
  assert.equal(nameMatch("Tata Steel")("Tara Steel"), null);
  assert.equal(nameMatch("Gazprum")("Gazprom"), null);
  assert.equal(nameMatch("Vladimir Putin")("Vladimir Popov"), null);
});

test("birth dates: a year agrees with any date in it; OFAC remarks give dates and years, not ranges", () => {
  assert.equal(sameBirth("1952-10-07", "1952"), true);
  assert.equal(sameBirth("1952-10-07", "1952-10-08"), false);
  assert.equal(sameBirth("1980", "1952-10-07"), false);
  assert.deepEqual(ofacBirthDates("DOB 07 Oct 1952; POB Leningrad; DOB 1953; DOB circa 1960; DOB 1960 to 1962;"), ["1952-10-07", "1953"]);
});

test("sameName needs the same words both ways", () => {
  assert.equal(sameName("Tesla, Inc.", "TESLA INC"), true);
  assert.equal(sameName("Vladimir Putin", "PUTIN, Vladimir Vladimirovich"), false);
});
