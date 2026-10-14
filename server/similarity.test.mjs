// Run: node server/similarity.test.mjs
import assert from "node:assert/strict";
import { shingleCounts, buildIdf, cosineSimilarity, jaccard, tokenize } from "./similarity.js";

const original = `#include <bits/stdc++.h>
using namespace std;
int main() {
    int n; cin >> n;
    vector<int> a(n);
    for (int i = 0; i < n; i++) cin >> a[i];
    long long best = 0, cur = 0;
    for (int i = 0; i < n; i++) {
        cur = max((long long)a[i], cur + a[i]);   // kadane
        best = max(best, cur);
    }
    cout << best << endl;
}`;
const renamed = original.replace(/\bn\b/g, "count").replace(/\ba\b/g, "arr").replace(/\bcur\b/g, "running").replace(/\bbest\b/g, "answer").replace("// kadane", "/* max subarray */").replace(/\n    /g, "\n\t");
const different = `#include <bits/stdc++.h>
using namespace std;
int main() {
    int n; cin >> n;
    vector<int> a(n);
    for (int i = 0; i < n; i++) cin >> a[i];
    long long best = a[0];
    for (int i = 0; i < n; i++) {
        long long s = 0;
        for (int j = i; j < n; j++) { s += a[j]; if (s > best) best = s; }
    }
    cout << best << endl;
}`;
const unrelated = `import sys
def solve(s):
    t = ''.join(c.lower() for c in s if c.isalnum())
    return "YES" if t == t[::-1] else "NO"
print(solve(sys.stdin.readline()))`;
const fillers = [`int main(){ int x; cin>>x; cout<<x*2; }`, `int main(){ string s; cin>>s; cout<<s; }`, `int main(){ int a,b; cin>>a>>b; cout<<a+b; }`];

const docs = [original, renamed, different, unrelated, ...fillers].map((c) => shingleCounts(c));
const idf = buildIdf(docs);
const sim = (i, j) => cosineSimilarity(docs[i], docs[j], idf);

// renaming variables / comments / indentation must not hide a copy
assert.ok(sim(0, 1) > 0.95, `renamed copy should score ~1, got ${sim(0, 1)}`);
// same boilerplate, different algorithm: clearly lower than a copy
assert.ok(sim(0, 2) < 0.6 && sim(0, 2) < sim(0, 1) - 0.35, `different algorithm too similar: ${sim(0, 2)}`);
// a different language / problem: near zero
assert.ok(sim(0, 3) < 0.1, `unrelated too similar: ${sim(0, 3)}`);
assert.ok(jaccard(docs[0], docs[1]) > 0.95 && jaccard(docs[0], docs[3]) < 0.1);
assert.deepEqual(tokenize("int total = 42; // note\nprintf(\"hi\");").slice(0, 4), ["int", "ID", "=", "NUM"]);
console.log("similarity tests OK:", { copy: +sim(0, 1).toFixed(2), otherAlgorithm: +sim(0, 2).toFixed(2), unrelated: +sim(0, 3).toFixed(2) });
