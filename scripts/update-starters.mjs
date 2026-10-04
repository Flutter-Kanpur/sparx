// Updates the editor starter code of problems from a JSON file of
// { <problemId>: { <language>: <code> } } — only the listed languages are
// replaced, the rest of each problem's `starter` is left alone.
//
//   scripts/starter-skeletons.json  the 10 beginner problems whose starter
//                                   code contained the full solution -> now
//                                   input-reading skeletons only
//   scripts/starter-repairs.json    starters where "\n" had been stored as a
//                                   real newline inside a string literal (a
//                                   syntax error in JS/C/C++/Python)
//
// Dry run by default; pass --apply to write. Safe to re-run.
//
// Usage:
//   SUPABASE_URL=https://xxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=xxx \
//   node scripts/update-starters.mjs scripts/starter-skeletons.json [--apply]

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const file = process.argv.find((a) => a.endsWith(".json"));
const apply = process.argv.includes("--apply");

if (!url || !serviceKey || !file) {
  console.error("Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/update-starters.mjs <changes.json> [--apply]");
  process.exit(1);
}

const changes = JSON.parse(readFileSync(file, "utf8"));
const supabase = createClient(url, serviceKey);

let touched = 0;
for (const [id, langs] of Object.entries(changes)) {
  const { data, error } = await supabase.from("problems").select("starter").eq("id", id).single();
  if (error || !data) {
    console.warn(`skip ${id}: ${error?.message || "not found"}`);
    continue;
  }
  const next = { ...data.starter, ...langs };
  if (JSON.stringify(next) === JSON.stringify(data.starter)) continue;
  console.log(`${apply ? "update" : "would update"} ${id}: ${Object.keys(langs).join(", ")}`);
  touched++;
  if (apply) {
    const { error: upErr } = await supabase.from("problems").update({ starter: next }).eq("id", id);
    if (upErr) console.error(`  failed: ${upErr.message}`);
  }
}
console.log(`${apply ? "Updated" : "Would update"} ${touched} problems.`);
if (!apply) console.log("Re-run with --apply to write.");
