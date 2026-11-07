// Free primary sources the network's answers are checked against. Each result says where it came from and when.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { config } from "./config.ts";

export type Sourced<T> = { value: T; source: string; asOf: string };

// Lowercase, no accents, punctuation as spaces: "TESLA, INC." == "Tesla, Inc."
export const normalize = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const tokens = (s: string) => new Set(normalize(s).split(" ").filter(Boolean));

// In a near match a word may be one typo off when the longer spelling has 6 or more letters ("Puttin", "Putin");
// shorter words must match exactly, so "Tara Steel" is not "Tata Steel".
const NEAR_MIN_LENGTH = 6;

const oneEditApart = (a: string, b: string) => {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) (i++, j++);
    else {
      if (++edits > 1) return false;
      if (a.length >= b.length) i++;
      if (b.length >= a.length) j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
};

export type NameMatch = "exact" | "near" | null;

// exact: every word of the name appears in the candidate, in any order. near: the same, but long words may be one
// typo off, and at least one word is exact. A near match is for review, never a finding on its own.
export const nameMatch = (name: string) => {
  const wanted = [...tokens(name)];
  return (candidate: string): NameMatch => {
    if (!wanted.length) return null;
    const words = tokens(candidate);
    if (wanted.every((t) => words.has(t))) return "exact";
    const close = (t: string) => [...words].some((w) => Math.max(t.length, w.length) >= NEAR_MIN_LENGTH && oneEditApart(t, w));
    return wanted.some((t) => words.has(t)) && wanted.every((t) => words.has(t) || close(t)) ? "near" : null;
  };
};

export const nameHit = (name: string) => {
  const match = nameMatch(name);
  return (candidate: string) => match(candidate) === "exact";
};

// Same words both ways: "Tesla, Inc." and "TESLA INC". A listed name that only contains the query is not this.
export const sameName = (a: string, b: string) => {
  const [x, y] = [tokens(a), tokens(b)];
  return x.size > 0 && x.size === y.size && [...x].every((t) => y.has(t));
};

// Dates of birth as "YYYY-MM-DD" or "YYYY". A year-only date agrees with any date in that year.
export const sameBirth = (a: string, b: string) => (a.length === 4 || b.length === 4 ? a.slice(0, 4) === b.slice(0, 4) : a === b);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "DOB 07 Oct 1952; DOB 1953;" in the OFAC remarks. Ranges and circa dates are left out, so they never rule anyone out.
export const ofacBirthDates = (remarks: string) =>
  [...remarks.matchAll(/DOB ([^;]*)/g)].flatMap(([, d]) => {
    const full = d.trim().match(/^(\d{2}) ([A-Z][a-z]{2}) (\d{4})$/);
    if (full && MONTHS.includes(full[2])) return [`${full[3]}-${String(MONTHS.indexOf(full[2]) + 1).padStart(2, "0")}-${full[1]}`];
    return /^\d{4}$/.test(d.trim()) ? [d.trim()] : [];
  });

// --- OFAC SDN list (US Treasury) ---

const OFAC = "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports";

