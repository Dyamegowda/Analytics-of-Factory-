const { solve2 } = require("./lp.js");
const P = {pc:40, pt:30, mc:2, mt:1, kc:1, kt:2, H:100, M:80};
const KEYS = ["pc","pt","mc","mt","kc","kt","H","M"];
const RES = solve2([P.pc,P.pt], [[P.mc,P.mt],[P.kc,P.kt]], [P.H,P.M]);
const basisKey = r => r.binding.map(b => b ? 1 : 0).join("");
const run = p => solve2([p.pc,p.pt], [[p.mc,p.mt],[p.kc,p.kt]], [p.H,p.M]);
function sameBasisAt(key, mult) {
  const q = {}; KEYS.forEach(k => q[k] = P[k]);
  q[key] = Math.max(0.01, P[key] * mult);
  const r = run(q);
  return r.feasible && basisKey(r) === basisKey(RES);
}
function edge(key, dir) {
  const step = 0.02 * dir; let good = 1, bad = null, trace = [];
  for (let i = 1; i <= 120; i++) {
    const m = 1 + step * i;
    if (m <= 0.01 || m >= 30) { bad = Math.max(0.01, Math.min(30, m)); break; }
    const ok = sameBasisAt(key, m);
    trace.push([+m.toFixed(2), ok, Math.round(P[key]*m)]);
    if (ok) good = m; else { bad = m; break; }
  }
  return { value: P[key]*good, good, bad, trace: trace.slice(0,6) };
}
console.log("base key", basisKey(RES), "z", RES.z);
const up = edge("H", 1);
console.log("up:", up.value, "good", up.good, "bad", up.bad, "trace", JSON.stringify(up.trace));
const down = edge("H", -1);
console.log("down:", down.value, "good", down.good, "bad", down.bad);
