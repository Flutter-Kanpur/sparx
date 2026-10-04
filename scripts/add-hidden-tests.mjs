// Adds hidden test cases to problems that only had their sample tests, so
// hard-coding the sample outputs no longer passes. Data: scripts/hidden-tests.json
// ({ tests: { <problemId>: [{input, expected}, ...] }, fixes: { <problemId>: [...] } }).
//
// Every expected output was produced by a reference solution that was first
// checked against the problem's existing tests (and, for several, a brute
// force). `fixes` replaces the expected output of an existing test that was
// wrong (e.g. container-with-most-water's "3 / 4 3 2" expects 6, correct is 4).
//
// Safe to re-run: tests whose input already exists are not added twice.
// Dry run by default; pass --apply to write.
//
// Usage:
//   SUPABASE_URL=https://xxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=xxx \
//   node scripts/add-hidden-tests.mjs            # preview
//   node scripts/add-hidden-tests.mjs --apply    # write

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const apply = process.argv.includes("--apply");

if (!url || !serviceKey) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (Project Settings → API → service_role).");
  process.exit(1);
}

const { tests, fixes = {} } = JSON.parse(
  readFileSync(new URL("./hidden-tests.json", import.meta.url), "utf8")
);
const supabase = createClient(url, serviceKey);

let touched = 0;
let added = 0;
for (const [id, extra] of Object.entries(tests)) {
  const { data, error } = await supabase.from("problems").select("tests").eq("id", id).single();
  if (error || !data) {
    console.warn(`skip ${id}: ${error?.message || "not found"}`);
    continue;
  }

  const fixMap = new Map((fixes[id] || []).map((f) => [f.input, f.expected]));
  let changed = false;
  const current = data.tests.map((t) => {
    if (fixMap.has(t.input) && t.expected !== fixMap.get(t.input)) {
      changed = true;
      console.log(`  fix ${id}: expected ${JSON.stringify(t.expected)} -> ${JSON.stringify(fixMap.get(t.input))}`);
      return { ...t, expected: fixMap.get(t.input) };
    }
    return t;
  });

  const have = new Set(current.map((t) => t.input));
  const fresh = extra.filter((t) => !have.has(t.input));
  if (!fresh.length && !changed) continue;

  console.log(`${apply ? "update" : "would update"} ${id}: ${current.length} -> ${current.length + fresh.length} tests`);
  touched++;
  added += fresh.length;
  if (apply) {
    const { error: upErr } = await supabase.from("problems").update({ tests: [...current, ...fresh] }).eq("id", id);
    if (upErr) console.error(`  failed: ${upErr.message}`);
  }
}

console.log(`${apply ? "Updated" : "Would update"} ${touched} problems, ${added} new hidden tests.`);
if (!apply) console.log("Re-run with --apply to write.");
