/* Two-variable linear programme: exact vertex enumeration + dual prices,
   extended in browser mode via window.__lpCore for arbitrary constraints,
   exact rational fractions, IIS infeasibility diagnostics, live resource gauges,
   direct-manipulation draggable constraint lines, crosshair HUD, and undo/redo. */
(function () {
  "use strict";

  function det2(m) { return m[0][0] * m[1][1] - m[0][1] * m[1][0]; }

  function solvePair(l1, l2) {
    var d = det2([l1.a, l2.a]);
    if (Math.abs(d) < 1e-12) return null;
    var x = (l1.b * l2.a[1] - l2.b * l1.a[1]) / d;
    var y = (l1.a[0] * l2.b - l2.a[0] * l1.b) / d;
    return [x, y];
  }

  function feasible(x, y, A, b) {
    if (x < -1e-9 || y < -1e-9) return false;
    for (var i = 0; i < A.length; i++) {
      if (A[i][0] * x + A[i][1] * y > b[i] + 1e-7) return false;
    }
    return true;
  }

  function solve2(c, A, b) {
    var lines = [
      { a: [A[0][0], A[0][1]], b: b[0], name: "machine" },
      { a: [A[1][0], A[1][1]], b: b[1], name: "material" },
      { a: [1, 0], b: 0, name: "x=0" },
      { a: [0, 1], b: 0, name: "y=0" }
    ];
    var best = null, verts = [], seen = {};
    for (var i = 0; i < lines.length; i++) {
      for (var j = i + 1; j < lines.length; j++) {
        var p = solvePair(lines[i], lines[j]);
        if (!p) continue;
        if (!feasible(p[0], p[1], A, b)) continue;
        var x = Math.round(p[0] * 1e6) / 1e6, y = Math.round(p[1] * 1e6) / 1e6;
        var key = x + ":" + y;
        if (!seen[key]) { seen[key] = 1; verts.push([x, y]); }
        var z = c[0] * x + c[1] * y;
        if (!best || z > best.z + 1e-9) best = { x: x, y: y, z: z, ex: p[0], ey: p[1] };
      }
    }
    if (!best) return { feasible: false, verts: verts };

    var dc = [
      { a: [A[0][0], A[1][0]], b: c[0] },
      { a: [A[0][1], A[1][1]], b: c[1] },
      { a: [1, 0], b: 0 },
      { a: [0, 1], b: 0 }
    ];
    var dmin = null;
    for (var p1 = 0; p1 < dc.length; p1++) {
      for (var p2 = p1 + 1; p2 < dc.length; p2++) {
        var q = solvePair(dc[p1], dc[p2]);
        if (!q) continue;
        if (q[0] < -1e-9 || q[1] < -1e-9) continue;
        if (A[0][0] * q[0] + A[1][0] * q[1] < c[0] - 1e-9) continue;
        if (A[0][1] * q[0] + A[1][1] * q[1] < c[1] - 1e-9) continue;
        var u1 = Math.round(q[0] * 1e6) / 1e6, u2 = Math.round(q[1] * 1e6) / 1e6;
        var w = b[0] * u1 + b[1] * u2;
        if (!dmin || w < dmin.w - 1e-9) dmin = { u1: u1, u2: u2, w: w };
      }
    }
    var slack = [
      b[0] - (A[0][0] * best.ex + A[0][1] * best.ey),
      b[1] - (A[1][0] * best.ex + A[1][1] * best.ey)
    ];
    return {
      feasible: true, x: best.x, y: best.y, z: best.z, verts: verts,
      u1: dmin ? dmin.u1 : 0, u2: dmin ? dmin.u2 : 0,
      slack: [Math.max(0, slack[0]), Math.max(0, slack[1])],
      binding: [slack[0] < 1e-6, slack[1] < 1e-6]
    };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { solve2: solve2 };
    return;
  }

  var $ = function (id) { return document.getElementById(id); };
  var num = function (v) { return Number(v); };
  var KEYS = ["pc", "pt", "mc", "mt", "kc", "kt", "H", "M"];
  var P = { pc: 40, pt: 30, mc: 2, mt: 1, kc: 1, kt: 2, H: 100, M: 80 };
  var extraCons = [];
  var useFrac = false;
  var challengeMode = false;
  var testPt = null; // user's manually placed test point {x, y}
  var isoRatio = null; // scrubber Z/Z* ratio when active
  var last = null;
  var overlays = { ilp: false, mga: false, robust: false, corners: true, grad: true };
  var overlayData = { ilp: null, mga: null, robust: null };

  // Undo / Redo snapshot stacks
  var undoStack = [], redoStack = [], skipHistory = false;
  function snapState() {
    return JSON.stringify({ p: P, cons: extraCons });
  }
  function pushHistory() {
    if (skipHistory) return;
    var s = snapState();
    if (!undoStack.length || undoStack[undoStack.length - 1] !== s) {
      undoStack.push(s);
      if (undoStack.length > 40) undoStack.shift();
      redoStack = [];
    }
    updateUndoBtns();
  }
  function updateUndoBtns() {
    if ($("btnUndo")) $("btnUndo").disabled = undoStack.length <= 1;
    if ($("btnRedo")) $("btnRedo").disabled = redoStack.length === 0;
  }
  function doUndo() {
    if (undoStack.length <= 1) return;
    var cur = undoStack.pop();
    redoStack.push(cur);
    var prev = JSON.parse(undoStack[undoStack.length - 1]);
    skipHistory = true;
    applyState(prev.p, prev.cons);
    skipHistory = false;
    updateUndoBtns();
  }
  function doRedo() {
    if (!redoStack.length) return;
    var nxt = redoStack.pop();
    undoStack.push(nxt);
    var obj = JSON.parse(nxt);
    skipHistory = true;
    applyState(obj.p, obj.cons);
    skipHistory = false;
    updateUndoBtns();
  }

  function Core() { return window.__lpCore || null; }

  function fmt(n, d) {
    var C = Core();
    if (useFrac && C) return C.toFrac(n);
    if (!isFinite(n)) return "∞";
    return n.toLocaleString("en-IN", { minimumFractionDigits: d === undefined ? 0 : d, maximumFractionDigits: d === undefined ? 0 : d });
  }

  function getAllCons(pObj) {
    var q = pObj || P;
    return [
      { name: "Machine", a1: q.mc, a2: q.mt, b: q.H, op: "<=" },
      { name: "Material", a1: q.kc, a2: q.kt, b: q.M, op: "<=" }
    ].concat(extraCons);
  }

  function syncInputsFromP() {
    KEYS.forEach(function (k) {
      var sl = $("p_" + k);
      var nb = $("n_" + k);
      if (sl) sl.value = Math.max(num(sl.min), Math.min(num(sl.max), P[k]));
      if (nb && document.activeElement !== nb) nb.value = P[k];
    });
  }

  function computeScale(res) {
    var W = 520, Hh = 380, pad = 46;
    var xm = 10, ym = 10;
    getAllCons().forEach(function (r) {
      if (r.a1 > 1e-6 && r.b > 0) xm = Math.max(xm, r.b / r.a1);
      if (r.a2 > 1e-6 && r.b > 0) ym = Math.max(ym, r.b / r.a2);
    });
    if (res && res.verts) {
      res.verts.forEach(function (v) { xm = Math.max(xm, v[0]); ym = Math.max(ym, v[1]); });
    }
    xm *= 1.16; ym *= 1.16;
    return {
      W: W, H: Hh, pad: pad, xm: xm, ym: ym,
      sx: function (x) { return pad + (x / xm) * (W - pad - 18); },
      sy: function (y) { return Hh - pad - (y / ym) * (Hh - pad - 22); }
    };
  }

  function draw(res) {
    var svg = $("lpChart");
    if (!svg) return;
    var s = computeScale(res);
    var W = s.W, Hh = s.H, pad = s.pad, xm = s.xm, ym = s.ym, sx = s.sx, sy = s.sy;
    var parts = [];

    // Gridlines
    for (var gi = 1; gi <= 4; gi++) {
      var gx = sx((xm * gi) / 4), gy = sy((ym * gi) / 4);
      parts.push('<line x1="' + pad + '" y1="' + gy + '" x2="' + (W - 12) + '" y2="' + gy + '" stroke="#f1f3f5" stroke-width="1"/>');
      parts.push('<line x1="' + gx + '" y1="14" x2="' + gx + '" y2="' + (Hh - pad) + '" stroke="#f1f3f5" stroke-width="1"/>');
    }

    // Axes
    parts.push('<line x1="' + pad + '" y1="' + (Hh - pad) + '" x2="' + (W - 12) + '" y2="' + (Hh - pad) + '" stroke="#d1d5db"/>');
    parts.push('<line x1="' + pad + '" y1="' + (Hh - pad) + '" x2="' + pad + '" y2="14" stroke="#d1d5db"/>');

    // Feasible polygon
    if (res && res.feasible && res.verts && res.verts.length > 2) {
      parts.push('<polygon points="' + res.verts.map(function (v) { return sx(v[0]) + "," + sy(v[1]); }).join(" ") +
        '" fill="rgba(60,163,82,.12)" stroke="#1e8e3e" stroke-width="1.6"/>');
    }

    // MGA near-optimal zone overlay
    if (overlays.mga && overlayData.mga && overlayData.mga.poly && overlayData.mga.poly.length > 2) {
      parts.push('<polygon points="' + overlayData.mga.poly.map(function (v) { return sx(v[0]) + "," + sy(v[1]); }).join(" ") +
        '" fill="rgba(234,122,72,.18)" stroke="#ea7a48" stroke-width="1.5" stroke-dasharray="4 3"/>');
    }

    // Integer lattice points overlay (ILP)
    if (overlays.ilp && overlayData.ilp && overlayData.ilp.lattice) {
      overlayData.ilp.lattice.forEach(function (pt) {
        if (pt[0] <= xm && pt[1] <= ym) {
          parts.push('<circle cx="' + sx(pt[0]) + '" cy="' + sy(pt[1]) + '" r="1.7" fill="rgba(37,99,235,.42)"/>');
        }
      });
    }

    // Constraint lines + interactive drag handles on Machine & Material
    function line(a1, a2, b, color, label, idx, isExtra) {
      var pts = [];
      if (Math.abs(a2) > 1e-9) { pts.push([0, b / a2]); pts.push([xm, (b - a1 * xm) / a2]); }
      else if (Math.abs(a1) > 1e-9) { pts.push([b / a1, 0]); pts.push([b / a1, ym]); }
      if (pts.length < 2) return;
      var p0 = [sx(pts[0][0]), sy(pts[0][1])], p1 = [sx(pts[1][0]), sy(pts[1][1])];
      parts.push('<line x1="' + p0[0] + '" y1="' + p0[1] + '" x2="' + p1[0] + '" y2="' + p1[1] +
        '" stroke="' + color + '" stroke-width="' + (isExtra ? "1.6" : "2.1") + '"' +
        (isExtra ? ' stroke-dasharray="6 4"' : '') + '/>');
      if (idx === 0 || idx === 1) {
        var dragKey = idx === 0 ? "H" : "M";
        parts.push('<line class="drag-line" data-dragline="' + dragKey + '" x1="' + p0[0] + '" y1="' + p0[1] +
          '" x2="' + p1[0] + '" y2="' + p1[1] + '" stroke="transparent" stroke-width="14">' +
          '<title>Drag line to adjust ' + (idx === 0 ? "Machine Hours (H)" : "Material (M)") + '</title></line>');
      }
      if (label) {
        parts.push('<text x="' + (W - 150) + '" y="' + (24 + idx * 15) + '" fill="' + color + '" font-size="10.5">' + label + '</text>');
      }
    }

    var palette = ["#ea7a48", "#2563eb", "#8b5cf6", "#1e8e3e", "#d93025", "#6b7280"];
    getAllCons().forEach(function (cRow, idx) {
      line(cRow.a1, cRow.a2, cRow.b, palette[idx % palette.length], cRow.name + " (" + cRow.op + ")", idx, idx >= 2);
    });

    // Objective Gradient Vector (grad Z)
    if (overlays.grad && (P.pc > 0 || P.pt > 0)) {
      var gn = Math.hypot(P.pc, P.pt) || 1;
      var gx2 = (P.pc / gn) * (xm * 0.16), gy2 = (P.pt / gn) * (ym * 0.16);
      parts.push('<defs><marker id="arrG" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto">' +
        '<path d="M 0 1 L 10 5 L 0 9 z" fill="#ea7a48"/></marker></defs>');
      parts.push('<line x1="' + sx(0) + '" y1="' + sy(0) + '" x2="' + sx(gx2) + '" y2="' + sy(gy2) +
        '" stroke="#ea7a48" stroke-width="2" marker-end="url(#arrG)" opacity="0.9"/>');
      parts.push('<text x="' + (sx(gx2) + 5) + '" y="' + (sy(gy2) - 4) + '" font-size="10" font-weight="700" fill="#d85a24">∇Z</text>');
    }

    // Interactive scrubbed isoprofit line
    if (isoRatio !== null && res && res.feasible && !res.unbounded) {
      var zIso = res.z * isoRatio;
      var ia = [0, 0], ib = [0, 0];
      if (Math.abs(P.pt) > 1e-9) { ia = [0, zIso / P.pt]; ib = [xm, (zIso - P.pc * xm) / P.pt]; }
      else if (Math.abs(P.pc) > 1e-9) { ia = [zIso / P.pc, 0]; ib = [zIso / P.pc, ym]; }
      parts.push('<line x1="' + sx(ia[0]) + '" y1="' + sy(ia[1]) + '" x2="' + sx(ib[0]) + '" y2="' + sy(ib[1]) +
        '" stroke="#ea7a48" stroke-width="2.2" stroke-dasharray="6 4"/>');
      parts.push('<text x="' + (pad + 8) + '" y="' + (Hh - pad - 10) + '" font-size="11" font-weight="700" fill="#d85a24">Isoprofit Z = ₹' +
        Math.round(zIso).toLocaleString("en-IN") + '</text>');
    }

    // Alternative optima edge highlight (hidden in blind challenge mode)
    if (!challengeMode && res && res.feasible && res.altVerts && res.altVerts.length > 1) {
      var vA = res.altVerts[0], vB = res.altVerts[res.altVerts.length - 1];
      parts.push('<line x1="' + sx(vA[0]) + '" y1="' + sy(vA[1]) + '" x2="' + sx(vB[0]) + '" y2="' + sy(vB[1]) +
        '" stroke="#1e8e3e" stroke-width="4" stroke-linecap="round"/>');
    }

    // Corner vertex badges
    if (overlays.corners && res && res.feasible && res.verts) {
      res.verts.forEach(function (v) {
        var vz = P.pc * v[0] + P.pt * v[1];
        parts.push('<circle class="corner-pt" data-vx="' + v[0] + '" data-vy="' + v[1] + '" cx="' + sx(v[0]) + '" cy="' + sy(v[1]) +
          '" r="4.2" fill="#fff" stroke="#1e8e3e" stroke-width="1.8" style="cursor:pointer">' +
          '<title>Corner (' + fmt(v[0], 1) + ', ' + fmt(v[1], 1) + ')' + (challengeMode ? '' : ' · Z = ₹' + fmt(vz, 0)) + '</title></circle>');
      });
    }

    // Unbounded ray
    if (res && res.unbounded && res.ray) {
      var rx = res.x + res.ray[0] * (xm * 0.25), ry = res.y + res.ray[1] * (ym * 0.25);
      parts.push('<line x1="' + sx(res.x) + '" y1="' + sy(res.y) + '" x2="' + sx(rx) + '" y2="' + sy(ry) +
        '" stroke="#d93025" stroke-width="2.2" stroke-dasharray="4 3"/>');
      parts.push('<text x="' + sx(rx) + '" y="' + (sy(ry) - 6) + '" fill="#d93025" font-weight="700">Unbounded → ∞</text>');
    }

    // Robust & ILP overlays (hidden in blind challenge mode)
    if (!challengeMode && overlays.robust && overlayData.robust && overlayData.robust.current && overlayData.robust.current.feasible) {
      var rp = overlayData.robust.current;
      parts.push('<rect x="' + (sx(rp.x) - 5) + '" y="' + (sy(rp.y) - 5) + '" width="10" height="10" fill="#2563eb" stroke="#fff" stroke-width="2">' +
        '<title>Robust plan: (' + rp.x.toFixed(1) + ', ' + rp.y.toFixed(1) + ')</title></rect>');
    }
    if (!challengeMode && overlays.ilp && overlayData.ilp && overlayData.ilp.feasible) {
      var ip = overlayData.ilp;
      var ix = sx(ip.x), iy = sy(ip.y);
      parts.push('<polygon points="' + ix + ',' + (iy - 7) + ' ' + (ix + 7) + ',' + iy + ' ' + ix + ',' + (iy + 7) + ' ' + (ix - 7) + ',' + iy +
        '" fill="#8b5cf6" stroke="#fff" stroke-width="2"><title>Integer optimum (' + ip.x + ', ' + ip.y + ') · Z=₹' + ip.z + '</title></polygon>');
    }

    // User-placed test point (or Challenge guess point)
    if (testPt) {
      var tx = sx(testPt.x), ty = sy(testPt.y);
      parts.push('<circle cx="' + tx + '" cy="' + ty + '" r="6" fill="#ea7a48" stroke="#fff" stroke-width="2"/>');
      parts.push('<text x="' + Math.min(W - 95, tx + 9) + '" y="' + Math.max(20, ty + 14) + '" font-size="11" font-weight="700" fill="#d85a24">You (' +
        testPt.x.toFixed(1) + ', ' + testPt.y.toFixed(1) + ')</text>');
    }

    // Optimal dot (hidden during Blind Challenge Mode)
    if (!challengeMode && res && res.feasible && !res.unbounded) {
      var ox = sx(res.x), oy = sy(res.y);
      var lblX = ox + 10 > W - 95 ? ox - 92 : ox + 10;
      var lblY = oy - 10 < 20 ? oy + 18 : oy - 10;
      parts.push('<circle cx="' + ox + '" cy="' + oy + '" r="6.5" fill="#111315" stroke="#fff" stroke-width="2.5" style="cursor:grab"/>');
      parts.push('<text x="' + lblX + '" y="' + lblY + '" font-size="12" font-weight="700" fill="#111315">(' +
        fmt(res.x, 1) + ", " + fmt(res.y, 1) + ")</text>");
    }

    // Crosshair group for live pointer hover
    parts.push('<g id="svgCrosshair" style="display:none;pointer-events:none">' +
      '<line id="chX" x1="0" y1="14" x2="0" y2="' + (Hh - pad) + '" stroke="#96a0aa" stroke-dasharray="3 3"/>' +
      '<line id="chY" x1="' + pad + '" y1="0" x2="' + (W - 12) + '" y2="0" stroke="#96a0aa" stroke-dasharray="3 3"/>' +
      '<circle id="chDot" cx="0" cy="0" r="3" fill="#5d6672"/></g>');

    // Tick labels
    parts.push('<text x="' + (W - 60) + '" y="' + (Hh - pad + 18) + '" font-size="11" fill="#5d6672">chairs</text>');
    parts.push('<text x="' + (pad - 34) + '" y="24" font-size="11" fill="#5d6672">tables</text>');
    parts.push('<text x="' + (pad - 6) + '" y="' + (Hh - pad + 16) + '" font-size="10" fill="#5d6672">0</text>');
    parts.push('<text x="' + (sx(xm) - 12) + '" y="' + (Hh - pad + 16) + '" font-size="10" fill="#5d6672">' + xm.toFixed(0) + '</text>');
    parts.push('<text x="' + (pad - 28) + '" y="' + (sy(ym) + 4) + '" font-size="10" fill="#5d6672">' + ym.toFixed(0) + '</text>');

    svg.innerHTML = parts.join("");
  }

  function renderConstraintsUI() {
    var box = $("consList");
    if (!box) return;
    if (!extraCons.length) {
      box.innerHTML = '<div style="font-size:11.5px;color:#8794a0">No extra constraints active. Add demand caps or contract floors above.</div>';
      return;
    }
    box.innerHTML = extraCons.map(function (cRow, idx) {
      return '<div class="cons-item" data-cidx="' + idx + '">' +
        '<div class="cons-head"><span>' + cRow.name + '</span>' +
        '<button type="button" class="btn-xs danger" data-delcons="' + idx + '">×</button></div>' +
        '<div class="cons-grid">' +
        '<input type="number" step="0.5" value="' + cRow.a1 + '" data-cf="a1" aria-label="Chairs coeff">' +
        '<input type="number" step="0.5" value="' + cRow.a2 + '" data-cf="a2" aria-label="Tables coeff">' +
        '<select data-cf="op" aria-label="Operator">' +
        '<option value="<="' + (cRow.op === "<=" ? " selected" : "") + '>≤</option>' +
        '<option value=">="' + (cRow.op === ">=" ? " selected" : "") + '>≥</option>' +
        '<option value="="' + (cRow.op === "=" ? " selected" : "") + '>=</option>' +
        '</select>' +
        '<input type="number" step="1" value="' + cRow.b + '" data-cf="b" aria-label="RHS">' +
        '</div>' +
        '<div style="font-size:10px;color:#8794a0;margin-top:3px">a₁·chairs + a₂·tables ' + cRow.op + ' b</div>' +
        '</div>';
    }).join("");
  }

  function updateMeters(res) {
    var mFill = $("mBarH"), kFill = $("mBarM"), mTxt = $("mTxtH"), kTxt = $("mTxtM");
    if (!mFill || !kFill) return;
    if (!res || !res.feasible || res.unbounded) {
      mFill.style.width = "100%"; mFill.className = "meter-fill bad";
      kFill.style.width = "100%"; kFill.className = "meter-fill bad";
      if (mTxt) mTxt.textContent = res && res.unbounded ? "Unbounded" : "Conflict";
      if (kTxt) kTxt.textContent = res && res.unbounded ? "Unbounded" : "Conflict";
      return;
    }
    var usedH = P.mc * res.x + P.mt * res.y;
    var usedM = P.kc * res.x + P.kt * res.y;
    var pctH = P.H > 0 ? Math.min(100, (usedH / P.H) * 100) : 0;
    var pctM = P.M > 0 ? Math.min(100, (usedM / P.M) * 100) : 0;
    mFill.style.width = pctH.toFixed(1) + "%";
    kFill.style.width = pctM.toFixed(1) + "%";
    mFill.className = "meter-fill " + (pctH > 99.5 ? "bind" : "");
    kFill.className = "meter-fill " + (pctM > 99.5 ? "bind" : "");
    if (mTxt) mTxt.textContent = usedH.toFixed(1) + " / " + P.H + " h (" + pctH.toFixed(0) + "%)" + (pctH > 99.5 ? " · Binding" : "");
    if (kTxt) kTxt.textContent = usedM.toFixed(1) + " / " + P.M + " kg (" + pctM.toFixed(0) + "%)" + (pctM > 99.5 ? " · Binding" : "");
  }

  function applyFix(rel) {
    if (!rel) return;
    if (rel.index === 0) P.H = Math.ceil(P.H + rel.delta);
    else if (rel.index === 1) P.M = Math.ceil(P.M + rel.delta);
    else if (extraCons[rel.index - 2]) {
      var cRow = extraCons[rel.index - 2];
      if (cRow.op === "<=") cRow.b = +(cRow.b + rel.delta).toFixed(2);
      else if (cRow.op === ">=") cRow.b = Math.max(0, +(cRow.b - rel.delta).toFixed(2));
    }
    syncInputsFromP();
    renderConstraintsUI();
    render();
  }

  function applyState(p, cons) {
    KEYS.forEach(function (k) { if (p[k] !== undefined) P[k] = Number(p[k]); });
    if (Array.isArray(cons)) extraCons = cons.map(function (c) { return Object.assign({}, c); });
    renderConstraintsUI();
    render();
  }

  function render() {
    syncInputsFromP();
    pushHistory();
    var C = Core();
    var cons = getAllCons();
    var res = C ? C.solve2D([P.pc, P.pt], cons) : solve2([P.pc, P.pt], [[P.mc, P.mt], [P.kc, P.kt]], [P.H, P.M]);
    last = res;

    if (!res.feasible) {
      $("zVal").textContent = "Infeasible";
      $("xVal").textContent = "—";
      $("yVal").textContent = "—";
      $("dH").textContent = "—";
      $("dM").textContent = "—";
      $("slackH").textContent = "conflict";
      $("slackM").textContent = "conflict";
      if ($("basisOut")) $("basisOut").textContent = "empty region";
      updateMeters(res);
      var diag = "No feasible production plan with these constraints.";
      if (res.relaxations && res.relaxations.length) {
        var msgs = res.relaxations.map(function (r) {
          return (r.direction === "increase" ? "increase " : (r.direction === "decrease" ? "decrease " : "adjust ")) +
            "<b>" + r.name + "</b> by <b>" + r.delta.toFixed(1) + "</b>";
        });
        diag = "Infeasible region — minimum fix: " + msgs.join(" and ") +
          ' <button type="button" class="btn-xs" id="btnAutoFix" style="margin-left:4px">Auto-apply fix</button>';
      }
      $("verdict").innerHTML = diag;
      var fixBtn = $("btnAutoFix");
      if (fixBtn) fixBtn.addEventListener("click", function () { res.relaxations.forEach(applyFix); });
      if ($("heroMixPill")) { $("heroMixPill").className = "status-pill bad"; $("heroMixPill").textContent = "Infeasible Constraint Set"; }
      if ($("heroDualPill")) { $("heroDualPill").className = "status-pill bad"; $("heroDualPill").textContent = "Relaxation Required"; }
      draw(null);
      if (window.__labRefresh) window.__labRefresh(P, res);
      return;
    }

    if (res.unbounded) {
      $("zVal").textContent = "∞ (Unbounded)";
      $("xVal").textContent = "→ ∞";
      $("yVal").textContent = "→ ∞";
      $("dH").textContent = "—";
      $("dM").textContent = "—";
      $("slackH").textContent = "unbounded";
      $("slackM").textContent = "unbounded";
      if ($("basisOut")) $("basisOut").textContent = "unbounded";
      updateMeters(res);
      if ($("heroMixPill")) { $("heroMixPill").className = "status-pill warn"; $("heroMixPill").textContent = "Unbounded Region"; }
      if ($("heroDualPill")) { $("heroDualPill").className = "status-pill muted"; $("heroDualPill").textContent = "Add Upper Cap"; }
      $("verdict").textContent = "Objective grows without bound along ray (" +
        res.ray[0].toFixed(2) + ", " + res.ray[1].toFixed(2) + "). Add a capacity or demand cap.";
      draw(res);
      if (window.__labRefresh) window.__labRefresh(P, res);
      return;
    }

    if (challengeMode) {
      $("zVal").textContent = "Hidden";
      $("xVal").textContent = "?";
      $("yVal").textContent = "?";
      $("dH").textContent = "?";
      $("dM").textContent = "?";
      $("slackH").textContent = "guess on chart";
      $("slackM").textContent = "guess on chart";
      if ($("basisOut")) $("basisOut").textContent = "blind challenge";
      if ($("heroMixPill")) { $("heroMixPill").className = "status-pill warn"; $("heroMixPill").textContent = "Blind Mode Active"; }
      if ($("heroDualPill")) { $("heroDualPill").className = "status-pill muted"; $("heroDualPill").textContent = "Guess on Canvas"; }
    } else {
      $("zVal").textContent = "₹" + fmt(res.z, 0);
      $("xVal").textContent = fmt(res.x, 1);
      $("yVal").textContent = fmt(res.y, 1);
      $("dH").textContent = res.binding[0] ? "₹" + fmt(res.u1, 2) : "₹0";
      $("dM").textContent = res.binding[1] ? "₹" + fmt(res.u2, 2) : "₹0";
      $("slackH").textContent = fmt(res.slack[0], 0) + " h idle";
      $("slackM").textContent = fmt(res.slack[1], 0) + " kg idle";
      var btype = res.hasAltOptima ? "alt optima edge"
                : (res.x > 1e-6 && res.y > 1e-6) ? "two products"
                : (res.x > 1e-6 ? "chairs only" : (res.y > 1e-6 ? "tables only" : "nothing"));
      if ($("basisOut")) $("basisOut").textContent = btype;
      if ($("heroMixPill")) {
        $("heroMixPill").className = "status-pill ok";
        $("heroMixPill").textContent = fmt(res.x, 0) + " Chairs · " + fmt(res.y, 0) + " Tables (₹" + fmt(res.z, 0) + ")";
      }
      if ($("heroDualPill")) {
        var topDual = res.u1 >= res.u2
          ? ("₹" + fmt(res.u1, 2) + " / Machine hr")
          : ("₹" + fmt(res.u2, 2) + " / Material kg");
        $("heroDualPill").className = (res.u1 > 0 || res.u2 > 0) ? "status-pill warn" : "status-pill muted";
        $("heroDualPill").textContent = (res.u1 > 0 || res.u2 > 0) ? topDual : "Extra Constraint Binds";
      }
    }
    updateMeters(res);

    var bMsg;
    if (res.hasAltOptima) {
      bMsg = "Alternative optima: the highlighted edge achieves identical maximum profit.";
    } else if (res.binding[0] && res.binding[1]) {
      bMsg = "Both base resources bind at the intersection (extra constraints: " + extraCons.length + ").";
    } else if (res.binding[0] !== res.binding[1]) {
      bMsg = "One base resource binds; the other has slack, so its shadow price is zero.";
    } else {
      bMsg = "An added constraint binds before base machine hours or material runs out.";
    }
    $("verdict").textContent = bMsg;
    draw(res);
    if (window.__labRefresh) window.__labRefresh(P, res);
  }

  /* ---------------- scenario explorer ---------------- */
  var filter = "all", searchQuery = "";
  var altSet = { 9: 1, 194: 1, 213: 1 };

  function typeOf(r) {
    if (r[9] > 1e-6 && r[10] > 1e-6) return "mixed";
    return r[9] > 1e-6 ? "chair" : "table";
  }

  function renderTable() {
    var tb = $("scenBody");
    if (!tb || typeof SCEN === "undefined") return;
    var q = searchQuery.trim().toLowerCase();
    var rows = SCEN.filter(function (r) {
      if (filter === "alt" && !altSet[r[0]]) return false;
      if (filter !== "all" && filter !== "alt" && typeOf(r) !== filter) return false;
      if (q) {
        var idStr = "scn-" + String(r[0]).padStart(3, "0");
        var hay = (idStr + " " + r[0] + " " + r[11] + " " + typeOf(r)).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    rows.sort(function (a, b) { return b[11] - a[11]; });
    tb.innerHTML = rows.map(function (r) {
      var isAlt = !!altSet[r[0]], t = typeOf(r);
      var badge = isAlt ? '<span class="score hi">alt optima</span>'
        : '<span class="score ' + (t === "mixed" ? "hi" : (t === "chair" ? "mid" : "lo")) + '">' +
          (t === "mixed" ? "both" : (t === "chair" ? "chairs" : "tables")) + '</span>';
      return '<tr data-id="' + r[0] + '"><td>SCN-' + String(r[0]).padStart(3, "0") + '</td><td class="num">' + fmt(r[1], 0) + '</td><td class="num">' +
        fmt(r[2], 0) + '</td><td class="num">' + fmt(r[9], 1) + '</td><td class="num">' + fmt(r[10], 1) +
        '</td><td class="num">₹' + fmt(r[11], 0) + '</td><td class="num">' + r[12] + '%</td><td class="num">' + r[13] +
        '%</td><td>' + badge + '</td></tr>';
    }).join("");
    if ($("scenCount")) $("scenCount").textContent = rows.length + " of " + SCEN.length;
  }

  function loadScenario(id) {
    if (typeof SCEN === "undefined") return;
    var r = SCEN.filter(function (x) { return x[0] === id; })[0];
    if (!r) return;
    testPt = null;
    applyState({ pc: r[1], pt: r[2], mc: r[3], mt: r[4], kc: r[5], kt: r[6], H: r[7], M: r[8] }, []);
    var card = $("solverCard");
    if (card && card.scrollIntoView) card.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function init() {
    if (!$("zVal")) return;
    KEYS.forEach(function (k) {
      var sl = $("p_" + k), nb = $("n_" + k);
      if (sl) sl.addEventListener("input", function () { P[k] = num(sl.value); if (nb) nb.value = P[k]; render(); });
      if (nb) nb.addEventListener("input", function () {
        var val = parseFloat(nb.value);
        if (!isNaN(val) && val >= 0) { P[k] = val; render(); }
      });
    });

    // Touch stepper +/- buttons and double-click label reset
    document.querySelectorAll("[data-stepk]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var k = btn.getAttribute("data-stepk");
        var d = parseFloat(btn.getAttribute("data-stepd"));
        P[k] = Math.max(0, +(P[k] + d).toFixed(2));
        render();
      });
    });
    document.querySelectorAll(".ctrl label").forEach(function (lbl) {
      lbl.title = "Double-click to reset this parameter to Base Case";
      lbl.addEventListener("dblclick", function () {
        var f = lbl.getAttribute("for");
        if (f && f.indexOf("p_") === 0 && typeof BASE !== "undefined") {
          var k = f.slice(2);
          if (BASE[k] !== undefined) { P[k] = BASE[k]; render(); }
        }
      });
    });

    if ($("btnUndo")) $("btnUndo").addEventListener("click", doUndo);
    if ($("btnRedo")) $("btnRedo").addEventListener("click", doRedo);
    document.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); doUndo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); doRedo(); }
    });

    var btn = $("btnReset");
    if (btn) btn.addEventListener("click", function () {
      testPt = null; isoRatio = null;
      if ($("isoScrub")) $("isoScrub").value = 100;
      applyState(BASE, []);
    });

    // Extra constraint presets
    document.querySelectorAll("[data-addcons]").forEach(function (b) {
      b.addEventListener("click", function () {
        var kind = b.getAttribute("data-addcons");
        if (kind === "c_cap") extraCons.push({ name: "Chair demand cap", a1: 1, a2: 0, b: 35, op: "<=" });
        else if (kind === "t_cap") extraCons.push({ name: "Table demand cap", a1: 0, a2: 1, b: 25, op: "<=" });
        else if (kind === "min_floor") extraCons.push({ name: "Min contract", a1: 1, a2: 1, b: 30, op: ">=" });
        else extraCons.push({ name: "Custom " + (extraCons.length + 1), a1: 1, a2: 1, b: 60, op: "<=" });
        renderConstraintsUI();
        render();
      });
    });

    var cList = $("consList");
    if (cList) {
      cList.addEventListener("click", function (e) {
        var del = e.target.getAttribute("data-delcons");
        if (del !== null) { extraCons.splice(+del, 1); renderConstraintsUI(); render(); }
      });
      cList.addEventListener("input", function (e) {
        var item = e.target.closest(".cons-item");
        if (!item) return;
        var idx = +item.dataset.cidx, field = e.target.getAttribute("data-cf");
        if (!field || !extraCons[idx]) return;
        if (field === "op") extraCons[idx].op = e.target.value;
        else { var v = parseFloat(e.target.value); if (!isNaN(v)) extraCons[idx][field] = v; }
        render();
      });
    }

    document.querySelectorAll("[data-filter]").forEach(function (b) {
      b.addEventListener("click", function () {
        filter = b.getAttribute("data-filter");
        document.querySelectorAll("[data-filter]").forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
        renderTable();
      });
    });
    if ($("scenSearch")) {
      $("scenSearch").addEventListener("input", function (e) { searchQuery = e.target.value; renderTable(); });
    }
    var body = $("scenBody");
    if (body) body.addEventListener("click", function (e) {
      var tr = e.target.closest("tr");
      if (tr && tr.dataset.id) loadScenario(Number(tr.dataset.id));
    });

    var qMatch = /[?&]scn=(\d+)/.exec(location.search);
    if (qMatch) loadScenario(Number(qMatch[1]));
    else { renderConstraintsUI(); render(); }
    renderTable();
  }

  window.__lp = {
    solve2: solve2,
    P: P,
    run: function (p) {
      var C = Core();
      if (C) return C.solve2D([p.pc, p.pt], getAllCons(p));
      return solve2([p.pc, p.pt], [[p.mc, p.mt], [p.kc, p.kt]], [p.H, p.M]);
    },
    apply: applyState,
    getAllCons: function () { return getAllCons(); },
    getExtraCons: function () { return extraCons.map(function (c) { return Object.assign({}, c); }); },
    setExtraCons: function (list) { extraCons = (list || []).map(function (c) { return Object.assign({}, c); }); renderConstraintsUI(); render(); },
    getUseFrac: function () { return useFrac; },
    setUseFrac: function (b) { useFrac = !!b; render(); renderTable(); },
    setChallenge: function (b) { challengeMode = !!b; if (!b) testPt = null; render(); },
    getChallenge: function () { return challengeMode; },
    setTestPt: function (pt) { testPt = pt; draw(last); },
    getTestPt: function () { return testPt; },
    setIsoRatio: function (r) { isoRatio = r; draw(last); },
    setParam: function (k, v) { P[k] = v; render(); },
    setOverlay: function (k, v) { overlays[k] = !!v; draw(last); },
    getOverlays: function () { return Object.assign({}, overlays); },
    setOverlayData: function (k, d) { overlayData[k] = d; draw(last); },
    getScale: function () { return computeScale(last); },
    getLast: function () { return last; },
    redraw: function () { draw(last); },
    render: render
  };

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
  }
})();
