// Diligence checks per entity and the pack files. Shared by the command line and the web page.
import { mkdirSync, writeFileSync } from "node:fs";
import { config } from "../../src/config.ts";
import type { createPayer } from "../../src/telegraph.ts";
import { buyChecked, type Agreement, type CheckSpec, type Item } from "../../src/evidence.ts";
import { flagValue, listValue, MATCH_LIST_KEYS, mentions, numberValue, SANCTIONED_KEYS, texts } from "../../src/answers.ts";
import { edgarLatestAnnual, gleifLookup, gleifParents, sameBirth, sameName, sanctionsScreen, type LeiRecord, type ListMatch, type SanctionsScreen, type Sourced } from "../../src/primary.ts";
import { renderPack } from "./render.ts";

export type Owner = { relation: string; lei: string; name: string; matches: ListMatch[] };
export type Verdict = { level: "CLEAR" | "REVIEW" | "HIT"; reasons: string[] };
export type EntityPack = {
  name: string;
  kind: "company" | "person";
  birth: string | null;
  items: Item[];
  // Parent companies reported to GLEIF, each screened against the same lists. Free; null when not looked up.
  owners: Sourced<Owner[]> | null;
  ownersNote: string | null;
  verdict: Verdict;
};

// "Tesla, Inc." or "person:Vladimir Putin, dob:1952-10-07". The birth date stays local; only the name goes to miners.
export function parseEntity(input: string) {
  const kind: "company" | "person" = input.startsWith("person:") ? "person" : "company";
  const dob = input.match(/,\s*dob:\s*(\S+)\s*$/i);
  if (dob && !/^\d{4}(-\d{2}-\d{2})?$/.test(dob[1])) throw new Error(`Write the birth date as dob:YYYY-MM-DD or dob:YYYY, not ${dob[1]}`);
  const name = input.replace(/^(person|company):/, "").replace(/,\s*dob:.*$/i, "").trim();
  return { kind, name, birth: dob?.[1] ?? null };
}

const listed = (m: ListMatch) => `${m.list} ${m.id} ${m.name}`;

// One call for the person reading the pack. HIT: listed under this exact name, or with the same birth date.
// REVIEW: a possible match that a name alone cannot settle, a listed owner, or a list that could not be read.
export function verdictFor(name: string, birth: string | null, screen: SanctionsScreen, owners: Owner[], ownersNote: string | null): Verdict {
  const sure = screen.matches.filter((m) => sameName(name, m.matchedOn) || (birth !== null && m.births.some((b) => sameBirth(b, birth))));
  if (sure.length) return { level: "HIT", reasons: [`Listed: ${sure.slice(0, 3).map(listed).join("; ")}.`] };
  const reasons = [
    screen.matches.length && `Name matches ${screen.matches.length} listed ${screen.matches.length === 1 ? "entry" : "entries"} (e.g. ${listed(screen.matches[0])}); confirm it is the same ${birth ? "one" : "one, for example by adding dob:YYYY-MM-DD"}.`,
    screen.near.length && `Similar name, one letter off: ${screen.near.slice(0, 3).map(listed).join("; ")}.`,
    ...owners.filter((o) => o.matches.length).map((o) => `Owner listed: ${o.relation} ${o.name} (${listed(o.matches[0])}).`),
    screen.notChecked.length && `Could not read: ${screen.notChecked.join(", ")}.`,
    ownersNote,
  ].filter((r): r is string => Boolean(r));
  if (reasons.length) return { level: "REVIEW", reasons };
  const ruledOut = screen.ruledOut.length ? ` ${screen.ruledOut.length} same-name ${screen.ruledOut.length === 1 ? "entry was" : "entries were"} ruled out by birth date.` : "";
  return { level: "CLEAR", reasons: [`No match on ${screen.checked.join(", ")}.${ruledOut}`] };
}

