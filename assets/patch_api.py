import pathlib
p = pathlib.Path("lp.js")
s = p.read_text(encoding="utf-8")

anchor = '    if ($("basisOut")) $("basisOut").textContent = btype;\n    draw(res);'
assert anchor in s
s = s.replace(anchor, anchor + '\n    if (window.__labRefresh) window.__labRefresh(P, res);', 1)

tail = '  if (typeof document !== "undefined") {'
assert tail in s
api = '''  window.__lp = {
    solve2: solve2,
    P: P,
    run: function (p) {
      return solve2([p.pc, p.pt], [[p.mc, p.mt], [p.kc, p.kt]], [p.H, p.M]);
    },
    apply: function (p) {
      Object.keys(p).forEach(function (k) {
        var el = document.getElementById("p_" + k);
        if (el) el.value = p[k];
      });
      render();
    }
  };

'''
s = s.replace(tail, api + tail, 1)
p.write_text(s, encoding="utf-8")
print("lp.js exposed:", "__labRefresh" in s, "| window.__lp" in s if False else "api added")
