/* Analysis lab: permalink, tornado, ranges, explain, sweep/scrub, direct-canvas
   interaction (crosshair HUD, draggable constraint lines, click-to-pin test plan,
   blind challenge mode), compare, surrogate + SPO+, Simplex trainer, Primal-Dual,
   ILP B&B (clickable tree nodes), MGA, Counterfactuals, Inverse Opt,
   Bertsimas-Sim Robust, Pareto MOLP, Parametric tracking, Capacity ROI,
   Scale-Up Multi-Product/Period, and Saved Notebook. */
(function () {
  "use strict";
  var LP = window.__lp;
  if (!LP) return;
  function Core() { return window.__lpCore || null; }

  var KEYS = ["pc", "pt", "mc", "mt", "kc", "kt", "H", "M"];
  var LABELS = { pc: "Chair profit", pt: "Table profit", mc: "Chair machine h", mt: "Table machine h",
                 kc: "Chair material kg", kt: "Table material kg", H: "Machine hours", M: "Material kg" };
  var SUR = null, P = null, RES = null, pinned = [];
  var simSteps = [], simIdx = 0, studentPivotMode = false;
  var activeTab = "tab-core";

  function $(id) { return document.getElementById(id); }
  function money(n, d) {
    if (!isFinite(n)) return "—";
    var C = Core();
    if (LP.getUseFrac && LP.getUseFrac() && C) return "₹" + C.toFrac(n);
    var dec = d === undefined ? 0 : d;
    return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }
  function fmtN(n, d) {
    if (!isFinite(n)) return "—";
    var C = Core();
    if (LP.getUseFrac && LP.getUseFrac() && C) return C.toFrac(n);
    var dec = d === undefined ? 1 : d;
    return n.toLocaleString("en-IN", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }

  /* ---------------------------------------------------------- 1. permalink */
  function encode() { return "#p=" + KEYS.map(function (k) { return P[k]; }).join(","); }
  function decode() {
    var m = /#p=([\d.,]+)/.exec(location.hash);
    if (!m) return null;
    var v = m[1].split(",").map(Number);
    if (v.length !== 8 || v.some(isNaN)) return null;
    var o = {}; KEYS.forEach(function (k, i) { o[k] = v[i]; }); return o;
  }
  function syncHash() {
    try {
      if (history.replaceState) history.replaceState(null, "", encode());
      else location.hash = encode();
    } catch (e) {}
  }
  function copyLink() {
    var url = location.origin + location.pathname + encode();
    var done = function () { flash($("btnLink"), "Copied"); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function () { fallbackCopy(url, done); });
    } else fallbackCopy(url, done);
  }
  function fallbackCopy(text, done) {
    var ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); done(); } catch (e) {}
    document.body.removeChild(ta);
  }
  function flash(btn, text) {
    if (!btn) return;
    var old = btn.textContent; btn.textContent = text;
    setTimeout(function () { btn.textContent = old; }, 1200);
  }

  /* ---------------------------------------------------------- 2. tornado */
  function withP(k, mult) {
    var q = {}; KEYS.forEach(function (key) { q[key] = P[key]; });
    q[k] = Math.max(0.1, q[k] * mult); return q;
  }
  function tornado() {
    var box = $("tornado");
    if (!box) return;
    if (!RES.feasible || RES.unbounded) {
      box.innerHTML = "<p class='note'>Tornado sensitivity requires a bounded feasible optimum.</p>";
      if ($("torNote")) $("torNote").textContent = "";
      return;
    }
    var base = RES.z, rows = KEYS.map(function (k) {
      var rLo = LP.run(withP(k, 0.9)), rHi = LP.run(withP(k, 1.1));
      var lo = rLo.feasible && isFinite(rLo.z) ? rLo.z : base;
      var hi = rHi.feasible && isFinite(rHi.z) ? rHi.z : base;
      return { k: k, lo: lo, hi: hi, d: hi - lo };
    }).sort(function (a, b) { return Math.abs(b.d) - Math.abs(a.d); });
    var span = Math.max.apply(null, rows.map(function (r) { return Math.max(Math.abs(r.lo - base), Math.abs(r.hi - base)); })) || 1;
    box.innerHTML = rows.map(function (r) {
      var l = (r.lo - base) / span * 50, h = (r.hi - base) / span * 50;
      var left = Math.min(l, h), width = Math.abs(h - l);
      return '<div class="tor-row"><span class="tor-lab">' + LABELS[r.k] + '</span>' +
        '<span class="tor-track"><i class="tor-zero"></i>' +
        '<i class="tor-bar ' + (r.d >= 0 ? "pos" : "neg") + '" style="left:' + (50 + left) + '%;width:' + Math.max(width, 0.6) + '%"></i></span>' +
        '<span class="tor-val">' + (r.d >= 0 ? "+" : "") + money(r.d) + '</span></div>';
    }).join("");
    if ($("torNote")) $("torNote").textContent = "±10% on each input, re-solved. Sorted by swing.";
  }

  /* ---------------------------------------------------------- 3. explain */
  function explain() {
    var el = $("explainBody");
    if (!el) return;
    if (!RES.feasible) {
      el.innerHTML = "<b>Infeasible:</b> no point satisfies all constraints. Use the auto-fix button in the parameter panel.";
      return;
    }
    if (RES.unbounded) {
      el.innerHTML = "<b>Unbounded:</b> profit grows without bound along ray (" +
        RES.ray[0].toFixed(2) + ", " + RES.ray[1].toFixed(2) + ").";
      return;
    }
    var b = RES.binding, u1 = RES.u1, u2 = RES.u2;
    var parts = ["Optimal mix: <b>" + fmtN(RES.x, 1) + " chairs</b> and <b>" + fmtN(RES.y, 1) + " tables</b>, earning <b>" + money(RES.z) + "</b>."];
    if (RES.hasAltOptima) {
      parts.push("<b>Alternative optima:</b> every mix along the highlighted optimal edge achieves identical profit.");
    } else if (b[0] && b[1]) {
      parts.push("Both base resources bind; marginal shadow prices are <b>" + money(u1, 2) + "/hr</b> and <b>" + money(u2, 2) + "/kg</b>.");
    } else if (b[0]) {
      parts.push("Machine time binds (<b>" + money(u1, 2) + "/hr</b>); material has " + fmtN(RES.slack[1], 0) + " kg idle (₹0 shadow price).");
    } else if (b[1]) {
      parts.push("Material binds (<b>" + money(u2, 2) + "/kg</b>); machine time has " + fmtN(RES.slack[0], 0) + " h idle (₹0 shadow price).");
    } else {
      parts.push("An extra demand/contract constraint binds before base capacities.");
    }
    el.innerHTML = parts.join(" ");
  }

  /* ---------------------------------------------------------- 4. ranges */
  function basisKey(r) { return (r.binding || []).map(function (b) { return b ? 1 : 0; }).join(""); }
  function sameBasisAt(key, mult) {
    var q = {}; KEYS.forEach(function (k) { q[k] = P[k]; });
    q[key] = Math.max(0.01, P[key] * mult);
    var r = LP.run(q);
    return r.feasible && !r.unbounded && basisKey(r) === basisKey(RES);
  }
  function edge(key, dir) {
    var step = 0.02 * dir, good = 1, bad = null;
    for (var i = 1; i <= 120; i++) {
      var m = 1 + step * i;
      if (m <= 0.01 || m >= 30) { bad = Math.max(0.01, Math.min(30, m)); break; }
      if (sameBasisAt(key, m)) good = m; else { bad = m; break; }
    }
    if (bad === null) return P[key] * good;
    for (var j = 0; j < 26; j++) {
      var mid = (good + bad) / 2;
      if (sameBasisAt(key, mid)) good = mid; else bad = mid;
    }
    return P[key] * good;
  }
  function ranges() {
    var tb = $("rangeBody");
    if (!tb) return;
    if (!RES.feasible || RES.unbounded) {
      tb.innerHTML = "<tr><td colspan='6' class='note'>Requires bounded feasible solution.</td></tr>";
      return;
    }
    var rows = [];
    ["H", "M"].forEach(function (k) {
      var up = edge(k, 1), dn = edge(k, -1), dual = k === "H" ? RES.u1 : RES.u2;
      rows.push([LABELS[k], fmtN(P[k], 0), fmtN(up - P[k], 1), fmtN(P[k] - dn, 1),
                 money(Math.abs(up - P[k]) * dual), money(Math.abs(P[k] - dn) * dual)]);
    });
    ["pc", "pt"].forEach(function (k) {
      var up = edge(k, 1), dn = edge(k, -1);
      rows.push([LABELS[k], fmtN(P[k], 0), fmtN(up - P[k], 1), fmtN(P[k] - dn, 1), "—", "—"]);
    });
    tb.innerHTML = rows.map(function (r) {
      return "<tr><td>" + r[0] + "</td><td class='num'>" + r[1] + "</td><td class='num'>+" + r[2] +
        "</td><td class='num'>−" + r[3] + "</td><td class='num'>" + r[4] + "</td><td class='num'>" + r[5] + "</td></tr>";
    }).join("");
  }

  /* ---------------------------------------------------------- 5. sweep & scrubber */
  var sweepRAF = null;
  function sweep() {
    var svg = $("lpChart"); if (!svg || !RES || !RES.feasible || RES.unbounded) return;
    var btn = $("btnSweep");
    if (sweepRAF) { cancelAnimationFrame(sweepRAF); sweepRAF = null; LP.setIsoRatio(null); if (btn) btn.textContent = "Animate isoprofit"; return; }
    if (btn) btn.textContent = "Stop";
    var t0 = performance.now(), dur = 2400;
    function frame(t) {
      var f = Math.min(1, (t - t0) / dur);
      var ratio = 0.05 + 1.05 * f;
      if ($("isoScrub")) $("isoScrub").value = Math.round(ratio * 100);
      LP.setIsoRatio(ratio);
      if (f < 1) sweepRAF = requestAnimationFrame(frame);
      else { sweepRAF = null; if (btn) btn.textContent = "Animate isoprofit"; setTimeout(function () { if (!sweepRAF) LP.setIsoRatio(null); }, 1000); }
    }
    sweepRAF = requestAnimationFrame(frame);
  }

  /* ---------------------------------------------------------- 6. Direct SVG interaction:
     Crosshair HUD, Drag Constraint Line (H/M), Drag/Click Test Point, Corner Click */
  function attachCanvasInteraction() {
    var svg = $("lpChart"); if (!svg) return;
    var dragMode = null; // "opt" | "lineH" | "lineM"

    function toData(ev) {
      var r = svg.getBoundingClientRect(), s = LP.getScale();
      var px = (ev.clientX - r.left) / r.width * s.W;
      var py = (ev.clientY - r.top) / r.height * s.H;
      return {
        x: Math.max(0, (px - s.pad) / (s.W - s.pad - 18) * s.xm),
        y: Math.max(0, (s.H - s.pad - py) / (s.H - s.pad - 22) * s.ym),
        px: px, py: py, s: s
      };
    }

    function inside(x, y) {
      if (x < -1e-6 || y < -1e-6) return false;
      var cons = LP.getAllCons();
      for (var i = 0; i < cons.length; i++) {
        var r = cons[i], v = r.a1 * x + r.a2 * y;
        if (r.op === "<=" && v > r.b + 1e-5) return false;
        if (r.op === ">=" && v < r.b - 1e-5) return false;
        if (r.op === "=" && Math.abs(v - r.b) > 1e-4) return false;
      }
      return true;
    }

    function updateHUD(d) {
      var hud = $("chartHud");
      if (!hud) return;
      var z = P.pc * d.x + P.pt * d.y;
      var feas = inside(d.x, d.y);
      var pctH = P.H > 0 ? ((P.mc * d.x + P.mt * d.y) / P.H) * 100 : 0;
      var pctM = P.M > 0 ? ((P.kc * d.x + P.kt * d.y) / P.M) * 100 : 0;
      hud.innerHTML = "<span>Cursor: <b>(" + d.x.toFixed(1) + ", " + d.y.toFixed(1) + ")</b></span>" +
        "<span>Z = <b>" + money(z) + "</b></span>" +
        "<span>Mach " + pctH.toFixed(0) + "% · Mat " + pctM.toFixed(0) + "%</span>" +
        "<span style='color:" + (feas ? "#63d4b4" : "#f3b5b5") + "'>" + (feas ? "Feasible ✓" : "Infeasible ✕") + "</span>";
    }

    function updateChallengeScore(x, y) {
      var chOut = $("challengeResult");
      if (!chOut || !RES || !RES.feasible) return;
      var feas = inside(x, y);
      var z = P.pc * x + P.pt * y;
      if (!feas) {
        chOut.innerHTML = "<span class='badge bad'>Infeasible</span> (" + x.toFixed(1) + ", " + y.toFixed(1) + ") breaches capacity — keep inside the shaded polygon!";
        return;
      }
      var pct = RES.z > 0 ? (z / RES.z) * 100 : 100;
      chOut.innerHTML = "Your guess <b>(" + x.toFixed(1) + ", " + y.toFixed(1) + ")</b> earns <b>" + money(z) +
        "</b> — click <b>Reveal LP Optimum</b> to see how close you got (currently " +
        (pct >= 99.5 ? "right on the optimum!" : pct.toFixed(1) + "% of optimum") + ").";
    }

    svg.addEventListener("pointerdown", function (ev) {
      // Corner badge click
      if (ev.target && ev.target.classList && ev.target.classList.contains("corner-pt")) {
        var vx = parseFloat(ev.target.getAttribute("data-vx"));
        var vy = parseFloat(ev.target.getAttribute("data-vy"));
        LP.setTestPt({ x: vx, y: vy });
        if ($("invX") && $("invY")) { $("invX").value = vx.toFixed(2); $("invY").value = vy.toFixed(2); renderInverse(); }
        if (LP.getChallenge()) updateChallengeScore(vx, vy);
        return;
      }
      // Draggable constraint line (Machine H or Material M)
      var dl = ev.target && ev.target.getAttribute && ev.target.getAttribute("data-dragline");
      if (dl === "H" || dl === "M") {
        dragMode = dl === "H" ? "lineH" : "lineM";
        svg.setPointerCapture(ev.pointerId);
        return;
      }
      if (!RES || !RES.feasible || RES.unbounded) return;
      var d = toData(ev);
      var nearOpt = !LP.getChallenge() && Math.hypot(d.s.sx(d.x) - d.s.sx(RES.x), d.s.sy(d.y) - d.s.sy(RES.y)) < 36;
      dragMode = "opt";
      svg.setPointerCapture(ev.pointerId);
      if (!nearOpt) {
        // Click anywhere on canvas pins a test point
        LP.setTestPt({ x: d.x, y: d.y });
        if ($("invX") && $("invY") && inside(d.x, d.y)) { $("invX").value = d.x.toFixed(1); $("invY").value = d.y.toFixed(1); renderInverse(); }
        if (LP.getChallenge()) updateChallengeScore(d.x, d.y);
      }
    });

    svg.addEventListener("pointermove", function (ev) {
      var d = toData(ev);
      updateHUD(d);
      var ch = $("svgCrosshair");
      if (ch && d.px >= d.s.pad && d.px <= d.s.W - 12 && d.py >= 14 && d.py <= d.s.H - d.s.pad) {
        ch.style.display = "inline";
        var chX = $("chX"), chY = $("chY"), chDot = $("chDot");
        if (chX) { chX.setAttribute("x1", d.px); chX.setAttribute("x2", d.px); }
        if (chY) { chY.setAttribute("y1", d.py); chY.setAttribute("y2", d.py); }
        if (chDot) { chDot.setAttribute("cx", d.px); chDot.setAttribute("cy", d.py); }
      } else if (ch) {
        ch.style.display = "none";
      }

      if (!dragMode) return;
      if (dragMode === "lineH") {
        var newH = Math.max(10, Math.round(P.mc * d.x + P.mt * d.y));
        LP.setParam("H", newH);
        return;
      }
      if (dragMode === "lineM") {
        var newM = Math.max(10, Math.round(P.kc * d.x + P.kt * d.y));
        LP.setParam("M", newM);
        return;
      }
      if (dragMode === "opt") {
        LP.setTestPt({ x: d.x, y: d.y });
        var note = $("dragNote");
        if (!inside(d.x, d.y)) {
          if (note) { note.className = "drag-note bad"; note.textContent = "Infeasible: (" + d.x.toFixed(1) + ", " + d.y.toFixed(1) + ") violates active constraints."; }
          if (LP.getChallenge()) updateChallengeScore(d.x, d.y);
          return;
        }
        var z = P.pc * d.x + P.pt * d.y, gap = RES.z - z;
        if (note && !LP.getChallenge()) {
          note.className = "drag-note";
          note.innerHTML = "Test point (" + d.x.toFixed(1) + ", " + d.y.toFixed(1) + "): profit <b>" + money(z) + "</b>" +
            (gap > 1e-4 ? " (<b>" + money(gap) + " below</b> optimum)." : " — optimal!");
        }
        if (LP.getChallenge()) updateChallengeScore(d.x, d.y);
        if ($("invX") && $("invY")) { $("invX").value = d.x.toFixed(1); $("invY").value = d.y.toFixed(1); renderInverse(); }
      }
    });

    svg.addEventListener("pointerleave", function () {
      var ch = $("svgCrosshair");
      if (ch) ch.style.display = "none";
    });

    svg.addEventListener("pointerup", function () { dragMode = null; });
  }

  /* ---------------------------------------------------------- 7. compare */
  function pinCurrent() {
    if (!RES || !RES.feasible || RES.unbounded) return;
    if (pinned.length >= 3) pinned.shift();
    var q = {}; KEYS.forEach(function (k) { q[k] = P[k]; });
    pinned.push({ p: q, cons: LP.getExtraCons(), z: RES.z, x: RES.x, y: RES.y, u1: RES.u1, u2: RES.u2 });
    renderPins();
  }
  function renderPins() {
    var tb = $("pinBody"); if (!tb) return;
    if (!pinned.length) { tb.innerHTML = "<tr><td colspan='5' class='note'>Nothing pinned yet — click Pin this solve.</td></tr>"; return; }
    var base = pinned[0].z;
    tb.innerHTML = pinned.map(function (r, i) {
      var d = r.z - base;
      return "<tr><td>" + (i + 1) + "</td><td class='num'>" + fmtN(r.x, 1) + " / " + fmtN(r.y, 1) +
        "</td><td class='num'>" + money(r.z) + "</td>" +
        "<td class='num'>" + (i === 0 ? "base" : (d >= 0 ? "+" : "−") + money(Math.abs(d))) +
        "</td><td><button class='mini' data-load='" + i + "'>load</button></td></tr>";
    }).join("");
    tb.querySelectorAll("[data-load]").forEach(function (b) {
      b.addEventListener("click", function () { var it = pinned[+b.dataset.load]; LP.apply(it.p, it.cons); });
    });
  }

  /* ---------------------------------------------------------- 8. surrogate & SPO+ */
  function feats(p) {
    return [p.pc, p.pt, p.mc, p.mt, p.kc, p.kt, p.H, p.M,
            p.pc / Math.max(0.1, p.mc), p.pt / Math.max(0.1, p.mt),
            p.pc / Math.max(0.1, p.kc), p.pt / Math.max(0.1, p.kt),
            p.H / Math.max(0.1, p.mc), p.M / Math.max(0.1, p.kt),
            p.H * p.kc, p.M * p.mt];
  }
  function predict(f) {
    var s = SUR.base;
    for (var t = 0; t < SUR.trees.length; t++) {
      var nodes = SUR.trees[t], i = 0;
      while (nodes[i][2] !== -1) i = (f[nodes[i][0]] <= nodes[i][1]) ? nodes[i][2] : nodes[i][3];
      s += nodes[i][4];
    }
    return s;
  }
  function surrogatePanel() {
    if (!SUR || !RES.feasible || RES.unbounded) return;
    var f = feats(P), pred = predict(f), err = RES.z ? (pred - RES.z) / RES.z * 100 : 0;
    $("surPred").textContent = money(pred);
    $("surExact").textContent = money(RES.z);
    $("surErr").textContent = (err >= 0 ? "+" : "") + err.toFixed(1) + "%";
    $("surErr").className = "val " + (Math.abs(err) < 3 ? "ok" : (Math.abs(err) < 10 ? "warn" : "bad"));
    if ($("surWhy")) {
      var e = Math.abs(err);
      $("surWhy").textContent = e < 3 ? "Tree ensemble closely matches the LP."
        : e < 10 ? "Trees smooth over LP corners."
        : "Outside training mass or extra constraints active — exact LP stays exact.";
    }
    var pairs = SUR.features.map(function (n, i) { return [n, SUR.importance[i]]; })
      .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 6);
    var max = pairs[0][1] || 1;
    $("surImp").innerHTML = pairs.map(function (p) {
      return '<div class="imp-row"><span>' + p[0] + '</span><i style="width:' + (p[1] / max * 100) + '%"></i>' +
        '<b>' + (p[1] * 100).toFixed(0) + '%</b></div>';
    }).join("");
  }
  function validate() {
    if (!SUR) return;
    var n = 25, ea = [], worst = 0, r = SUR.ranges;
    for (var i = 0; i < n; i++) {
      var q = {};
      KEYS.forEach(function (k) { q[k] = r[k][0] + Math.random() * (r[k][1] - r[k][0]); });
      var ex = LP.run(q).z, pr = predict(feats(q));
      if (ex > 1) { ea.push(Math.abs(pr - ex) / ex * 100); worst = Math.max(worst, Math.abs(pr - ex)); }
    }
    var mape = ea.reduce(function (a, b) { return a + b; }, 0) / ea.length;
    $("surVal").innerHTML = "Tested 25 random LPs: mean error <b>" + mape.toFixed(1) + "%</b>, worst " + money(worst) + ".";
  }

  function renderSPO() {
    var C = Core(), svg = $("spoChart"), out = $("spoSummary");
    if (!C || !svg || !out) return;
    var noisePct = $("spoNoise") ? +$("spoNoise").value : 45;
    if ($("o_spoNoise")) $("o_spoNoise").textContent = noisePct + "%";
    var spo = C.spoBenchmark(P, LP.getExtraCons(), noisePct, 40);
    if (!spo) { out.textContent = "Requires bounded feasible LP."; svg.innerHTML = ""; return; }
    out.innerHTML = "40 noisy profit forecasts (±" + noisePct + "%): mean forecast error <b>" +
      spo.avgPredErr.toFixed(1) + "%</b> → mean <b>SPO Decision Regret</b> <b>" +
      spo.avgRegretPct.toFixed(2) + "%</b> (max " + spo.maxRegretPct.toFixed(1) + "% · " +
      spo.zeroRegretRate.toFixed(0) + "% optimal corner hit rate).";

    var W = 440, Hh = 180, pL = 40, pB = 26, pT = 14, pR = 14;
    var maxX = Math.max(25, Math.max.apply(null, spo.samples.map(function (s) { return s.predMape; })) * 1.1);
    var maxY = Math.max(10, Math.max.apply(null, spo.samples.map(function (s) { return s.regretPct; })) * 1.15);
    var sx = function (v) { return pL + (v / maxX) * (W - pL - pR); };
    var sy = function (v) { return Hh - pB - (v / maxY) * (Hh - pT - pB); };
    var pts = ['<line x1="' + pL + '" y1="' + (Hh - pB) + '" x2="' + (W - pR) + '" y2="' + (Hh - pB) + '" stroke="#d1d5db"/>',
               '<line x1="' + pL + '" y1="' + (Hh - pB) + '" x2="' + pL + '" y2="' + pT + '" stroke="#d1d5db"/>'];
    spo.samples.forEach(function (s) {
      var col = s.regretPct < 0.05 ? "#1e8e3e" : "#ea7a48";
      pts.push('<circle cx="' + sx(s.predMape).toFixed(1) + '" cy="' + sy(s.regretPct).toFixed(1) +
        '" r="3.8" fill="' + col + '" opacity="0.82"><title>MAPE ' + s.predMape.toFixed(1) +
        '% → Regret ' + s.regretPct.toFixed(2) + '%</title></circle>');
    });
    pts.push('<text x="' + (W / 2 - 48) + '" y="' + (Hh - 5) + '" font-size="10" fill="#6b7280">Forecast profit error (%)</text>');
    pts.push('<text x="6" y="14" font-size="10" fill="#6b7280">Regret %</text>');
    svg.innerHTML = pts.join("");
  }

  /* ---------------------------------------------------------- 9. Interactive Parametric Curve & ROI */
  function renderParametric() {
    var C = Core(), svg = $("paramChart"), sel = $("paramKey"), note = $("paramNote");
    if (!C || !svg || !sel) return;
    var key = sel.value, res = C.parametricCurve(P, LP.getExtraCons(), key);
    if (!res.points.length) { svg.innerHTML = ""; if (note) note.textContent = "No feasible sweep points."; return; }
    var W = 440, Hh = 190, pL = 52, pB = 26, pT = 16, pR = 16;
    var minX = res.points[0].val, maxX = res.points[res.points.length - 1].val;
    var maxZ = Math.max.apply(null, res.points.map(function (pt) { return pt.z; })) * 1.08 || 100;
    var sx = function (v) { return pL + ((v - minX) / Math.max(1e-6, maxX - minX)) * (W - pL - pR); };
    var sy = function (z) { return Hh - pB - (z / maxZ) * (Hh - pT - pB); };
    var parts = ['<line x1="' + pL + '" y1="' + (Hh - pB) + '" x2="' + (W - pR) + '" y2="' + (Hh - pB) + '" stroke="#d1d5db"/>',
                 '<line x1="' + pL + '" y1="' + (Hh - pB) + '" x2="' + pL + '" y2="' + pT + '" stroke="#d1d5db"/>'];
    res.breaks.forEach(function (bk) {
      parts.push('<line x1="' + sx(bk.val).toFixed(1) + '" y1="' + pT + '" x2="' + sx(bk.val).toFixed(1) +
        '" y2="' + (Hh - pB) + '" stroke="#ea7a48" stroke-dasharray="4 3" opacity="0.8"/>');
    });
    parts.push('<polyline fill="none" stroke="#1e8e3e" stroke-width="2.2" points="' +
      res.points.map(function (pt) { return sx(pt.val).toFixed(1) + "," + sy(pt.z).toFixed(1); }).join(" ") + '"/>');
    res.points.forEach(function (pt, idx) {
      parts.push('<circle class="param-pt" data-ppi="' + idx + '" cx="' + sx(pt.val).toFixed(1) + '" cy="' + sy(pt.z).toFixed(1) +
        '" r="5" fill="transparent" style="cursor:pointer"/>');
    });
    if (RES.feasible && !RES.unbounded) {
      parts.push('<circle cx="' + sx(res.current).toFixed(1) + '" cy="' + sy(RES.z).toFixed(1) +
        '" r="5" fill="#111315" stroke="#fff" stroke-width="2"/>');
    }
    parts.push('<text x="' + pL + '" y="' + (Hh - 7) + '" font-size="10" fill="#5d6672">' + minX.toFixed(0) + '</text>');
    parts.push('<text x="' + (W - pR - 22) + '" y="' + (Hh - 7) + '" font-size="10" fill="#5d6672">' + maxX.toFixed(0) + '</text>');
    parts.push('<text x="6" y="' + (pT + 6) + '" font-size="10" fill="#5d6672">₹' + Math.round(maxZ).toLocaleString("en-IN") + '</text>');
    svg.innerHTML = parts.join("");
    if (note) note.innerHTML = "Hover points or click any point on the curve to jump <b>" + LABELS[key] +
      "</b> there (" + res.breaks.length + " basis kinks marked).";
    svg.querySelectorAll(".param-pt").forEach(function (el) {
      el.addEventListener("mouseenter", function () {
        var pt = res.points[+el.getAttribute("data-ppi")];
        if (note && pt) note.innerHTML = LABELS[key] + " = <b>" + pt.val.toFixed(1) + "</b> → Z* = <b>" + money(pt.z) +
          "</b> (" + pt.x.toFixed(1) + "c / " + pt.y.toFixed(1) + "t) · click to apply";
      });
      el.addEventListener("click", function () {
        var pt = res.points[+el.getAttribute("data-ppi")];
        if (pt) LP.setParam(key, Math.round(pt.val));
      });
    });
  }

  function renderROI() {
    var C = Core(), box = $("roiOut");
    if (!C || !box) return;
    var cH = parseFloat($("roiCostH").value) || 0;
    var cM = parseFloat($("roiCostM").value) || 0;
    var bud = parseFloat($("roiBudget").value) || 0;
    var r = C.solveCapacityROI([P.pc, P.pt], P, LP.getExtraCons(), cH, cM, bud);
    if (!r.feasible) { box.innerHTML = "<p class='note'>Capacity ROI requires a bounded feasible LP.</p>"; return; }
    box.innerHTML =
      "<div class='grid g3' style='gap:10px;margin-top:10px'>" +
      "<div class='out'><div class='lab'>Buy Machine</div><div class='val'>+" + fmtN(r.dH, 1) + " h</div></div>" +
      "<div class='out'><div class='lab'>Buy Material</div><div class='val'>+" + fmtN(r.dM, 1) + " kg</div></div>" +
      "<div class='out'><div class='lab'>Net ROI Gain</div><div class='val ok'>+" + money(r.netGain) + "</div></div>" +
      "</div>" +
      "<p class='note' style='margin-top:8px'>Spends <b>" + money(r.spend) + "</b> of " + money(bud) +
      " budget → new plan <b>" + fmtN(r.x, 1) + " chairs / " + fmtN(r.y, 1) + " tables</b> (net " + money(r.netProfit) + ").</p>";
  }

  /* ---------------------------------------------------------- 10. Simplex Tableau & Pivot Trainer */
  function refreshSimplex() {
    var C = Core();
    if (!C || !$("simTableau")) return;
    var cons = LP.getAllCons();
    var sim = C.solveSimplexN([P.pc, P.pt], cons.map(function (r) { return [r.a1, r.a2]; }),
      cons.map(function (r) { return r.op; }), cons.map(function (r) { return r.b; }), ["x (Chairs)", "y (Tables)"], true, true);
    simSteps = sim.tableaus || [];
    if (simIdx >= simSteps.length) simIdx = Math.max(0, simSteps.length - 1);
    renderSimplexStep(sim.status);
  }

  function renderSimplexStep(finalStatus) {
    var box = $("simTableau"), meta = $("simMeta"), fb = $("simFeedback");
    if (!box) return;
    if (!simSteps.length) { box.innerHTML = ""; return; }
    var st = simSteps[simIdx];
    var isFinal = st.pivotRow === null && st.pivotCol === null;
    var phaseLab = st.phase === 1 ? "Phase I" : "Phase II";
    if (meta) {
      meta.innerHTML = "<b>Step " + (simIdx + 1) + "/" + simSteps.length + "</b> · " + phaseLab +
        (isFinal ? " · <span class='badge teal'>" + (finalStatus || "Optimal") + "</span>"
          : (st.pivotRow === null ? " · <span class='badge bad'>Unbounded</span>"
            : (!studentPivotMode ? " · Pivot: enter <b>" + st.enterVar + "</b>, leave <b>" + st.leaveVar + "</b>"
              : " · <span class='badge amber'>Click the valid pivot cell</span>")));
    }
    var hdr = "<tr><th>Basis</th>" + st.colNames.map(function (cn, ci) {
      return "<th" + ((!studentPivotMode && ci === st.pivotCol) ? " class='piv-col'" : "") + ">" + cn + "</th>";
    }).join("") + "<th>RHS</th><th>θ Ratio</th></tr>";
    var body = st.matrix.map(function (row, ri) {
      var th = (st.theta && st.theta[ri] !== null && st.theta[ri] !== undefined) ? fmtN(st.theta[ri], 2) : "—";
      if (studentPivotMode && !isFinal) th = "?";
      return "<tr" + ((!studentPivotMode && ri === st.pivotRow) ? " class='piv-row'" : "") + "><td><b>" + st.basisNames[ri] + "</b></td>" +
        row.map(function (val, ci) {
          var cls = (!studentPivotMode && ri === st.pivotRow && ci === st.pivotCol) ? " class='piv'"
            : (studentPivotMode && !isFinal ? " class='piv-pick' data-pr='" + ri + "' data-pc='" + ci + "'" : "");
          return "<td" + cls + ">" + fmtN(val, 2) + "</td>";
        }).join("") + "<td><b>" + fmtN(st.rhs[ri], 2) + "</b></td><td>" + th + "</td></tr>";
    }).join("");
    var zRow = "<tr style='background:#f2f8f5'><td><b>Zⱼ − Cⱼ</b></td>" +
      st.zc.map(function (v) { return "<td><b>" + fmtN(v, 2) + "</b></td>"; }).join("") +
      "<td colspan='2'><b>Obj = " + fmtN(st.obj, 2) + "</b></td></tr>";
    box.innerHTML = "<table class='tbl simplex'><thead>" + hdr + "</thead><tbody>" + body + zRow + "</tbody></table>";
    if (fb && !studentPivotMode) fb.textContent = "";
    if (studentPivotMode && !isFinal) {
      box.querySelectorAll("[data-pr]").forEach(function (td) {
        td.addEventListener("click", function () {
          var pr = +td.getAttribute("data-pr"), pc = +td.getAttribute("data-pc");
          if (pr === st.pivotRow && pc === st.pivotCol) {
            if (fb) fb.innerHTML = "<span class='badge teal'>Correct!</span> Enter " + st.enterVar + ", leave " + st.leaveVar + ".";
            if (simIdx < simSteps.length - 1) setTimeout(function () { simIdx++; renderSimplexStep(finalStatus); }, 600);
          } else {
            var reason = st.zc[pc] >= -1e-9 ? "that column has Zⱼ−Cⱼ ≥ 0"
              : (st.matrix[pr][pc] <= 1e-9 ? "pivot must be > 0" : "check minimum positive ratio θ = RHS / aᵢⱼ");
            if (fb) fb.innerHTML = "<span class='badge bad'>Try again</span> Hint: " + reason + ".";
          }
        });
      });
    }
  }

  /* ---------------------------------------------------------- 11. Primal-Dual Visualizer */
  function renderDual() {
    var C = Core(), alg = $("dualAlg"), svg = $("dualChart"), comp = $("dualComp");
    if (!C || !alg || !svg || !comp) return;
    var cons = LP.getAllCons(), d = C.buildDual([P.pc, P.pt], cons);
    alg.innerHTML = "<span class='k'>minimise</span> <span class='v'>W</span> = " +
      d.objectiveTerms.map(function (t) { return fmtN(t.coeff, 0) + "<span class='v'>" + t.name + "</span>"; }).join(" + ") +
      "<br><span class='k'>subject to</span><br>" +
      d.constraints.map(function (dc) {
        return "&nbsp;&nbsp;" + dc.coeffs.map(function (cf, i) { return fmtN(cf, 1) + "<span class='v'>u" + (i + 1) + "</span>"; }).join(" + ") +
          " ≥ " + fmtN(dc.rhs, 0) + " <span class='cm'>(" + dc.name + ")</span>";
      }).join("<br>");

    if (d.dualPoly.length > 2 && RES.feasible && !RES.unbounded) {
      var W = 400, Hh = 220, pad = 42, maxU1 = 1, maxU2 = 1;
      d.dualPoly.forEach(function (v) { maxU1 = Math.max(maxU1, v[0]); maxU2 = Math.max(maxU2, v[1]); });
      var sx = function (u) { return pad + (u / maxU1) * (W - pad - 18); };
      var sy = function (u) { return Hh - pad - (u / maxU2) * (Hh - pad - 18); };
      var pts = ['<line x1="' + pad + '" y1="' + (Hh - pad) + '" x2="' + (W - 12) + '" y2="' + (Hh - pad) + '" stroke="#d1d5db"/>',
                 '<line x1="' + pad + '" y1="' + (Hh - pad) + '" x2="' + pad + '" y2="14" stroke="#d1d5db"/>',
                 '<polygon points="' + d.dualPoly.map(function (v) { return sx(v[0]).toFixed(1) + "," + sy(v[1]).toFixed(1); }).join(" ") +
                 '" fill="rgba(37,99,235,.14)" stroke="#2563eb" stroke-width="1.6"/>'];
      if (d.dualOpt) {
        var ox = sx(d.dualOpt[0]), oy = sy(d.dualOpt[1]);
        pts.push('<circle cx="' + ox.toFixed(1) + '" cy="' + oy.toFixed(1) + '" r="5.5" fill="#111315" stroke="#fff" stroke-width="2"/>');
        pts.push('<text x="' + Math.min(W - 110, ox + 8).toFixed(1) + '" y="' + Math.max(20, oy - 8).toFixed(1) +
          '" font-size="11" font-weight="700" fill="#111315">u*=(' + fmtN(d.dualOpt[0], 2) + ', ' + fmtN(d.dualOpt[1], 2) + ')</text>');
      }
      pts.push('<text x="' + (W - 72) + '" y="' + (Hh - 12) + '" font-size="10" fill="#5d6672">u₁ (₹/hr)</text>');
      pts.push('<text x="6" y="20" font-size="10" fill="#5d6672">u₂ (₹/kg)</text>');
      svg.innerHTML = pts.join("");
    } else {
      svg.innerHTML = '<text x="20" y="110" font-size="12" fill="#5d6672">2D Dual plot displays when using the 2 base ≤ constraints.</text>';
    }

    if (RES.feasible && !RES.unbounded) {
      comp.innerHTML = cons.map(function (r, i) {
        var s = RES.slack[i] || 0, u = RES.duals[i] || 0;
        return "<tr><td>" + r.name + "</td><td class='num'>" + fmtN(s, 2) + "</td><td class='num'>" +
          money(u, 2) + "</td><td class='num'>" + fmtN(s * u, 3) + " ✓</td></tr>";
      }).join("");
    } else {
      comp.innerHTML = "<tr><td colspan='4' class='note'>Requires bounded feasible LP.</td></tr>";
    }
  }

  /* ---------------------------------------------------------- 12. ILP & Clickable B&B Tree */
  function renderILP() {
    var C = Core(), summary = $("ilpSummary"), svg = $("bnbChart"), nodeNote = $("bnbNote");
    if (!C || !summary || !svg) return;
    var ilp = C.solveILP2D([P.pc, P.pt], LP.getAllCons());
    LP.setOverlayData("ilp", ilp);
    if (!ilp.feasible) { summary.innerHTML = "<p class='note'>No feasible integer plan found.</p>"; svg.innerHTML = ""; return; }
    summary.innerHTML =
      "<div class='grid g4' style='gap:10px'>" +
      "<div class='out'><div class='lab'>LP Relaxation</div><div class='val'>" + money(ilp.lpZ, 1) + "</div><div class='sub2'>" + ilp.lpX.toFixed(2) + " / " + ilp.lpY.toFixed(2) + "</div></div>" +
      "<div class='out'><div class='lab'>Integer Optimum</div><div class='val ok'>" + money(ilp.z, 0) + "</div><div class='sub2'>" + ilp.x + " chairs · " + ilp.y + " tables</div></div>" +
      "<div class='out'><div class='lab'>Rounding Cost</div><div class='val warn'>" + money(ilp.gap, 1) + "</div><div class='sub2'>" + ilp.gapPct.toFixed(2) + "% gap</div></div>" +
      "<div class='out'><div class='lab'>B&amp;B Nodes</div><div class='val'>" + ilp.nodes.length + "</div><div class='sub2'>click nodes below</div></div>" +
      "</div>";

    var byDepth = {}, maxDepth = 0;
    ilp.nodes.forEach(function (n) { maxDepth = Math.max(maxDepth, n.depth); (byDepth[n.depth] = byDepth[n.depth] || []).push(n); });
    var W = 520, Hh = Math.max(170, (maxDepth + 1) * 58 + 26);
    svg.setAttribute("viewBox", "0 0 " + W + " " + Hh);
    var pos = {};
    Object.keys(byDepth).forEach(function (d) {
      var arr = byDepth[d], y = 28 + (+d) * 56;
      arr.forEach(function (n, idx) { pos[n.id] = { x: ((idx + 1) / (arr.length + 1)) * W, y: y }; });
    });
    var parts = [];
    ilp.nodes.forEach(function (n) {
      if (n.parentId !== null && pos[n.parentId]) {
        var p0 = pos[n.parentId], p1 = pos[n.id];
        parts.push('<line x1="' + p0.x.toFixed(1) + '" y1="' + p0.y + '" x2="' + p1.x.toFixed(1) + '" y2="' + p1.y + '" stroke="#b9b3a4"/>');
        parts.push('<text x="' + ((p0.x + p1.x) / 2).toFixed(1) + '" y="' + ((p0.y + p1.y) / 2 - 2).toFixed(1) +
          '" font-size="9.5" text-anchor="middle" fill="#3d444c">' + n.rule + '</text>');
      }
    });
    var colMap = { incumbent: "#1e8e3e", integer: "#3ca352", branched: "#2563eb", pruned: "#ea7a48", infeasible: "#d93025" };
    ilp.nodes.forEach(function (n, ni) {
      var pt = pos[n.id], fill = colMap[n.status] || "#5d6672";
      var label = n.feasible ? ("Z=" + Math.round(n.z)) : "Infeas";
      parts.push('<g class="bnb-node" data-ni="' + ni + '" style="cursor:pointer">' +
        '<rect x="' + (pt.x - 28).toFixed(1) + '" y="' + (pt.y - 12) + '" width="56" height="24" rx="6" fill="' + fill + '"/>' +
        '<text x="' + pt.x.toFixed(1) + '" y="' + (pt.y + 4) + '" font-size="10" font-weight="700" fill="#fff" text-anchor="middle">' + label + '</text></g>');
    });
    svg.innerHTML = parts.join("");
    if (nodeNote) nodeNote.textContent = "Click any Branch-and-Bound node above to inspect its subproblem relaxation & status.";
    svg.querySelectorAll(".bnb-node").forEach(function (g) {
      g.addEventListener("click", function () {
        var n = ilp.nodes[+g.getAttribute("data-ni")];
        if (!nodeNote || !n) return;
        nodeNote.innerHTML = "<b>Node #" + n.id + " (" + n.rule + ")</b>: status <span class='badge'>" + n.status + "</span>" +
          (n.feasible ? " · LP x=" + n.x.toFixed(2) + ", y=" + n.y.toFixed(2) + ", Z=" + money(n.z, 1) : " · infeasible subproblem");
      });
    });
  }

  /* ---------------------------------------------------------- 13. MGA, Counterfactuals, Inverse */
  function renderMGA() {
    var C = Core(), tb = $("mgaBody");
    if (!C || !tb) return;
    var tol = $("mgaTol") ? +$("mgaTol").value : 5;
    if ($("o_mgaTol")) $("o_mgaTol").textContent = tol + "%";
    var mga = C.solveMGA([P.pc, P.pt], LP.getAllCons(), tol);
    LP.setOverlayData("mga", mga);
    if (!mga.feasible) { tb.innerHTML = "<tr><td colspan='6' class='note'>Requires bounded feasible LP.</td></tr>"; return; }
    tb.innerHTML = mga.plans.map(function (pl, i) {
      return "<tr data-mgai='" + i + "' style='cursor:pointer'><td><b>" + pl.label + "</b></td><td class='num'>" + fmtN(pl.x, 1) + " / " + fmtN(pl.y, 1) +
        "</td><td class='num'>" + money(pl.z) + "</td><td class='num'>" + pl.pctOfOpt.toFixed(1) +
        "%</td><td class='num'>" + fmtN(pl.machUse, 0) + " h</td><td class='num'>" + fmtN(pl.matUse, 0) + " kg</td></tr>";
    }).join("");
    tb.querySelectorAll("[data-mgai]").forEach(function (tr) {
      tr.addEventListener("click", function () {
        var pl = mga.plans[+tr.getAttribute("data-mgai")];
        if (pl) { LP.setTestPt({ x: pl.x, y: pl.y }); if ($("invX")) { $("invX").value = pl.x.toFixed(2); $("invY").value = pl.y.toFixed(2); renderInverse(); } }
      });
    });
  }

  function renderCounterfactual() {
    var C = Core(), box = $("cfOut");
    if (!C || !box) return;
    var mode = $("cfTarget") ? $("cfTarget").value : "chairs";
    var targetZ = $("cfTargetZ") ? (parseFloat($("cfTargetZ").value) || 0) : 0;
    if ($("cfGoalWrap")) $("cfGoalWrap").style.display = mode === "target_z" ? "block" : "none";
    var cf = C.solveCounterfactual([P.pc, P.pt], LP.getAllCons(), mode, targetZ);
    if (!cf.feasible) { box.innerHTML = "<p class='note'>Requires bounded feasible LP.</p>"; return; }
    var html = [];
    if (mode !== "target_z") {
      if (cf.currentRegime === mode) html.push("<p class='note'>The active plan is already in the <b>" + mode + "</b> regime.</p>");
      else if (cf.profitCF) {
        var pcf = cf.profitCF;
        html.push("<p class='explain'><b>Minimum Profit Shift (L₁ = " + money(pcf.l1, 1) + "):</b> Chair by <b>" +
          (pcf.dc1 >= 0 ? "+" : "−") + money(Math.abs(pcf.dc1), 1) + "</b> (" + money(pcf.newC1, 1) +
          "), Table by <b>" + (pcf.dc2 >= 0 ? "+" : "−") + money(Math.abs(pcf.dc2), 1) +
          "</b> (" + money(pcf.newC2, 1) + ") → flips optimum to <b>(" + fmtN(pcf.targetX, 1) + ", " + fmtN(pcf.targetY, 1) + ")</b>.</p>" +
          "<button type='button' class='btn lite' id='btnApplyCF' style='margin-top:8px'>Apply counterfactual</button>");
      } else html.push("<p class='note'>No feasible corner exists for that regime.</p>");
    }
    if (cf.capacityCF) {
      var ccf = cf.capacityCF;
      html.push("<p class='explain' style='margin-top:8px'><b>To reach " + money(ccf.goalZ) + ":</b> add " +
        ccf.deltas.map(function (d) { return "<b>+" + d.delta.toFixed(1) + "</b> to " + d.name; }).join(" and ") +
        " (" + fmtN(ccf.x, 1) + "c / " + fmtN(ccf.y, 1) + "t).</p>");
    }
    box.innerHTML = html.join("");
    if ($("btnApplyCF") && cf.profitCF) {
      $("btnApplyCF").addEventListener("click", function () {
        LP.apply({ pc: +cf.profitCF.newC1.toFixed(2), pt: +cf.profitCF.newC2.toFixed(2) });
      });
    }
  }

  function renderInverse() {
    var C = Core(), box = $("invOut");
    if (!C || !box) return;
    var x0 = parseFloat($("invX") ? $("invX").value : 40) || 0;
    var y0 = parseFloat($("invY") ? $("invY").value : 20) || 0;
    var inv = C.solveInverse2D([P.pc, P.pt], LP.getAllCons(), x0, y0);
    if (!inv.feasible) { box.innerHTML = "<p class='note' style='color:#9f2d2d'>" + (inv.reason || "Infeasible.") + "</p>"; return; }
    if (inv.interior) { box.innerHTML = "<p class='note'>" + inv.note + "</p>"; return; }
    box.innerHTML = "<p class='explain'>Implied unit profits making <b>(" + fmtN(x0, 1) + ", " + fmtN(y0, 1) + ")</b> optimal: " +
      "<b>Chair = " + money(inv.d1, 2) + "</b> (" + (inv.dc1 >= 0 ? "+" : "") + inv.dc1.toFixed(1) + ") and <b>Table = " +
      money(inv.d2, 2) + "</b> (" + (inv.dc2 >= 0 ? "+" : "") + inv.dc2.toFixed(1) + "), L₁ shift = " + money(inv.l1, 1) + ".</p>";
  }

  /* ---------------------------------------------------------- 14. Interactive Robust & Pareto */
  function renderRobust() {
    var C = Core(), out = $("robOut"), svg = $("robChart");
    if (!C || !out || !svg) return;
    var unc = $("robUnc") ? +$("robUnc").value : 15;
    var gam = $("robGamma") ? +$("robGamma").value : 1.0;
    if ($("o_robUnc")) $("o_robUnc").textContent = "±" + unc + "%";
    if ($("o_robGamma")) $("o_robGamma").textContent = gam.toFixed(2);
    var rob = C.solveRobust2D([P.pc, P.pt], P, LP.getExtraCons(), unc, gam);
    LP.setOverlayData("robust", rob);
    if (!rob.current.feasible) { out.innerHTML = "<p class='note'>No feasible robust solution.</p>"; svg.innerHTML = ""; return; }

    out.innerHTML =
      "<div class='grid g3' style='gap:10px;margin-top:8px'>" +
      "<div class='out'><div class='lab'>Robust Profit</div><div class='val'>" + money(rob.current.z) + "</div><div class='sub2'>" + fmtN(rob.current.x, 1) + " / " + fmtN(rob.current.y, 1) + "</div></div>" +
      "<div class='out'><div class='lab'>Price of Robustness</div><div class='val warn'>−" + money(rob.priceOfRobustness) + "</div><div class='sub2'>" + rob.pricePct.toFixed(1) + "% insurance</div></div>" +
      "<div class='out'><div class='lab'>Overrun Bound</div><div class='val'>" + rob.current.violationBoundPct.toFixed(1) + "%</div><div class='sub2'>nominal risks +" + rob.nominalOverrunH.toFixed(1) + "h / +" + rob.nominalOverrunM.toFixed(1) + "kg</div></div>" +
      "</div>";

    var W = 440, Hh = 175, pL = 50, pB = 26, pT = 16, pR = 16;
    var minZ = Math.min.apply(null, rob.curve.map(function (c) { return c.z; })) * 0.96;
    var maxZ = Math.max.apply(null, rob.curve.map(function (c) { return c.z; })) * 1.03 || 100;
    var sx = function (g) { return pL + (g / 2) * (W - pL - pR); };
    var sy = function (z) { return Hh - pB - ((z - minZ) / Math.max(1, maxZ - minZ)) * (Hh - pT - pB); };
    var parts = ['<line x1="' + pL + '" y1="' + (Hh - pB) + '" x2="' + (W - pR) + '" y2="' + (Hh - pB) + '" stroke="#d1d5db"/>',
                 '<line x1="' + pL + '" y1="' + (Hh - pB) + '" x2="' + pL + '" y2="' + pT + '" stroke="#d1d5db"/>',
                 '<polyline fill="none" stroke="#2563eb" stroke-width="2.2" points="' +
                 rob.curve.map(function (c) { return sx(c.gamma).toFixed(1) + "," + sy(c.z).toFixed(1); }).join(" ") + '"/>'];
    rob.curve.forEach(function (c) {
      parts.push('<circle class="rob-pt" data-rg="' + c.gamma + '" cx="' + sx(c.gamma).toFixed(1) + '" cy="' + sy(c.z).toFixed(1) +
        '" r="4.5" fill="#2563eb" opacity="0.72" style="cursor:pointer"><title>Click to set Γ = ' + c.gamma + ' (Z=' + Math.round(c.z) + ')</title></circle>');
    });
    parts.push('<circle cx="' + sx(gam).toFixed(1) + '" cy="' + sy(rob.current.z).toFixed(1) + '" r="5.5" fill="#ea7a48" stroke="#fff" stroke-width="2"/>');
    parts.push('<text x="' + pL + '" y="' + (Hh - 7) + '" font-size="10" fill="#5d6672">Γ = 0 (click points to jump Γ)</text>');
    parts.push('<text x="' + (W - 72) + '" y="' + (Hh - 7) + '" font-size="10" fill="#5d6672">Γ = 2.0</text>');
    svg.innerHTML = parts.join("");
    svg.querySelectorAll(".rob-pt").forEach(function (dot) {
      dot.addEventListener("click", function () {
        if ($("robGamma")) { $("robGamma").value = dot.getAttribute("data-rg"); renderRobust(); }
      });
    });
  }

  function renderPareto() {
    var C = Core(), svg = $("parChart"), note = $("parNote");
    if (!C || !svg) return;
    var e1 = parseFloat($("parE1") ? $("parE1").value : 3) || 1;
    var e2 = parseFloat($("parE2") ? $("parE2").value : 2) || 1;
    var par = C.solvePareto([P.pc, P.pt], [e1, e2], LP.getAllCons(), 18);
    if (!par.feasible || par.points.length < 2) { svg.innerHTML = ""; if (note) note.textContent = "Requires bounded feasible region."; return; }
    var W = 440, Hh = 185, pL = 50, pB = 26, pT = 16, pR = 16;
    var maxE = Math.max(1, par.eMax * 1.08), maxZ = Math.max(1, par.points[par.points.length - 1].profit * 1.08);
    var sx = function (e) { return pL + (e / maxE) * (W - pL - pR); };
    var sy = function (z) { return Hh - pB - (z / maxZ) * (Hh - pT - pB); };
    var parts = ['<line x1="' + pL + '" y1="' + (Hh - pB) + '" x2="' + (W - pR) + '" y2="' + (Hh - pB) + '" stroke="#d1d5db"/>',
                 '<line x1="' + pL + '" y1="' + (Hh - pB) + '" x2="' + pL + '" y2="' + pT + '" stroke="#d1d5db"/>',
                 '<polyline fill="none" stroke="#1e8e3e" stroke-width="2.2" points="' +
                 par.points.map(function (pt) { return sx(pt.impact).toFixed(1) + "," + sy(pt.profit).toFixed(1); }).join(" ") + '"/>'];
    par.points.forEach(function (pt, idx) {
      parts.push('<circle class="par-pt" data-pi="' + idx + '" cx="' + sx(pt.impact).toFixed(1) + '" cy="' + sy(pt.profit).toFixed(1) +
        '" r="4.5" fill="#1e8e3e" stroke="#fff" stroke-width="1.5" style="cursor:pointer">' +
        '<title>Click to inspect & enforce (' + pt.x.toFixed(1) + ', ' + pt.y.toFixed(1) + ')</title></circle>');
    });
    parts.push('<text x="' + (W / 2 - 42) + '" y="' + (Hh - 7) + '" font-size="10" fill="#5d6672">Energy / Impact Units</text>');
    parts.push('<text x="6" y="14" font-size="10" fill="#5d6672">Profit ₹</text>');
    svg.innerHTML = parts.join("");
    if (note) note.textContent = par.points.length + " non-dominated trade-offs. Click any point to inspect or enforce its impact cap.";
    svg.querySelectorAll(".par-pt").forEach(function (dot) {
      dot.addEventListener("click", function () {
        var pt = par.points[+dot.getAttribute("data-pi")];
        if (!note || !pt) return;
        LP.setTestPt({ x: pt.x, y: pt.y });
        note.innerHTML = "Selected: <b>" + fmtN(pt.x, 1) + "c, " + fmtN(pt.y, 1) + "t</b> → " + money(pt.profit) +
          " at impact " + pt.impact.toFixed(1) +
          " <button type='button' class='mini' id='btnEnforcePar'>Enforce impact ≤ " + pt.impact.toFixed(0) + "</button>";
        if ($("btnEnforcePar")) {
          $("btnEnforcePar").addEventListener("click", function () {
            var curCons = LP.getExtraCons().filter(function (c) { return c.name !== "Pareto Impact Cap"; });
            curCons.push({ name: "Pareto Impact Cap", a1: e1, a2: e2, b: +pt.impact.toFixed(2), op: "<=" });
            LP.setExtraCons(curCons);
          });
        }
      });
    });
  }

  /* ---------------------------------------------------------- 15. Scale-Up */
  function solveScaleUp() {
    var C = Core(); if (!C) return;
    var out4 = $("mp4Out");
    if (out4) {
      var nm = ["Chairs", "Tables", "Desks", "Cabinets"];
      var c = [0, 1, 2, 3].map(function (i) { return parseFloat($("mp_p" + i).value) || 0; });
      var rM = [0, 1, 2, 3].map(function (i) { return parseFloat($("mp_m" + i).value) || 0; });
      var rK = [0, 1, 2, 3].map(function (i) { return parseFloat($("mp_k" + i).value) || 0; });
      var rL = [0, 1, 2, 3].map(function (i) { return parseFloat($("mp_l" + i).value) || 0; });
      var bH = parseFloat($("mp_H").value) || 0, bM = parseFloat($("mp_M").value) || 0, bL = parseFloat($("mp_L").value) || 0;
      var sol = C.solveSimplexN(c, [rM, rK, rL], ["<=", "<=", "<="], [bH, bM, bL], nm, true, false);
      if (sol.status === "optimal") {
        out4.innerHTML = "<div class='out' style='margin-top:10px'><div class='lab'>4-Product Optimal Profit</div><div class='val ok'>" +
          money(sol.z, 0) + "</div><div class='sub2'>" +
          nm.map(function (n, i) { return n + ": <b>" + fmtN(sol.x[i], 1) + "</b>"; }).join(" · ") +
          "</div><div class='sub2' style='margin-top:4px'>Duals → Machine: " + money(sol.duals[0], 2) +
          "/h · Material: " + money(sol.duals[1], 2) + "/kg · Labor: " + money(sol.duals[2], 2) + "/h</div></div>";
      } else out4.innerHTML = "<p class='note'>Status: " + sol.status + "</p>";
    }

    var out3 = $("perOut");
    if (out3) {
      var hold = parseFloat($("per_hold").value) || 0;
      var dX = [1, 2, 3].map(function (m) { return parseFloat($("per_dx" + m).value) || 0; });
      var dY = [1, 2, 3].map(function (m) { return parseFloat($("per_dy" + m).value) || 0; });
      var capH = [1, 2, 3].map(function (m) { return parseFloat($("per_h" + m).value) || 0; });
      var capM = [1, 2, 3].map(function (m) { return parseFloat($("per_m" + m).value) || 0; });
      var cObj = [P.pc, P.pc, P.pc, P.pt, P.pt, P.pt, -hold, -hold, -hold, -hold];
      var A = [], ops = [], b = [];
      for (var m = 0; m < 3; m++) {
        var rm = new Array(10).fill(0); rm[m] = P.mc; rm[3 + m] = P.mt; A.push(rm); ops.push("<="); b.push(capH[m]);
        var rk = new Array(10).fill(0); rk[m] = P.kc; rk[3 + m] = P.kt; A.push(rk); ops.push("<="); b.push(capM[m]);
      }
      A.push([1, 0, 0, 0, 0, 0, -1, 0, 0, 0]); ops.push("<="); b.push(dX[0]);
      A.push([0, 0, 0, 1, 0, 0, 0, 0, -1, 0]); ops.push("<="); b.push(dY[0]);
      A.push([0, 1, 0, 0, 0, 0, 1, -1, 0, 0]); ops.push("<="); b.push(dX[1]);
      A.push([0, 0, 0, 0, 1, 0, 0, 0, 1, -1]); ops.push("<="); b.push(dY[1]);
      A.push([0, 0, 1, 0, 0, 0, 0, 1, 0, 0]); ops.push("<="); b.push(dX[2]);
      A.push([0, 0, 0, 0, 0, 1, 0, 0, 0, 1]); ops.push("<="); b.push(dY[2]);
      A.push([1, 0, 0, 0, 0, 0, -1, 0, 0, 0]); ops.push(">="); b.push(0);
      A.push([0, 0, 0, 1, 0, 0, 0, 0, -1, 0]); ops.push(">="); b.push(0);
      A.push([0, 1, 0, 0, 0, 0, 1, -1, 0, 0]); ops.push(">="); b.push(0);
      A.push([0, 0, 0, 0, 1, 0, 0, 0, 1, -1]); ops.push(">="); b.push(0);

      var sol3 = C.solveSimplexN(cObj, A, ops, b, null, true, false);
      if (sol3.status === "optimal") {
        var x = sol3.x;
        out3.innerHTML = "<div class='out' style='margin-top:10px'><div class='lab'>3-Month Net Profit</div><div class='val ok'>" +
          money(sol3.z, 0) + "</div><div class='sub2'>" +
          "M1: " + x[0].toFixed(1) + "c/" + x[3].toFixed(1) + "t (inv " + x[6].toFixed(1) + "c," + x[8].toFixed(1) + "t) · " +
          "M2: " + x[1].toFixed(1) + "c/" + x[4].toFixed(1) + "t (inv " + x[7].toFixed(1) + "c," + x[9].toFixed(1) + "t) · " +
          "M3: " + x[2].toFixed(1) + "c/" + x[5].toFixed(1) + "t</div></div>";
      } else out3.innerHTML = "<p class='note'>Status: " + sol3.status + "</p>";
    }
  }

  /* ---------------------------------------------------------- 16. Saved Notebook & Presets */
  var NB_KEY = "abl_factory_notebook_v1";
  var PRESETS = {
    base: { name: "Base textbook case", p: { pc: 40, pt: 30, mc: 2, mt: 1, kc: 1, kt: 2, H: 100, M: 80 }, cons: [] },
    scn9: { name: "SCN-009 (Alternative optima)", p: { pc: 98, pt: 49, mc: 2, mt: 3, kc: 4, kt: 2, H: 113, M: 120 }, cons: [] },
    scn194: { name: "SCN-194 (Alternative optima)", p: { pc: 76, pt: 95, mc: 1, mt: 4, kc: 4, kt: 5, H: 171, M: 138 }, cons: [] },
    scn213: { name: "SCN-213 (Alternative optima)", p: { pc: 39, pt: 39, mc: 5, mt: 5, kc: 4, kt: 3, H: 133, M: 138 }, cons: [] },
    scn89: { name: "SCN-089 (Highest profit)", p: { pc: 115, pt: 105, mc: 4, mt: 1, kc: 3, kt: 1, H: 204, M: 161 }, cons: [] },
    demand: { name: "Base + Demand caps", p: { pc: 40, pt: 30, mc: 2, mt: 1, kc: 1, kt: 2, H: 100, M: 80 },
      cons: [{ name: "Chair demand cap", a1: 1, a2: 0, b: 32, op: "<=" }, { name: "Table demand cap", a1: 0, a2: 1, b: 25, op: "<=" }] },
    contract: { name: "Base + Min Contract (≥)", p: { pc: 40, pt: 30, mc: 2, mt: 1, kc: 1, kt: 2, H: 100, M: 80 },
      cons: [{ name: "Min Table Contract", a1: 0, a2: 1, b: 30, op: ">=" }] }
  };

  function getNotebook() { try { return JSON.parse(localStorage.getItem(NB_KEY) || "[]"); } catch (e) { return []; } }
  function saveNotebook(list) { try { localStorage.setItem(NB_KEY, JSON.stringify(list)); } catch (e) {} }
  function renderNotebook() {
    var box = $("nbList"); if (!box) return;
    var list = getNotebook();
    if (!list.length) { box.innerHTML = "<div style='font-size:11px;color:#8794a0'>No saved solves yet.</div>"; return; }
    box.innerHTML = list.map(function (item, idx) {
      return "<div class='nb-item'><span title='" + item.name + "'>" + item.name + " (₹" + Math.round(item.z || 0) + ")</span>" +
        "<div style='display:flex;gap:4px'><button type='button' class='btn-xs' data-nbload='" + idx + "'>Load</button>" +
        "<button type='button' class='btn-xs danger' data-nbdel='" + idx + "'>×</button></div></div>";
    }).join("");
  }

  /* ---------------------------------------------------------- 17. export & one-pager */
  function download(name, blob) {
    if (!window.URL || !URL.createObjectURL) return;
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  function exportCSV() {
    var rows = [["parameter", "value"]].concat(KEYS.map(function (k) { return [k, P[k]]; }));
    rows.push(["chairs", RES.x], ["tables", RES.y], ["profit_inr", RES.z],
              ["dual_machine_hour", RES.u1], ["dual_material_kg", RES.u2],
              ["machine_slack", RES.slack ? RES.slack[0] : 0], ["material_slack", RES.slack ? RES.slack[1] : 0]);
    LP.getExtraCons().forEach(function (ec, i) {
      rows.push(["extra_" + (i + 1), ec.a1 + "x + " + ec.a2 + "y " + ec.op + " " + ec.b]);
    });
    download("factory_solve.csv", new Blob([rows.map(function (r) { return r.join(","); }).join("\n")],
      { type: "text/csv;charset=utf-8" }));
  }
  function exportPNG() {
    var svg = $("lpChart"); if (!svg) return;
    var clone = svg.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", 1040); clone.setAttribute("height", 760);
    var s = new XMLSerializer().serializeToString(clone);
    var img = new Image();
    img.onload = function () {
      var c = document.createElement("canvas"); c.width = 1040; c.height = 760;
      var ctx = c.getContext("2d");
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, 1040, 760);
      c.toBlob(function (b) { download("feasible_region.png", b); });
    };
    img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(s)));
  }
  function fillOnePager() {
    var box = $("onepager"); if (!box || !RES) return;
    box.innerHTML =
      "<h1>Factory LP — solved case</h1>" +
      "<p><b>Plan:</b> " + (RES.feasible ? fmtN(RES.x, 1) + " chairs and " + fmtN(RES.y, 1) + " tables" : "Infeasible") +
      " · <b>Profit:</b> " + (RES.feasible ? money(RES.z) : "—") +
      " · <b>Duals:</b> " + (RES.feasible ? money(RES.u1, 2) + "/machine-hour, " + money(RES.u2, 2) + "/kg" : "—") + "</p>" +
      "<table class='tbl'><tr><th>Parameter</th><th>Value</th></tr>" +
      KEYS.map(function (k) { return "<tr><td>" + LABELS[k] + "</td><td>" + P[k] + "</td></tr>"; }).join("") +
      "</table><p class='note'>" + ($("explainBody") ? $("explainBody").textContent : "") + "</p>";
  }

  /* ---------------------------------------------------------- wiring */
  function refresh(p, res) {
    P = p; RES = res;
    explain(); tornado(); ranges(); surrogatePanel();
    renderParametric(); renderROI(); refreshSimplex();
    renderDual(); renderILP(); renderMGA();
    renderCounterfactual(); renderInverse();
    renderRobust(); renderPareto(); renderSPO(); solveScaleUp();
    syncHash();
  }
  window.__labRefresh = refresh;

  function switchTab(id) {
    activeTab = id;
    document.querySelectorAll(".lab-tab").forEach(function (b) {
      b.setAttribute("aria-selected", b.getAttribute("data-tab") === id ? "true" : "false");
    });
    document.querySelectorAll(".tab-panel").forEach(function (p) { p.classList.toggle("active", p.id === id); });
  }

  function init() {
    if (!$("explainBody")) return;
    var fromUrl = decode();
    var j = window.SURROGATE;
    if (j) {
      SUR = j;
      if ($("surMeta")) $("surMeta").textContent = "Trained on " + j.metrics.n_train.toLocaleString("en-IN") +
        " sampled LPs · R² " + j.metrics.r2 + " · mean error " + j.metrics.mape + "%";
    } else if ($("surMeta")) $("surMeta").textContent = "Surrogate file missing.";

    document.querySelectorAll(".lab-tab").forEach(function (b) {
      b.addEventListener("click", function () { switchTab(b.getAttribute("data-tab")); });
    });
    document.querySelectorAll("[data-frac]").forEach(function (b) {
      b.addEventListener("click", function () {
        var isF = b.getAttribute("data-frac") === "1";
        document.querySelectorAll("[data-frac]").forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
        LP.setUseFrac(isF);
      });
    });
    document.querySelectorAll("[data-ov]").forEach(function (b) {
      b.addEventListener("click", function () {
        var key = b.getAttribute("data-ov"), next = b.getAttribute("aria-pressed") !== "true";
        b.setAttribute("aria-pressed", next ? "true" : "false");
        LP.setOverlay(key, next);
      });
    });

    // Blind Challenge Mode
    if ($("btnChallenge")) {
      $("btnChallenge").addEventListener("click", function () {
        var next = !LP.getChallenge();
        LP.setChallenge(next);
        $("btnChallenge").setAttribute("aria-pressed", next ? "true" : "false");
        if ($("challengeBox")) $("challengeBox").style.display = next ? "flex" : "none";
        if (next && $("challengeResult")) $("challengeResult").textContent = "Click or drag inside the feasible polygon to submit your guess!";
      });
    }
    if ($("btnRevealOpt")) {
      $("btnRevealOpt").addEventListener("click", function () {
        var tp = LP.getTestPt();
        LP.setChallenge(false);
        if ($("btnChallenge")) $("btnChallenge").setAttribute("aria-pressed", "false");
        if ($("challengeBox")) $("challengeBox").style.display = "none";
        if (tp && RES && RES.feasible) {
          var tz = P.pc * tp.x + P.pt * tp.y;
          var note = $("dragNote");
          if (note) note.innerHTML = "Challenge result: your guess (" + tp.x.toFixed(1) + ", " + tp.y.toFixed(1) + ") earned <b>" +
            money(tz) + "</b> vs LP optimum <b>" + money(RES.z) + "</b> (<b>" + ((tz / Math.max(1, RES.z)) * 100).toFixed(1) + "%</b> score)!";
        }
      });
    }

    // Isoprofit Scrubber
    if ($("isoScrub")) {
      $("isoScrub").addEventListener("input", function (e) {
        var val = +e.target.value / 100;
        LP.setIsoRatio(val === 1 ? null : val);
      });
    }

    if ($("presetSel")) $("presetSel").addEventListener("change", function (e) {
      var pr = PRESETS[e.target.value]; if (pr) { LP.setTestPt(null); LP.apply(pr.p, pr.cons); }
    });
    document.querySelectorAll("[data-preset]").forEach(function (card) {
      card.addEventListener("click", function () {
        var pr = PRESETS[card.getAttribute("data-preset")];
        if (pr) { LP.setTestPt(null); LP.apply(pr.p, pr.cons); }
      });
    });
    if ($("btnNbSave")) $("btnNbSave").addEventListener("click", function () {
      var nameEl = $("nbName"), nm = (nameEl && nameEl.value.trim()) || ("Solve #" + (getNotebook().length + 1));
      var list = getNotebook();
      list.unshift({ name: nm, p: Object.assign({}, P), cons: LP.getExtraCons(), z: RES ? RES.z : 0 });
      saveNotebook(list.slice(0, 15));
      if (nameEl) nameEl.value = "";
      renderNotebook();
    });
    if ($("nbList")) $("nbList").addEventListener("click", function (e) {
      var li = e.target.getAttribute("data-nbload"), di = e.target.getAttribute("data-nbdel"), list = getNotebook();
      if (li !== null && list[+li]) LP.apply(list[+li].p, list[+li].cons);
      if (di !== null) { list.splice(+di, 1); saveNotebook(list); renderNotebook(); }
    });
    if ($("btnExportNb")) $("btnExportNb").addEventListener("click", function () {
      download("factory_notebook.json", new Blob([JSON.stringify(getNotebook(), null, 2)], { type: "application/json" }));
    });

    if ($("btnLink")) $("btnLink").addEventListener("click", copyLink);
    if ($("btnSweep")) $("btnSweep").addEventListener("click", sweep);
    if ($("btnPin")) $("btnPin").addEventListener("click", pinCurrent);
    if ($("btnClearPins")) $("btnClearPins").addEventListener("click", function () { pinned = []; renderPins(); });
    if ($("btnValidate")) $("btnValidate").addEventListener("click", validate);
    if ($("btnCsv")) $("btnCsv").addEventListener("click", exportCSV);
    if ($("btnPng")) $("btnPng").addEventListener("click", exportPNG);
    if ($("btnPrint")) $("btnPrint").addEventListener("click", function () { fillOnePager(); if (window.print) window.print(); });

    if ($("paramKey")) $("paramKey").addEventListener("change", renderParametric);
    ["roiCostH", "roiCostM", "roiBudget"].forEach(function (id) { if ($(id)) $(id).addEventListener("input", renderROI); });
    if ($("btnSimPrev")) $("btnSimPrev").addEventListener("click", function () { if (simIdx > 0) { simIdx--; renderSimplexStep(); } });
    if ($("btnSimNext")) $("btnSimNext").addEventListener("click", function () { if (simIdx < simSteps.length - 1) { simIdx++; renderSimplexStep(); } });
    if ($("btnSimMode")) $("btnSimMode").addEventListener("click", function () {
      studentPivotMode = !studentPivotMode;
      $("btnSimMode").setAttribute("aria-pressed", studentPivotMode ? "true" : "false");
      renderSimplexStep();
    });
    if ($("mgaTol")) $("mgaTol").addEventListener("input", renderMGA);
    if ($("cfTarget")) $("cfTarget").addEventListener("change", renderCounterfactual);
    if ($("cfTargetZ")) $("cfTargetZ").addEventListener("input", renderCounterfactual);
    if ($("invX")) $("invX").addEventListener("input", renderInverse);
    if ($("invY")) $("invY").addEventListener("input", renderInverse);
    if ($("robUnc")) $("robUnc").addEventListener("input", renderRobust);
    if ($("robGamma")) $("robGamma").addEventListener("input", renderRobust);
    if ($("parE1")) $("parE1").addEventListener("input", renderPareto);
    if ($("parE2")) $("parE2").addEventListener("input", renderPareto);
    if ($("spoNoise")) $("spoNoise").addEventListener("input", renderSPO);
    document.querySelectorAll(".scale-in").forEach(function (inp) { inp.addEventListener("input", solveScaleUp); });

    if (fromUrl) LP.apply(fromUrl);
    else refresh(LP.P, LP.getLast() || LP.run(LP.P));

    attachCanvasInteraction();
    renderPins();
    renderNotebook();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