async function screenOwners(lei: string): Promise<{ owners: Sourced<Owner[]> | null; note: string | null }> {
  try {
    const parents = await gleifParents(lei);
    const owners: Owner[] = [];
    for (const p of parents.value) {
      // A one-word short name like "Sberbank" matches every listed company with that word, so full names only.
      const full = p.names.filter((n) => n.trim().split(/\s+/).length > 1);
      const screened = full.length ? full : p.names;
      const found = new Map<string, ListMatch>();
      for (const n of screened) for (const m of (await sanctionsScreen(n)).value.matches) found.set(`${m.list} ${m.id}`, m);
      owners.push({ relation: p.relation, lei: p.lei, name: screened.at(-1)!, matches: [...found.values()] });
    }
    return { owners: { ...parents, value: owners }, note: null };
  } catch (err) {
    return { owners: null, note: `Could not check owners: ${(err as Error).message}.` };
  }
}

const LEI_PATTERN = /\b[A-Z0-9]{18}[0-9]{2}\b/;

// Miners asked directly before the routed ask, checked on 2026-11-01: on V2 routing these Intents often reached
// miners that could not answer. IDs can change; a miner that is gone or cannot take the request costs nothing.
const SANCTIONS_MINERS = ["710637", "4433"]; // Sanctions Name Evidence (clear yes/no, checked 2026-11-04), LiveCert
// TxLens, then DataWire. Trial on 2026-11-04 with six US, UK and German companies: 14 of 14 right against 9 of 12.
const REGISTRY_MINERS = ["9002", "7393"];
const FILING_MINERS = ["77131"]; // Filing Window, checked 2026-11-04: wants the exact SEC name and explicit dates

// Long enough to always hold the latest annual report of a company that files on time.
const FILING_WINDOW_DAYS = 400;

const filingWindow = () => {
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return `${day(Date.now() - FILING_WINDOW_DAYS * 86_400_000)} to ${day(Date.now())}`;
};

const MAX_LISTED_SHOWN = 8;

// V2 sometimes drops the yes/no. A near-certain score counts, but a fuzzy candidate is no verdict, even in the
// match list: LiveCert returned the vessel TELA for "Tesla, Inc." at 0.947.
export const saysSanctioned = (answer: unknown) => {
  const flag = flagValue(answer, SANCTIONED_KEYS);
  if (flag !== null) return flag;
  const score = numberValue(answer, ["match_score"]);
  if (score !== null) return score >= 0.99 ? true : score <= 0.5 ? false : null;
  return listValue(answer, MATCH_LIST_KEYS);
};

export function compareSanctions(answer: unknown, { matches, notChecked }: SanctionsScreen): Agreement {
  const said = saysSanctioned(answer);
  if (said === null) return "unconfirmed";
  if (said === matches.length > 0) return "confirmed";
  // Many miners cover OFAC only, so missing a UN, EU or UK listing is not a wrong answer about what they cover.
  if (!said && !matches.some((m) => m.list === "OFAC SDN")) return "unconfirmed";
  // A list we could not read may be where the miner found it.
  return said && notChecked.length ? "unconfirmed" : "contradicted";
}

export function compareRegistry(answer: unknown, query: string, reg: LeiRecord | null): Agreement {
  // The registry identifier may be the LEI or the national company number.
  if (reg && mentions(answer, query, reg.lei, ...(reg.registeredAs ? [reg.registeredAs] : []))) return "confirmed";
  // With no exact-name record to compare against, another LEI is not shown to be wrong.
  return reg && texts(answer, query).some((t) => LEI_PATTERN.test(t)) ? "contradicted" : "unconfirmed";
}

