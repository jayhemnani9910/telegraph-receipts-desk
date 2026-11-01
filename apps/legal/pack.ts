// Diligence checks per entity and the pack files. Shared by the command line and the web page.
import { mkdirSync, writeFileSync } from "node:fs";
import { config } from "../../src/config.ts";
import type { createPayer } from "../../src/telegraph.ts";
import { buyChecked, type CheckSpec, type Item } from "../../src/evidence.ts";
import { flagValue, listValue, MATCH_LIST_KEYS, mentions, SANCTIONED_KEYS, texts } from "../../src/answers.ts";
import { edgarLatestAnnual, gleifLookup, ofacScreen } from "../../src/primary.ts";
import { renderPack } from "./render.ts";

export type EntityPack = { name: string; kind: "company" | "person"; items: Item[] };

const LEI_PATTERN = /\b[A-Z0-9]{18}[0-9]{2}\b/;

async function diligence(payer: ReturnType<typeof createPayer>, input: string): Promise<EntityPack> {
  const buy = (spec: CheckSpec) => buyChecked(payer, "diligence", spec);
  const kind = input.startsWith("person:") ? "person" : "company";
  const name = input.replace(/^(person|company):/, "").trim();

  const [ofac, lei, filing] = await Promise.all([
    ofacScreen(name),
    kind === "company" ? gleifLookup(name) : null,
    kind === "company" ? edgarLatestAnnual(name) : null,
  ]);

  const purchases: Promise<Item>[] = [];

  const listed = ofac.value.length > 0;
  purchases.push(
    buy({
      check: "Sanctions (OFAC SDN)",
      intent: "SANCTIONS_SCREENING_MATCH_GENERAL",
      query: `Is ${name} on the OFAC SDN sanctions list?`,
      params: { name },
      primary: ofac,
      finding: listed
        ? `Listed: ${ofac.value.map((m) => `#${m.entNum} ${m.name} (${m.programs})`).join("; ")}`
        : "No match on the SDN list or its aliases.",
      limits: "US OFAC SDN only (not UN, EU, UK). Exact word match on names and aliases; spelling variants and transliterations can be missed.",
      compare: (answer) => {
        const said = flagValue(answer, SANCTIONED_KEYS) ?? listValue(answer, MATCH_LIST_KEYS);
        return said === null ? "unconfirmed" : said === listed ? "confirmed" : "contradicted";
      },
    }),
  );

  if (lei) {
    const reg = lei.value;
    purchases.push(
      buy({
        check: "Corporate registry (GLEIF LEI)",
        intent: "CORPORATE_REGISTRY_LOOKUP_GENERAL",
        query: `Look up ${name} in the GLEIF LEI registry. What is its LEI code and jurisdiction?`,
        params: { company: name, jurisdiction: reg?.jurisdiction ?? "US" },
        primary: lei,
        finding: reg
          ? `LEI ${reg.lei}, ${reg.legalName}, jurisdiction ${reg.jurisdiction}${reg.registeredAs ? `, company number ${reg.registeredAs}` : ""}, entity ${reg.entityStatus}, registration ${reg.registrationStatus} (updated ${reg.lastUpdate.slice(0, 10)}).`
          : "No LEI record with this exact legal name.",
        limits: "Matches the exact registered legal name; trading names and subsidiaries are not searched.",
        compare: (answer, query) => {
          // The registry identifier may be the LEI or the national company number.
          if (reg && mentions(answer, query, reg.lei, ...(reg.registeredAs ? [reg.registeredAs] : []))) return "confirmed";
          return texts(answer, query).some((t) => LEI_PATTERN.test(t)) ? "contradicted" : "unconfirmed";
        },
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
        params: { entity: `${name} (CIK ${f.cik}) ${f.form}`, period: "last 12 months" },
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

  const dir = `data/packs/${generatedAt.replaceAll(":", "-")}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/pack.json`, JSON.stringify({ generatedAt, payer: payer.address, network: config.network, entities }, null, 2));
  writeFileSync(`${dir}/pack.md`, renderPack(generatedAt, payer.address, entities));
  return { dir, entities };
}
