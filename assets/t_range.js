const { solve2 } = require("./lp.js");
const P = {pc:40, pt:30, mc:2, mt:1, kc:1, kt:2, H:100, M:80};
function key(H){
  const r = solve2([P.pc,P.pt], [[P.mc,P.mt],[P.kc,P.kt]], [H, P.M]);
  return {k: r.binding.map(b=>b?1:0).join(""), z: Math.round(r.z), x: +r.x.toFixed(2), y: +r.y.toFixed(2)};
}
console.log("base:", key(100));
for (const H of [104,110,114,116,120,140,150,158,160,162]) console.log("H="+H, key(H));