async function diligence(payer: ReturnType<typeof createPayer>, input: string): Promise<EntityPack> {
  const buy = (spec: CheckSpec) => buyChecked(payer, "diligence", spec);
  const { kind, name, birth } = parseEntity(input);

  const [sanctions, lei, filing] = await Promise.all([
    sanctionsScreen(name, birth ?? undefined),
    kind === "company" ? gleifLookup(name) : null,
    kind === "company" ? edgarLatestAnnual(name) : null,
  ]);

  const purchases: Promise<Item>[] = [];

  const { matches, near, ruledOut, checked, notChecked } = sanctions.value;
  const skipped = notChecked.length ? ` Could not check: ${notChecked.join(", ")}.` : "";
  const more = matches.length - MAX_LISTED_SHOWN;
  const also = [
    near.length && `${near.length} similar ${near.length === 1 ? "name" : "names"} one letter off (for review)`,
    ruledOut.length && `${ruledOut.length} same-name ${ruledOut.length === 1 ? "entry" : "entries"} ruled out by birth date`,
  ].filter(Boolean);
  const alsoText = also.length ? ` Also: ${also.join("; ")}.` : "";
  purchases.push(
    buy({
      check: "Sanctions (OFAC, UN, EU, UK)",
      intent: "SANCTIONS_SCREENING_MATCH_GENERAL",
      query: `Is ${name} on the US OFAC, UN, EU or UK sanctions list?`,
      params: { name },
      miners: SANCTIONS_MINERS,
      primary: sanctions,
      finding: matches.length
        ? `Listed: ${matches.slice(0, MAX_LISTED_SHOWN).map((m) => `${m.list} ${m.id} ${m.name} (${m.programs})`).join("; ")}${more > 0 ? `; and ${more} more` : ""}.${alsoText}${skipped}`
        : `No match on ${checked.join(", ")}, or their aliases.${alsoText}${skipped}`,
      limits: "Every word of the name must appear in a listed name or alias; words of 6 or more letters may be one letter off, shown for review only. Other spellings and transliterations can be missed. A name match alone does not prove it is the same person or company; a birth date, if given, rules out entries whose listed birth dates all differ.",
      compare: (answer) => compareSanctions(answer, sanctions.value),
    }),
  );

  if (lei) {
    const reg = lei.value;
    purchases.push(
      buy({
        check: "Corporate registry (GLEIF LEI)",
        intent: "CORPORATE_REGISTRY_LOOKUP_GENERAL",
        query: `Look up ${name} in the GLEIF LEI registry. What is its LEI code and jurisdiction?`,
        // Country only: asked for "US-CA", DataWire sometimes answered with an SEC number instead of the LEI.
        params: { company: name, jurisdiction: (reg?.jurisdiction ?? "US").split("-")[0] },
        miners: REGISTRY_MINERS,
        primary: lei,
        finding: reg
          ? `LEI ${reg.lei}, ${reg.legalName}, jurisdiction ${reg.jurisdiction}${reg.registeredAs ? `, company number ${reg.registeredAs}` : ""}, entity ${reg.entityStatus}, registration ${reg.registrationStatus} (updated ${reg.lastUpdate.slice(0, 10)}).`
          : "No LEI record with this exact legal name.",
        limits: "Matches the exact registered legal name; trading names and subsidiaries are not searched.",
        compare: (answer, query) => compareRegistry(answer, query, reg),
      }),
    );
  }

  if (filing?.value) {
    const f = filing.value;
    purchases.push(
      buy({
        check: "Latest annual report (SEC EDGAR)",
        intent: "REGULATORY_FILING_MONITOR_GENERAL",
        query: `What is the filing date of ${name}'s (CIK ${f.cik}) most recent ${f.form} on SEC EDGAR?`,
        params: { entity: `${name} ${f.form}`, period: filingWindow() },
        miners: FILING_MINERS,
        primary: filing,
        finding: `${f.form} filed ${f.filingDate}, accession ${f.accession}.`,
        limits: "US SEC registrants only.",
        // Filing URLs carry the accession number without dashes.
        compare: (answer, query) =>
          mentions(answer, query, f.filingDate, f.accession, f.accession.replaceAll("-", "")) ? "confirmed" : "unconfirmed",
      }),
    );
  }

  const { owners, note } = lei?.value ? await screenOwners(lei.value.lei) : { owners: null, note: null };
  const items = await Promise.all(purchases);
  return { name, kind, birth, items, owners, ownersNote: note, verdict: verdictFor(name, birth, sanctions.value, owners?.value ?? [], note) };
}

// Runs the entities one after another and writes pack.md and pack.json. Returns the folder and the results.
export async function buildPack(payer: ReturnType<typeof createPayer>, inputs: string[]) {
  const generatedAt = new Date().toISOString();
  const entities: EntityPack[] = [];
  for (const input of inputs) entities.push(await diligence(payer, input));

  const dir = `${config.dataDir}/packs/${generatedAt.replaceAll(":", "-")}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/pack.json`, JSON.stringify({ generatedAt, payer: payer.address, network: config.network, entities }, null, 2));
  writeFileSync(`${dir}/pack.md`, renderPack(generatedAt, payer.address, entities));
  return { dir, entities };
}
