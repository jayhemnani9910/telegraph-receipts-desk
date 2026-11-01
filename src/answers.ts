// Reading miner answers: they come back as arbitrary JSON, so look at values and field names, not the raw text.

type Leaf = [key: string, value: unknown];

// Every scalar in the answer with the key it sits under.
export const leaves = (value: unknown, key = ""): Leaf[] =>
  Array.isArray(value)
    ? value.flatMap((v) => leaves(v, key))
    : value && typeof value === "object"
      ? Object.entries(value).flatMap(([k, v]) => leaves(v, k))
      : [[key, value]];

// String values, minus any that only echo the question back.
export const texts = (result: unknown, query: string) =>
  leaves(result)
    .map(([, v]) => v)
    .filter((v): v is string => typeof v === "string" && !query.toLowerCase().includes(v.toLowerCase()));

export const mentions = (result: unknown, query: string, ...words: string[]) =>
  texts(result, query).some((t) => words.some((w) => t.toLowerCase().includes(w.toLowerCase())));

// Value of the yes/no fields among `keys`: true or false if they all agree, null if absent or mixed.
export const flagValue = (result: unknown, keys: string[]): boolean | null => {
  // An empty field (V2 returns null for anything the miner did not say) is no answer, not "no".
  const found = leaves(result)
    .filter(([k, v]) => keys.includes(k.toLowerCase()) && v !== null && v !== undefined && v !== "")
    .map(([, v]) => [true, 1, "true", "yes"].includes(v as any));
  if (!found.length || found.some((v) => v !== found[0])) return null;
  return found[0];
};

export const SANCTIONED_KEYS = ["on_list", "sanctioned", "is_sanctioned", "match", "matched", "listed"];
export const DISRUPTED_KEYS = ["disrupted", "disruption_active", "is_disrupted"];

// Whether a list field such as "matches" is non-empty; null if no such field.
export const listValue = (result: unknown, keys: string[]): boolean | null => {
  if (Array.isArray(result)) {
    for (const v of result) {
      const found = listValue(v, keys);
      if (found !== null) return found;
    }
  } else if (result && typeof result === "object") {
    for (const [k, v] of Object.entries(result)) {
      if (keys.includes(k.toLowerCase()) && Array.isArray(v)) return v.length > 0;
      const found = listValue(v, keys);
      if (found !== null) return found;
    }
  }
  return null;
};

export const MATCH_LIST_KEYS = ["matches", "hits"];
