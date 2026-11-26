/* Interactive Scenario Regime Map, Batch CSV Re-Solver,
   Two-Stage Stochastic Simulator, Shadow-Price Histograms,
   and Alternative Optima Launcher. */
(function () {
  "use strict";
  function $(id) { return document.getElementById(id); }
  function Core() { return window.__lpCore || null; }
  function money(n) { return "₹" + Math.round(n).toLocaleString("en-IN"); }

  /* -------------------------------------------- 1. Interactive 300-Scenario Regime Map */
  function initRegimeMap() {
    var svg = $("regimeChart");
    if (!svg || typeof SCEN === "undefined") return;
    var modeSel = $("regimeAxes"), tip = $("regimeTooltip"), minZEl = $("regMinZ");
    var altIds = { 9: 1, 194: 1, 213: 1 };
    var activeRegime = "all";

    function typeOf(r) {
      if (altIds[r[0]]) return "alt";
      if (r[9] > 1e-6 && r[10] > 1e-6) return "mixed";
      return r[9] > 1e-6 ? "chair" : "table";
    }

    function coords(r, mode) {
      if (mode === "qty") return [r[9], r[10]];
      if (mode === "eff") return [r[1] / Math.max(0.1, r[3]), r[2] / Math.max(0.1, r[4])];
      return [r[12], r[13]];
    }

    function drawMap() {
      var mode = modeSel ? modeSel.value : "util";
      var minZ = minZEl ? +minZEl.value : 0;
      if ($("o_regMinZ")) $("o_regMinZ").textContent = "≥ " + money(minZ);
      var W = 640, Hh = 320, pL = 48, pB = 34, pT = 18, pR = 20;

      var allPts = SCEN.map(function (r) { var xy = coords(r, mode); return { r: r, x: xy[0], y: xy[1], t: typeOf(r) }; });
      var maxX = Math.max(10, Math.max.apply(null, allPts.map(function (p) { return p.x; })) * 1.06);
      var maxY = Math.max(10, Math.max.apply(null, allPts.map(function (p) { return p.y; })) * 1.06);
      if (mode === "util") { maxX = 105; maxY = 105; }
      var sx = function (v) { return pL + (v / maxX) * (W - pL - pR); };
      var sy = function (v) { return Hh - pB - (v / maxY) * (Hh - pT - pB); };

      var matched = allPts.filter(function (p) {
        if (p.r[11] < minZ) return false;
        if (activeRegime !== "all" && p.t !== activeRegime) return false;
        return true;
      });
      if ($("regMatchCount")) $("regMatchCount").textContent = matched.length + " matching";

      var parts = [
        '<line x1="' + pL + '" y1="' + (Hh - pB) + '" x2="' + (W - pR) + '" y2="' + (Hh - pB) + '" stroke="#b9b3a4"/>',
        '<line x1="' + pL + '" y1="' + (Hh - pB) + '" x2="' + pL + '" y2="' + pT + '" stroke="#b9b3a4"/>'
      ];
      var col = { chair: "#ea7a48", table: "#2563eb", mixed: "#1e8e3e", alt: "#111315" };
      allPts.forEach(function (p, i) {
        var keep = p.r[11] >= minZ && (activeRegime === "all" || p.t === activeRegime);
        var rad = p.t === "alt" ? 6.2 : (keep ? 3.8 : 2.2);
        var op = keep ? (p.t === "alt" ? 1 : 0.84) : 0.10;
        var st = p.t === "alt" ? ' stroke="#ea7a48" stroke-width="2.2"' : '';
        parts.push('<circle class="reg-pt" data-ri="' + i + '" cx="' + sx(p.x).toFixed(1) + '" cy="' + sy(p.y).toFixed(1) +
          '" r="' + rad + '" fill="' + col[p.t] + '" opacity="' + op + '"' + st + ' style="cursor:pointer"/>');
      });
      var xlab = mode === "qty" ? "Optimal Chairs" : (mode === "eff" ? "Chair Profit / Machine hr (₹)" : "Machine Utilisation (%)");
      var ylab = mode === "qty" ? "Optimal Tables" : (mode === "eff" ? "Table Profit / Machine hr (₹)" : "Material Utilisation (%)");
      parts.push('<text x="' + (W / 2 - 55) + '" y="' + (Hh - 8) + '" font-size="11" fill="#5d6672">' + xlab + '</text>');
      parts.push('<text x="10" y="14" font-size="11" fill="#5d6672">' + ylab + '</text>');
      svg.innerHTML = parts.join("");

      svg.querySelectorAll(".reg-pt").forEach(function (el) {
        el.addEventListener("mouseenter", function () {
          var p = allPts[+el.getAttribute("data-ri")], r = p.r;
          if (tip) tip.innerHTML = "<b>SCN-" + String(r[0]).padStart(3, "0") + "</b> · Chairs " + r[9].toFixed(1) +
            " · Tables " + r[10].toFixed(1) + " · Profit <b>" + money(r[11]) + "</b> · Mach " + r[12] +
            "% / Mat " + r[13] + "%" + (p.t === "alt" ? " · <b>Alternative Optima</b>" : "") + " (click to open in Workbench)";
        });
        el.addEventListener("click", function () {
          var p = allPts[+el.getAttribute("data-ri")];
          location.href = "index.html?scn=" + p.r[0] + "#solverCard";
        });
      });
    }

    document.querySelectorAll("[data-regfilt]").forEach(function (b) {
      b.addEventListener("click", function () {
        activeRegime = b.getAttribute("data-regfilt");
        document.querySelectorAll("[data-regfilt]").forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
        drawMap();
      });
    });
    if (modeSel) modeSel.addEventListener("change", drawMap);
    if (minZEl) minZEl.addEventListener("input", drawMap);
    drawMap();
  }

  /* -------------------------------------------- 2. Batch CSV Uploader & Re-Solver */
  function initBatchCSV() {
    var dz = $("csvDrop"), fi = $("csvFile"), btnSample = $("btnSampleBatch"), out = $("batchOut");
    if (!dz || !out) return;
    var lastBatch = null;

    function processText(txt, label) {
      var C = Core();
      if (!C) return;
      var res = C.parseAndSolveCSV(txt);
      if (res.error) {
        out.innerHTML = "<div class='callout' style='margin-top:14px'><div class='ico'>!</div><div><h4>CSV error</h4><p>" + res.error + "</p></div></div>";
        return;
      }
      lastBatch = res;
      var preview = res.rows.slice(0, 15).map(function (r) {
        return "<tr><td>" + r.id + "</td><td class='num'>" + r.x.toFixed(1) + "</td><td class='num'>" + r.y.toFixed(1) +
          "</td><td class='num'>" + money(r.z) + "</td><td class='num'>₹" + r.u1.toFixed(2) + "</td><td class='num'>₹" + r.u2.toFixed(2) +
          "</td><td>" + (r.hasAlt ? "<span class='badge teal'>alt optima</span>" : (r.bindMach && r.bindMat ? "both bind" : (r.bindMach ? "mach" : "mat"))) + "</td></tr>";
      }).join("");

      out.innerHTML =
        "<div class='grid g4' style='margin-top:14px;gap:10px'>" +
        "<div class='kpi'><div class='lab'>Solved (" + label + ")</div><div class='val'>" + res.count + "</div><div class='note'>" + (res.hasRecorded ? res.exactMatches + " match file" : "custom schema") + "</div></div>" +
        "<div class='kpi'><div class='lab'>Machine binds</div><div class='val'>" + res.bindMachPct.toFixed(1) + "%</div><div class='note'>avg dual ₹" + res.avgU1.toFixed(2) + "/h</div></div>" +
        "<div class='kpi'><div class='lab'>Material binds</div><div class='val'>" + res.bindMatPct.toFixed(1) + "%</div><div class='note'>avg dual ₹" + res.avgU2.toFixed(2) + "/kg</div></div>" +
        "<div class='kpi'><div class='lab'>Alt optima</div><div class='val'>" + res.altCount + "</div><div class='note'>edge-optimal rows</div></div>" +
        "</div>" +
        "<div class='btnrow' style='margin-top:12px'><button type='button' class='btn lite' id='btnDlBatch'>Download re-solved CSV</button></div>" +
        "<div class='scroll' style='margin-top:12px;max-height:300px;overflow-y:auto'><table class='tbl compact'>" +
        "<thead><tr><th>ID</th><th class='num'>Chairs</th><th class='num'>Tables</th><th class='num'>Profit</th><th class='num'>Dual H</th><th class='num'>Dual M</th><th>Status</th></tr></thead>" +
        "<tbody>" + preview + "</tbody></table></div>";

      if ($("btnDlBatch")) {
        $("btnDlBatch").addEventListener("click", function () {
          if (!lastBatch) return;
          var lines = ["ID,pc,pt,mc,mt,kc,kt,H,M,Optimal_Chairs,Optimal_Tables,Maximum_Profit_INR,Dual_Machine,Dual_Material,Alt_Optima"];
          lastBatch.rows.forEach(function (r) {
            lines.push([r.id, r.p.pc, r.p.pt, r.p.mc, r.p.mt, r.p.kc, r.p.kt, r.p.H, r.p.M,
                        r.x.toFixed(4), r.y.toFixed(4), r.z.toFixed(2), r.u1.toFixed(4), r.u2.toFixed(4), r.hasAlt].join(","));
          });
          var a = document.createElement("a");
          a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }));
          a.download = "resolved_scenarios.csv";
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
        });
      }
    }

    function handleFiles(files) {
      if (!files || !files.length) return;
      var f = files[0], rd = new FileReader();
      rd.onload = function () { processText(rd.result, f.name); };
      rd.readAsText(f);
    }

    dz.addEventListener("click", function () { if (fi) fi.click(); });
    if (fi) fi.addEventListener("change", function () { handleFiles(fi.files); });
    dz.addEventListener("dragover", function (e) { e.preventDefault(); dz.classList.add("over"); });
    dz.addEventListener("dragleave", function () { dz.classList.remove("over"); });
    dz.addEventListener("drop", function (e) { e.preventDefault(); dz.classList.remove("over"); handleFiles(e.dataTransfer.files); });

    if (btnSample && typeof SCEN !== "undefined") {
      btnSample.addEventListener("click", function () {
        var hdr = "Scenario_ID,Chair_Profit_INR,Table_Profit_INR,Chair_Machine_Hours,Table_Machine_Hours,Chair_Material_Kg,Table_Material_Kg,Available_Machine_Hours,Available_Material_Kg,Maximum_Profit_INR";
        var rows = SCEN.slice(0, 25).map(function (r) {
          return ["SCN-" + String(r[0]).padStart(3, "0"), r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[11]].join(",");
        });
        processText([hdr].concat(rows).join("\n"), "25-row sample");
      });
    }
  }

  /* -------------------------------------------- 3. Interactive Stochastic Simulator (results.html) */
  function initStochastic() {
    var box = $("stochBox"), svg = $("stochChart"), penEl = $("stochPen"), subEl = $("stochSubset");
    var C = Core();
    if (!box || !C || typeof SCEN === "undefined") return;

    function runStoch() {
      var penPct = penEl ? +penEl.value : 25;
      if ($("o_stochPen")) $("o_stochPen").textContent = penPct + "%";
      var subMode = subEl ? subEl.value : "all";
      var rows = SCEN.filter(function (r) {
        if (subMode === "mixed") return r[9] > 1e-6 && r[10] > 1e-6;
        if (subMode === "high") return r[11] >= 5000;
        return true;
      });
      var st = C.stochasticMetrics(rows, penPct / 100);
      if (!st) return;

      box.innerHTML =
        "<div class='grid g4' style='gap:14px;margin-top:16px'>" +
        "<div class='kpi'><div class='lab'>Wait-and-See (WS)</div><div class='val'>" + money(st.ws) + "</div><div class='note'>" + st.n + " scenarios</div></div>" +
        "<div class='kpi'><div class='lab'>Stochastic Plan (RP)</div><div class='val' style='color:#10473c'>" + money(st.rp) + "</div><div class='note'>commit " + st.rpPlan.x + "c / " + st.rpPlan.y + "t</div></div>" +
        "<div class='kpi'><div class='lab'>EVPI (WS − RP)</div><div class='val' style='color:#b0530b'>" + money(st.evpi) + "</div><div class='note'>max forecast value</div></div>" +
        "<div class='kpi'><div class='lab'>VSS (RP − EEV)</div><div class='val' style='color:#1c6b5b'>" + money(st.vss) + "</div><div class='note'>beats EEV (" + money(st.eev) + ")</div></div>" +
        "</div>";

      if (svg) {
        var W = 600, Hh = 150, pL = 175, pR = 80, maxV = Math.max(1, st.ws * 1.05);
        var bars = [
          { label: "Wait-and-See (Perfect info)", val: st.ws, col: "#2563eb" },
          { label: "Stochastic Optimal (RP)", val: st.rp, col: "#1e8e3e" },
          { label: "Mean-Parameter Plan (EEV)", val: st.eev, col: "#ea7a48" }
        ];
        svg.innerHTML = bars.map(function (r, idx) {
          var y = 18 + idx * 42, w = (r.val / maxV) * (W - pL - pR);
          return '<text x="6" y="' + (y + 18) + '" font-size="12" font-weight="600" fill="#161a1f">' + r.label + '</text>' +
            '<rect x="' + pL + '" y="' + y + '" width="' + w.toFixed(1) + '" height="26" rx="6" fill="' + r.col + '"/>' +
            '<text x="' + (pL + w + 8).toFixed(1) + '" y="' + (y + 18) + '" font-size="12" font-weight="700" fill="#161a1f">' + money(r.val) + '</text>';
        }).join("");
      }
    }

    if (penEl) penEl.addEventListener("input", runStoch);
    if (subEl) subEl.addEventListener("change", runStoch);
    runStoch();
  }

  /* -------------------------------------------- 4. Interactive Shadow-Price Histograms & Alt Optima */
  function initHistograms() {
    var hMach = $("histMach"), hMat = $("histMat"), detail = $("histDetail"), altGrid = $("altGrid");
    var C = Core();
    if ((!hMach && !altGrid) || !C || typeof SCEN === "undefined") return;

    // Solve all 300 scenarios to get exact duals
    var solved = SCEN.map(function (r) {
      var res = C.solve2D([r[1], r[2]], [
        { name: "Machine", a1: r[3], a2: r[4], b: r[7], op: "<=" },
        { name: "Material", a1: r[5], a2: r[6], b: r[8], op: "<=" }
      ]);
      return { r: r, u1: res.u1 || 0, u2: res.u2 || 0, hasAlt: !!res.hasAltOptima, altVerts: res.altVerts || [] };
    });

    var bins = [
      { label: "₹0 (Slack)", lo: -0.01, hi: 0.01 },
      { label: "₹0–15", lo: 0.01, hi: 15 },
      { label: "₹15–30", lo: 15, hi: 30 },
      { label: "₹30–60", lo: 30, hi: 60 },
      { label: "₹60+", lo: 60, hi: 1e9 }
    ];

    function drawHist(svg, key, color, titleLabel) {
      if (!svg) return;
      var counts = bins.map(function (b) {
        return solved.filter(function (s) { return s[key] > b.lo && s[key] <= b.hi; });
      });
      var maxC = Math.max(1, Math.max.apply(null, counts.map(function (a) { return a.length; })));
      var W = 420, Hh = 175, pL = 22, pB = 28, pT = 20, pR = 14;
      var bw = (W - pL - pR) / bins.length;
      var parts = ['<line x1="' + pL + '" y1="' + (Hh - pB) + '" x2="' + (W - pR) + '" y2="' + (Hh - pB) + '" stroke="#b9b3a4"/>'];
      counts.forEach(function (arr, bi) {
        var bh = (arr.length / maxC) * (Hh - pT - pB);
        var x = pL + bi * bw + 8, y = Hh - pB - bh, w = bw - 16;
        parts.push('<rect class="hist-bar" data-bi="' + bi + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) +
          '" width="' + w.toFixed(1) + '" height="' + Math.max(2, bh).toFixed(1) + '" rx="5" fill="' + color + '"/>');
        parts.push('<text x="' + (x + w / 2).toFixed(1) + '" y="' + (y - 5).toFixed(1) + '" font-size="10.5" font-weight="700" text-anchor="middle" fill="#161a1f">' + arr.length + '</text>');
        parts.push('<text x="' + (x + w / 2).toFixed(1) + '" y="' + (Hh - 10) + '" font-size="9.5" text-anchor="middle" fill="#5d6672">' + bins[bi].label + '</text>');
      });
      svg.innerHTML = parts.join("");
      svg.querySelectorAll(".hist-bar").forEach(function (rect) {
        rect.addEventListener("click", function () {
          var bi = +rect.getAttribute("data-bi"), matches = counts[bi];
          if (!detail) return;
          var rows = matches.slice(0, 12).map(function (m) {
            return "<tr><td><a href='index.html?scn=" + m.r[0] + "#solverCard'>SCN-" + String(m.r[0]).padStart(3, "0") + "</a></td>" +
              "<td class='num'>" + m.r[9].toFixed(1) + " / " + m.r[10].toFixed(1) + "</td>" +
              "<td class='num'>" + money(m.r[11]) + "</td><td class='num'>₹" + m.u1.toFixed(2) + "</td><td class='num'>₹" + m.u2.toFixed(2) + "</td></tr>";
          }).join("");
          detail.innerHTML = "<h4>" + titleLabel + " in " + bins[bi].label + " (" + matches.length + " scenarios)</h4>" +
            "<div class='scroll' style='margin-top:8px'><table class='tbl compact'><thead><tr><th>ID (click to open)</th><th class='num'>Chairs / Tables</th><th class='num'>Profit</th><th class='num'>u₁ (Mach)</th><th class='num'>u₂ (Mat)</th></tr></thead><tbody>" +
            rows + "</tbody></table></div>";
        });
      });
    }

    drawHist(hMach, "u1", "#ea7a48", "Machine Dual");
    drawHist(hMat, "u2", "#2563eb", "Material Dual");

    if (altGrid) {
      var alts = solved.filter(function (s) { return s.hasAlt; });
      altGrid.innerHTML = alts.map(function (a) {
        var v1 = a.altVerts[0] || [a.r[9], a.r[10]];
        var v2 = a.altVerts[a.altVerts.length - 1] || v1;
        return "<div class='card'><span class='tagn'>SCN-" + String(a.r[0]).padStart(3, "0") + " · Alt Optima Edge</span>" +
          "<h4>Optimal Profit " + money(a.r[11]) + "</h4>" +
          "<p class='note'>Corner A: <b>" + v1[0].toFixed(2) + "c, " + v1[1].toFixed(2) + "t</b><br>Corner B: <b>" +
          v2[0].toFixed(2) + "c, " + v2[1].toFixed(2) + "t</b></p>" +
          "<p style='margin-top:10px'><a class='cta' style='padding:8px 12px' href='index.html?scn=" + a.r[0] + "#solverCard'>Inspect in Workbench →</a></p></div>";
      }).join("");
    }
  }

  function init() {
    initRegimeMap();
    initBatchCSV();
    initStochastic();
    initHistograms();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
