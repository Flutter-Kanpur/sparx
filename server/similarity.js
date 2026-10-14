// Code similarity engine used by the interview "check similarity" tool and the
// contest-review originality flags.
//
//  1. Tokenise: drop comments/whitespace/preprocessor lines, replace string and
//     number literals and every user-chosen identifier with a placeholder, keep
//     keywords, operators and well-known library names. Renaming variables,
//     reformatting or editing comments therefore cannot hide a copy.
//  2. Shingle: overlapping 5-token chunks.
//  3. TF-IDF cosine: each chunk is weighted by how rare it is across all the
//     submissions to the same problem, so boilerplate everyone writes (starter
//     code, standard input loops) counts for almost nothing and distinctive
//     chunks count a lot.
//
// It is a screening signal, not proof: two correct solutions to a tiny problem
// can legitimately share structure, and a rewrite with a different algorithm
// will not match at all.

const KEYWORDS = new Set((
  // control flow & declarations (C, C++, Java, JS/TS, Python, Go, Rust, Dart, Kotlin, Swift, PHP, Ruby, C#)
  "if else elif for foreach while do switch case default break continue return goto try catch except finally throw throws raise " +
  "int long short float double char byte bool boolean void string str var let const val auto unsigned signed static public private protected final " +
  "class struct enum interface extends implements new delete this self super def fn func function lambda import from include using namespace package " +
  "true false null nullptr none None True False nil undefined typeof instanceof in is not and or async await yield pass with as " +
  // very common library / builtin names (kept so two programs using the same API still look alike)
  "main printf scanf cin cout cerr endl getline puts putchar getchar fgets sizeof malloc free memset strlen strcmp " +
  "print println input read readline range len sorted sort reverse reversed max min sum abs pow sqrt floor ceil round " +
  "append push pop push_back pop_back emplace_back insert erase remove size length begin end front back top empty clear " +
  "vector map set unordered_map unordered_set queue stack deque priority_queue pair make_pair list dict tuple array " +
  "split join strip trim substr substring charAt indexOf includes keys values items get put contains containsKey " +
  "Math Integer String Scanner BufferedReader StringBuilder ArrayList HashMap HashSet LinkedList Arrays Collections " +
  "System out in nextInt nextLine parseInt toString equals hashCode lower upper isdigit isalpha isalnum tolower toupper"
).split(/\s+/));

const PREPROCESSOR_LINE = /^\s*#\s*(include|define|import|pragma|ifdef|ifndef|endif|undef)\b.*$/gm;

export function tokenize(source) {
  let code = String(source || "");
  code = code.replace(PREPROCESSOR_LINE, " ");
  code = code.replace(/\/\*[\s\S]*?\*\//g, " ");           // block comments
  code = code.replace(/(^|[^:"'])\/\/.*$/gm, "$1 ");        // line comments (not URLs)
  code = code.replace(/(^|[^"'\\])#.*$/gm, "$1 ");          // # comments (Python/Ruby/shell)
  code = code.replace(/"""[\s\S]*?"""|'''[\s\S]*?'''/g, " STR ");
  code = code.replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g, " STR ");

  const tokens = [];
  const re = /[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|==|!=|<=|>=|&&|\|\||\+\+|--|\+=|-=|\*=|\/=|%=|->|=>|<<|>>|::|[^\s]/g;
  let m;
  while ((m = re.exec(code))) {
    const t = m[0];
    if (/^\d/.test(t)) tokens.push("NUM");
    else if (t === "STR") tokens.push("STR");
    else if (/^[A-Za-z_]/.test(t)) tokens.push(KEYWORDS.has(t) ? t.toLowerCase() : "ID");
    else tokens.push(t);
  }
  return tokens;
}

/** Map of 5-token chunk -> count. Short programs fall back to shorter chunks so they still compare. */
export function shingleCounts(source, k = 5) {
  const tokens = tokenize(source);
  const n = Math.min(k, Math.max(2, tokens.length));
  const counts = new Map();
  for (let i = 0; i + n <= tokens.length; i++) {
    const key = tokens.slice(i, i + n).join(" ");
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

/** Inverse document frequency over a pool of shingle-count maps (one per submission). */
export function buildIdf(pool) {
  const df = new Map();
  for (const counts of pool) for (const key of counts.keys()) df.set(key, (df.get(key) || 0) + 1);
  const N = pool.length;
  const idf = new Map();
  for (const [key, d] of df) idf.set(key, Math.log((N + 1) / (d + 1)) + 1);
  return idf;
}

function weigh(counts, idf) {
  const vec = new Map();
  let norm = 0;
  for (const [key, c] of counts) {
    const w = (1 + Math.log(c)) * (idf.get(key) ?? 1);
    vec.set(key, w);
    norm += w * w;
  }
  return { vec, norm: Math.sqrt(norm) };
}

/** TF-IDF cosine similarity in [0, 1] between two shingle-count maps. */
export function cosineSimilarity(countsA, countsB, idf) {
  const a = weigh(countsA, idf);
  const b = weigh(countsB, idf);
  if (a.norm === 0 || b.norm === 0) return 0;
  const [small, large] = a.vec.size <= b.vec.size ? [a.vec, b.vec] : [b.vec, a.vec];
  let dot = 0;
  for (const [key, w] of small) {
    const o = large.get(key);
    if (o) dot += w * o;
  }
  return dot / (a.norm * b.norm);
}

/** Plain Jaccard over the chunk sets — no pool needed (used for "did they rewrite their own code"). */
export function jaccard(countsA, countsB) {
  if (countsA.size === 0 || countsB.size === 0) return 0;
  let inter = 0;
  for (const key of countsA.keys()) if (countsB.has(key)) inter++;
  return inter / (countsA.size + countsB.size - inter);
}

/** Programs with fewer normalised tokens than this have too little distinctive structure to compare:
 * e.g. every correct Fibonacci loop is the same few tokens, so a 100% match means nothing. */
export const MIN_MEANINGFUL_TOKENS = 60;
export function isTooShort(source) {
  return tokenize(source).length < MIN_MEANINGFUL_TOKENS;
}
