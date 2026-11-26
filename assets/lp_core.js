/* Pure-JS Operations Research & Prescriptive Analytics Engine for Factory LP.
   Zero external dependencies, UMD-compatible (Browser + Node.js).
   Provides: exact rational formatting, n-variable Two-Phase Simplex,
   general 2D constraint polygon & IIS relaxation diagnostics, 2D ILP Branch-and-Bound,
   Primal-Dual builder, MGA (Brill 1982), Counterfactuals (Kurtz et al. 2024),
   Bertsimas-Sim (2004) Robust LP, Inverse Optimization (Ahuja & Orlin 2001),
   Multi-Objective Pareto Frontier, Stochastic EVPI/VSS, SPO Regret, Capacity ROI,
   Parametric curves, and Batch CSV solver. */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.__lpCore = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var EPS = 1e-8;

  /* ------------------------------------------------ 1. Rational & number format */
  function gcd(a, b) {
    a = Math.abs(a); b = Math.abs(b);
    while (b) { var t = b; b = a % b; a = t; }
    return a || 1;
  }

  function toFrac(val, maxDen) {
    maxDen = maxDen || 500;
    if (!isFinite(val)) return "—";
    if (Math.abs(val) < 1e-9) return "0";
    var sign = val < 0 ? "−" : "";
    var x = Math.abs(val);
    if (Math.abs(x - Math.round(x)) < 1e-7) return sign + Math.round(x).toLocaleString("en-IN");
    // Continued fraction rational approximation
    var h1 = 1, h2 = 0, k1 = 0, k2 = 1, b = x;
    for (var iter = 0; iter < 18; iter++) {
      var a = Math.floor(b);
      var h = a * h1 + h2, k = a * k1 + k2;
      if (k > maxDen) break;
      h2 = h1; h1 = h; k2 = k1; k1 = k;
      var rem = b - a;
      if (Math.abs(x - h1 / k1) < 1e-7 || rem < 1e-10) break;
      b = 1 / rem;
    }
    if (k1 > 1 && Math.abs(x - h1 / k1) < 1e-5) {
      var g = gcd(h1, k1);
      var num = h1 / g, den = k1 / g;
      if (den === 1) return sign + num;
      return sign + num + "/" + den;
    }
    return (val < 0 ? "−" : "") + x.toFixed(2);
  }

  function fmtVal(val, decimals, useFrac) {
    if (!isFinite(val)) return "—";
    if (useFrac) return toFrac(val);
    var d = decimals === undefined ? 2 : decimals;
    var r = Math.abs(val) < 1e-9 ? 0 : val;
    return r.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  /* ------------------------------------------------ 2. Linear algebra helper */
  function solveLinearSystem(M, rhs) {
    var n = M.length;
    var A = M.map(function (row, i) { return row.slice().concat([rhs[i]]); });
    for (var col = 0; col < n; col++) {
      var piv = col;
      for (var r = col + 1; r < n; r++) {
        if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
      }
      if (Math.abs(A[piv][col]) < 1e-11) return null;
      var tmp = A[col]; A[col] = A[piv]; A[piv] = tmp;
      var div = A[col][col];
      for (var j = col; j <= n; j++) A[col][j] /= div;
      for (var r2 = 0; r2 < n; r2++) {
        if (r2 === col) continue;
        var f = A[r2][col];
        if (Math.abs(f) < 1e-13) continue;
        for (var j2 = col; j2 <= n; j2++) A[r2][j2] -= f * A[col][j2];
      }
    }
    return A.map(function (row) { return row[n]; });
  }

  /* ------------------------------------------------ 3. General Two-Phase Simplex */
  /**
   * Solve: opt c·x  s.t.  A x (<= | >= | =) b,  x >= 0
   * @param {number[]} c
   * @param {number[][]} A
   * @param {string[]} ops - array of "<=", ">=", "="
   * @param {number[]} b
   * @param {string[]} [varNames]
   * @param {boolean} [maximize=true]
   * @param {boolean} [recordSteps=true]
   */
  function solveSimplexN(c, A, ops, b, varNames, maximize, recordSteps) {
    maximize = maximize === undefined ? true : !!maximize;
    recordSteps = recordSteps === undefined ? true : !!recordSteps;
    var m = A.length;
    var n = c.length;
    var names = varNames && varNames.length === n
      ? varNames.slice()
      : c.map(function (_, i) { return "x" + (i + 1); });

    if (m === 0) {
      // Unconstrained non-negative LP
      var pos = c.some(function (v) { return (maximize ? v : -v) > EPS; });
      if (pos) return { status: "unbounded", x: c.map(function () { return 0; }), z: 0, duals: [], slacks: [], tableaus: [] };
      return { status: "optimal", x: c.map(function () { return 0; }), z: 0, duals: [], slacks: [], tableaus: [] };
    }

    var objSign = maximize ? 1 : -1;
    var cMax = c.map(function (v) { return objSign * v; });

    // Normalize RHS >= 0 and track sign flips for dual recovery
    var rowFlip = [];
    var normA = [], normOps = [], normB = [];
    for (var i = 0; i < m; i++) {
      var bi = b[i];
      var op = ops[i] || "<=";
      if (bi < -1e-9) {
        rowFlip.push(-1);
        normA.push(A[i].map(function (v) { return -v; }));
        normB.push(-bi);
        normOps.push(op === "<=" ? ">=" : (op === ">=" ? "<=" : "="));
      } else {
        rowFlip.push(1);
        normA.push(A[i].slice());
        normB.push(Math.max(0, bi));
        normOps.push(op);
      }
    }

    // Build augmented columns: decision vars, slacks/surplus, artificials
    var colNames = names.slice();
    var slackCols = []; // per constraint: { col, sign }
    var artCols = [];
    var basis = [];
    var T = normA.map(function (r) { return r.slice(); });

    function addCol(name, rowIdx, val) {
      var idx = colNames.length;
      colNames.push(name);
      for (var r = 0; r < m; r++) T[r].push(r === rowIdx ? val : 0);
      return idx;
    }

    for (var i2 = 0; i2 < m; i2++) {
      if (normOps[i2] === "<=") {
        var sc = addCol("s" + (i2 + 1), i2, 1);
        slackCols.push({ col: sc, type: "<=" });
        basis.push(sc);
      } else if (normOps[i2] === ">=") {
        var ec = addCol("e" + (i2 + 1), i2, -1);
        var ac = addCol("a" + (i2 + 1), i2, 1);
        slackCols.push({ col: ec, type: ">=" });
        artCols.push(ac);
        basis.push(ac);
      } else {
        var acEq = addCol("a" + (i2 + 1), i2, 1);
        slackCols.push({ col: -1, type: "=" });
        artCols.push(acEq);
        basis.push(acEq);
      }
    }

    var totalCols = colNames.length;
    var rhs = normB.slice();
    var tableaus = [];

    function calcReducedCosts(cVec, activeCols) {
      var zc = [];
      for (var j = 0; j < totalCols; j++) {
        if (activeCols && !activeCols[j]) { zc.push(0); continue; }
        var sum = 0;
        for (var r = 0; r < m; r++) sum += (cVec[basis[r]] || 0) * T[r][j];
        zc.push(sum - (cVec[j] || 0));
      }
      var obj = 0;
      for (var r2 = 0; r2 < m; r2++) obj += (cVec[basis[r2]] || 0) * rhs[r2];
      return { zc: zc, obj: obj };
    }

    function snapshot(phase, step, cVec, activeCols, pivotRow, pivotCol, theta) {
      if (!recordSteps) return;
      var rc = calcReducedCosts(cVec, activeCols);
      var colMap = [];
      for (var j = 0; j < totalCols; j++) if (!activeCols || activeCols[j]) colMap.push(j);
      tableaus.push({
        phase: phase,
        step: step,
        colNames: colMap.map(function (j) { return colNames[j]; }),
        colIndices: colMap,
        basisNames: basis.map(function (bIdx) { return colNames[bIdx]; }),
        matrix: T.map(function (row) { return colMap.map(function (j) { return row[j]; }); }),
        rhs: rhs.slice(),
        zc: colMap.map(function (j) { return rc.zc[j]; }),
        obj: phase === 1 ? -rc.obj : objSign * rc.obj,
        pivotRow: pivotRow,
        pivotCol: pivotCol !== undefined && pivotCol !== null ? colMap.indexOf(pivotCol) : null,
        pivotColGlobal: pivotCol,
        enterVar: pivotCol !== undefined && pivotCol !== null ? colNames[pivotCol] : null,
        leaveVar: pivotRow !== undefined && pivotRow !== null ? colNames[basis[pivotRow]] : null,
        theta: theta ? theta.slice() : null
      });
    }

    function pivot(pr, pc) {
      var div = T[pr][pc];
      for (var j = 0; j < totalCols; j++) T[pr][j] /= div;
      rhs[pr] /= div;
      for (var r = 0; r < m; r++) {
        if (r === pr) continue;
        var f = T[r][pc];
        if (Math.abs(f) < 1e-13) continue;
        for (var j2 = 0; j2 < totalCols; j2++) T[r][j2] -= f * T[pr][j2];
        rhs[r] -= f * rhs[pr];
        if (Math.abs(rhs[r]) < 1e-12) rhs[r] = 0;
      }
      basis[pr] = pc;
    }

    function runPhase(phase, cVec, activeCols) {
      var maxIter = 250;
      for (var iter = 0; iter < maxIter; iter++) {
        var rc = calcReducedCosts(cVec, activeCols);
        // Most negative reduced cost (maximize) with Bland fallback after 40 steps
        var pc = -1, bestVal = -1e-9;
        var useBland = iter > 40;
        for (var j = 0; j < totalCols; j++) {
          if (activeCols && !activeCols[j]) continue;
          if (rc.zc[j] < -1e-9) {
            if (useBland) { pc = j; break; }
            if (rc.zc[j] < bestVal) { bestVal = rc.zc[j]; pc = j; }
          }
        }
        if (pc === -1) {
          snapshot(phase, iter, cVec, activeCols, null, null, null);
          return { status: "optimal", rc: rc };
        }
        var pr = -1, minRatio = Infinity;
        var thetas = [];
        for (var r = 0; r < m; r++) {
          var aij = T[r][pc];
          if (aij > 1e-9) {
            var ratio = Math.max(0, rhs[r]) / aij;
            thetas.push(ratio);
            if (ratio < minRatio - 1e-11 || (Math.abs(ratio - minRatio) <= 1e-11 && basis[r] < (pr >= 0 ? basis[pr] : Infinity))) {
              minRatio = ratio;
              pr = r;
            }
          } else {
            thetas.push(null);
          }
        }
        if (pr === -1) {
          snapshot(phase, iter, cVec, activeCols, null, pc, thetas);
          var ray = c.map(function () { return 0; });
          if (pc < n) ray[pc] = 1;
          for (var rr = 0; rr < m; rr++) {
            if (basis[rr] < n) ray[basis[rr]] = -T[rr][pc];
          }
          return { status: "unbounded", ray: ray };
        }
        snapshot(phase, iter, cVec, activeCols, pr, pc, thetas);
        pivot(pr, pc);
      }
      return { status: "max_iter" };
    }

    var active = [];
    for (var j0 = 0; j0 < totalCols; j0++) active.push(true);

    // Phase I if artificial variables exist
    if (artCols.length > 0) {
      var cP1 = [];
      for (var j1 = 0; j1 < totalCols; j1++) cP1.push(artCols.indexOf(j1) !== -1 ? -1 : 0);
      var p1 = runPhase(1, cP1, active);
      if (p1.status !== "optimal") return { status: p1.status, tableaus: tableaus };
      var sumArt = -p1.rc.obj;
      if (sumArt > 1e-6) {
        return { status: "infeasible", x: c.map(function () { return 0; }), z: NaN, duals: [], slacks: [], tableaus: tableaus };
      }
      // Pivot any remaining zero-valued artificial variable out of basis
      for (var r3 = 0; r3 < m; r3++) {
        if (artCols.indexOf(basis[r3]) !== -1) {
          var swapCol = -1;
          for (var jj = 0; jj < totalCols; jj++) {
            if (artCols.indexOf(jj) === -1 && Math.abs(T[r3][jj]) > 1e-8) { swapCol = jj; break; }
          }
          if (swapCol !== -1) pivot(r3, swapCol);
        }
      }
      // Disable artificial columns for Phase II (if a row still holds a degenerate artificial, keep col inactive)
      artCols.forEach(function (acIdx) {
        if (basis.indexOf(acIdx) === -1) active[acIdx] = false;
      });
    }

    // Phase II
    var cP2 = [];
    for (var j2 = 0; j2 < totalCols; j2++) cP2.push(j2 < n ? cMax[j2] : 0);
    var p2 = runPhase(2, cP2, active);
    if (p2.status === "unbounded") {
      return { status: "unbounded", ray: p2.ray, x: c.map(function () { return 0; }), z: maximize ? Infinity : -Infinity, duals: [], slacks: [], tableaus: tableaus };
    }
    if (p2.status !== "optimal") {
      return { status: p2.status, x: c.map(function () { return 0; }), z: NaN, duals: [], slacks: [], tableaus: tableaus };
    }

    var x = c.map(function () { return 0; });
    for (var rb = 0; rb < m; rb++) {
      if (basis[rb] < n) x[basis[rb]] = Math.max(0, rhs[rb]);
    }
    var z = 0;
    for (var jx = 0; jx < n; jx++) z += c[jx] * x[jx];

    // Slacks in original constraint direction
    var slacks = [];
    for (var ic = 0; ic < m; ic++) {
      var lhs = 0;
      for (var jc = 0; jc < n; jc++) lhs += A[ic][jc] * x[jc];
      var sVal = (ops[ic] || "<=") === ">=" ? lhs - b[ic] : b[ic] - lhs;
      slacks.push(Math.abs(sVal) < 1e-8 ? 0 : sVal);
    }

    // Recover dual prices cleanly from final reduced costs and B^-1
    var duals = [];
    for (var id = 0; id < m; id++) {
      var scInfo = slackCols[id];
      if (scInfo.col !== -1) {
        var rawDual = scInfo.type === "<=" ? p2.rc.zc[scInfo.col] : -p2.rc.zc[scInfo.col];
        duals.push(objSign * rowFlip[id] * rawDual);
      } else {
        // Equality row: solve from basis matrix if non-degenerate, else 0
        duals.push(0);
      }
    }
    // Check equality rows via B^T y = c_B when m equality rows exist
    var hasEq = ops.some(function (o) { return o === "="; });
    if (hasEq) {
      // Build full original columns for basis (only non-artificial)
      var fullCols = [];
      for (var jc2 = 0; jc2 < n; jc2++) {
        fullCols.push(normA.map(function (row) { return row[jc2]; }));
      }
      for (var ic2 = 0; ic2 < m; ic2++) {
        var sc2 = slackCols[ic2];
        if (sc2.col !== -1) {
          var vec = new Array(m).fill(0);
          vec[ic2] = sc2.type === "<=" ? 1 : -1;
          fullCols[sc2.col] = vec;
        }
      }
      var validBasis = basis.every(function (bi) { return fullCols[bi] !== undefined; });
      if (validBasis) {
        var BT = [];
        var cB = [];
        for (var r4 = 0; r4 < m; r4++) {
          BT.push(fullCols[basis[r4]].slice());
          cB.push(basis[r4] < n ? cMax[basis[r4]] : 0);
        }
        var ySol = solveLinearSystem(BT, cB);
        if (ySol) {
          duals = ySol.map(function (yv, idx) { return objSign * rowFlip[idx] * yv; });
        }
      }
    }

    // Check alternative optima signal (non-basic active non-artificial column with zero reduced cost)
    var hasAlt = false;
    for (var ja = 0; ja < totalCols; ja++) {
      if (!active[ja] || basis.indexOf(ja) !== -1) continue;
      if (Math.abs(p2.rc.zc[ja]) < 1e-7) { hasAlt = true; break; }
    }

    return {
      status: "optimal",
      x: x,
      z: z,
      duals: duals.map(function (d) { return Math.abs(d) < 1e-9 ? 0 : d; }),
      slacks: slacks,
      basis: basis.map(function (bi) { return colNames[bi]; }),
      hasAltOptima: hasAlt,
      tableaus: tableaus
    };
  }

  /* ------------------------------------------------ 4. General 2D LP + IIS + Alt Optima */
  /**
   * Solve general 2D LP with arbitrary constraints:
   *   constraints: [{ name, a1, a2, b, op }]
   */
  function solve2D(c, constraints) {
    var cons = (constraints || []).map(function (r, idx) {
      return {
        name: r.name || ("C" + (idx + 1)),
        a1: +r.a1,
        a2: +r.a2,
        b: +r.b,
        op: r.op || "<="
      };
    });

    var A = cons.map(function (r) { return [r.a1, r.a2]; });
    var ops = cons.map(function (r) { return r.op; });
    var b = cons.map(function (r) { return r.b; });

    var sim = solveSimplexN(c, A, ops, b, ["chairs", "tables"], true, false);

    // Collect boundary lines for 2D vertex geometry
    var lines = cons.map(function (r, idx) {
      return { a: [r.a1, r.a2], b: r.b, name: r.name, idx: idx };
    });
    lines.push({ a: [1, 0], b: 0, name: "x=0", idx: -1 });
    lines.push({ a: [0, 1], b: 0, name: "y=0", idx: -2 });

    function isFeas2(x, y) {
      if (x < -1e-7 || y < -1e-7) return false;
      for (var i = 0; i < cons.length; i++) {
        var r = cons[i];
        var v = r.a1 * x + r.a2 * y;
        if (r.op === "<=" && v > r.b + 1e-6) return false;
        if (r.op === ">=" && v < r.b - 1e-6) return false;
        if (r.op === "=" && Math.abs(v - r.b) > 1e-6) return false;
      }
      return true;
    }

    function solvePair2(l1, l2) {
      var d = l1.a[0] * l2.a[1] - l1.a[1] * l2.a[0];
      if (Math.abs(d) < 1e-11) return null;
      return [
        (l1.b * l2.a[1] - l2.b * l1.a[1]) / d,
        (l1.a[0] * l2.b - l2.a[0] * l1.b) / d
      ];
    }

    if (sim.status === "infeasible") {
      // IIS / Minimum Relaxation LP: min sum(r_i) s.t. relaxed constraints
      var nVars = 2;
      var relCols = [];
      var rA = [], rOps = [], rB = [], rC = [0, 0], rNames = ["chairs", "tables"];
      for (var i = 0; i < cons.length; i++) {
        var row = [cons[i].a1, cons[i].a2];
        var posIdx = nVars++;
        rNames.push("relax_" + i);
        rC.push(1);
        relCols.push({ i: i, pos: posIdx, neg: -1, op: cons[i].op });
        for (var pad = 2; pad < posIdx; pad++) row.push(0);
        if (cons[i].op === "<=") row.push(-1);
        else if (cons[i].op === ">=") row.push(1);
        else {
          row.push(-1);
          var negIdx = nVars++;
          rNames.push("relax_neg_" + i);
          rC.push(1);
          row.push(1);
          relCols[relCols.length - 1].neg = negIdx;
        }
        rA.push(row);
        rOps.push(cons[i].op);
        rB.push(cons[i].b);
      }
      // Pad shorter rows
      rA.forEach(function (row) { while (row.length < nVars) row.push(0); });
      var relSol = solveSimplexN(rC, rA, rOps, rB, rNames, false, false);
      var relaxations = [];
      if (relSol.status === "optimal") {
        relCols.forEach(function (rc) {
          var amt = (relSol.x[rc.pos] || 0) + (rc.neg >= 0 ? (relSol.x[rc.neg] || 0) : 0);
          if (amt > 1e-6) {
            relaxations.push({
              index: rc.i,
              name: cons[rc.i].name,
              op: cons[rc.i].op,
              rhs: cons[rc.i].b,
              delta: amt,
              direction: cons[rc.i].op === "<=" ? "increase" : (cons[rc.i].op === ">=" ? "decrease" : "shift")
            });
          }
        });
      }
      return {
        feasible: false,
        infeasible: true,
        unbounded: false,
        verts: [],
        altVerts: [],
        relaxations: relaxations,
        constraints: cons
      };
    }

    // Enumerate feasible extreme points (plus clip box if unbounded for polygon visualization)
    var xBound = 100, yBound = 100;
    cons.forEach(function (r) {
      if (r.a1 > 1e-9 && r.b > 0) xBound = Math.max(xBound, r.b / r.a1);
      if (r.a2 > 1e-9 && r.b > 0) yBound = Math.max(yBound, r.b / r.a2);
    });
    var boxX = xBound * 1.4, boxY = yBound * 1.4;
    var clipLines = lines.slice();
    if (sim.status === "unbounded") {
      clipLines.push({ a: [1, 0], b: boxX, name: "boxX", idx: -3 });
      clipLines.push({ a: [0, 1], b: boxY, name: "boxY", idx: -4 });
    }

    var verts = [], seen = {};
    for (var i2 = 0; i2 < clipLines.length; i2++) {
      for (var j2 = i2 + 1; j2 < clipLines.length; j2++) {
        var p = solvePair2(clipLines[i2], clipLines[j2]);
        if (!p) continue;
        if (!isFeas2(p[0], p[1])) continue;
        if (sim.status === "unbounded" && (p[0] > boxX + 1e-5 || p[1] > boxY + 1e-5)) continue;
        var vx = Math.abs(p[0]) < 1e-9 ? 0 : Math.round(p[0] * 1e6) / 1e6;
        var vy = Math.abs(p[1]) < 1e-9 ? 0 : Math.round(p[1] * 1e6) / 1e6;
        var k = vx.toFixed(5) + ":" + vy.toFixed(5);
        if (!seen[k]) { seen[k] = 1; verts.push([vx, vy]); }
      }
    }

    // Sort polygon vertices CCW around centroid
    if (verts.length > 2) {
      var cx = 0, cy = 0;
      verts.forEach(function (v) { cx += v[0]; cy += v[1]; });
      cx /= verts.length; cy /= verts.length;
      verts.sort(function (u, v) { return Math.atan2(u[1] - cy, u[0] - cx) - Math.atan2(v[1] - cy, v[0] - cx); });
    }

    if (sim.status === "unbounded") {
      return {
        feasible: true,
        unbounded: true,
        x: sim.x[0],
        y: sim.x[1],
        z: Infinity,
        ray: sim.ray,
        verts: verts,
        altVerts: [],
        hasAltOptima: false,
        duals: cons.map(function () { return 0; }),
        slack: cons.map(function () { return 0; }),
        binding: cons.map(function () { return false; }),
        constraints: cons
      };
    }

    var bestZ = sim.z;
    var altVerts = verts.filter(function (v) {
      return Math.abs((c[0] * v[0] + c[1] * v[1]) - bestZ) <= 1e-5;
    });
    var binding = sim.slacks.map(function (s, idx) {
      return cons[idx].op === "=" || Math.abs(s) < 1e-6;
    });

    return {
      feasible: true,
      unbounded: false,
      x: Math.round(sim.x[0] * 1e6) / 1e6,
      y: Math.round(sim.x[1] * 1e6) / 1e6,
      z: bestZ,
      verts: verts,
      altVerts: altVerts,
      hasAltOptima: altVerts.length > 1 || sim.hasAltOptima,
      duals: sim.duals,
      u1: sim.duals[0] || 0,
      u2: sim.duals[1] || 0,
      slack: sim.slacks,
      binding: binding,
      constraints: cons
    };
  }

  /* ------------------------------------------------ 5. 2D ILP & Branch-and-Bound */
  function solveILP2D(c, constraints) {
    var rootLP = solve2D(c, constraints);
    if (!rootLP.feasible || rootLP.unbounded) {
      return {
        feasible: false,
        unbounded: !!rootLP.unbounded,
        lpZ: rootLP.z,
        nodes: [],
        lattice: []
      };
    }

    // Collect feasible integer lattice points inside polygon (bounded sampling for very large bounds)
    var maxX = 0, maxY = 0;
    rootLP.verts.forEach(function (v) { maxX = Math.max(maxX, v[0]); maxY = Math.max(maxY, v[1]); });
    var lattice = [];
    var step = (maxX * maxY > 9000) ? Math.ceil(Math.sqrt((maxX * maxY) / 4000)) : 1;
    for (var ix = 0; ix <= Math.ceil(maxX) + 1; ix += step) {
      for (var iy = 0; iy <= Math.ceil(maxY) + 1; iy += step) {
        var ok = true;
        for (var ic = 0; ic < constraints.length; ic++) {
          var r = constraints[ic];
          var val = r.a1 * ix + r.a2 * iy;
          if (r.op === "<=" && val > r.b + 1e-7) { ok = false; break; }
          if (r.op === ">=" && val < r.b - 1e-7) { ok = false; break; }
          if (r.op === "=" && Math.abs(val - r.b) > 1e-7) { ok = false; break; }
        }
        if (ok) lattice.push([ix, iy]);
      }
    }

    var bestInt = null;
    var nodes = [];
    var nodeSeq = 0;

    function isInt(v) { return Math.abs(v - Math.round(v)) < 1e-6; }

    function branch(extraBounds, parentId, ruleLabel, depth) {
      if (nodes.length >= 65 || depth > 18) return;
      var id = nodeSeq++;
      var fullCons = constraints.concat(extraBounds);
      var lp = solve2D(c, fullCons);
      var node = {
        id: id,
        parentId: parentId,
        rule: ruleLabel,
        depth: depth,
        feasible: lp.feasible && !lp.unbounded,
        x: lp.x,
        y: lp.y,
        z: lp.z,
        status: "open"
      };
      nodes.push(node);

      if (!lp.feasible || lp.unbounded) {
        node.status = "infeasible";
        return;
      }
      if (bestInt && lp.z <= bestInt.z + 1e-7) {
        node.status = "pruned";
        return;
      }
      if (isInt(lp.x) && isInt(lp.y)) {
        var xi = Math.round(lp.x), yi = Math.round(lp.y);
        var zi = c[0] * xi + c[1] * yi;
        node.status = "integer";
        if (!bestInt || zi > bestInt.z + 1e-7) {
          bestInt = { x: xi, y: yi, z: zi, nodeId: id };
          node.status = "incumbent";
        }
        return;
      }
      node.status = "branched";
      var fx = Math.abs(lp.x - Math.round(lp.x));
      var fy = Math.abs(lp.y - Math.round(lp.y));
      var branchX = fx >= fy && !isInt(lp.x);
      if (branchX) {
        var fl = Math.floor(lp.x + 1e-7), cl = Math.ceil(lp.x - 1e-7);
        if (fl === cl) { fl = Math.floor(lp.x); cl = fl + 1; }
        branch(extraBounds.concat([{ name: "x≤" + fl, a1: 1, a2: 0, b: fl, op: "<=" }]), id, "x ≤ " + fl, depth + 1);
        branch(extraBounds.concat([{ name: "x≥" + cl, a1: 1, a2: 0, b: cl, op: ">=" }]), id, "x ≥ " + cl, depth + 1);
      } else {
        var fly = Math.floor(lp.y + 1e-7), cly = Math.ceil(lp.y - 1e-7);
        if (fly === cly) { fly = Math.floor(lp.y); cly = fly + 1; }
        branch(extraBounds.concat([{ name: "y≤" + fly, a1: 0, a2: 1, b: fly, op: "<=" }]), id, "y ≤ " + fly, depth + 1);
        branch(extraBounds.concat([{ name: "y≥" + cly, a1: 0, a2: 1, b: cly, op: ">=" }]), id, "y ≥ " + cly, depth + 1);
      }
    }

    branch([], null, "Root LP", 0);

    return {
      feasible: !!bestInt,
      x: bestInt ? bestInt.x : 0,
      y: bestInt ? bestInt.y : 0,
      z: bestInt ? bestInt.z : 0,
      lpX: rootLP.x,
      lpY: rootLP.y,
      lpZ: rootLP.z,
      gap: bestInt ? Math.max(0, rootLP.z - bestInt.z) : NaN,
      gapPct: bestInt && rootLP.z > 0 ? ((rootLP.z - bestInt.z) / rootLP.z) * 100 : 0,
      incumbentNodeId: bestInt ? bestInt.nodeId : -1,
      nodes: nodes,
      lattice: lattice
    };
  }

  /* ------------------------------------------------ 6. Primal <-> Dual Builder */
  function buildDual(c, constraints) {
    var cons = constraints || [];
    var dualObjTerms = cons.map(function (r, idx) {
      return { name: "u" + (idx + 1), label: r.name, coeff: r.b, op: r.op };
    });
    var dualCons = [
      {
        name: "Chairs (x)",
        coeffs: cons.map(function (r) { return r.a1; }),
        op: ">=",
        rhs: c[0]
      },
      {
        name: "Tables (y)",
        coeffs: cons.map(function (r) { return r.a2; }),
        op: ">=",
        rhs: c[1]
      }
    ];
    // If exactly 2 <= constraints, compute dual feasible polygon in (u1, u2)
    var dualPoly = [];
    var dualOpt = null;
    if (cons.length === 2 && cons[0].op === "<=" && cons[1].op === "<=") {
      var dLines = [
        { a: [cons[0].a1, cons[1].a1], b: c[0] },
        { a: [cons[0].a2, cons[1].a2], b: c[1] },
        { a: [1, 0], b: 0 },
        { a: [0, 1], b: 0 }
      ];
      var dMaxU1 = 10, dMaxU2 = 10;
      [0, 1].forEach(function (j) {
        if (dLines[j].a[0] > 1e-8) dMaxU1 = Math.max(dMaxU1, dLines[j].b / dLines[j].a[0]);
        if (dLines[j].a[1] > 1e-8) dMaxU2 = Math.max(dMaxU2, dLines[j].b / dLines[j].a[1]);
      });
      var boxU1 = dMaxU1 * 1.45, boxU2 = dMaxU2 * 1.45;
      dLines.push({ a: [1, 0], b: boxU1 });
      dLines.push({ a: [0, 1], b: boxU2 });
      var seen = {};
      for (var i = 0; i < dLines.length; i++) {
        for (var j2 = i + 1; j2 < dLines.length; j2++) {
          var det = dLines[i].a[0] * dLines[j2].a[1] - dLines[i].a[1] * dLines[j2].a[0];
          if (Math.abs(det) < 1e-11) continue;
          var u1 = (dLines[i].b * dLines[j2].a[1] - dLines[j2].b * dLines[i].a[1]) / det;
          var u2 = (dLines[i].a[0] * dLines[j2].b - dLines[j2].a[0] * dLines[i].b) / det;
          if (u1 < -1e-7 || u2 < -1e-7 || u1 > boxU1 + 1e-6 || u2 > boxU2 + 1e-6) continue;
          if (cons[0].a1 * u1 + cons[1].a1 * u2 < c[0] - 1e-6) continue;
          if (cons[0].a2 * u1 + cons[1].a2 * u2 < c[1] - 1e-6) continue;
          var ku = u1.toFixed(4) + ":" + u2.toFixed(4);
          if (!seen[ku]) { seen[ku] = 1; dualPoly.push([Math.max(0, u1), Math.max(0, u2)]); }
        }
      }
      if (dualPoly.length > 2) {
        var cx = 0, cy = 0;
        dualPoly.forEach(function (v) { cx += v[0]; cy += v[1]; });
        cx /= dualPoly.length; cy /= dualPoly.length;
        dualPoly.sort(function (p, q) { return Math.atan2(p[1] - cy, p[0] - cx) - Math.atan2(q[1] - cy, q[0] - cx); });
      }
      var primal = solve2D(c, cons);
      if (primal.feasible && !primal.unbounded) {
        dualOpt = [primal.duals[0], primal.duals[1]];
      }
    }
    return {
      objectiveTerms: dualObjTerms,
      constraints: dualCons,
      dualPoly: dualPoly,
      dualOpt: dualOpt
    };
  }

  /* ------------------------------------------------ 7. MGA (Brill 1982 / DeCarolis 2011) */
  function solveMGA(c, constraints, tolPct) {
    var base = solve2D(c, constraints);
    if (!base.feasible || base.unbounded) return { feasible: false, plans: [], poly: [] };
    var floorZ = base.z * (1 - (tolPct || 0) / 100);
    var mgaCons = constraints.concat([{ name: "MGA floor", a1: c[0], a2: c[1], b: floorZ, op: ">=" }]);
    var zone = solve2D(c, mgaCons);

    var dirs = [
      { label: "Max Chairs mix", w: [1, 0] },
      { label: "Max Tables mix", w: [0, 1] },
      { label: "Min Machine load", w: [-(constraints[0] ? constraints[0].a1 : 1), -(constraints[0] ? constraints[0].a2 : 1)] },
      { label: "Min Material use", w: [-(constraints[1] ? constraints[1].a1 : 1), -(constraints[1] ? constraints[1].a2 : 1)] }
    ];
    var plans = [], seen = {};
    // Always include optimal vertex first
    var key0 = base.x.toFixed(2) + ":" + base.y.toFixed(2);
    seen[key0] = 1;
    plans.push({
      label: "Optimal baseline",
      x: base.x, y: base.y, z: base.z,
      pctOfOpt: 100,
      machUse: constraints[0] ? constraints[0].a1 * base.x + constraints[0].a2 * base.y : 0,
      matUse: constraints[1] ? constraints[1].a1 * base.x + constraints[1].a2 * base.y : 0
    });
    dirs.forEach(function (d) {
      var res = solve2D(d.w, mgaCons);
      if (!res.feasible) return;
      var k = res.x.toFixed(2) + ":" + res.y.toFixed(2);
      var zAct = c[0] * res.x + c[1] * res.y;
      if (!seen[k]) {
        seen[k] = 1;
        plans.push({
          label: d.label,
          x: res.x, y: res.y, z: zAct,
          pctOfOpt: base.z > 0 ? (zAct / base.z) * 100 : 100,
          machUse: constraints[0] ? constraints[0].a1 * res.x + constraints[0].a2 * res.y : 0,
          matUse: constraints[1] ? constraints[1].a1 * res.x + constraints[1].a2 * res.y : 0
        });
      }
    });
    return {
      feasible: true,
      floorZ: floorZ,
      poly: zone.verts,
      plans: plans
    };
  }

  /* ------------------------------------------------ 8. Counterfactuals (Kurtz et al. 2024) */
  function solveCounterfactual(c, constraints, targetMode, targetZ) {
    var base = solve2D(c, constraints);
    if (!base.feasible || base.unbounded) return { feasible: false };

    // 1. Profit-vector counterfactual: minimum L1 change |d1 - c1| + |d2 - c2| to make a target vertex optimal
    var candidates = base.verts.filter(function (v) {
      if (targetMode === "chairs") return v[0] > 1e-4 && v[1] <= 1e-4;
      if (targetMode === "tables") return v[1] > 1e-4 && v[0] <= 1e-4;
      if (targetMode === "mixed") return v[0] > 1e-4 && v[1] > 1e-4;
      if (targetMode === "target_z") return true;
      return false;
    });

    var bestProfitCF = null;
    if (targetMode !== "target_z") {
      candidates.forEach(function (v) {
        // Min d1+ + d1- + d2+ + d2-  s.t. (c1 + d1+ - d1-) (v0 - w0) + (c2 + d2+ - d2-) (v1 - w1) >= 0, d >= 0
        // Variables: [d1+, d1-, d2+, d2-]
        var lA = [], lOps = [], lB = [];
        base.verts.forEach(function (w) {
          var dx = v[0] - w[0], dy = v[1] - w[1];
          if (Math.abs(dx) < 1e-7 && Math.abs(dy) < 1e-7) return;
          // d1*dx + d2*dy >= -(c0*dx + c1*dy)  (plus tiny margin 1e-3 so v beats w strictly if desired)
          lA.push([dx, -dx, dy, -dy]);
          lOps.push(">=");
          lB.push(-(c[0] * dx + c[1] * dy) + 0.05);
        });
        // Non-negative final profits: c0 + d1+ - d1- >= 0, c1 + d2+ - d2- >= 0
        lA.push([1, -1, 0, 0]); lOps.push(">="); lB.push(-c[0]);
        lA.push([0, 0, 1, -1]); lOps.push(">="); lB.push(-c[1]);
        var sol = solveSimplexN([1, 1, 1, 1], lA, lOps, lB, ["dp1", "dm1", "dp2", "dm2"], false, false);
        if (sol.status === "optimal") {
          var d1 = sol.x[0] - sol.x[1], d2 = sol.x[2] - sol.x[3];
          var l1 = Math.abs(d1) + Math.abs(d2);
          if (!bestProfitCF || l1 < bestProfitCF.l1) {
            bestProfitCF = {
              l1: l1,
              dc1: d1,
              dc2: d2,
              newC1: c[0] + d1,
              newC2: c[1] + d2,
              targetX: v[0],
              targetY: v[1],
              newZ: (c[0] + d1) * v[0] + (c[1] + d2) * v[1]
            };
          }
        }
      });
    }

    // 2. Capacity counterfactual: minimum sum of capacity additions to hit targetZ (default +20% if not specified)
    var goalZ = targetMode === "target_z" && targetZ > 0 ? targetZ : base.z * 1.15;
    var bestCapCF = null;
    if (goalZ > base.z + 1e-5) {
      // Vars: [x, y, d_0, d_1, ...] where d_i >= 0 adds RHS to <= constraints (or relaxes >=)
      var m = constraints.length;
      var cObj = [0, 0];
      var rA = [], rOps = [], rB = [];
      for (var i = 0; i < m; i++) {
        cObj.push(1);
        var row = [constraints[i].a1, constraints[i].a2];
        for (var j = 0; j < m; j++) {
          if (i === j) row.push(constraints[i].op === "<=" ? -1 : (constraints[i].op === ">=" ? 1 : 0));
          else row.push(0);
        }
        rA.push(row); rOps.push(constraints[i].op); rB.push(constraints[i].b);
      }
      // Profit goal row: c0 x + c1 y >= goalZ
      var goalRow = [c[0], c[1]];
      for (var j2 = 0; j2 < m; j2++) goalRow.push(0);
      rA.push(goalRow); rOps.push(">="); rB.push(goalZ);

      var capSol = solveSimplexN(cObj, rA, rOps, rB, null, false, false);
      if (capSol.status === "optimal") {
        var deltas = [];
        for (var i2 = 0; i2 < m; i2++) {
          if (capSol.x[2 + i2] > 1e-5) {
            deltas.push({ name: constraints[i2].name, delta: capSol.x[2 + i2], newRhs: constraints[i2].b + capSol.x[2 + i2] });
          }
        }
        bestCapCF = {
          goalZ: goalZ,
          x: capSol.x[0],
          y: capSol.x[1],
          totalAdd: capSol.z,
          deltas: deltas
        };
      }
    }

    return {
      feasible: true,
      baseZ: base.z,
      currentRegime: (base.x > 1e-4 && base.y > 1e-4) ? "mixed" : (base.x > 1e-4 ? "chairs" : "tables"),
      profitCF: bestProfitCF,
      capacityCF: bestCapCF
    };
  }

  /* ------------------------------------------------ 9. Bertsimas & Sim (2004) Robust LP */
  function solveRobust2D(c, P, extraCons, uncPct, gamma) {
    var eps = Math.max(0, Math.min(0.45, (uncPct || 0) / 100));
    var g = Math.max(0, Math.min(2, gamma || 0));

    function solveAtGamma(gam) {
      // Vars: [x, y, z1, p11, p12, z2, p21, p22] (8 vars)
      // Constraint 1 (Machine): mc*x + mt*y + gam*z1 + p11 + p12 <= H
      //   z1 + p11 >= (eps*mc)*x  => -eps*mc*x + z1 + p11 >= 0
      //   z1 + p12 >= (eps*mt)*y  => -eps*mt*y + z1 + p12 >= 0
      // Constraint 2 (Material): kc*x + kt*y + gam*z2 + p21 + p22 <= M
      //   z2 + p21 >= (eps*kc)*x
      //   z2 + p22 >= (eps*kt)*y
      var A = [
        [P.mc, P.mt, gam, 1, 1, 0, 0, 0],
        [-eps * P.mc, 0, 1, 1, 0, 0, 0, 0],
        [0, -eps * P.mt, 1, 0, 1, 0, 0, 0],
        [P.kc, P.kt, 0, 0, 0, gam, 1, 1],
        [-eps * P.kc, 0, 0, 0, 0, 1, 1, 0],
        [0, -eps * P.kt, 0, 0, 0, 1, 0, 1]
      ];
      var ops = ["<=", ">=", ">=", "<=", ">=", ">="];
      var b = [P.H, 0, 0, P.M, 0, 0];
      (extraCons || []).forEach(function (ec) {
        A.push([ec.a1, ec.a2, 0, 0, 0, 0, 0, 0]);
        ops.push(ec.op);
        b.push(ec.b);
      });
      var sol = solveSimplexN([c[0], c[1], 0, 0, 0, 0, 0, 0], A, ops, b, null, true, false);
      // Bertsimas & Sim (2004) Theorem 2 bound for n=2 symmetric deviations: exp(-gamma^2 / (2n))
      var violationBound = Math.exp(-(gam * gam) / 4);
      return {
        gamma: gam,
        feasible: sol.status === "optimal",
        x: sol.x ? sol.x[0] : 0,
        y: sol.x ? sol.x[1] : 0,
        z: sol.status === "optimal" ? sol.z : 0,
        violationBoundPct: Math.min(100, violationBound * 100)
      };
    }

    var nominal = solveAtGamma(0);
    var current = solveAtGamma(g);
    var curve = [];
    for (var step = 0; step <= 8; step++) {
      var gm = step * 0.25;
      curve.push(solveAtGamma(gm));
    }

    // Worst-case machine/material load if nominal plan hits full uncertainty (eps)
    var nomWorstH = (1 + eps) * (P.mc * nominal.x + P.mt * nominal.y);
    var nomWorstM = (1 + eps) * (P.kc * nominal.x + P.kt * nominal.y);

    return {
      nominal: nominal,
      current: current,
      priceOfRobustness: nominal.z - current.z,
      pricePct: nominal.z > 0 ? ((nominal.z - current.z) / nominal.z) * 100 : 0,
      nominalOverrunH: Math.max(0, nomWorstH - P.H),
      nominalOverrunM: Math.max(0, nomWorstM - P.M),
      curve: curve
    };
  }

  /* ------------------------------------------------ 10. Inverse Optimization (Ahuja & Orlin 2001) */
  function solveInverse2D(c, constraints, x0, y0) {
    var base = solve2D(c, constraints);
    if (!base.feasible || base.unbounded) return { feasible: false };

    // Check feasibility of (x0, y0)
    for (var i = 0; i < constraints.length; i++) {
      var r = constraints[i];
      var lhs = r.a1 * x0 + r.a2 * y0;
      if (r.op === "<=" && lhs > r.b + 1e-5) return { feasible: false, reason: "Point is outside feasible region." };
      if (r.op === ">=" && lhs < r.b - 1e-5) return { feasible: false, reason: "Point violates minimum constraint." };
      if (r.op === "=" && Math.abs(lhs - r.b) > 1e-5) return { feasible: false, reason: "Point violates equality constraint." };
    }
    if (x0 < -1e-6 || y0 < -1e-6) return { feasible: false, reason: "Quantities must be non-negative." };

    // Check if strictly interior (no constraints binding and x0 > 0, y0 > 0)
    var anyBinding = constraints.some(function (r) {
      return Math.abs(r.a1 * x0 + r.a2 * y0 - r.b) < 1e-4;
    });
    if (!anyBinding && x0 > 1e-4 && y0 > 1e-4) {
      return {
        feasible: true,
        interior: true,
        d1: 0, d2: 0,
        dc1: -c[0], dc2: -c[1],
        l1: Math.abs(c[0]) + Math.abs(c[1]),
        note: "Strict interior point: no constraint binds, so only zero unit profits (0, 0) make it optimal."
      };
    }

    // Min L1 distance |d1 - c1| + |d2 - c2| s.t. d·(x0,y0) >= d·w for all vertices w, d >= 0
    var lA = [], lOps = [], lB = [];
    base.verts.forEach(function (w) {
      var dx = x0 - w[0], dy = y0 - w[1];
      if (Math.abs(dx) < 1e-7 && Math.abs(dy) < 1e-7) return;
      lA.push([dx, -dx, dy, -dy]);
      lOps.push(">=");
      lB.push(-(c[0] * dx + c[1] * dy));
    });
    lA.push([1, -1, 0, 0]); lOps.push(">="); lB.push(-c[0]);
    lA.push([0, 0, 1, -1]); lOps.push(">="); lB.push(-c[1]);

    var sol = solveSimplexN([1, 1, 1, 1], lA, lOps, lB, null, false, false);
    if (sol.status !== "optimal") return { feasible: false, reason: "Could not rationalize point." };
    var dc1 = sol.x[0] - sol.x[1], dc2 = sol.x[2] - sol.x[3];
    return {
      feasible: true,
      interior: false,
      d1: c[0] + dc1,
      d2: c[1] + dc2,
      dc1: dc1,
      dc2: dc2,
      l1: Math.abs(dc1) + Math.abs(dc2),
      impliedZ: (c[0] + dc1) * x0 + (c[1] + dc2) * y0
    };
  }

  /* ------------------------------------------------ 11. Multi-Objective Pareto (epsilon-constraint) */
  function solvePareto(c, eObj, constraints, steps) {
    steps = steps || 18;
    var optZ = solve2D(c, constraints);
    var minE = solve2D([-eObj[0], -eObj[1]], constraints);
    if (!optZ.feasible || optZ.unbounded || !minE.feasible) return { feasible: false, points: [] };

    var eAtOpt = eObj[0] * optZ.x + eObj[1] * optZ.y;
    var eMin = eObj[0] * minE.x + eObj[1] * minE.y;
    var pts = [], seen = {};

    for (var s = 0; s <= steps; s++) {
      var eps = eMin + (eAtOpt - eMin) * (s / steps);
      var pCons = constraints.concat([{ name: "Impact cap", a1: eObj[0], a2: eObj[1], b: eps, op: "<=" }]);
      var res = solve2D(c, pCons);
      if (!res.feasible) continue;
      var eAct = eObj[0] * res.x + eObj[1] * res.y;
      var k = res.x.toFixed(3) + ":" + res.y.toFixed(3);
      if (!seen[k]) {
        seen[k] = 1;
        pts.push({ x: res.x, y: res.y, profit: res.z, impact: eAct });
      }
    }
    // Filter strictly to non-dominated points sorted by impact ascending
    pts.sort(function (a, b) { return a.impact - b.impact || b.profit - a.profit; });
    var pareto = [];
    var maxProfSoFar = -Infinity;
    pts.forEach(function (pt) {
      if (pt.profit > maxProfSoFar + 1e-6) {
        maxProfSoFar = pt.profit;
        pareto.push(pt);
      }
    });
    return { feasible: true, points: pareto, eMin: eMin, eMax: eAtOpt };
  }

  /* ------------------------------------------------ 12. Parametric Breakpoint Curves */
  function parametricCurve(P, extraCons, key) {
    var cur = P[key];
    var lo = key === "H" || key === "M" ? Math.max(10, cur * 0.25) : Math.max(5, cur * 0.25);
    var hi = key === "H" || key === "M" ? Math.max(250, cur * 2.0) : Math.max(150, cur * 2.2);
    var steps = 36;
    var pts = [];
    var prevBasis = null;
    var breaks = [];
    for (var i = 0; i <= steps; i++) {
      var v = lo + (hi - lo) * (i / steps);
      var q = Object.assign({}, P);
      q[key] = v;
      var cons = [
        { name: "Machine", a1: q.mc, a2: q.mt, b: q.H, op: "<=" },
        { name: "Material", a1: q.kc, a2: q.kt, b: q.M, op: "<=" }
      ].concat(extraCons || []);
      var res = solve2D([q.pc, q.pt], cons);
      if (!res.feasible || res.unbounded) continue;
      var bk = res.binding.map(function (b) { return b ? 1 : 0; }).join("") + ":" + (res.x > 1e-4 ? 1 : 0) + (res.y > 1e-4 ? 1 : 0);
      if (prevBasis && bk !== prevBasis && pts.length) {
        breaks.push({ val: (pts[pts.length - 1].val + v) / 2, z: (pts[pts.length - 1].z + res.z) / 2 });
      }
      prevBasis = bk;
      pts.push({ val: v, z: res.z, x: res.x, y: res.y, u1: res.u1, u2: res.u2 });
    }
    return { key: key, current: cur, points: pts, breaks: breaks };
  }

  /* ------------------------------------------------ 13. Capacity Make-or-Buy ROI Optimizer */
  function solveCapacityROI(c, P, extraCons, costH, costM, budget) {
    // Vars: [x, y, dH, dM]
    // max c0*x + c1*y - costH*dH - costM*dM
    // s.t. mc*x + mt*y - dH <= H
    //      kc*x + kt*y - dM <= M
    //      costH*dH + costM*dM <= budget
    var base = solve2D(c, [
      { name: "Machine", a1: P.mc, a2: P.mt, b: P.H, op: "<=" },
      { name: "Material", a1: P.kc, a2: P.kt, b: P.M, op: "<=" }
    ].concat(extraCons || []));
    if (!base.feasible || base.unbounded) return { feasible: false };

    var obj = [c[0], c[1], -costH, -costM];
    var A = [
      [P.mc, P.mt, -1, 0],
      [P.kc, P.kt, 0, -1],
      [0, 0, costH, costM]
    ];
    var ops = ["<=", "<=", "<="];
    var b = [P.H, P.M, Math.max(0, budget)];
    (extraCons || []).forEach(function (ec) {
      A.push([ec.a1, ec.a2, 0, 0]);
      ops.push(ec.op);
      b.push(ec.b);
    });
    var sol = solveSimplexN(obj, A, ops, b, ["x", "y", "dH", "dM"], true, false);
    if (sol.status !== "optimal") return { feasible: false };
    var dH = sol.x[2], dM = sol.x[3];
    var spend = costH * dH + costM * dM;
    var grossZ = c[0] * sol.x[0] + c[1] * sol.x[1];
    return {
      feasible: true,
      baseZ: base.z,
      x: sol.x[0],
      y: sol.x[1],
      dH: dH,
      dM: dM,
      spend: spend,
      grossProfit: grossZ,
      netProfit: sol.z,
      netGain: sol.z - base.z
    };
  }

  /* ------------------------------------------------ 14. Two-Stage Stochastic Analysis (EVPI & VSS) */
  function stochasticMetrics(scenRows, penaltyRate) {
    if (!scenRows || !scenRows.length) return null;
    var pen = penaltyRate === undefined ? 0.25 : Math.max(0.01, Math.min(1, penaltyRate));
    var n = scenRows.length;
    var sums = [0, 0, 0, 0, 0, 0, 0, 0];
    var wsSum = 0;
    var maxX = 0, maxY = 0;
    for (var i = 0; i < n; i++) {
      var r = scenRows[i];
      for (var k = 0; k < 8; k++) sums[k] += r[1 + k];
      wsSum += r[11];
      if (r[9] > maxX) maxX = r[9];
      if (r[10] > maxY) maxY = r[10];
    }
    var meanP = sums.map(function (s) { return s / n; });
    var evPlan = solve2D([meanP[0], meanP[1]], [
      { name: "Machine", a1: meanP[2], a2: meanP[3], b: meanP[6], op: "<=" },
      { name: "Material", a1: meanP[4], a2: meanP[5], b: meanP[7], op: "<=" }
    ]);

    function evalPlanAcrossScenarios(commX, commY) {
      // Fast inline 2D 4-constraint vertex solver for zero-lag 300-scenario stochastic evaluation
      var tot = 0;
      for (var s = 0; s < n; s++) {
        var r = scenRows[s];
        var pc = r[1], pt = r[2], mc = r[3], mt = r[4], kc = r[5], kt = r[6], Hs = r[7], Ms = r[8];
        var bestZ = 0, bestX = 0, bestY = 0;
        var pts = [[0, 0]];
        if (mc > 0) pts.push([Math.min(commX, Hs / mc), 0]);
        if (mt > 0) pts.push([0, Math.min(commY, Hs / mt)]);
        if (kc > 0) pts.push([Math.min(commX, Ms / kc), 0]);
        if (kt > 0) pts.push([0, Math.min(commY, Ms / kt)]);
        pts.push([commX, commY]);
        if (mt > 0) pts.push([commX, (Hs - mc * commX) / mt]);
        if (kt > 0) pts.push([commX, (Ms - kc * commX) / kt]);
        if (mc > 0) pts.push([(Hs - mt * commY) / mc, commY]);
        if (kc > 0) pts.push([(Ms - kt * commY) / kc, commY]);
        var det = mc * kt - mt * kc;
        if (Math.abs(det) > 1e-10) {
          pts.push([(Hs * kt - Ms * mt) / det, (mc * Ms - kc * Hs) / det]);
        }
        for (var pi = 0; pi < pts.length; pi++) {
          var px = pts[pi][0], py = pts[pi][1];
          if (px < -1e-7 || py < -1e-7 || px > commX + 1e-6 || py > commY + 1e-6) continue;
          if (mc * px + mt * py > Hs + 1e-6 || kc * px + kt * py > Ms + 1e-6) continue;
          var pz = pc * px + pt * py;
          if (pz > bestZ) { bestZ = pz; bestX = px; bestY = py; }
        }
        var shortPen = pen * (pc * Math.max(0, commX - bestX) + pt * Math.max(0, commY - bestY));
        tot += bestZ - shortPen;
      }
      return tot / n;
    }

    var ws = wsSum / n;
    var eev = evalPlanAcrossScenarios(evPlan.x, evPlan.y);

    // Sample-average search for Here-and-Now Stochastic Plan (X*, Y*) over coarse + refined 2D grid
    var bestRP = { z: eev, x: evPlan.x, y: evPlan.y };
    var stepX = Math.max(5, Math.round(maxX / 8)), stepY = Math.max(5, Math.round(maxY / 8));
    for (var cx = 0; cx <= maxX; cx += stepX) {
      for (var cy = 0; cy <= maxY; cy += stepY) {
        var v = evalPlanAcrossScenarios(cx, cy);
        if (v > bestRP.z) bestRP = { z: v, x: cx, y: cy };
      }
    }
    // Fine local refinement around best coarse point
    for (var dx = -stepX; dx <= stepX; dx += Math.max(2, Math.round(stepX / 4))) {
      for (var dy = -stepY; dy <= stepY; dy += Math.max(2, Math.round(stepY / 4))) {
        var fx = Math.max(0, bestRP.x + dx), fy = Math.max(0, bestRP.y + dy);
        var vf = evalPlanAcrossScenarios(fx, fy);
        if (vf > bestRP.z) bestRP = { z: vf, x: fx, y: fy };
      }
    }

    return {
      n: n,
      ws: ws,
      evPlan: { x: evPlan.x, y: evPlan.y, evZ: evPlan.z },
      eev: eev,
      rp: bestRP.z,
      rpPlan: { x: bestRP.x, y: bestRP.y },
      evpi: Math.max(0, ws - bestRP.z),
      vss: Math.max(0, bestRP.z - eev)
    };
  }

  /* ------------------------------------------------ 15. SPO+ Decision Regret Benchmark */
  function spoBenchmark(P, extraCons, noisePct, trials) {
    trials = trials || 40;
    var sigma = (noisePct || 20) / 100;
    var cons = [
      { name: "Machine", a1: P.mc, a2: P.mt, b: P.H, op: "<=" },
      { name: "Material", a1: P.kc, a2: P.kt, b: P.M, op: "<=" }
    ].concat(extraCons || []);
    var truth = solve2D([P.pc, P.pt], cons);
    if (!truth.feasible || truth.unbounded) return null;

    var predErrs = [], regrets = [], zeroRegretCount = 0;
    // Deterministic seeded LCG so benchmark is reproducible for a given parameter set
    var seed = Math.round(P.pc * 13 + P.pt * 29 + P.H * 7 + P.M * 11 + noisePct * 31) % 2147483647 || 12345;
    function rand() { seed = (seed * 48271) % 2147483647; return (seed - 1) / 2147483646; }

    var samples = [];
    for (var i = 0; i < trials; i++) {
      var u1 = (rand() * 2 - 1) * sigma;
      var u2 = (rand() * 2 - 1) * sigma;
      var cHat = [Math.max(1, P.pc * (1 + u1)), Math.max(1, P.pt * (1 + u2))];
      var predMape = (Math.abs(cHat[0] - P.pc) / Math.max(1, P.pc) + Math.abs(cHat[1] - P.pt) / Math.max(1, P.pt)) * 50;
      var dec = solve2D(cHat, cons);
      var realizedZ = P.pc * dec.x + P.pt * dec.y;
      var regret = Math.max(0, truth.z - realizedZ);
      var regretPct = truth.z > 0 ? (regret / truth.z) * 100 : 0;
      if (regret < 1e-4) zeroRegretCount++;
      predErrs.push(predMape);
      regrets.push(regretPct);
      samples.push({ predMape: predMape, regret: regret, regretPct: regretPct, c1: cHat[0], c2: cHat[1], x: dec.x, y: dec.y });
    }
    var avgPredErr = predErrs.reduce(function (a, b) { return a + b; }, 0) / trials;
    var avgRegretPct = regrets.reduce(function (a, b) { return a + b; }, 0) / trials;
    var maxRegretPct = Math.max.apply(null, regrets);
    return {
      trials: trials,
      avgPredErr: avgPredErr,
      avgRegretPct: avgRegretPct,
      maxRegretPct: maxRegretPct,
      zeroRegretRate: (zeroRegretCount / trials) * 100,
      samples: samples
    };
  }

  /* ------------------------------------------------ 16. Batch CSV Parser & Re-Solver */
  function parseAndSolveCSV(csvText) {
    var lines = csvText.trim().split(/\r?\n/).filter(function (l) { return l.trim().length > 0; });
    if (lines.length < 2) return { error: "CSV needs a header row and at least one data row." };
    var headers = lines[0].split(",").map(function (h) { return h.trim().replace(/^"|"$/g, ""); });

    function idxOf(candidates) {
      for (var i = 0; i < candidates.length; i++) {
        var idx = headers.indexOf(candidates[i]);
        if (idx !== -1) return idx;
        var low = candidates[i].toLowerCase();
        for (var j = 0; j < headers.length; j++) {
          if (headers[j].toLowerCase() === low) return j;
        }
      }
      return -1;
    }

    var map = {
      id: idxOf(["Scenario_ID", "id", "ID"]),
      pc: idxOf(["Chair_Profit_INR", "pc", "chair_profit"]),
      pt: idxOf(["Table_Profit_INR", "pt", "table_profit"]),
      mc: idxOf(["Chair_Machine_Hours", "mc", "chair_machine_hours"]),
      mt: idxOf(["Table_Machine_Hours", "mt", "table_machine_hours"]),
      kc: idxOf(["Chair_Material_Kg", "kc", "chair_material_kg"]),
      kt: idxOf(["Table_Material_Kg", "kt", "table_material_kg"]),
      H: idxOf(["Available_Machine_Hours", "H", "machine_hours"]),
      M: idxOf(["Available_Material_Kg", "M", "material_kg"]),
      recZ: idxOf(["Maximum_Profit_INR", "profit_inr", "z"])
    };

    var required = ["pc", "pt", "mc", "mt", "kc", "kt", "H", "M"];
    var missing = required.filter(function (k) { return map[k] === -1; });
    if (missing.length) {
      return { error: "Missing columns: " + missing.join(", ") + ". Expected Factory LP schema (or pc,pt,mc,mt,kc,kt,H,M)." };
    }

    var results = [], bindMach = 0, bindMat = 0, sumU1 = 0, sumU2 = 0, altCount = 0, exactMatches = 0;
    for (var r = 1; r < lines.length; r++) {
      var cols = lines[r].split(",").map(function (v) { return v.trim().replace(/^"|"$/g, ""); });
      var val = function (k) { return parseFloat(cols[map[k]]); };
      var rowP = { pc: val("pc"), pt: val("pt"), mc: val("mc"), mt: val("mt"), kc: val("kc"), kt: val("kt"), H: val("H"), M: val("M") };
      if (required.some(function (k) { return isNaN(rowP[k]); })) continue;

      var sol = solve2D([rowP.pc, rowP.pt], [
        { name: "Machine", a1: rowP.mc, a2: rowP.mt, b: rowP.H, op: "<=" },
        { name: "Material", a1: rowP.kc, a2: rowP.kt, b: rowP.M, op: "<=" }
      ]);
      if (sol.feasible && !sol.unbounded) {
        if (sol.binding[0]) bindMach++;
        if (sol.binding[1]) bindMat++;
        sumU1 += sol.u1;
        sumU2 += sol.u2;
        if (sol.hasAltOptima) altCount++;
      }
      var recZ = map.recZ !== -1 ? parseFloat(cols[map.recZ]) : NaN;
      if (!isNaN(recZ) && Math.abs(recZ - sol.z) < 0.05) exactMatches++;

      results.push({
        id: map.id !== -1 ? cols[map.id] : ("ROW-" + r),
        p: rowP,
        x: sol.x, y: sol.y, z: sol.z,
        u1: sol.u1, u2: sol.u2,
        bindMach: sol.binding ? sol.binding[0] : false,
        bindMat: sol.binding ? sol.binding[1] : false,
        hasAlt: !!sol.hasAltOptima,
        recZ: recZ
      });
    }

    var count = results.length;
    return {
      count: count,
      bindMachPct: count ? (bindMach / count) * 100 : 0,
      bindMatPct: count ? (bindMat / count) * 100 : 0,
      avgU1: count ? sumU1 / count : 0,
      avgU2: count ? sumU2 / count : 0,
      altCount: altCount,
      hasRecorded: map.recZ !== -1,
      exactMatches: exactMatches,
      rows: results
    };
  }

  return {
    toFrac: toFrac,
    fmtVal: fmtVal,
    solveSimplexN: solveSimplexN,
    solve2D: solve2D,
    solveILP2D: solveILP2D,
    buildDual: buildDual,
    solveMGA: solveMGA,
    solveCounterfactual: solveCounterfactual,
    solveRobust2D: solveRobust2D,
    solveInverse2D: solveInverse2D,
    solvePareto: solvePareto,
    parametricCurve: parametricCurve,
    solveCapacityROI: solveCapacityROI,
    stochasticMetrics: stochasticMetrics,
    spoBenchmark: spoBenchmark,
    parseAndSolveCSV: parseAndSolveCSV
  };
});