export function parseCsv(text: string): string[][] {
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
  const dir = `${config.dataDir}/cache/ofac-${new Date().toISOString().slice(0, 10)}`;
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

export type SdnMatch = { entNum: string; name: string; type: string; programs: string; matchedOn: string; match: "exact" | "near"; births: string[] };

// Matches SDN names and aliases; an exact match wins over a near one for the same entry.
export async function ofacScreen(name: string): Promise<Sourced<SdnMatch[]>> {
  const [sdn, alt] = await Promise.all([ofacFile("SDN.CSV"), ofacFile("ALT.CSV")]);
  const match = nameMatch(name);
  const entries = new Map(sdn.rows.map((r) => [r[0], r]));
  // Programs come as "UKRAINE-EO13662] [RUSSIA-EO14024".
  const programs = (r: string[]) => r[3].split("] [").join(", ");
  const matches = new Map<string, SdnMatch>();
  const consider = (e: string[], matchedOn: string) => {
    const m = match(matchedOn);
    if (!m || matches.get(e[0])?.match === "exact") return;
    if (m === "near" && matches.has(e[0])) return;
    matches.set(e[0], { entNum: e[0], name: e[1], type: e[2], programs: programs(e), matchedOn, match: m, births: ofacBirthDates(e[11] ?? "") });
  };
  for (const r of sdn.rows) if (r[1]) consider(r, r[1]);
  for (const a of alt.rows) {
    const e = entries.get(a[0]);
    if (e && a[3]) consider(e, a[3]);
  }
  return { value: [...matches.values()], source: `${OFAC}/SDN.CSV (+ ALT.CSV), list published ${sdn.lastModified}`, asOf: new Date().toISOString() };
}

// --- UN, EU and UK sanctions lists ---

type ListEntry = { id: string; names: string[]; programs: string; births: string[] };
type ParsedList = { entries: ListEntry[]; generated: string };

const unescapeXml = (s: string) =>
  s.replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" })[e as string] as string);

const allTags = (xml: string, name: string) => [...xml.matchAll(new RegExp(`<${name}>([^<]*)</${name}>`, "g"))].map((m) => unescapeXml(m[1].trim()));

export const parseUn = (xml: string): ParsedList => ({
  generated: xml.match(/dateGenerated="([\d-]{10})/)?.[1] ?? "unknown",
  entries: xml.split(/<(?:INDIVIDUAL|ENTITY)>/).slice(1).map((b) => ({
    id: allTags(b, "REFERENCE_NUMBER")[0] ?? "",
    programs: allTags(b, "UN_LIST_TYPE").join(", "),
    names: [["FIRST_NAME", "SECOND_NAME", "THIRD_NAME", "FOURTH_NAME"].flatMap((t) => allTags(b, t)).join(" "), ...allTags(b, "ALIAS_NAME")].filter(Boolean),
    // Exact dates, and years marked EXACT; approximate years and ranges are left out.
    births: b.split("<INDIVIDUAL_DATE_OF_BIRTH>").slice(1).flatMap((d) => {
      const date = allTags(d, "DATE")[0];
      if (date) return [date];
      return allTags(d, "TYPE_OF_DATE")[0] === "EXACT" && allTags(d, "YEAR")[0] ? [allTags(d, "YEAR")[0]] : [];
    }),
  })),
});

export const parseEu = (xml: string): ParsedList => ({
  generated: xml.match(/generationDate="([\d-]{10})/)?.[1] ?? "unknown",
  entries: xml.split("<sanctionEntity ").slice(1).map((b) => ({
    id: b.match(/euReferenceNumber="([^"]*)"/)?.[1] ?? "",
    programs: [...new Set([...b.matchAll(/ programme="([^"]+)"/g)].map((m) => m[1]))].join(", "),
    names: [...new Set([...b.matchAll(/ wholeName="([^"]+)"/g)].map((m) => unescapeXml(m[1])))],
    births: [...b.matchAll(/<birthdate ([^>]*)>/g)].flatMap(([, attrs]) => {
      if (/circa="true"/.test(attrs)) return [];
      const date = attrs.match(/ birthdate="(\d{4}-\d{2}-\d{2})"/)?.[1] ?? attrs.match(/ year="(\d{4})"/)?.[1];
      return date ? [date] : [];
    }),
  })),
});

export const parseUk = (xml: string): ParsedList => ({
  generated: allTags(xml, "DateGenerated")[0] ?? "unknown",
  entries: xml.split("<Designation>").slice(1).map((b) => ({
    id: allTags(b, "UniqueID")[0] ?? "",
    programs: allTags(b, "RegimeName").join(", "),
    names: b.split("<Name>").slice(1).map((n) => ["Name1", "Name2", "Name3", "Name4", "Name5", "Name6"].flatMap((t) => allTags(n, t)).join(" ")).filter(Boolean),
    // "07/10/1952"; "dd/mm/1952" and "1952" give the year only.
    births: allTags(b, "DOB").flatMap((d) => {
      const full = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (full) return [`${full[3]}-${full[2]}-${full[1]}`];
      const year = d.match(/(\d{4})$/)?.[1];
      return year ? [year] : [];
    }),
  })),
});

const OTHER_LISTS = [
  { list: "UN", url: "https://scsanctions.un.org/resources/xml/en/consolidated.xml", parse: parseUn },
  { list: "EU", url: "https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw", parse: parseEu },
  { list: "UK", url: "https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.xml", parse: parseUk },
];

const parsedLists = new Map<string, Promise<ParsedList>>();

// One download per day, cached under data/cache; each list is parsed once per process.
function loadList({ list, url, parse }: (typeof OTHER_LISTS)[number]): Promise<ParsedList> {
  const dir = `${config.dataDir}/cache/sanctions-${new Date().toISOString().slice(0, 10)}`;
  const path = `${dir}/${list}.xml`;
  const pending = parsedLists.get(path);
  if (pending) return pending;
  const loading = (async () => {
    if (!existsSync(path)) {
      const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
      if (!res.ok) throw new Error(`${list} list -> ${res.status}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, await res.text());
    }
    return parse(readFileSync(path, "utf8"));
  })();
  loading.catch(() => parsedLists.delete(path));
  parsedLists.set(path, loading);
  return loading;
}

export type ListMatch = { list: string; id: string; name: string; programs: string; matchedOn: string; births: string[] };
export type SanctionsScreen = {
  // Every word of the name appears in a listed name or alias, and no listed birth date contradicts the one given.
  matches: ListMatch[];
  // A listed name one typo away: for review, not a finding.
  near: ListMatch[];
  // The name matches, but every listed birth date differs from the one given.
  ruledOut: ListMatch[];
  checked: string[];
  notChecked: string[];
};

// A list that cannot be read is reported as not checked, never as "no match". A birth date, when given, only rules
// out entries that list birth dates and none of them agree; it is never sent to the network.
export async function sanctionsScreen(name: string, birth?: string): Promise<Sourced<SanctionsScreen>> {
  const match = nameMatch(name);
  const [ofac, ...others] = await Promise.allSettled([ofacScreen(name), ...OTHER_LISTS.map(loadList)]);
  const screen: SanctionsScreen = { matches: [], near: [], ruledOut: [], checked: [], notChecked: [] };
  const add = (m: ListMatch, kind: "exact" | "near") => {
    if (birth && m.births.length && !m.births.some((b) => sameBirth(b, birth))) screen.ruledOut.push(m);
    else (kind === "exact" ? screen.matches : screen.near).push(m);
  };
  const sources: string[] = [];
  if (ofac.status === "fulfilled") {
    screen.checked.push("OFAC SDN");
    sources.push(ofac.value.source);
    for (const m of ofac.value.value) add({ list: "OFAC SDN", id: m.entNum, name: m.name, programs: m.programs, matchedOn: m.matchedOn, births: m.births }, m.match);
  } else screen.notChecked.push("OFAC SDN");
  others.forEach((result, i) => {
    const { list, url } = OTHER_LISTS[i];
    if (result.status === "rejected") return void screen.notChecked.push(list);
    screen.checked.push(list);
    sources.push(`${url}, generated ${result.value.generated}`);
    for (const e of result.value.entries) {
      const results = e.names.map((n) => [n, match(n)] as const);
      const best = results.find(([, m]) => m === "exact") ?? results.find(([, m]) => m === "near");
      if (best) add({ list, id: e.id, name: best[0], programs: e.programs, matchedOn: best[0], births: e.births }, best[1]!);
    }
  });
  return { value: screen, source: sources.join("; "), asOf: new Date().toISOString() };
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

export type Parent = { relation: "direct parent" | "ultimate parent"; lei: string; names: string[] };

// Parent companies as reported to GLEIF. Most companies report none or an exception; that is "none reported", not "no owner".
// Names in other scripts are left out (sanctions lists use Latin script), but GLEIF's English names are kept.
export async function gleifParents(lei: string): Promise<Sourced<Parent[]>> {
  const base = `https://api.gleif.org/api/v1/lei-records/${lei}`;
  const parents: Parent[] = [];
  for (const relation of ["direct parent", "ultimate parent"] as const) {
    const res = await fetch(`${base}/${relation.replace(" ", "-")}`);
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`GLEIF ${relation} -> ${res.status}`);
    const { attributes: a } = (await res.json()).data;
    if (parents.some((p) => p.lei === a.lei)) continue;
    const all: string[] = [a.entity.legalName.name, ...(a.entity.otherNames ?? []).map((n: any) => n.name), ...(a.entity.transliteratedOtherNames ?? []).map((n: any) => n.name)];
    parents.push({ relation, lei: a.lei, names: [...new Set(all.filter((n) => /[A-Za-z]/.test(n)))] });
  }
  return { value: parents, source: `${base}/direct-parent, ${base}/ultimate-parent`, asOf: new Date().toISOString() };
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
