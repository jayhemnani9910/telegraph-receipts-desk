// Diligence checks per entity and the pack files. Shared by the command line and the web page.
import { mkdirSync, writeFileSync } from "node:fs";
import { config } from "../../src/config.ts";
import type { createPayer } from "../../src/telegraph.ts";
import { buyChecked, type Agreement, type CheckSpec, type Item } from "../../src/evidence.ts";
import { flagValue, listValue, MATCH_LIST_KEYS, mentions, numberValue, SANCTIONED_KEYS, texts } from "../../src/answers.ts";
import { edgarLatestAnnual, gleifLookup, sanctionsScreen, type LeiRecord, type SanctionsScreen } from "../../src/primary.ts";
import { renderPack } from "./render.ts";

export type EntityPack = { name: string; kind: "company" | "person"; items: Item[] };

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
  const kind = input.startsWith("person:") ? "person" : "company";
  const name = input.replace(/^(person|company):/, "").trim();

  const [sanctions, lei, filing] = await Promise.all([
    sanctionsScreen(name),
    kind === "company" ? gleifLookup(name) : null,
    kind === "company" ? edgarLatestAnnual(name) : null,
  ]);

  const purchases: Promise<Item>[] = [];

  const { matches, checked, notChecked } = sanctions.value;
  const listed = matches.length > 0;
  const skipped = notChecked.length ? ` Could not check: ${notChecked.join(", ")}.` : "";
  const more = matches.length - MAX_LISTED_SHOWN;
  purchases.push(
    buy({
      check: "Sanctions (OFAC, UN, EU, UK)",
      intent: "SANCTIONS_SCREENING_MATCH_GENERAL",
      query: `Is ${name} on the US OFAC, UN, EU or UK sanctions list?`,
      params: { name },
      miners: SANCTIONS_MINERS,
      primary: sanctions,
      finding: listed
        ? `Listed: ${matches.slice(0, MAX_LISTED_SHOWN).map((m) => `${m.list} ${m.id} ${m.name} (${m.programs})`).join("; ")}${more > 0 ? `; and ${more} more` : ""}.${skipped}`
        : `No match on ${checked.join(", ")}, or their aliases.${skipped}`,
      limits: "Exact word match on names and aliases; spelling variants and transliterations can be missed, and a name match alone does not prove it is the same person or company. Does not follow ownership.",
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

  return { name, kind, items: await Promise.all(purchases) };
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
