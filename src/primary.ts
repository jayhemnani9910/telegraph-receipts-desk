// Free primary sources the network's answers are checked against. Each result says where it came from and when.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { config } from "./config.ts";

export type Sourced<T> = { value: T; source: string; asOf: string };

// Lowercase, no accents, punctuation as spaces: "TESLA, INC." == "Tesla, Inc."
export const normalize = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const tokens = (s: string) => new Set(normalize(s).split(" ").filter(Boolean));

// --- OFAC SDN list (US Treasury) ---

const OFAC = "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports";

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') field += text[i++];
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") row.push(field), (field = "");
    else if (c === "\n") row.push(field), rows.push(row), (row = []), (field = "");
    else if (c !== "\r") field += c;
  }
  if (field || row.length) row.push(field), rows.push(row);
  return rows;
}

// One download per day, cached under data/cache.
export async function ofacFile(name: string): Promise<{ rows: string[][]; lastModified: string }> {
  const dir = `data/cache/ofac-${new Date().toISOString().slice(0, 10)}`;
  const path = `${dir}/${name}`;
  if (!existsSync(path)) {
    const res = await fetch(`${OFAC}/${name}`);
    if (!res.ok) throw new Error(`OFAC ${name} -> ${res.status}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, await res.text());
    writeFileSync(`${path}.modified`, res.headers.get("last-modified") ?? "");
  }
  return { rows: parseCsv(readFileSync(path, "utf8")), lastModified: readFileSync(`${path}.modified`, "utf8") };
}

export type SdnMatch = { entNum: string; name: string; type: string; programs: string; matchedOn: string };

// Exact token match: every word of the name appears in an SDN name or alias, in any order.
// No fuzzy matching, so spelling variants are missed; the pack says so.
export async function ofacScreen(name: string): Promise<Sourced<SdnMatch[]>> {
  const [sdn, alt] = await Promise.all([ofacFile("SDN.CSV"), ofacFile("ALT.CSV")]);
  const wanted = tokens(name);
  const hit = (candidate: string) => [...wanted].every((t) => tokens(candidate).has(t));
  const entries = new Map(sdn.rows.map((r) => [r[0], r]));
  // Programs come as "UKRAINE-EO13662] [RUSSIA-EO14024".
  const programs = (r: string[]) => r[3].split("] [").join(", ");
  const matches = new Map<string, SdnMatch>();
  for (const r of sdn.rows) if (r[1] && hit(r[1])) matches.set(r[0], { entNum: r[0], name: r[1], type: r[2], programs: programs(r), matchedOn: r[1] });
  for (const a of alt.rows) {
    const e = entries.get(a[0]);
    if (e && a[3] && !matches.has(a[0]) && hit(a[3])) matches.set(a[0], { entNum: e[0], name: e[1], type: e[2], programs: programs(e), matchedOn: a[3] });
  }
  return { value: [...matches.values()], source: `${OFAC}/SDN.CSV (+ ALT.CSV), list published ${sdn.lastModified}`, asOf: new Date().toISOString() };
}

// --- GLEIF LEI registry ---

export type LeiRecord = {
  lei: string;
  legalName: string;
  jurisdiction: string;
  registeredAs: string | null;
  entityStatus: string;
  registrationStatus: string;
  lastUpdate: string;
};

export async function gleifLookup(name: string): Promise<Sourced<LeiRecord | null>> {
  const url = `https://api.gleif.org/api/v1/lei-records?filter[entity.legalName]=${encodeURIComponent(name)}&page[size]=10`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GLEIF -> ${res.status}`);
  const records: LeiRecord[] = (await res.json()).data.map((r: any) => ({
    lei: r.attributes.lei,
    legalName: r.attributes.entity.legalName.name,
    jurisdiction: r.attributes.entity.jurisdiction,
    registeredAs: r.attributes.entity.registeredAs,
    entityStatus: r.attributes.entity.status,
    registrationStatus: r.attributes.registration.status,
    lastUpdate: r.attributes.registration.lastUpdateDate,
  }));
  const exact = records.find((r) => normalize(r.legalName) === normalize(name)) ?? null;
  return { value: exact, source: url, asOf: new Date().toISOString() };
}

// --- SEC EDGAR ---

export const sec = (url: string) => fetch(url, { headers: { "User-Agent": config.secUserAgent } });

export type Filing = { cik: string; form: string; filingDate: string; accession: string };

// Latest annual report for a company whose name exactly matches an SEC registrant; null if not SEC-registered.
export async function edgarLatestAnnual(name: string): Promise<Sourced<Filing | null>> {
  const asOf = new Date().toISOString();
  const tickers = Object.values(await (await sec("https://www.sec.gov/files/company_tickers.json")).json()) as any[];
  const company = tickers.find((c) => normalize(c.title) === normalize(name));
  if (!company) return { value: null, source: "https://www.sec.gov/files/company_tickers.json", asOf };
  const cik = String(company.cik_str).padStart(10, "0");
  const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
  const recent = (await (await sec(url)).json()).filings.recent;
  const i = recent.form.findIndex((f: string) => f === "10-K" || f === "20-F");
  const value = i < 0 ? null : { cik, form: recent.form[i], filingDate: recent.filingDate[i], accession: recent.accessionNumber[i] };
  return { value, source: url, asOf };
}

// --- FAA National Airspace System status (US airports) ---

export const FAA_NAS = "https://nasstatus.faa.gov/api/airport-status-information";

export type AirportEvent = { type: string; reason: string; detail: string };
export type AirportStatus = { airport: string; disrupted: boolean; events: AirportEvent[]; feedUpdated: string };

const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1]?.trim() ?? "";

// Closures that only restrict general aviation ("CLSD TO NON SKED TRANSIENT GA", "CLSD EXC SKED ACFT") do not stop airline flights.
const gaOnly = (reason: string) => /NON SKED|EXC SKED|TRANSIENT GA/i.test(reason);

export async function faaFeed(): Promise<string> {
  const res = await fetch(FAA_NAS);
  if (!res.ok) throw new Error(`FAA NAS -> ${res.status}`);
  return res.text();
}

export const faaAirportStatus = async (airport: string): Promise<Sourced<AirportStatus>> => ({
  value: parseFaa(await faaFeed(), airport),
  source: FAA_NAS,
  asOf: new Date().toISOString(),
});

// Every airport the feed mentions, for building questions from saved snapshots.
export const faaAirports = (xml: string) => [...new Set([...xml.matchAll(/<ARPT>(\w+)<\/ARPT>/g)].map((m) => m[1]))];

export function parseFaa(xml: string, airport: string): AirportStatus {
  const code = airport.toUpperCase();
  const events: AirportEvent[] = [];
  for (const block of xml.split("<Delay_type>").slice(1)) {
    const type = tag(block, "Name");
    for (const [, entry] of block.matchAll(/<(?:Ground_Delay|Program|Delay|Airport)>([\s\S]*?)<\/(?:Ground_Delay|Program|Delay|Airport)>/g)) {
      if (tag(entry, "ARPT") !== code) continue;
      const reason = tag(entry, "Reason");
      const [avg, min, max] = [tag(entry, "Avg"), tag(entry, "Min"), tag(entry, "Max")];
      // Arrival/departure delays: <Arrival_Departure Type="Departure"><Min>..</Min><Max>..</Max>
      const direction = entry.match(/Arrival_Departure Type="(\w+)"/)?.[1] ?? "";
      const detail = [
        avg && `avg ${avg}`,
        min ? `${direction} delay ${min} to ${max}`.trim() : max && `max ${max}`,
        tag(entry, "End_Time") && `until ${tag(entry, "End_Time")}`,
        tag(entry, "Reopen") && `reopens ${tag(entry, "Reopen")}`,
      ].filter(Boolean).join(", ");
      events.push({ type, reason, detail });
    }
  }
  const disrupted = events.some((e) => !(e.type === "Airport Closures" && gaOnly(e.reason)));
  return { airport: code, disrupted, events, feedUpdated: tag(xml, "Update_Time") };
}
