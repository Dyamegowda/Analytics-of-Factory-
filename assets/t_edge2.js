const { solve2 } = require("./lp.js");
const P = {pc:40, pt:30, mc:2, mt:1, kc:1, kt:2, H:100, M:80};
const KEYS = ["pc","pt","mc","mt","kc","kt","H","M"];
const base = solve2([P.pc,P.pt], [[P.mc,P.mt],[P.kc,P.kt]], [P.H,P.M]);
const key = r => r.binding.map(b => b?1:0).join("");
for (const mult of [1.12, 1.14, 1.2]) {
  const q = {}; KEYS.forEach(k => q[k] = P[k]); q.H = P.H * mult;
  const r = solve2([q.pc,q.pt], [[q.mc,q.mt],[q.kc,q.kt]], [q.H, q.M]);
  console.log("mult", mult, "H", q.H.toFixed(2), "-> k", key(r), "x", r.x.toFixed(3), "y", r.y.toFixed(3),
              "slack", r.slack.map(s => s.toFixed(6)).join(","), "z", Math.round(r.z));
}
console.log("base k", key(base), "slack", base.slack.map(s=>s.toFixed(6)).join(","));
