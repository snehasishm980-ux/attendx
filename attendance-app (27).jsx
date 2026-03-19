import { useState, useEffect } from "react";
// SheetJS loaded via CDN script tag in index.html or inline via useEffect
// We'll use a dynamic import pattern for the browser

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const NATIONAL_HOLIDAYS_2025 = [
  "2025-01-01","2025-01-14","2025-01-26","2025-03-14","2025-04-10",
  "2025-04-14","2025-04-18","2025-05-12","2025-08-15","2025-10-02",
  "2025-10-20","2025-10-23","2025-11-01","2025-11-15","2025-12-25"
];
// ── EXCEL EXPORT ─────────────────────────────────────────────────────────────
// Download window: 1st–10th of each month
function isInDownloadWindow() {
  return new Date().getDate() <= 10;
}

async function loadXLSX() {
  // Dynamically load SheetJS from CDN if not already available
  if (window.XLSX) return window.XLSX;
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload = () => resolve(window.XLSX);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function exportBranchesExcel(employees, branches, otConfig, empOTOverrides, latePolicy, bonusTypes, selMonth, selYear) {
  const XLSX = await loadXLSX();
  const wb = XLSX.utils.book_new();
  const now = new Date();
  const MONTHS_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  // selMonth is 0-based index; selYear is 4-digit year
  const salMon = MONTHS[selMonth];
  const salMonFull = MONTHS_FULL[selMonth];
  const salYr = selYear;
  // OT period for selected month: 16th of (selMonth-1) → 15th of selMonth
  const pad = n=>String(n).padStart(2,"0");
  const prevMonthDate = new Date(selYear, selMonth-1, 16);
  const curMonthDate  = new Date(selYear, selMonth,   15);
  const otStart = `${prevMonthDate.getFullYear()}-${pad(prevMonthDate.getMonth()+1)}-16`;
  const otEnd   = `${selYear}-${pad(selMonth+1)}-15`;
  const inSelOTPeriod = d => d >= otStart && d <= otEnd;
  const selMonKey = `${selYear}-${pad(selMonth+1)}`;
  const period = `${prevMonthDate.toLocaleDateString("en-IN",{day:"2-digit",month:"short"})} – ${curMonthDate.toLocaleDateString("en-IN",{day:"2-digit",month:"short"})}`;
  const payMon = MONTHS_FULL[(selMonth+1)%12];
  const payYr  = selMonth===11 ? selYear+1 : selYear;
  const payStr = `1st week of ${payMon} ${payYr}`;

  // ── Summary sheet ─────────────────────────────────────────────────────────
  const summaryRows = [
    ["AttendX Monthly Report", `${salMon} ${salYr}`, "", "OT Period:", period],
    ["Generated on:", now.toLocaleDateString("en-IN"), "", "Paid in:", payStr],
    [],
    ["Branch", "Active Staff", "Total OT Hours", "Total OT Cost (₹)", "Total Deductions (₹)", "Total Bonuses (₹)", "Total Net Payable (₹)"],
  ];
  branches.forEach(b => {
    const brEmp = employees.filter(e=>e.active&&e.branch===b);
    let otH=0,otC=0,ded=0,bon=0,net=0;
    brEmp.forEach(e=>{
      const pr = calcPayroll(e,otConfig,empOTOverrides,latePolicy);
      otH+=pr.otEarnings/(calcHourlyRate(e.salary||0)||1); // approx
      otC+=pr.otEarnings; ded+=pr.totalDeductions; bon+=pr.bonuses; net+=pr.netSalary;
    });
    // recalc ot hours properly
    const otHrs = brEmp.reduce((s,e)=>(e.overtime||[]).filter(o=>o.status==="approved"&&inOTPeriod(o.date)).reduce((ss,o)=>ss+(o.hours||0),s),0);
    summaryRows.push([b, brEmp.length, +otHrs.toFixed(1), +otC.toFixed(0), +ded.toFixed(0), +bon.toFixed(0), +net.toFixed(0)]);
  });
  // Totals row
  const dataRows = summaryRows.slice(4);
  summaryRows.push([
    "TOTAL",
    `=SUM(B5:B${4+dataRows.length})`,
    `=SUM(C5:C${4+dataRows.length})`,
    `=SUM(D5:D${4+dataRows.length})`,
    `=SUM(E5:E${4+dataRows.length})`,
    `=SUM(F5:F${4+dataRows.length})`,
    `=SUM(G5:G${4+dataRows.length})`,
  ]);
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = [{wch:22},{wch:13},{wch:16},{wch:18},{wch:20},{wch:18},{wch:20}];
  XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");

  // ── Per-branch sheets ─────────────────────────────────────────────────────
  branches.forEach(branch => {
    const brEmp = employees.filter(e=>e.active&&e.branch===branch);
    const rows = [
      [`Branch: ${branch}`, "", `Report: ${salMon} ${salYr}`, "", `OT Period: ${period}`],
      [],
      ["Emp ID","Name","Designation","Salary (₹)","Base (₹)","OT Hours","OT Earn (₹)",
       "Bonuses (₹)","Late Ded (₹)","Early Ded (₹)","Unpaid Ded (₹)","Half-Day Ded (₹)",
       "Total Ded (₹)","Net Pay (₹)","Paid Leaves Left","Medical Left"],
    ];
    brEmp.forEach(e => {
      const pr = calcPayroll(e, otConfig, empOTOverrides, latePolicy);
      const otH = (e.overtime||[]).filter(o=>o.status==="approved"&&inOTPeriod(o.date)).reduce((s,o)=>s+(o.hours||0),0);
      rows.push([
        e.id, e.name, e.designation,
        e.salary||0,
        +pr.baseSalary.toFixed(0),
        +otH.toFixed(1),
        +pr.otEarnings.toFixed(0),
        +pr.bonuses.toFixed(0),
        +pr.lateDeductions.toFixed(0),
        +pr.earlyDeductions.toFixed(0),
        +pr.unpaidDeductions.toFixed(0),
        +pr.halfDayDeductions.toFixed(0),
        +pr.totalDeductions.toFixed(0),
        +pr.netSalary.toFixed(0),
        e.paidLeaveBalance||0,
        e.medicalLeaveBalance||0,
      ]);
    });
    // Totals
    const dataStart = 4, dataEnd = 3 + brEmp.length;
    if (brEmp.length > 0) {
      rows.push([
        "","TOTAL","","",
        `=SUM(E${dataStart}:E${dataEnd})`,
        `=SUM(F${dataStart}:F${dataEnd})`,
        `=SUM(G${dataStart}:G${dataEnd})`,
        `=SUM(H${dataStart}:H${dataEnd})`,
        `=SUM(I${dataStart}:I${dataEnd})`,
        `=SUM(J${dataStart}:J${dataEnd})`,
        `=SUM(K${dataStart}:K${dataEnd})`,
        `=SUM(L${dataStart}:L${dataEnd})`,
        `=SUM(M${dataStart}:M${dataEnd})`,
        `=SUM(N${dataStart}:N${dataEnd})`,
        "","",
      ]);
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{wch:10},{wch:20},{wch:22},{wch:12},{wch:12},{wch:10},{wch:12},{wch:12},{wch:12},{wch:12},{wch:12},{wch:13},{wch:12},{wch:12},{wch:14},{wch:12}];
    // Safe sheet name (max 31 chars, no special chars)
    const safeName = branch.replace(/[:\/?*\[\]]/g,"").substring(0,31);
    XLSX.utils.book_append_sheet(wb, ws, safeName);
  });

  // ── Attendance sheet (all branches) ──────────────────────────────────────
  const attRows = [
    [`Attendance Log — ${salMon} ${salYr}`],
    [],
    ["Date","Emp ID","Name","Branch","Designation","Check-In","Check-Out","Duration (h)","Location","Holiday","Status"],
  ];
  employees.filter(e=>e.active).forEach(e=>{
    (e.attendance||[]).filter(a=>a.date.startsWith(selMonKey)).forEach(a=>{
      const durH = a.checkIn&&a.checkOut ? +(durMins(a.checkIn,a.checkOut)/60).toFixed(2) : "";
      attRows.push([
        a.date, e.id, e.name, e.branch, e.designation,
        a.checkIn ? fmtT(a.checkIn) : "",
        a.checkOut ? fmtT(a.checkOut) : "",
        durH,
        a.location||"",
        a.isHoliday?"Yes":"",
        a.attStatus||"approved",
      ]);
    });
  });
  const wsAtt = XLSX.utils.aoa_to_sheet(attRows);
  wsAtt['!cols'] = [{wch:12},{wch:10},{wch:20},{wch:16},{wch:24},{wch:10},{wch:10},{wch:12},{wch:28},{wch:8},{wch:10}];
  XLSX.utils.book_append_sheet(wb, wsAtt, "Attendance");

  // ── OT sheet ──────────────────────────────────────────────────────────────
  const otRows = [
    [`OT Records — Period: ${period}`],
    [],
    ["Date","Emp ID","Name","Branch","Designation","Start","End","Hours","Rate (%)","Cost (₹)","Type","Status"],
  ];
  employees.filter(e=>e.active).forEach(e=>{
    (e.overtime||[]).forEach(o=>{
      otRows.push([o.date,e.id,e.name,e.branch,e.designation,o.startTime,o.endTime,o.hours,+(o.rate*100).toFixed(0),+(o.cost||0).toFixed(0),o.otType||"regular",o.status]);
    });
  });
  const wsOT = XLSX.utils.aoa_to_sheet(otRows);
  wsOT['!cols'] = [{wch:12},{wch:10},{wch:20},{wch:16},{wch:24},{wch:8},{wch:8},{wch:8},{wch:8},{wch:12},{wch:10},{wch:10}];
  XLSX.utils.book_append_sheet(wb, wsOT, "Overtime");

  // ── Write & download ──────────────────────────────────────────────────────
  const fileName = `AttendX_${salMon}${salYr}_${now.toISOString().split("T")[0]}.xlsx`;
  // payStr already computed above
  XLSX.writeFile(wb, fileName);
  return fileName;
}

// ── END EXCEL EXPORT ──────────────────────────────────────────────────────────

// Designations are managed by HR via state (useLS). This is just the seed list.
const DEFAULT_DESIGNATIONS = [
  {name:"Medical Support Interpreter", canApprove:false, autoApprove:false, autoApproveManual:false},
  {name:"Supervisor",      canApprove:true,  autoApprove:true,  autoApproveManual:true},
  {name:"Manager",         canApprove:true,  autoApprove:true,  autoApproveManual:true},
];
const INITIAL_BRANCHES = ["Delhi HQ","Mumbai","Bangalore","Chennai","Hyderabad","Kolkata"];
const INITIAL_EMPLOYEES = [
  { id:"EMP001", name:"Priya Sharma", designation:"Manager", branch:"Delhi HQ",
    username:"priya.sharma", password:"Pass@123", salary:120000,
    paidLeaveBalance:14, medicalLeaveBalance:7, weekOffsUsed:0,
    hireDate:"2022-03-15", active:true,
    attendance:[], leaves:[], overtime:[], weekOffRequests:[] },
  { id:"EMP002", name:"Rahul Gupta", designation:"Supervisor", branch:"Mumbai",
    username:"rahul.gupta", password:"Pass@456", salary:85000,
    paidLeaveBalance:14, medicalLeaveBalance:7, weekOffsUsed:0,
    hireDate:"2023-01-10", active:true,
    attendance:[], leaves:[], overtime:[], weekOffRequests:[] },
  { id:"EMP003", name:"Anjali Singh", designation:"Medical Support Interpreter", branch:"Delhi HQ",
    username:"anjali.singh", password:"Pass@789", salary:45000,
    paidLeaveBalance:11, medicalLeaveBalance:5, weekOffsUsed:2,
    hireDate:"2023-06-01", active:true,
    attendance:[], leaves:[], overtime:[], weekOffRequests:[] },
];

// OT: base hourly = salary × 0.005 (0.5% of monthly salary = 1 hour pay)
function calcHourlyRate(salary) { return (salary||0) * 0.005; }
function calcOTRate(date, startTime, otConfig, override) {
  const cfg = override || otConfig || {};
  const nightHolPct = (cfg.nightHolidayPct != null ? cfg.nightHolidayPct : 130) / 100;
  const regularPct  = (cfg.regularPct      != null ? cfg.regularPct      : 100) / 100;
  const h = parseInt((startTime||"09:00").split(":")[0]);
  return (isHolidayGlobal(date) || h >= 22 || h < 5) ? nightHolPct : regularPct;
}
function calcOTCost(salary, hours, rate) { return calcHourlyRate(salary) * hours * rate; }

// OT blocks: 30-min blocks measured from start time.
// The minutes already elapsed in the starting block are subtracted first (you didn't
// work from the block's beginning). Then floor into 30-min blocks; a partial block
// at the end only counts if it is ≥ 16 mins.
// Examples: 17:00→17:15 = 0h · 17:00→17:16 = 0.5h · 17:00→17:46 = 1h
//           17:46→19:47 = 1.5h (14 min wasted at start) · 17:45→19:47 = 2h (15 min wasted)
function calcOTBlocks(startTime, endTime) {
  if (!startTime || !endTime) return 0;
  const [sh,sm] = startTime.split(":").map(Number);
  const [eh,em] = endTime.split(":").map(Number);
  let rawMins = (eh*60+em) - (sh*60+sm);
  if (rawMins < 0) rawMins += 1440; // overnight
  // Subtract the partial minutes already elapsed in the starting 30-min block
  const wasted = (sh*60+sm) % 30;
  const effective = rawMins - wasted;
  if (effective <= 0) return 0;
  const fullBlocks = Math.floor(effective / 30);
  const remainder  = effective % 30;
  const blocks = fullBlocks + (remainder >= 16 ? 1 : 0);
  return blocks * 0.5; // each block = 0.5 hours
}
function fmtOTHours(h) {
  if (h === 0) return "0h (below threshold)";
  const blocks = h / 0.5;
  return `${h}h (${blocks} block${blocks!==1?"s":""} × 30 min)`;
}
// Call OT: blocks measured FROM exact start time (no wasted-start deduction).
// A partial block at end counts if ≥ 16 min into it.
function calcCallOTBlocks(startTime, endTime) {
  if (!startTime || !endTime) return 0;
  const [sh,sm] = startTime.split(":").map(Number);
  const [eh,em] = endTime.split(":").map(Number);
  let rawMins = (eh*60+em) - (sh*60+sm);
  if (rawMins < 0) rawMins += 1440;
  if (rawMins < 16) return 0; // below minimum threshold
  const fullBlocks = Math.floor(rawMins / 30);
  const remainder  = rawMins % 30;
  const blocks = fullBlocks + (remainder >= 16 ? 1 : 0);
  return blocks * 0.5;
}

// Global holidays (fallback) + per-branch holidays
// ── LATE / EARLY / HALF-DAY / UNPAID DEDUCTION LOGIC ──────────────────────────
// Default policy (HR can override via latePolicy state)
// latePolicy = { graceEnd:"08:30", lateDeductHr:"09:30", workStart:"08:30", workEnd:"17:30" }
function calcAttendanceDeductions(checkInISO, checkOutISO, salary, otConfig, empOTCfg, latePolicy) {
  if (!checkInISO) return { lateDeduct:0, earlyDeduct:0, note:"" };
  const hrRate = calcHourlyRate(salary||0);
  const cfg = empOTCfg || otConfig || {};
  const rPct = (cfg.regularPct ?? 100) / 100;
  const policy = latePolicy || {};
  const graceEnd   = policy.graceEnd   || "08:30"; // after this = 1hr deducted
  const lateDeductHr = policy.lateDeductHr || "09:30"; // after this = OT-block deduction
  const workEnd    = policy.workEnd    || "17:30";

  const ciDate = new Date(checkInISO);
  const ciH = ciDate.getHours(), ciM = ciDate.getMinutes(), ciS = ciDate.getSeconds();
  const ciTotalMins = ciH*60 + ciM + ciS/60;

  const [geH,geM] = graceEnd.split(":").map(Number);
  const graceMins = geH*60+geM;
  const [ldH,ldM] = lateDeductHr.split(":").map(Number);
  const lateDeductMins = ldH*60+ldM;

  let lateDeduct = 0, lateNote = "";
  if (ciTotalMins > graceMins && ciTotalMins <= lateDeductMins) {
    // after grace but before lateDeductHr: flat 1hr deduction
    lateDeduct = hrRate * rPct;
    lateNote = `Late (after ${graceEnd}): -1hr = ${fmtMoney(lateDeduct)}`;
  } else if (ciTotalMins > lateDeductMins) {
    // after lateDeductHr: OT-block deduction on late minutes
    const lateMinutes = ciTotalMins - graceMins;
    const blocks = calcOTBlocks("08:30", `${String(ciH).padStart(2,"0")}:${String(ciM).padStart(2,"0")}`);
    lateDeduct = blocks * hrRate * rPct;
    lateNote = `Late (after ${lateDeductHr}): ${blocks}h blocks = ${fmtMoney(lateDeduct)}`;
  }

  // Early checkout deduction
  let earlyDeduct = 0, earlyNote = "";
  if (checkOutISO) {
    const coDate = new Date(checkOutISO);
    const coH = coDate.getHours(), coM = coDate.getMinutes();
    const [weH,weM] = workEnd.split(":").map(Number);
    const workEndMins = weH*60+weM;
    const coMins = coH*60+coM;
    if (coMins < workEndMins) {
      const earlyBlocks = calcOTBlocks(`${String(coH).padStart(2,"0")}:${String(coM).padStart(2,"0")}`, workEnd);
      earlyDeduct = earlyBlocks * hrRate * rPct;
      if (earlyDeduct > 0) earlyNote = `Early out (before ${workEnd}): ${earlyBlocks}h blocks = ${fmtMoney(earlyDeduct)}`;
    }
  }

  return { lateDeduct, earlyDeduct, note:[lateNote,earlyNote].filter(Boolean).join(" · ") };
}

// Daily hourly rate for unpaid leave (8hrs = 1 day salary)
function calcUnpaidDeduct(salary, otConfig, empOTCfg) {
  const hrRate = calcHourlyRate(salary||0);
  const cfg = empOTCfg || otConfig || {};
  const rPct = (cfg.regularPct ?? 100) / 100;
  return hrRate * rPct * 8; // 8 hrs = 1 day
}

function calcHalfDayDeduct(salary, otConfig, empOTCfg) {
  return calcUnpaidDeduct(salary, otConfig, empOTCfg) / 2;
}

// ── PAYROLL CALCULATION ────────────────────────────────────────────────────────
// Returns breakdown for a given employee for the OT period
function calcPayroll(emp, otConfig, empOTOverrides, latePolicy) {
  const empOTCfg = (empOTOverrides&&empOTOverrides[emp.id]) || otConfig || {};
  const baseSalary = emp.salary || 0;
  const hrRate = calcHourlyRate(baseSalary);
  const rPct = (empOTCfg.regularPct ?? 100) / 100;
  const { name: salMonName, year: salYr } = salaryMonth();

  // OT earnings (approved, OT period = 16th prev → 15th current salary month)
  const otEarnings = (emp.overtime||[])
    .filter(o=>o.status==="approved"&&inOTPeriod(o.date))
    .reduce((s,o)=>s+(o.cost||0), 0);

  // Deductions: late, early-out, unpaid leaves (current salary month calendar days)
  let lateDeductions = 0, earlyDeductions = 0, unpaidDeductions = 0, halfDayDeductions = 0;
  const deductionNotes = [];

  // Attendance deductions — only for the salary calendar month
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const salMonIdx = MONTHS.indexOf(salMonName); // 0-based
  const salMonKey = `${salYr}-${String(salMonIdx+1).padStart(2,"0")}`;

  (emp.attendance||[]).filter(a=>a.date.startsWith(salMonKey)).forEach(a=>{
    const d = calcAttendanceDeductions(a.checkIn, a.checkOut, baseSalary, otConfig, empOTCfg, latePolicy);
    lateDeductions  += d.lateDeduct;
    earlyDeductions += d.earlyDeduct;
    if (d.note) deductionNotes.push(`${a.date}: ${d.note}`);
  });

  // Leave deductions — salary month
  (emp.leaves||[]).filter(l=>l.date.startsWith(salMonKey)).forEach(l=>{
    if (l.type==="unpaid" || l.status==="unpaid") {
      unpaidDeductions += calcUnpaidDeduct(baseSalary, otConfig, empOTCfg);
    }
    if (l.halfDay && l.status==="approved") {
      halfDayDeductions += calcHalfDayDeduct(baseSalary, otConfig, empOTCfg);
    }
  });

  // Bonuses — OT period (same window as OT)
  const bonuses = (emp.bonuses||[])
    .filter(b=>inOTPeriod(b.date))
    .reduce((s,b)=>s+(b.amount||0), 0);

  const totalDeductions = lateDeductions + earlyDeductions + unpaidDeductions + halfDayDeductions;
  const netSalary = baseSalary + otEarnings + bonuses - totalDeductions;

  return { baseSalary, otEarnings, bonuses, lateDeductions, earlyDeductions, unpaidDeductions, halfDayDeductions, totalDeductions, netSalary, salMonName, salYr };
}

function isHoliday(d, branchHolidays, branch) {
  if (!d) return false;
  if (NATIONAL_HOLIDAYS_2025.includes(d)) return true;
  if (branchHolidays && branch) {
    const list = branchHolidays[branch] || [];
    // entries stored as "date|name" or plain date
    return list.some(e => e === d || e.startsWith(d + "|"));
  }
  return false;
}
function isHolidayGlobal(d) { return NATIONAL_HOLIDAYS_2025.includes(d); }
function isSunday(d) { return new Date(d).getDay() === 0; }
function todayStr() { return new Date().toISOString().split("T")[0]; }
function fmt(d) { try { return new Date(d).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}); } catch{ return d; } }
function fmtT(d) { try { return new Date(d).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}); } catch{ return ""; } }
function fmtMoney(n) { return "₹"+Number(n||0).toLocaleString("en-IN",{maximumFractionDigits:0}); }
function durMins(s,e) { return Math.max(0,(new Date(e)-new Date(s))/60000); }
function minsHM(m) { return `${Math.floor(m/60)}h ${Math.round(m%60)}m`; }
function monthKey() { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; }

// ── SALARY PERIOD LOGIC ──────────────────────────────────────────────────────
// Salary for month M = base salary of M + OT from 16th(M-1) to 15th(M) + bonuses
// Paid in the first week of (M+1)
// e.g. March salary = March base + OT Feb16–Mar15 + bonuses; paid first week of April

function salaryMonth() {
  // Which calendar month's salary are we currently calculating?
  // If today ≤ 15th → salary month is current month (OT period: 16th last → 15th this)
  // If today > 15th → salary month is next month (OT period: 16th this → 15th next)
  const now = new Date();
  const d = now.getDate();
  const salMon = d <= 15 ? now.getMonth() : now.getMonth() + 1; // 0-based
  const salYr  = d <= 15 ? now.getFullYear() : (now.getMonth()===11 ? now.getFullYear()+1 : now.getFullYear());
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return { name: MONTHS[salMon % 12], year: salYr };
}

function paymentWeek() {
  // Paid in first week of the month AFTER the salary month
  const { name, year } = salaryMonth();
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const idx = MONTHS.indexOf(name);
  const payMon = MONTHS[(idx + 1) % 12];
  const payYr  = idx === 11 ? year + 1 : year;
  return `1st week of ${payMon} ${payYr}`;
}

// Auto-approve attendance: Medical Support Interpreter attendance not approved by next 16th gets auto-approved
function shouldAutoApproveAttendance(attDate, designationName) {
  if (designationName !== "Medical Support Interpreter") return false; // only applies to Medical Support Interpreter
  // Auto-approve if the 16th of the following month has passed
  const [yr, mo] = attDate.split("-").map(Number);
  const deadline = new Date(yr, mo, 16); // 16th of the next month (mo is 1-based, so mo = next month in 0-based)
  return new Date() >= deadline;
}

// OT pay period: 16th of previous month to 15th of current month
// If today > 15th, the current period has just closed — bonuses/payroll use the NEXT period (16th this month → 15th next)
function otPeriod() {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  const pad = n => String(n).padStart(2,"0");
  const fmtD = dt => `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}`;
  let start, end;
  if (d <= 15) {
    // 1st–15th: current period is 16th last month → 15th this month
    start = new Date(y, m - 1, 16);
    end   = new Date(y, m, 15);
  } else {
    // 16th–end: current period is 16th this month → 15th next month
    start = new Date(y, m, 16);
    end   = new Date(y, m + 1, 15);
  }
  return { start: fmtD(start), end: fmtD(end) };
}
function inOTPeriod(dateStr) {
  const { start, end } = otPeriod();
  return dateStr >= start && dateStr <= end;
}
function fmtPeriod() {
  const { start, end } = otPeriod();
  const mo = d => new Date(d).toLocaleDateString("en-IN",{day:"2-digit",month:"short"});
  return `${mo(start)} – ${mo(end)}`;
}

function useLS(key, init) {
  const [v,setV] = useState(()=>{ try{ const s=localStorage.getItem(key); return s?JSON.parse(s):init; }catch{ return init; } });
  useEffect(()=>{ localStorage.setItem(key,JSON.stringify(v)); },[key,v]);
  return [v,setV];
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [employees, setEmployees] = useLS("ax2_emp", INITIAL_EMPLOYEES);
  const [hrPassword, setHrPassword] = useLS("ax2_hrpw", "hr@admin123");
  const [branches, setBranches] = useLS("ax2_branches", INITIAL_BRANCHES);
  // branchHolidays: { "Delhi HQ": ["2025-03-25", ...], "Mumbai": [...] }
  const [branchHolidays, setBranchHolidays] = useLS("ax2_bholidays", {});
  const [designations, setDesignations] = useLS("ax2_designations", DEFAULT_DESIGNATIONS);
  // Migrate: ensure every designation has autoApprove defined (backfill from DEFAULT_DESIGNATIONS)
  useEffect(()=>{
    if (!designations) return;
    const needsPatch = designations.some(d=>d.autoApprove===undefined||d.autoApproveManual===undefined);
    if (needsPatch) {
      setDesignations(prev=>(prev||[]).map(d=>{
        const def = DEFAULT_DESIGNATIONS.find(x=>x.name===d.name);
        const out = {...d};
        if (d.autoApprove === undefined)
          out.autoApprove = def ? (def.autoApprove===true) : false;
        if (d.autoApproveManual === undefined)
          out.autoApproveManual = def ? (def.autoApproveManual===true) : false;
        return out;
      }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Global OT config: { regularPct: 100, nightHolidayPct: 130 }
  const [otConfig, setOtConfig] = useLS("ax2_otconfig", {regularPct:100, nightHolidayPct:130});
  // Per-employee OT pct override: { EMP001: { regularPct:110, nightHolidayPct:140 } }
  const [empOTOverrides, setEmpOTOverrides] = useLS("ax2_otoverrides", {});
  // Global leave defaults: { paidLeave:14, medicalLeave:7 }
  const [leaveDefaults, setLeaveDefaults] = useLS("ax2_leavedefaults", {paidLeave:14, medicalLeave:7});
  // Late policy: graceEnd = after this 1hr deducted, lateDeductHr = after this OT-block deduction
  const [latePolicy, setLatePolicy] = useLS("ax2_latepolicy", {graceEnd:"08:30", lateDeductHr:"09:30", workStart:"08:30", workEnd:"17:30"});
  // bonusTypes: array of {name, description}
  const [bonusTypes, setBonusTypes] = useLS("ax2_bonustypes", [{name:"Performance Bonus",description:""},{name:"Festival Bonus",description:""},{name:"Award",description:""}]);
  const [session, setSession] = useState(null);
  const [tab, setTab] = useState("home");

  const updateEmp = (id, fn) => {
    setEmployees(prev => prev.map(e => e.id===id ? {...e,...fn(e)} : e));
  };
  const currentEmp = session?.type==="emp" ? employees.find(e=>e.id===session.id) : null;

  const login = (username, password) => {
    if (username==="hr" && password===hrPassword) { setSession({type:"hr"}); return true; }
    const emp = employees.find(e=>e.username===username && e.password===password && e.active);
    if (emp) { setSession({type:"emp",id:emp.id}); return true; }
    return false;
  };
  const logout = () => { setSession(null); setTab("home"); };

  if (!session) return <LoginScreen onLogin={login}/>;
  if (session.type==="hr") return <HRPortal hrPassword={hrPassword} setHrPassword={setHrPassword} employees={employees} setEmployees={setEmployees} branches={branches} setBranches={setBranches} branchHolidays={branchHolidays} setBranchHolidays={setBranchHolidays} designations={designations} setDesignations={setDesignations} otConfig={otConfig} setOtConfig={setOtConfig} empOTOverrides={empOTOverrides} setEmpOTOverrides={setEmpOTOverrides} leaveDefaults={leaveDefaults} setLeaveDefaults={setLeaveDefaults} latePolicy={latePolicy} setLatePolicy={setLatePolicy} bonusTypes={bonusTypes} setBonusTypes={setBonusTypes} onLogout={logout}/>;
  if (!currentEmp) { logout(); return null; }
  return <EmployeeApp emp={currentEmp} employees={employees} updateEmp={updateEmp} branchHolidays={branchHolidays} setBranchHolidays={setBranchHolidays} designations={designations} otConfig={otConfig} empOTOverrides={empOTOverrides} latePolicy={latePolicy} bonusTypes={bonusTypes} onLogout={logout} tab={tab} setTab={setTab}/>;
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [u,setU]=useState(""); const [p,setP]=useState(""); const [err,setErr]=useState(""); const [busy,setBusy]=useState(false);
  const go = async()=>{
    setBusy(true); setErr("");
    await new Promise(r=>setTimeout(r,500));
    if (!onLogin(u.trim(),p)) setErr("Invalid credentials. Check your Employee ID and password.");
    setBusy(false);
  };
  return (
    <Shell center>
      <div style={{width:"100%",maxWidth:380,zIndex:1}}>
        <div style={{textAlign:"center",marginBottom:36}}>
          <div style={S.logoBox}><svg width={26} height={26} viewBox="0 0 24 24" fill="#fff"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg></div>
          <h1 style={{...S.heading,fontSize:30,margin:"0 0 6px"}}>AttendX</h1>
          <p style={{color:"#4b5563",fontSize:14,margin:0}}>Workforce Attendance System</p>
        </div>
        <div style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",borderRadius:20,padding:28}}>
          <FInput label="Employee ID / Username" value={u} onChange={setU} placeholder="e.g. anjali.singh" onEnter={go}/>
          <FInput label="Password" type="password" value={p} onChange={setP} placeholder="Enter password" onEnter={go}/>
          {err && <div style={S.errBox}>{err}</div>}
          <button onClick={go} disabled={busy} style={{...S.primaryBtn,width:"100%",marginTop:4}}>{busy?"Signing in…":"Sign In"}</button>
        </div>
        <p style={{textAlign:"center",color:"#374151",fontSize:12,marginTop:16}}>HR login: username <b style={{color:"#6b7280"}}>hr</b></p>
      </div>
    </Shell>
  );
}

// ─── EMPLOYEE APP SHELL ───────────────────────────────────────────────────────
function EmployeeApp({ emp, employees, updateEmp, branchHolidays, setBranchHolidays, designations, otConfig, empOTOverrides, latePolicy, bonusTypes, onLogout, tab, setTab }) {
  const desgConfig = (designations||[]).find(d=>d.name===emp.designation)||{};
  const canApprove = desgConfig.canApprove === true;
  const isManager  = emp.designation === "Manager";
  // autoApprove: designation flag (with safe fallback for Supervisor/Manager) OR individual override
  const desgAutoApprove = desgConfig.autoApprove === true ||
    (desgConfig.autoApprove === undefined && (emp.designation === "Manager" || emp.designation === "Supervisor"));
  const hasAutoApprove = desgAutoApprove || (emp.autoApproveLeave === true);
  // autoApproveManual: designation flag OR individual override
  const desgAutoApproveManual = desgConfig.autoApproveManual === true ||
    (desgConfig.autoApproveManual === undefined && (emp.designation === "Manager" || emp.designation === "Supervisor"));
  const hasAutoApproveManual = desgAutoApproveManual || (emp.autoApproveManual === true);
  const TABS = [{id:"home",e:"🏠",l:"Home"},{id:"attend",e:"📍",l:"Attend"},{id:"leaves",e:"📅",l:"Leaves"},{id:"ot",e:"⏱",l:"OT"},{id:"me",e:"👤",l:"Profile"}];
  return (
    <Shell>
      <div style={S.header}>
        <div><div style={S.heading}>AttendX</div><div style={{color:"#6366f1",fontSize:12,fontWeight:600}}>{emp.designation} · {emp.branch}</div></div>
        <Av name={emp.name}/>
      </div>
      <div style={{paddingBottom:84}}>
        {tab==="home"   && <HomeTab   emp={emp} employees={employees} canApprove={canApprove} updateEmp={updateEmp} branchHolidays={branchHolidays} setTab={setTab} otConfig={otConfig} empOTOverrides={empOTOverrides} latePolicy={latePolicy}/>}
        {tab==="attend" && <AttendTab emp={emp} employees={employees} updateEmp={updateEmp} branchHolidays={branchHolidays} canApprove={canApprove} hasAutoApprove={hasAutoApprove} hasAutoApproveManual={hasAutoApproveManual}/>}
        {tab==="leaves" && <LeavesTab emp={emp} employees={employees} canApprove={canApprove} updateEmp={updateEmp} branchHolidays={branchHolidays} otConfig={otConfig} empOTOverrides={empOTOverrides} bonusTypes={bonusTypes} hasAutoApprove={hasAutoApprove}/>}
        {tab==="ot"     && <OTTab     emp={emp} employees={employees} canApprove={canApprove} updateEmp={updateEmp} branchHolidays={branchHolidays} setBranchHolidays={setBranchHolidays} otConfig={otConfig} empOTOverrides={empOTOverrides}/>}
        {tab==="me"     && <ProfileTab emp={emp} updateEmp={updateEmp} onLogout={onLogout} otConfig={otConfig} empOTOverrides={empOTOverrides} latePolicy={latePolicy}/>}
      </div>
      <div style={S.bottomNav}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{...S.navBtn,color:tab===t.id?"#6366f1":"#4b5563"}}>
            <span style={{fontSize:19}}>{t.e}</span>
            <span style={{fontSize:10,fontWeight:tab===t.id?700:400}}>{t.l}</span>
          </button>
        ))}
      </div>
    </Shell>
  );
}

// ─── HOME ─────────────────────────────────────────────────────────────────────
function HomeTab({ emp, employees, canApprove, updateEmp, branchHolidays, setTab, otConfig, empOTOverrides, latePolicy }) {
  const today = todayStr();
  const todayIsHol = isHoliday(today, branchHolidays, emp.branch);
  const mk = monthKey();
  const woUsed = (emp.weekOffRequests||[]).filter(w=>w.status==="approved"&&w.date.startsWith(mk)).length;

  // Calendar state — default to current month
  const now = new Date();
  const [calYear,  setCalYear]  = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth()); // 0-based
  const [selected, setSelected] = useState(today);

  // ── Pay deductions for current period ──────────────────────────────────────
  const empCfg = (empOTOverrides&&empOTOverrides[emp.id])||otConfig||{};
  const hrRateH = calcHourlyRate(emp.salary||0);

  // Late / early deductions — per attendance record
  const lateItems = (emp.attendance||[]).filter(a=>inOTPeriod(a.date)).reduce((arr,a)=>{
    const d = calcAttendanceDeductions(a.checkIn,a.checkOut,emp.salary||0,otConfig,empCfg,latePolicy);
    if (d.lateDeduct>0)  arr.push({date:a.date,label:"Late arrival",  amount:d.lateDeduct,  icon:"🕐"});
    if (d.earlyDeduct>0) arr.push({date:a.date,label:"Early checkout", amount:d.earlyDeduct, icon:"🚪"});
    return arr;
  },[]);

  // Leave deductions
  const leaveDeductItems = [];
  (emp.leaves||[]).filter(l=>inOTPeriod(l.date)).forEach(l=>{
    if (l.type==="unpaid"||l.status==="unpaid")
      leaveDeductItems.push({date:l.date,label:"Unpaid leave",amount:calcUnpaidDeduct(emp.salary||0,otConfig,empCfg),icon:"📅"});
    if (l.halfDay&&l.status==="approved")
      leaveDeductItems.push({date:l.date,label:`Half day (${l.halfSlot==="morning"?"AM":"PM"})`,amount:calcHalfDayDeduct(emp.salary||0,otConfig,empCfg),icon:"🌗"});
  });

  const allDeductItems = [...lateItems,...leaveDeductItems];
  const totalDeductAmt = allDeductItems.reduce((s,d)=>s+d.amount,0);

  // OT earnings
  const periodOT = (emp.overtime||[]).filter(o=>o.status==="approved"&&inOTPeriod(o.date));
  const totalOTHrs = periodOT.reduce((s,o)=>s+(o.hours||0),0);
  const totalOTEarn = periodOT.reduce((s,o)=>s+(o.cost||0),0);
  const totalBonus = (emp.bonuses||[]).filter(b=>inOTPeriod(b.date)).reduce((s,b)=>s+(b.amount||0),0);
  const estimatedNet = (emp.salary||0) + totalOTEarn + totalBonus - totalDeductAmt;

  const [showPayDash, setShowPayDash] = useState(false);

  // Pending approvals — same branch only, Medical Support Interpreter attendance also needs approval
  const pending = canApprove ? employees
    .filter(e => e.active && e.branch === emp.branch)
    .flatMap(e=>[
      ...(e.leaves||[]).filter(l=>l.status==="pending").map(l=>({...l,eName:e.name,eId:e.id,kind:"leave"})),
      ...(e.overtime||[]).filter(o=>o.status==="pending").map(o=>({...o,eName:e.name,eId:e.id,kind:"ot"})),
      ...(e.weekOffRequests||[]).filter(w=>w.status==="pending").map(w=>({...w,eName:e.name,eId:e.id,kind:"wo"})),
      // Attendance approval for Medical Support Interpreter (not yet approved, not auto-expired)
      ...(e.designation==="Medical Support Interpreter"
        ? (e.attendance||[])
            .filter(a=>a.attStatus==="pending" && !shouldAutoApproveAttendance(a.date, e.designation))
            .map(a=>({date:a.date,eName:e.name,eId:e.id,kind:"attendance",checkIn:a.checkIn,checkOut:a.checkOut,location:a.location}))
        : []),
      // Manual entries pending approval (any designation, any employee)
      ...((e.attendance||[])
        .filter(a=>(a.manual||a.manualPatch) && a.manualStatus==="pending")
        .map(a=>({date:a.date,eName:e.name,eId:e.id,kind:"manual",checkIn:a.checkIn,checkOut:a.checkOut,reason:a.manualReason}))),
    ]) : [];

  const act = (kind,eId,date,approve) => {
    if (kind==="attendance" || kind==="manual") {
      updateEmp(eId, e=>({ attendance:(e.attendance||[]).map(a=>a.date===date?{...a,
        attStatus:approve?"approved":"rejected",
        manualStatus:approve?"approved":"rejected"
      }:a) }));
    } else {
      const key = kind==="leave"?"leaves":kind==="ot"?"overtime":"weekOffRequests";
      updateEmp(eId, e=>({ [key]: e[key].map(i=>i.date===date?{...i,status:approve?"approved":"rejected"}:i) }));
    }
  };

  // ── calendar helpers ──
  const daysInMonth = (y,m) => new Date(y,m+1,0).getDate();
  const firstDayOfMonth = (y,m) => new Date(y,m,1).getDay(); // 0=Sun
  const prevMonth = () => { if(calMonth===0){setCalYear(y=>y-1);setCalMonth(11);}else setCalMonth(m=>m-1); };
  const nextMonth = () => { if(calMonth===11){setCalYear(y=>y+1);setCalMonth(0);}else setCalMonth(m=>m+1); };
  const pad2 = n => String(n).padStart(2,"0");
  const dateStr = (y,m,d) => `${y}-${pad2(m+1)}-${pad2(d)}`;

  // Build info maps for the displayed month
  const attendanceMap = {};
  (emp.attendance||[]).forEach(a => { attendanceMap[a.date] = a; });

  const leaveMap = {};
  (emp.leaves||[]).forEach(l => {
    if (l.status==="approved"||l.status==="pending") leaveMap[l.date] = l;
  });

  const weekOffMap = {};
  (emp.weekOffRequests||[]).forEach(w => {
    if (w.status==="approved"||w.status==="pending") weekOffMap[w.date] = w;
  });

  const otMap = {};
  (emp.overtime||[]).forEach(o => {
    if (!otMap[o.date]) otMap[o.date] = [];
    otMap[o.date].push(o);
  });

  // Build team leave maps: same-branch colleagues (excluding self)
  // teamLeaveMap[date] = [{name, type, status, halfDay, halfSlot}]
  // teamWOMap[date]    = [{name, status}]
  const branchTeam = employees.filter(e=>e.active && e.id!==emp.id && e.branch===emp.branch);

  const teamLeaveMap = {};
  branchTeam.forEach(m => {
    (m.leaves||[]).forEach(l => {
      if (l.status==="approved"||l.status==="pending") {
        if (!teamLeaveMap[l.date]) teamLeaveMap[l.date] = [];
        teamLeaveMap[l.date].push({name:m.name,type:l.type,status:l.status,halfDay:l.halfDay,halfSlot:l.halfSlot});
      }
    });
    (m.weekOffRequests||[]).forEach(w => {
      if (w.status==="approved"||w.status==="pending") {
        if (!teamLeaveMap[w.date]) teamLeaveMap[w.date] = [];
        teamLeaveMap[w.date].push({name:m.name,type:"week-off",status:w.status});
      }
    });
  });

  // What dots to show on a day cell
  const getDayInfo = (ds) => {
    const att       = attendanceMap[ds];
    const lv        = leaveMap[ds];
    const wo        = weekOffMap[ds];
    const ots       = otMap[ds]||[];
    const hol       = isHoliday(ds, branchHolidays, emp.branch);
    const sun       = isSunday(ds);
    const teamLvs   = teamLeaveMap[ds]||[];
    return { att, lv, wo, ots, hol, sun, teamLvs };
  };

  // Selected day detail
  const selInfo = getDayInfo(selected);
  const selDate = new Date(selected);
  const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const DAY_NAMES   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  const days   = daysInMonth(calYear, calMonth);
  const offset = firstDayOfMonth(calYear, calMonth);
  const cells  = Array.from({length: Math.ceil((offset+days)/7)*7}, (_,i) => {
    const d = i - offset + 1;
    return (d >= 1 && d <= days) ? dateStr(calYear, calMonth, d) : null;
  });

  // today's rec for top strip
  const todayRec = attendanceMap[today];

  return (
    <div style={{padding:"16px 16px 0"}}>

      {/* ── Top greeting strip ── */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
        <div>
          <div style={{color:"#4b5563",fontSize:12,marginBottom:2}}>{new Date().getHours()<12?"Good Morning":"Good Afternoon"} 👋</div>
          <div style={{...S.heading,fontSize:20}}>{emp.name.split(" ")[0]}</div>
          <div style={{color:"#6366f1",fontSize:12,marginTop:1}}>{emp.designation} · {emp.branch}</div>
        </div>
        <div style={{textAlign:"right"}}>
          {isSunday(today) && <Chip c="#f87171">Sunday</Chip>}
          {todayIsHol && <Chip c="#fbbf24">Holiday</Chip>}
          {!todayRec && !isSunday(today) &&
            <button onClick={()=>setTab("attend")} style={{display:"block",marginTop:4,padding:"7px 14px",background:"linear-gradient(135deg,#6366f1,#8b5cf6)",border:"none",borderRadius:8,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",boxShadow:"0 2px 10px rgba(99,102,241,.35)"}}>
              📍 Check In
            </button>
          }
          {todayRec&&!todayRec.checkOut &&
            <button onClick={()=>setTab("attend")} style={{display:"block",marginTop:4,padding:"7px 14px",background:"rgba(239,68,68,.12)",border:"1px solid rgba(239,68,68,.25)",borderRadius:8,color:"#f87171",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
              📍 Check Out
            </button>
          }
          {todayRec?.checkOut &&
            <div style={{fontSize:11,color:"#10b981",marginTop:4,fontWeight:600}}>{fmtT(todayRec.checkIn)}→{fmtT(todayRec.checkOut)}</div>
          }
        </div>
      </div>

      {/* ── Leave balances ── */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:14}}>
        <Stat l="Paid Leave"  v={emp.paidLeaveBalance}  s="/14" c="#6366f1"/>
        <Stat l="Medical"     v={emp.medicalLeaveBalance} s="/7" c="#10b981"/>
        <Stat l="Week Offs"   v={woUsed}                s="/3 mo" c="#f59e0b"/>
      </div>

      {/* ── Pay & Deductions Dashboard ── */}
      <div style={{...S.card,marginBottom:12}}>
        <button onClick={()=>setShowPayDash(!showPayDash)}
          style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",padding:0}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:15}}>💰</span>
            <span style={{color:"#e2e8f0",fontWeight:600,fontSize:14}}>Pay Summary</span>
            <span style={{color:"#4b5563",fontSize:11}}>{fmtPeriod()}</span>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            {totalDeductAmt>0 && !showPayDash && (
              <span style={{background:"rgba(239,68,68,.1)",border:"1px solid rgba(239,68,68,.2)",borderRadius:20,padding:"1px 8px",color:"#f87171",fontSize:11,fontWeight:700}}>
                −{fmtMoney(totalDeductAmt)}
              </span>
            )}
            {totalOTEarn>0 && !showPayDash && (
              <span style={{background:"rgba(16,185,129,.08)",border:"1px solid rgba(16,185,129,.18)",borderRadius:20,padding:"1px 8px",color:"#10b981",fontSize:11,fontWeight:700}}>
                +{fmtMoney(totalOTEarn)}
              </span>
            )}
            <span style={{color:"#4b5563",fontSize:15,lineHeight:1}}>{showPayDash?"▲":"▼"}</span>
          </div>
        </button>

        {showPayDash && (
          <div style={{marginTop:12,paddingTop:12,borderTop:"1px solid rgba(255,255,255,.06)"}}>
            {/* Net hero */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 14px",background:"linear-gradient(135deg,rgba(16,185,129,.08),rgba(99,102,241,.06))",borderRadius:10,border:"1px solid rgba(16,185,129,.12)",marginBottom:12}}>
              <div>
                <div style={{color:"#6b7280",fontSize:11,marginBottom:2}}>{salaryMonth().name} {salaryMonth().year} · Paid {paymentWeek()}</div>
                <div style={{color:"#4b5563",fontSize:11}}>OT period: {fmtPeriod()}</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{color:"#10b981",fontFamily:"Syne,sans-serif",fontSize:22,fontWeight:800}}>{fmtMoney(estimatedNet)}</div>
                <div style={{color:"#374151",fontSize:10}}>est. net</div>
              </div>
            </div>

            {/* Earnings */}
            <div style={{marginBottom:8}}>
              <div style={{color:"#6b7280",fontSize:11,fontWeight:600,marginBottom:5,textTransform:"uppercase",letterSpacing:"0.05em"}}>Earnings</div>
              <DashRow icon="🏦" label="Base Salary"                       value={fmtMoney(emp.salary||0)}          color="#e2e8f0"/>
              {totalOTHrs>0   && <DashRow icon="⏱" label={`Overtime (${totalOTHrs.toFixed(1)}h)`} value={"+"+fmtMoney(totalOTEarn)} color="#fbbf24"/>}
              {totalBonus>0   && <DashRow icon="🎁" label="Bonuses"                                value={"+"+fmtMoney(totalBonus)}   color="#a78bfa"/>}
            </div>

            {/* Deductions */}
            {allDeductItems.length>0 && (
              <div>
                <div style={{color:"#f87171",fontSize:11,fontWeight:600,marginBottom:5,textTransform:"uppercase",letterSpacing:"0.05em"}}>Deductions</div>
                {allDeductItems.map((d,i)=>(
                  <DashRow key={i} icon={d.icon} label={`${d.label} · ${fmt(d.date)}`} value={"−"+fmtMoney(d.amount)} color="#f87171"/>
                ))}
                <div style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderTop:"1px solid rgba(255,255,255,.06)",marginTop:4}}>
                  <span style={{color:"#6b7280",fontSize:12,fontWeight:600}}>Total Deductions</span>
                  <span style={{color:"#f87171",fontSize:12,fontWeight:700}}>−{fmtMoney(totalDeductAmt)}</span>
                </div>
              </div>
            )}
            {allDeductItems.length===0 && (
              <div style={{color:"#374151",fontSize:12,textAlign:"center",padding:"6px 0"}}>✓ No deductions this period</div>
            )}

            <div style={{marginTop:8,fontSize:11,color:"#374151",textAlign:"center"}}>Estimated — final payroll by HR</div>
          </div>
        )}
      </div>

      {/* ── Calendar ── */}
      <div style={{...S.card,padding:"14px 12px",marginBottom:12}}>
        {/* Month nav */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <button onClick={prevMonth} style={{background:"none",border:"none",color:"#6b7280",fontSize:18,cursor:"pointer",padding:"0 6px",lineHeight:1}}>‹</button>
          <div style={{color:"#e2e8f0",fontFamily:"Syne,sans-serif",fontSize:15,fontWeight:700}}>{MONTH_NAMES[calMonth]} {calYear}</div>
          <button onClick={nextMonth} style={{background:"none",border:"none",color:"#6b7280",fontSize:18,cursor:"pointer",padding:"0 6px",lineHeight:1}}>›</button>
        </div>

        {/* Day-of-week headers */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",marginBottom:4}}>
          {DAY_NAMES.map(d=>(
            <div key={d} style={{textAlign:"center",fontSize:10,color:d==="Sun"?"#f87171":"#374151",fontWeight:600,paddingBottom:4}}>{d}</div>
          ))}
        </div>

        {/* Day cells */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2}}>
          {cells.map((ds,i)=>{
            if (!ds) return <div key={i}/>;
            const info = getDayInfo(ds);
            const isToday = ds===today;
            const isSel   = ds===selected;
            const isCurrentMonth = ds.startsWith(`${calYear}-${pad2(calMonth+1)}`);

            // Determine cell background
            let bg = "transparent";
            let border = "1px solid transparent";
            if (isSel)        { bg="rgba(99,102,241,.25)"; border="1px solid rgba(99,102,241,.5)"; }
            else if (isToday) { bg="rgba(99,102,241,.12)"; border="1px solid rgba(99,102,241,.3)"; }
            else if (info.lv?.status==="approved") { bg="rgba(99,102,241,.08)"; }
            else if (info.wo?.status==="approved") { bg="rgba(245,158,11,.07)"; }
            else if (info.hol) { bg="rgba(251,191,36,.08)"; }
            else if (info.sun) { bg="rgba(239,68,68,.05)"; }

            const dayNum = parseInt(ds.split("-")[2]);
            const dayOfWeek = new Date(ds).getDay();
            const textColor = !isCurrentMonth ? "#1f2937"
              : isSel ? "#c7d2fe"
              : isToday ? "#818cf8"
              : info.sun ? "#f87171"
              : "#9ca3af";

            // Dots
            const dots = [];
            if (info.att) dots.push(info.att.checkOut ? "#10b981" : "#f59e0b");
            if (info.lv?.status==="approved")  dots.push("#6366f1");
            if (info.lv?.status==="pending")   dots.push("#818cf8");
            if (info.wo?.status==="approved")  dots.push("#f59e0b");
            if (info.ots.some(o=>o.status==="approved"))  dots.push("#fbbf24");
            if (info.ots.some(o=>o.status==="pending"))   dots.push("#a78bfa");
            if (info.hol) dots.push("#fbbf24");
            // Team leave dot — pink/coral if any colleague is on leave that day
            if (info.teamLvs.some(t=>t.status==="approved")) dots.push("#f472b6");
            else if (info.teamLvs.some(t=>t.status==="pending")) dots.push("#fb7185");

            return (
              <div key={ds} onClick={()=>setSelected(ds)}
                style={{borderRadius:7,padding:"5px 2px",textAlign:"center",cursor:"pointer",background:bg,border,minHeight:38,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-start",gap:2}}>
                <div style={{fontSize:12,fontWeight:isToday||isSel?700:400,color:textColor,lineHeight:1.2}}>{dayNum}</div>
                {/* dot row */}
                <div style={{display:"flex",gap:2,justifyContent:"center",flexWrap:"wrap",maxWidth:24}}>
                  {dots.slice(0,3).map((c,di)=>(
                    <div key={di} style={{width:4,height:4,borderRadius:"50%",background:c,flexShrink:0}}/>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div style={{display:"flex",flexWrap:"wrap",gap:"6px 12px",marginTop:10,paddingTop:8,borderTop:"1px solid rgba(255,255,255,.05)"}}>
          {[["#10b981","Present"],["#f59e0b","Active/OT"],["#6366f1","My Leave"],["#fbbf24","Holiday"],["#f472b6","Team Leave"],["#a78bfa","Pending"],["#f87171","Sunday"]].map(([c,l])=>(
            <div key={l} style={{display:"flex",alignItems:"center",gap:4,fontSize:10,color:"#374151"}}>
              <div style={{width:6,height:6,borderRadius:"50%",background:c}}/>
              {l}
            </div>
          ))}
        </div>
      </div>

      {/* ── Selected day detail ── */}
      <div style={{...S.card,marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <div style={{color:"#e2e8f0",fontWeight:700,fontSize:14,fontFamily:"Syne,sans-serif"}}>
            {selDate.toLocaleDateString("en-IN",{weekday:"long",day:"numeric",month:"long"})}
          </div>
          <div style={{display:"flex",gap:5}}>
            {selInfo.sun  && <Chip c="#f87171" sm>Sunday</Chip>}
            {selInfo.hol  && <Chip c="#fbbf24" sm>Holiday</Chip>}
            {selected===today && <Chip c="#818cf8" sm>Today</Chip>}
          </div>
        </div>

        {/* Attendance */}
        {selInfo.att ? (
          <DetailRow icon="📍" label="Attendance" color="#10b981">
            <span style={{color:"#10b981",fontWeight:600}}>{fmtT(selInfo.att.checkIn)}{selInfo.att.checkOut ? " → "+fmtT(selInfo.att.checkOut) : " (active)"}</span>
            {selInfo.att.checkOut && <span style={{color:"#4b5563",marginLeft:6}}>{minsHM(durMins(selInfo.att.checkIn,selInfo.att.checkOut))}</span>}
            {selInfo.att.location && <div style={{color:"#374151",fontSize:11,marginTop:2}}>📍 {selInfo.att.location}</div>}
          </DetailRow>
        ) : (
          <DetailRow icon="📍" label="Attendance" color="#374151">
            <span style={{color:"#374151"}}>{selInfo.sun||selInfo.hol||selInfo.wo?.status==="approved"||selInfo.lv?.status==="approved" ? "Day off" : "No record"}</span>
          </DetailRow>
        )}

        {/* Leave */}
        {selInfo.lv && (
          <DetailRow icon="📅" label="Leave" color="#6366f1">
            <span style={{color:"#818cf8",fontWeight:600,textTransform:"capitalize"}}>{selInfo.lv.type} leave</span>
            <SBadge s={selInfo.lv.status}/>
            {selInfo.lv.reason && <div style={{color:"#374151",fontSize:11,marginTop:2}}>{selInfo.lv.reason}</div>}
          </DetailRow>
        )}

        {/* Week off */}
        {selInfo.wo && (
          <DetailRow icon="🗓" label="Week Off" color="#f59e0b">
            <SBadge s={selInfo.wo.status}/>
            {selInfo.wo.reason && <div style={{color:"#374151",fontSize:11,marginTop:2}}>{selInfo.wo.reason}</div>}
          </DetailRow>
        )}

        {/* OT entries */}
        {selInfo.ots.length>0 && selInfo.ots.map((o,i)=>(
          <DetailRow key={i} icon={o.otType==="call"?"📞":"⏱"} label={o.otType==="call"?"Call OT":"Overtime"} color="#fbbf24">
            <span style={{color:"#fbbf24",fontWeight:600}}>{o.startTime}–{o.endTime} · {fmtOTHours(o.hours)} @ {o.rate*100}%</span>
            <span style={{color:"#10b981",marginLeft:6}}>{fmtMoney(o.cost)}</span>
            <SBadge s={o.status}/>
            {o.reason && <div style={{color:"#374151",fontSize:11,marginTop:2}}>{o.reason}</div>}
          </DetailRow>
        ))}

        {/* Nothing — own */}
        {!selInfo.att && !selInfo.lv && !selInfo.wo && selInfo.ots.length===0 && !selInfo.hol && !selInfo.sun && selInfo.teamLvs.length===0 && (
          <div style={{color:"#1f2937",fontSize:13,textAlign:"center",padding:"10px 0"}}>No records for this day</div>
        )}

        {/* Team leaves on this day */}
        {selInfo.teamLvs.length>0 && (
          <div style={{marginTop:8,paddingTop:8,borderTop:"1px solid rgba(255,255,255,.05)"}}>
            <div style={{color:"#374151",fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:6}}>Team on Leave</div>
            {selInfo.teamLvs.map((t,i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:"1px solid rgba(255,255,255,.04)"}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <div style={{width:24,height:24,borderRadius:"50%",background:"linear-gradient(135deg,#db2777,#9333ea)",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:10,fontWeight:700,flexShrink:0}}>{t.name.charAt(0)}</div>
                  <div>
                    <div style={{color:"#e2e8f0",fontSize:13,fontWeight:500}}>{t.name}</div>
                    <div style={{color:"#6b7280",fontSize:11,textTransform:"capitalize"}}>
                      {t.type==="week-off"?"Week off":t.type==="paid"?"Paid leave":t.type==="medical"?"Medical leave":t.type==="unpaid"?"Unpaid leave":t.type}
                      {t.halfDay&&<span style={{color:"#a78bfa"}}> · {t.halfSlot==="morning"?"Morning":"Afternoon"} half</span>}
                    </div>
                  </div>
                </div>
                <SBadge s={t.status}/>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Team Board — only for supervisors/managers ── */}
      {canApprove && <TeamBoard emp={emp} employees={employees} today={today} branchHolidays={branchHolidays} pending={pending} act={act} otConfig={otConfig} empOTOverrides={empOTOverrides} latePolicy={latePolicy}/>}
    </div>
  );
}

// ─── TEAM BOARD ───────────────────────────────────────────────────────────────
function TeamBoard({ emp, employees, today, branchHolidays, pending, act, otConfig, empOTOverrides, latePolicy }) {
  const [view, setView] = useState("today"); // "today" | "pending"
  const team = employees.filter(e => e.active && e.id !== emp.id && e.branch === emp.branch);

  const presentCount = team.filter(e=>(e.attendance||[]).some(a=>a.date===today)).length;
  const absentCount  = team.length - presentCount;
  const pendingCount = pending.length;

  return (
    <div style={{marginTop:4,paddingBottom:16}}>
      {/* Header with counts */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <div style={{fontFamily:"Syne,sans-serif",fontSize:16,fontWeight:700,color:"#f1f5f9"}}>
          Team · {emp.branch}
          <span style={{color:"#4b5563",fontWeight:400,fontSize:13,marginLeft:6}}>({team.length} members)</span>
        </div>
        <div style={{display:"flex",gap:6}}>
          {pendingCount>0 && (
            <span style={{background:"rgba(239,68,68,.12)",border:"1px solid rgba(239,68,68,.25)",borderRadius:20,padding:"2px 8px",color:"#f87171",fontSize:11,fontWeight:700}}>
              {pendingCount} pending
            </span>
          )}
        </div>
      </div>

      {/* Disclaimer banner */}
      <div style={{background:"rgba(245,158,11,.06)",border:"1px solid rgba(245,158,11,.2)",borderRadius:10,padding:"10px 13px",marginBottom:12,fontSize:12,lineHeight:1.7}}>
        <div style={{color:"#fbbf24",fontWeight:700,marginBottom:3}}>📋 Attendance Approval Reminder</div>
        <div style={{color:"#6b7280"}}>Medical Support Interpreter attendance requires your approval. Unapproved records are <b style={{color:"#fbbf24"}}>auto-approved on the 16th of the following month</b>.</div>
        <div style={{color:"#4b5563",marginTop:3}}>
          Salary cycle: <b style={{color:"#e2e8f0"}}>{salaryMonth().name} {salaryMonth().year}</b> base + OT ({fmtPeriod()}) → paid <b style={{color:"#e2e8f0"}}>{paymentWeek()}</b>
        </div>
      </div>

      {/* View toggle */}
      <div style={{display:"flex",gap:6,marginBottom:12}}>
        {[["today","📋 Today"],["pending","⏳ Approvals"],["leaves","📅 Leaves"],["ot","⏱ OT"]].map(([v,l])=>(
          <button key={v} onClick={()=>setView(v)} style={{padding:"6px 12px",background:view===v?"rgba(99,102,241,.2)":"rgba(255,255,255,.04)",border:`1px solid ${view===v?"rgba(99,102,241,.4)":"rgba(255,255,255,.08)"}`,borderRadius:20,color:view===v?"#818cf8":"#4b5563",fontSize:11,fontWeight:view===v?700:400,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>
            {l}{v==="pending"&&pendingCount>0?` (${pendingCount})`:""}
          </button>
        ))}
      </div>

      {/* ── TODAY view ── */}
      {view==="today" && (
        <div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
            <Stat l="Present" v={presentCount} s="checked in" c="#10b981"/>
            <Stat l="Absent"  v={absentCount}  s="not seen"  c="#f87171"/>
          </div>
          {team.length===0 && <Empty>No other team members in {emp.branch}</Empty>}
          {team.map(m=>{
            const rec = (m.attendance||[]).find(a=>a.date===today);
            const lv  = (m.leaves||[]).find(l=>l.date===today&&(l.status==="approved"));
            const wo  = (m.weekOffRequests||[]).find(w=>w.date===today&&w.status==="approved");
            const hol = isHoliday(today, branchHolidays, m.branch);
            const sun = isSunday(today);
            const isOff = lv||wo||hol||sun;
            const empOTCfg = (empOTOverrides&&empOTOverrides[m.id])||otConfig||{};
            return (
              <div key={m.id} style={{...S.row,display:"flex",alignItems:"center",gap:10,padding:"10px 12px"}}>
                <Av name={m.name} size={34}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{color:"#e2e8f0",fontSize:13,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.name}</div>
                  <div style={{color:"#4b5563",fontSize:11}}>{m.designation}</div>
                </div>
                <div style={{textAlign:"right",flexShrink:0}}>
                  {rec ? (
                    <div>
                      <div style={{color:"#10b981",fontSize:12,fontWeight:600}}>
                        {fmtT(rec.checkIn)}{rec.checkOut?" → "+fmtT(rec.checkOut):""}
                      </div>
                      {rec.checkOut
                        ? <div style={{color:"#374151",fontSize:10}}>{minsHM(durMins(rec.checkIn,rec.checkOut))}</div>
                        : <div style={{color:"#f59e0b",fontSize:10}}>Still in</div>
                      }
                    </div>
                  ) : isOff ? (
                    <div style={{color:"#6b7280",fontSize:12}}>
                      {lv?"On leave":wo?"Week off":hol?"Holiday":"Sunday"}
                    </div>
                  ) : (
                    <div style={{color:"#374151",fontSize:12}}>Not checked in</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── PENDING APPROVALS view ── */}
      {view==="pending" && (
        <div>
          {pending.length===0 && <Empty>No pending requests</Empty>}
          {pending.map((item,i)=>{
            const kindColors = {leave:["rgba(99,102,241,.12)","rgba(99,102,241,.25)","#818cf8"],ot:["rgba(245,158,11,.1)","rgba(245,158,11,.22)","#fbbf24"],wo:["rgba(245,158,11,.1)","rgba(245,158,11,.22)","#fbbf24"],attendance:["rgba(16,185,129,.1)","rgba(16,185,129,.22)","#10b981"],manual:["rgba(99,102,241,.1)","rgba(99,102,241,.22)","#a78bfa"]};
            const [kbg,kbrd,kclr] = kindColors[item.kind]||kindColors.ot;
            const kindLabel = {leave:"LEAVE",ot:"OT",wo:"WEEK OFF",attendance:"ATTENDANCE",manual:"MANUAL ATT."}[item.kind]||item.kind.toUpperCase();
            return (
            <div key={i} style={{...S.row,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
                  <span style={{color:"#e2e8f0",fontSize:13,fontWeight:600}}>{item.eName}</span>
                  <span style={{background:kbg,border:`1px solid ${kbrd}`,borderRadius:4,padding:"1px 6px",color:kclr,fontSize:10,fontWeight:600}}>{kindLabel}</span>
                </div>
                <div style={{color:"#6b7280",fontSize:12}}>{fmt(item.date)}</div>
                {item.kind==="attendance"&&item.checkIn&&<div style={{color:"#374151",fontSize:11}}>{fmtT(item.checkIn)}{item.checkOut?" → "+fmtT(item.checkOut):""} {item.location?"· 📍"+item.location:""}</div>}
                {item.reason && <div style={{color:"#374151",fontSize:11,marginTop:1}}>{item.reason}</div>}
              </div>
              <div style={{display:"flex",gap:6,flexShrink:0,marginLeft:8}}>
                <Abt ok onClick={()=>act(item.kind,item.eId,item.date,true)}>✓</Abt>
                <Abt   onClick={()=>act(item.kind,item.eId,item.date,false)}>✗</Abt>
              </div>
            </div>
            );
          })}
        </div>
      )}

      {/* ── LEAVES view ── */}
      {view==="leaves" && (
        <div>
          {team.length===0 && <Empty>No team members</Empty>}
          {team.map(m=>{
            const mk = monthKey();
            const monthLeaves = (m.leaves||[]).filter(l=>l.date.startsWith(mk));
            const pendingLeaves = monthLeaves.filter(l=>l.status==="pending");
            const approvedLeaves = monthLeaves.filter(l=>l.status==="approved");
            return (
              <div key={m.id} style={S.row}>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:pendingLeaves.length+approvedLeaves.length>0?8:0}}>
                  <Av name={m.name} size={30}/>
                  <div style={{flex:1}}>
                    <div style={{color:"#e2e8f0",fontSize:13,fontWeight:600}}>{m.name}</div>
                    <div style={{color:"#4b5563",fontSize:11}}>{m.designation} · PL: {m.paidLeaveBalance}/{m.paidLeaveMax||14} · ML: {m.medicalLeaveBalance}/{m.medicalLeaveMax||7}</div>
                  </div>
                </div>
                {pendingLeaves.map((l,i)=>(
                  <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderTop:"1px solid rgba(255,255,255,.05)",fontSize:12}}>
                    <span style={{color:"#818cf8"}}>{fmt(l.date)} · {l.type}{l.halfDay?" (half)":""}</span>
                    <div style={{display:"flex",gap:5,alignItems:"center"}}>
                      <SBadge s="pending"/>
                      <Abt ok onClick={()=>act("leave",m.id,l.date,true)}>✓</Abt>
                      <Abt   onClick={()=>act("leave",m.id,l.date,false)}>✗</Abt>
                    </div>
                  </div>
                ))}
                {approvedLeaves.map((l,i)=>(
                  <div key={"a"+i} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderTop:"1px solid rgba(255,255,255,.05)",fontSize:12}}>
                    <span style={{color:"#374151"}}>{fmt(l.date)} · {l.type}{l.halfDay?" (half)":""}</span>
                    <SBadge s="approved"/>
                  </div>
                ))}
                {monthLeaves.length===0 && <div style={{color:"#1f2937",fontSize:11}}>No leaves this month</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* ── OT view ── */}
      {view==="ot" && (
        <div>
          {team.length===0 && <Empty>No team members</Empty>}
          {team.map(m=>{
            const approved = (m.overtime||[]).filter(o=>o.status==="approved"&&inOTPeriod(o.date));
            const pending2  = (m.overtime||[]).filter(o=>o.status==="pending");
            const totalH = approved.reduce((s,o)=>s+(o.hours||0),0);
            const totalC = approved.reduce((s,o)=>s+(o.cost||0),0);
            return (
              <div key={m.id} style={S.row}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:pending2.length>0?8:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <Av name={m.name} size={30}/>
                    <div>
                      <div style={{color:"#e2e8f0",fontSize:13,fontWeight:600}}>{m.name}</div>
                      <div style={{color:"#4b5563",fontSize:11}}>{m.designation}</div>
                    </div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{color:"#fbbf24",fontSize:13,fontWeight:700}}>{totalH.toFixed(1)}h</div>
                    <div style={{color:"#10b981",fontSize:11}}>{fmtMoney(totalC)}</div>
                  </div>
                </div>
                {pending2.map((o,i)=>(
                  <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderTop:"1px solid rgba(255,255,255,.05)",fontSize:12}}>
                    <span style={{color:"#a78bfa"}}>{fmt(o.date)} · {o.startTime}–{o.endTime} · {fmtOTHours(o.hours)}</span>
                    <div style={{display:"flex",gap:5,alignItems:"center"}}>
                      <SBadge s="pending"/>
                      <Abt ok onClick={()=>act("ot",m.id,o.date,true)}>✓</Abt>
                      <Abt   onClick={()=>act("ot",m.id,o.date,false)}>✗</Abt>
                    </div>
                  </div>
                ))}
                {approved.length===0&&pending2.length===0 && <div style={{color:"#1f2937",fontSize:11}}>No OT this period</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Helper for selected-day detail rows
function DetailRow({ icon, label, color, children }) {
  return (
    <div style={{display:"flex",gap:10,padding:"8px 0",borderBottom:"1px solid rgba(255,255,255,.04)",alignItems:"flex-start"}}>
      <div style={{fontSize:14,marginTop:1,flexShrink:0}}>{icon}</div>
      <div style={{flex:1}}>
        <div style={{color:"#374151",fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:3}}>{label}</div>
        <div style={{display:"flex",flexWrap:"wrap",alignItems:"center",gap:6,fontSize:13}}>{children}</div>
      </div>
    </div>
  );
}

// ─── ATTEND ───────────────────────────────────────────────────────────────────
function AttendTab({ emp, employees, updateEmp, branchHolidays, canApprove, hasAutoApprove, hasAutoApproveManual }) {
  const [busy, setBusy] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [manForm, setManForm] = useState({date:"", checkIn:"", checkOut:"", reason:""});
  const [msg, setMsg] = useState("");
  const flash = m=>{ setMsg(m); setTimeout(()=>setMsg(""),4000); };

  const today = todayStr();
  const rec = emp.attendance?.find(a=>a.date===today);
  const todayIsHol = isHoliday(today, branchHolidays, emp.branch);

  // Window check: 08:17 to 17:16
  const CHECK_IN_START  = 8*60+17;   // 08:17
  const CHECK_IN_END    = 17*60+16;  // 17:16

  const nowMins = ()=>{ const n=new Date(); return n.getHours()*60+n.getMinutes(); };
  const inWindow = ()=>{ const m=nowMins(); return m>=CHECK_IN_START && m<=CHECK_IN_END; };

  const getLoc = ()=>new Promise(res=>{
    if (!navigator.geolocation){ res("Location unavailable"); return; }
    navigator.geolocation.getCurrentPosition(
      p=>res(`${p.coords.latitude.toFixed(4)}, ${p.coords.longitude.toFixed(4)}`),
      ()=>res("Location unavailable")
    );
  });

  const checkIn = async()=>{
    if (!inWindow()) { flash("Check-in only allowed between 08:17 and 17:16"); return; }
    setBusy(true);
    const loc = await getLoc();
    const needsAttApproval = emp.designation === "Medical Support Interpreter";
    updateEmp(emp.id, e=>({ attendance:[...(e.attendance||[]).filter(a=>a.date!==today),
      {date:today, checkIn:new Date().toISOString(), checkOut:null, location:loc,
       isHoliday:isHoliday(today,branchHolidays,emp.branch), isSunday:isSunday(today),
       attStatus: needsAttApproval ? "pending" : "approved", manual:false}] }));
    setBusy(false);
  };

  const checkOut = async()=>{
    if (!inWindow()) { flash("Check-out only allowed between 08:17 and 17:16"); return; }
    setBusy(true);
    const loc = await getLoc();
    updateEmp(emp.id, e=>({ attendance:(e.attendance||[]).map(a=>
      a.date===today ? {...a, checkOut:new Date().toISOString(), checkOutLoc:loc} : a
    )}));
    setBusy(false);
  };

  const submitManual = ()=>{
    if (!manForm.date){ flash("Select a date"); return; }
    if (!manForm.checkIn && !manForm.checkOut){ flash("Enter at least one time"); return; }
    // Check if record already exists for that date
    const existing = (emp.attendance||[]).find(a=>a.date===manForm.date);
    const manStatus = (canApprove || hasAutoApproveManual) ? "approved" : "pending";
    const now = new Date().toISOString();
    const buildTime = (dateStr, timeStr)=>{
      if (!timeStr) return null;
      return new Date(`${dateStr}T${timeStr}:00`).toISOString();
    };
    const ciISO = buildTime(manForm.date, manForm.checkIn);
    const coISO = buildTime(manForm.date, manForm.checkOut);

    if (existing) {
      // Patch missing check-in or check-out only
      updateEmp(emp.id, e=>({ attendance:(e.attendance||[]).map(a=>
        a.date===manForm.date ? {
          ...a,
          checkIn:  (!a.checkIn  && ciISO) ? ciISO : a.checkIn,
          checkOut: (!a.checkOut && coISO) ? coISO : a.checkOut,
          manualPatch: true,
          manualStatus: manStatus,
          manualReason: manForm.reason,
          manualOn: now,
        } : a
      )}));
    } else {
      updateEmp(emp.id, e=>({ attendance:[...(e.attendance||[]),
        {date:manForm.date, checkIn:ciISO, checkOut:coISO, location:"Manual entry",
         isHoliday:isHoliday(manForm.date,branchHolidays,emp.branch), isSunday:isSunday(manForm.date),
         attStatus: manStatus, manual:true, manualStatus:manStatus,
         manualReason:manForm.reason, manualOn:now}
      ]}));
    }
    flash((canApprove||hasAutoApproveManual) ? "Manual entry saved ✓" : "Manual entry submitted — pending approval");
    setShowManual(false); setManForm({date:"",checkIn:"",checkOut:"",reason:""});
  };

  const recent = [...(emp.attendance||[])].reverse().slice(0,15);
  const curMins = nowMins();
  const windowOpen = curMins>=CHECK_IN_START && curMins<=CHECK_IN_END;

  return (
    <Pad>
      <SecTitle style={{marginTop:0}}>Attendance</SecTitle>

      {/* Today card */}
      <div style={{...S.card,textAlign:"center",marginBottom:16}}>
        <div style={{color:"#6b7280",fontSize:13,marginBottom:6}}>{fmt(today)}</div>
        {todayIsHol && <div style={{...S.banner,color:"#fbbf24",marginBottom:10}}>Holiday — working today is at 130% OT</div>}
        {isSunday(today)  && <div style={{...S.banner,color:"#f87171",marginBottom:10}}>Sunday — Rest day</div>}
        {/* Window notice */}
        <div style={{...S.banner,marginBottom:12,fontSize:11,color:windowOpen?"#10b981":"#f87171",borderColor:windowOpen?"rgba(16,185,129,.2)":"rgba(239,68,68,.2)",background:windowOpen?"rgba(16,185,129,.05)":"rgba(239,68,68,.05)"}}>
          {windowOpen ? "✓ Check-in window open (08:17–17:16)" : "⚠ Check-in window: 08:17–17:16 only"}
        </div>

        {!rec && (
          <button onClick={checkIn} disabled={busy||!windowOpen}
            style={{...S.primaryBtn,width:"100%",opacity:!windowOpen?0.4:1}}>
            {busy?"Getting location…":"📍 Check In"}
          </button>
        )}
        {rec&&!rec.checkOut && <>
          <div style={{color:"#10b981",fontSize:15,fontWeight:600,marginBottom:4}}>✓ In · {fmtT(rec.checkIn)}</div>
          <div style={{color:"#374151",fontSize:12,marginBottom:12}}>📍 {rec.location}</div>
          <button onClick={checkOut} disabled={busy||!windowOpen}
            style={{padding:"12px 24px",background:"rgba(239,68,68,.1)",border:"1px solid rgba(239,68,68,.22)",borderRadius:12,color:"#f87171",fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"inherit",width:"100%",opacity:!windowOpen?0.4:1}}>
            {busy?"Getting location…":"📍 Check Out"}
          </button>
        </>}
        {rec?.checkOut && <>
          <div style={{color:"#818cf8",fontSize:15,fontWeight:600}}>{fmtT(rec.checkIn)} → {fmtT(rec.checkOut)}</div>
          <div style={{color:"#10b981",fontSize:13,marginTop:4}}>{minsHM(durMins(rec.checkIn,rec.checkOut))}</div>
          <div style={{color:"#374151",fontSize:11,marginTop:6}}>📍 In: {rec.location}{rec.checkOutLoc?" · Out: "+rec.checkOutLoc:""}</div>
        </>}
      </div>

      {/* Manual entry */}
      <button onClick={()=>setShowManual(!showManual)} style={{width:"100%",padding:"10px",background:showManual?"rgba(99,102,241,.14)":"rgba(255,255,255,.04)",border:`1px solid ${showManual?"rgba(99,102,241,.3)":"rgba(255,255,255,.08)"}`,borderRadius:10,color:showManual?"#818cf8":"#4b5563",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit",marginBottom:10}}>
        ✏️ Manual Entry {(canApprove||hasAutoApproveManual)?"(auto-approved)":"(requires approval)"}
      </button>
      {msg && <SuccBox>{msg}</SuccBox>}
      {showManual && (
        <FCard title="Manual Attendance Entry" onClose={()=>setShowManual(false)}>
          <div style={{...S.banner,marginBottom:10,fontSize:12,color:(canApprove||hasAutoApproveManual)?"#10b981":"#fbbf24"}}>
            {(canApprove||hasAutoApproveManual)
              ? "✓ Your manual entries are auto-approved (Manager/Supervisor)."
              : "⚠ Manual entries require approval from your Manager or Supervisor."}
          </div>
          <FInput label="Date" type="date" value={manForm.date} onChange={v=>setManForm(f=>({...f,date:v}))}/>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9}}>
            <FInput label="Check-in Time (optional)" type="time" value={manForm.checkIn} onChange={v=>setManForm(f=>({...f,checkIn:v}))}/>
            <FInput label="Check-out Time (optional)" type="time" value={manForm.checkOut} onChange={v=>setManForm(f=>({...f,checkOut:v}))}/>
          </div>
          <FInput label="Reason *" value={manForm.reason} onChange={v=>setManForm(f=>({...f,reason:v}))} placeholder="Why was check-in/out missed?"/>
          <button onClick={submitManual} style={{...S.primaryBtn,width:"100%"}}>Submit Manual Entry</button>
        </FCard>
      )}

      <SecTitle>History</SecTitle>
      {recent.length===0 && <Empty>No records yet</Empty>}
      {recent.map((r,i)=>(
        <div key={i} style={{...S.row,display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
              <span style={{color:"#e2e8f0",fontSize:14,fontWeight:500}}>{fmt(r.date)}</span>
              {r.manual && <span style={{background:"rgba(99,102,241,.1)",border:"1px solid rgba(99,102,241,.22)",borderRadius:4,padding:"1px 6px",color:"#818cf8",fontSize:10,fontWeight:600}}>MANUAL</span>}
              {r.manualPatch && <span style={{background:"rgba(245,158,11,.08)",border:"1px solid rgba(245,158,11,.2)",borderRadius:4,padding:"1px 6px",color:"#fbbf24",fontSize:10,fontWeight:600}}>PATCHED</span>}
            </div>
            <div style={{color:"#6b7280",fontSize:12}}>
              {r.checkIn?fmtT(r.checkIn):"-"} → {r.checkOut?fmtT(r.checkOut):"–"}
            </div>
            {r.location && <div style={{color:"#374151",fontSize:11}}>📍 {r.location}</div>}
            {r.manualReason && <div style={{color:"#374151",fontSize:11,marginTop:1}}>"{r.manualReason}"</div>}
          </div>
          <div style={{textAlign:"right",flexShrink:0}}>
            {r.isHoliday && <Chip c="#fbbf24" sm>Holiday</Chip>}
            {r.isSunday  && <Chip c="#f87171" sm>Sunday</Chip>}
            {(r.manual||r.manualPatch) && r.manualStatus && <SBadge s={r.manualStatus}/>}
            {r.checkOut  && <div style={{color:"#10b981",fontSize:12,marginTop:4}}>{minsHM(durMins(r.checkIn,r.checkOut))}</div>}
          </div>
        </div>
      ))}
    </Pad>
  );
}

// ─── LEAVES ───────────────────────────────────────────────────────────────────
function LeavesTab({ emp, employees, canApprove, updateEmp, branchHolidays, otConfig, empOTOverrides, bonusTypes, hasAutoApprove }) {
  const [lf,setLf]=useState({show:false,date:"",type:"paid",halfDay:false,halfSlot:"morning",reason:""});
  const [wf,setWf]=useState({show:false,date:"",reason:""});
  const [msg,setMsg]=useState("");
  const [editLeave,setEditLeave]=useState(null); // {idx, kind:"leave"|"wo", newDate:""}
  const [teamView,setTeamView]=useState(false);
  const mk = monthKey();
  const yr = new Date().getFullYear();
  const woUsed = (emp.weekOffRequests||[]).filter(w=>w.status==="approved"&&w.date.startsWith(mk)).length;
  const halfDaysUsed = (emp.leaves||[]).filter(l=>l.halfDay&&l.status==="approved"&&l.date.startsWith(String(yr))).length;
  const flash = m=>{ setMsg(m); setTimeout(()=>setMsg(""),4000); };

  const empOTCfg = (empOTOverrides&&empOTOverrides[emp.id])||otConfig||{};
  const unpaidDeductAmt = calcUnpaidDeduct(emp.salary||0, otConfig, empOTCfg);
  const halfDayDeductAmt = calcHalfDayDeduct(emp.salary||0, otConfig, empOTCfg);

  const submitLeave = ()=>{
    if (!lf.date){ flash("Select a date"); return; }
    if (lf.type==="paid"&&!lf.halfDay&&emp.paidLeaveBalance<1){ flash("No paid leaves remaining"); return; }
    if (lf.type==="paid"&&lf.halfDay&&emp.paidLeaveBalance<0.5){ flash("Not enough paid leave for half day"); return; }
    if (lf.type==="medical"&&emp.medicalLeaveBalance<1){ flash("No medical leaves remaining"); return; }
    if (lf.halfDay&&halfDaysUsed>=4){ flash("Maximum 4 half days per calendar year used"); return; }
    const leaveStatus = hasAutoApprove ? "approved" : "pending";
    const leave = {date:lf.date,type:lf.type,halfDay:lf.halfDay,halfSlot:lf.halfDay?lf.halfSlot:null,reason:lf.reason,status:leaveStatus,on:new Date().toISOString()};
    updateEmp(emp.id,e=>({ leaves:[...(e.leaves||[]),leave] }));
    flash(`${lf.halfDay?"Half day":"Leave"} ${hasAutoApprove?"auto-approved ✓":"requested — pending approval"}`);
    setLf({show:false,date:"",type:"paid",halfDay:false,halfSlot:"morning",reason:""});
  };
  const submitWO = ()=>{
    if (!wf.date){ flash("Select a date"); return; }
    if (woUsed>=3){ flash("Max 3 week offs per month used"); return; }
    if (isSunday(wf.date)){ flash("Sunday is already a day off"); return; }
    const woStatus = hasAutoApprove ? "approved" : "pending";
    updateEmp(emp.id,e=>({ weekOffRequests:[...(e.weekOffRequests||[]),{date:wf.date,reason:wf.reason,status:woStatus,on:new Date().toISOString()}] }));
    flash(`Week off ${hasAutoApprove?"auto-approved ✓":"requested — pending approval"}`);
    setWf({show:false,date:"",reason:""});
  };

  // ── Employee: cancel an approved/pending leave ────────────────────────────
  const cancelLeave = (idx)=>{
    updateEmp(emp.id,e=>({ leaves:e.leaves.map((l,i)=>i===idx?{...l,status:"cancelled"}:l) }));
    flash("Leave cancelled");
  };
  const cancelWO = (idx)=>{
    updateEmp(emp.id,e=>({ weekOffRequests:e.weekOffRequests.map((w,i)=>i===idx?{...w,status:"cancelled"}:w) }));
    flash("Week off cancelled");
  };

  // ── Employee: reschedule — cancel old, create new pending ─────────────────
  const rescheduleLeave = (oldLeave, newDate)=>{
    if (!newDate){ flash("Select a new date"); return; }
    updateEmp(emp.id,e=>({
      leaves: e.leaves.map(l=>l.date===oldLeave.date&&l.on===oldLeave.on?{...l,status:"cancelled"}:l)
        .concat([{...oldLeave,date:newDate,status:hasAutoApprove?"approved":"pending",
                  rescheduledFrom:oldLeave.date,on:new Date().toISOString()}])
    }));
    flash(`Rescheduled to ${fmt(newDate)} ${hasAutoApprove?"✓":"— pending approval"}`);
    setEditLeave(null);
  };
  const rescheduleWO = (oldWO, newDate)=>{
    if (!newDate){ flash("Select a new date"); return; }
    if (isSunday(newDate)){ flash("Sunday is already a day off"); return; }
    updateEmp(emp.id,e=>({
      weekOffRequests: e.weekOffRequests.map(w=>w.date===oldWO.date&&w.on===oldWO.on?{...w,status:"cancelled"}:w)
        .concat([{...oldWO,date:newDate,status:hasAutoApprove?"approved":"pending",
                  rescheduledFrom:oldWO.date,on:new Date().toISOString()}])
    }));
    flash(`Week off rescheduled to ${fmt(newDate)} ${hasAutoApprove?"✓":"— pending approval"}`);
    setEditLeave(null);
  };

  const allLeaves = [...(emp.leaves||[])].map((l,i)=>({...l,_idx:i})).reverse();
  const unpaidLeaves = allLeaves.filter(l=>l.type==="unpaid"||l.status==="unpaid");
  const paidLeaves   = allLeaves.filter(l=>l.type!=="unpaid"&&l.status!=="unpaid");
  const allWOs       = [...(emp.weekOffRequests||[])].map((w,i)=>({...w,_idx:i})).reverse();

  const canModify = (status)=> status==="approved"||status==="pending";

  return (
    <Pad>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <SecTitle style={{margin:0}}>Leaves & Days Off</SecTitle>
        {canApprove && (
          <button onClick={()=>setTeamView(!teamView)}
            style={{padding:"6px 12px",background:teamView?"rgba(99,102,241,.2)":"rgba(255,255,255,.04)",border:`1px solid ${teamView?"rgba(99,102,241,.35)":"rgba(255,255,255,.08)"}`,borderRadius:8,color:teamView?"#818cf8":"#4b5563",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
            {teamView?"My Leaves":"👥 Team"}
          </button>
        )}
      </div>

      {/* ── TEAM MANAGEMENT VIEW (managers/supervisors) ── */}
      {teamView && canApprove ? (
        <TeamLeaveManager emp={emp} employees={employees} updateEmp={updateEmp} hasAutoApprove={hasAutoApprove} flash={flash}/>
      ) : (<>
        {msg && <SuccBox>{msg}</SuccBox>}
        <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:8,marginBottom:14}}>
          <Stat l="Paid" v={emp.paidLeaveBalance} s={`/${emp.paidLeaveMax||14}`} c="#6366f1"/>
          <Stat l="Medical" v={emp.medicalLeaveBalance} s={`/${emp.medicalLeaveMax||7}`} c="#10b981"/>
          <Stat l="Week Offs" v={woUsed} s="/3 mo" c="#f59e0b"/>
          <Stat l="Half Days" v={halfDaysUsed} s="/4 yr" c="#a78bfa"/>
        </div>

        <div style={{...S.banner,marginBottom:12,fontSize:12,lineHeight:1.8}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
            <div style={{color:"#e2e8f0",fontWeight:600}}>Leave Policies</div>
            {hasAutoApprove && <span style={{background:"rgba(16,185,129,.15)",border:"1px solid rgba(16,185,129,.3)",borderRadius:6,padding:"2px 8px",color:"#10b981",fontSize:11,fontWeight:700}}>✓ AUTO-APPROVE</span>}
          </div>
          <div style={{color:"#6b7280"}}>📅 Half day morning: 08:30–12:30 · Afternoon: 12:31–17:30</div>
          <div style={{color:"#6b7280"}}>💸 Unpaid: <b style={{color:"#f87171"}}>{fmtMoney(unpaidDeductAmt)}</b>/day · 🌗 Half day: <b style={{color:"#a78bfa"}}>{fmtMoney(halfDayDeductAmt)}</b></div>
          <div style={{color:"#4b5563",fontSize:11}}>Approved leaves can be cancelled or rescheduled</div>
        </div>

        <div style={{display:"flex",gap:9,marginBottom:12}}>
          <OBtn col="indigo" onClick={()=>{setLf(f=>({...f,show:!f.show}));setWf(f=>({...f,show:false}))}}>+ Leave</OBtn>
          <OBtn col="amber"  onClick={()=>{setWf(f=>({...f,show:!f.show}));setLf(f=>({...f,show:false}))}}>+ Week Off</OBtn>
        </div>

        {lf.show && (
          <FCard title="Request Leave" onClose={()=>setLf(f=>({...f,show:false}))}>
            <FSel label="Leave Type" value={lf.type} onChange={v=>setLf(f=>({...f,type:v}))}
              opts={[{v:"paid",l:"Paid Leave"},{v:"medical",l:"Medical Leave"},{v:"unpaid",l:"Unpaid Leave (self)"}]}/>
            <FInput label="Date" type="date" value={lf.date} onChange={v=>setLf(f=>({...f,date:v}))}/>
            {lf.type!=="medical" && (
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10,padding:"9px 12px",background:"rgba(167,139,250,.07)",borderRadius:8,border:"1px solid rgba(167,139,250,.18)"}}>
                <input type="checkbox" id="hdCheck" checked={lf.halfDay} onChange={e=>setLf(f=>({...f,halfDay:e.target.checked}))} style={{width:14,height:14,cursor:"pointer"}}/>
                <label htmlFor="hdCheck" style={{color:"#c4b5fd",fontSize:13,cursor:"pointer"}}>Half Day <span style={{color:"#4b5563",fontSize:11}}>(0.5 paid leave)</span></label>
              </div>
            )}
            {lf.halfDay && <FSel label="Slot" value={lf.halfSlot} onChange={v=>setLf(f=>({...f,halfSlot:v}))} opts={[{v:"morning",l:"Morning (08:30–12:30)"},{v:"afternoon",l:"Afternoon (12:31–17:30)"}]}/>}
            <FInput label="Reason (optional)" value={lf.reason} onChange={v=>setLf(f=>({...f,reason:v}))} placeholder="Brief reason"/>
            <button onClick={submitLeave} style={{...S.primaryBtn,width:"100%"}}>Submit Request</button>
          </FCard>
        )}
        {wf.show && (
          <FCard title="Request Week Off" onClose={()=>setWf(f=>({...f,show:false}))}>
            <FInput label="Date" type="date" value={wf.date} onChange={v=>setWf(f=>({...f,date:v}))}/>
            <FInput label="Reason (optional)" value={wf.reason} onChange={v=>setWf(f=>({...f,reason:v}))} placeholder="Brief reason"/>
            <button onClick={submitWO} style={{padding:"12px",background:"rgba(245,158,11,.12)",border:"1px solid rgba(245,158,11,.28)",borderRadius:10,color:"#fbbf24",fontWeight:600,cursor:"pointer",fontFamily:"inherit",width:"100%"}}>Submit Week Off</button>
          </FCard>
        )}

        <SecTitle>My Leaves</SecTitle>
        {paidLeaves.length===0 && <Empty>No leave requests yet</Empty>}
        {paidLeaves.map((l,i)=>(
          <div key={i} style={S.row}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div style={{flex:1}}>
                <div style={{color:"#e2e8f0",fontSize:14,fontWeight:500}}>
                  {l.type==="paid"?"Paid":l.type==="medical"?"Medical":"Unpaid"} Leave
                  {l.halfDay&&<span style={{color:"#a78bfa",fontSize:12}}> · {l.halfSlot==="morning"?"AM":"PM"} half</span>}
                  {l.rescheduledFrom&&<span style={{color:"#4b5563",fontSize:11}}> (from {fmt(l.rescheduledFrom)})</span>}
                </div>
                <div style={{color:"#6b7280",fontSize:12}}>{fmt(l.date)}</div>
                {l.reason&&<div style={{color:"#374151",fontSize:11,marginTop:1}}>{l.reason}</div>}
              </div>
              <SBadge s={l.status}/>
            </div>
            {/* Actions: cancel / reschedule for approved or pending, non-medical, non-cancelled */}
            {canModify(l.status) && l.type!=="unpaid" && (
              <div style={{marginTop:8,display:"flex",gap:6,flexWrap:"wrap"}}>
                {editLeave?.on===l.on ? (
                  <div style={{display:"flex",gap:6,alignItems:"center",width:"100%",flexWrap:"wrap"}}>
                    <input type="date" value={editLeave.newDate} onChange={e=>setEditLeave(ev=>({...ev,newDate:e.target.value}))}
                      style={{...S.input,flex:1,fontSize:13,padding:"6px 10px"}}/>
                    <button onClick={()=>rescheduleLeave(l,editLeave.newDate)} style={{...S.greenBtn,padding:"7px 12px",fontSize:12,marginBottom:0}}>✓ Save</button>
                    <button onClick={()=>setEditLeave(null)} style={{...S.dangerPill}}>✗</button>
                  </div>
                ) : (
                  <>
                    <button onClick={()=>setEditLeave({on:l.on,kind:"leave",newDate:""})}
                      style={{padding:"5px 11px",background:"rgba(99,102,241,.1)",border:"1px solid rgba(99,102,241,.22)",borderRadius:7,color:"#818cf8",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                      📅 Reschedule
                    </button>
                    <button onClick={()=>cancelLeave(l._idx)}
                      style={{padding:"5px 11px",background:"rgba(239,68,68,.08)",border:"1px solid rgba(239,68,68,.2)",borderRadius:7,color:"#f87171",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                      ✗ Cancel
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        ))}

        {unpaidLeaves.length>0 && <>
          <SecTitle>Unpaid Leaves</SecTitle>
          {unpaidLeaves.map((l,i)=>(
            <div key={i} style={{...S.row,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{color:"#f87171",fontSize:14,fontWeight:500}}>Unpaid Leave</div>
                <div style={{color:"#6b7280",fontSize:12}}>{fmt(l.date)}{l.reason?` · ${l.reason}`:""}</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{color:"#f87171",fontSize:12,fontWeight:600}}>−{fmtMoney(unpaidDeductAmt)}</div>
                <SBadge s={l.status||"approved"}/>
              </div>
            </div>
          ))}
        </>}

        {allWOs.length>0 && <>
          <SecTitle>Week Off Requests</SecTitle>
          {allWOs.map((w,i)=>(
            <div key={i} style={S.row}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                <div style={{flex:1}}>
                  <div style={{color:"#e2e8f0",fontSize:14,fontWeight:500}}>Week Off
                    {w.rescheduledFrom&&<span style={{color:"#4b5563",fontSize:11}}> (from {fmt(w.rescheduledFrom)})</span>}
                  </div>
                  <div style={{color:"#6b7280",fontSize:12}}>{fmt(w.date)}</div>
                  {w.reason&&<div style={{color:"#374151",fontSize:11,marginTop:1}}>{w.reason}</div>}
                </div>
                <SBadge s={w.status}/>
              </div>
              {canModify(w.status) && (
                <div style={{marginTop:8,display:"flex",gap:6,flexWrap:"wrap"}}>
                  {editLeave?.on===w.on ? (
                    <div style={{display:"flex",gap:6,alignItems:"center",width:"100%",flexWrap:"wrap"}}>
                      <input type="date" value={editLeave.newDate} onChange={e=>setEditLeave(ev=>({...ev,newDate:e.target.value}))}
                        style={{...S.input,flex:1,fontSize:13,padding:"6px 10px"}}/>
                      <button onClick={()=>rescheduleWO(w,editLeave.newDate)} style={{...S.greenBtn,padding:"7px 12px",fontSize:12,marginBottom:0}}>✓ Save</button>
                      <button onClick={()=>setEditLeave(null)} style={{...S.dangerPill}}>✗</button>
                    </div>
                  ) : (
                    <>
                      <button onClick={()=>setEditLeave({on:w.on,kind:"wo",newDate:""})}
                        style={{padding:"5px 11px",background:"rgba(245,158,11,.08)",border:"1px solid rgba(245,158,11,.2)",borderRadius:7,color:"#fbbf24",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                        📅 Reschedule
                      </button>
                      <button onClick={()=>cancelWO(w._idx)}
                        style={{padding:"5px 11px",background:"rgba(239,68,68,.08)",border:"1px solid rgba(239,68,68,.2)",borderRadius:7,color:"#f87171",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                        ✗ Cancel
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </>}
      </>)}
    </Pad>
  );
}

// ─── TEAM LEAVE MANAGER (for managers/supervisors) ────────────────────────────
function TeamLeaveManager({ emp, employees, updateEmp, hasAutoApprove, flash }) {
  const [selEmpId, setSelEmpId] = useState(null);
  const [addForm, setAddForm] = useState({show:false,type:"paid",date:"",halfDay:false,halfSlot:"morning",reason:""});
  const [addWOForm, setAddWOForm] = useState({show:false,date:"",reason:""});
  const [editItem, setEditItem] = useState(null); // {empId, kind:"leave"|"wo", item, newDate:""}

  const branchTeam = employees.filter(e=>e.active && e.branch===emp.branch);
  const target = selEmpId ? employees.find(e=>e.id===selEmpId) : null;

  const assignLeave = ()=>{
    if (!addForm.date||!selEmpId){ flash("Select employee and date"); return; }
    const leave = {date:addForm.date,type:addForm.type,halfDay:addForm.halfDay,
      halfSlot:addForm.halfDay?addForm.halfSlot:null,reason:addForm.reason,
      status:"approved",assignedBy:emp.name,on:new Date().toISOString()};
    updateEmp(selEmpId,e=>({ leaves:[...(e.leaves||[]),leave] }));
    flash(`Leave assigned to ${target?.name} ✓`);
    setAddForm({show:false,type:"paid",date:"",halfDay:false,halfSlot:"morning",reason:""});
  };
  const assignWO = ()=>{
    if (!addWOForm.date||!selEmpId){ flash("Select employee and date"); return; }
    if (isSunday(addWOForm.date)){ flash("Sunday is already off"); return; }
    updateEmp(selEmpId,e=>({ weekOffRequests:[...(e.weekOffRequests||[]),
      {date:addWOForm.date,reason:addWOForm.reason,status:"approved",
       assignedBy:emp.name,on:new Date().toISOString()}] }));
    flash(`Week off assigned to ${target?.name} ✓`);
    setAddWOForm({show:false,date:"",reason:""});
  };
  const removeLeave = (empId,leaveOn)=>{
    updateEmp(empId,e=>({ leaves:e.leaves.map(l=>l.on===leaveOn?{...l,status:"cancelled",removedBy:emp.name}:l) }));
    flash("Leave removed");
  };
  const removeWO = (empId,woOn)=>{
    updateEmp(empId,e=>({ weekOffRequests:e.weekOffRequests.map(w=>w.on===woOn?{...w,status:"cancelled",removedBy:emp.name}:w) }));
    flash("Week off removed");
  };
  const rescheduleItem = ()=>{
    if (!editItem?.newDate){ flash("Select new date"); return; }
    if (editItem.kind==="leave") {
      updateEmp(editItem.empId,e=>({
        leaves:e.leaves.map(l=>l.on===editItem.item.on?{...l,status:"cancelled"}:l)
          .concat([{...editItem.item,date:editItem.newDate,status:"approved",
                    rescheduledFrom:editItem.item.date,rescheduledBy:emp.name,on:new Date().toISOString()}])
      }));
    } else {
      if (isSunday(editItem.newDate)){ flash("Sunday is already off"); return; }
      updateEmp(editItem.empId,e=>({
        weekOffRequests:e.weekOffRequests.map(w=>w.on===editItem.item.on?{...w,status:"cancelled"}:w)
          .concat([{...editItem.item,date:editItem.newDate,status:"approved",
                    rescheduledFrom:editItem.item.date,rescheduledBy:emp.name,on:new Date().toISOString()}])
      }));
    }
    flash(`Rescheduled to ${fmt(editItem.newDate)} ✓`);
    setEditItem(null);
  };

  return (
    <div>
      {/* Employee selector */}
      <div style={{...S.banner,marginBottom:12,fontSize:12,color:"#6b7280"}}>
        Select a team member to manage their leaves and week-offs. Changes take effect immediately.
      </div>
      <FSel label="Team Member" value={selEmpId||""} onChange={setSelEmpId}
        opts={[{v:"",l:"— Select employee —"},...branchTeam.map(e=>({v:e.id,l:`${e.name} (${e.designation})`}))]}/>

      {target && (<>
        {/* Action buttons */}
        <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
          <OBtn col="indigo" onClick={()=>{setAddForm(f=>({...f,show:!f.show}));setAddWOForm(f=>({...f,show:false}))}}>+ Assign Leave</OBtn>
          <OBtn col="amber"  onClick={()=>{setAddWOForm(f=>({...f,show:!f.show}));setAddForm(f=>({...f,show:false}))}}>+ Assign Week Off</OBtn>
        </div>

        {addForm.show && (
          <FCard title={`Assign Leave — ${target.name}`} onClose={()=>setAddForm(f=>({...f,show:false}))}>
            <FSel label="Leave Type" value={addForm.type} onChange={v=>setAddForm(f=>({...f,type:v}))}
              opts={[{v:"paid",l:"Paid Leave"},{v:"medical",l:"Medical Leave"},{v:"unpaid",l:"Unpaid Leave"}]}/>
            <FInput label="Date" type="date" value={addForm.date} onChange={v=>setAddForm(f=>({...f,date:v}))}/>
            {addForm.type!=="medical" && (
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10,padding:"8px 12px",background:"rgba(167,139,250,.07)",borderRadius:8,border:"1px solid rgba(167,139,250,.18)"}}>
                <input type="checkbox" id="thdCheck" checked={addForm.halfDay} onChange={e=>setAddForm(f=>({...f,halfDay:e.target.checked}))} style={{width:14,height:14}}/>
                <label htmlFor="thdCheck" style={{color:"#c4b5fd",fontSize:13,cursor:"pointer"}}>Half Day</label>
              </div>
            )}
            {addForm.halfDay && <FSel label="Slot" value={addForm.halfSlot} onChange={v=>setAddForm(f=>({...f,halfSlot:v}))} opts={[{v:"morning",l:"Morning"},{v:"afternoon",l:"Afternoon"}]}/>}
            <FInput label="Reason (optional)" value={addForm.reason} onChange={v=>setAddForm(f=>({...f,reason:v}))} placeholder="Brief reason"/>
            <button onClick={assignLeave} style={{...S.primaryBtn,width:"100%"}}>Assign Leave (Auto-approved)</button>
          </FCard>
        )}
        {addWOForm.show && (
          <FCard title={`Assign Week Off — ${target.name}`} onClose={()=>setAddWOForm(f=>({...f,show:false}))}>
            <FInput label="Date" type="date" value={addWOForm.date} onChange={v=>setAddWOForm(f=>({...f,date:v}))}/>
            <FInput label="Reason (optional)" value={addWOForm.reason} onChange={v=>setAddWOForm(f=>({...f,reason:v}))} placeholder="Brief reason"/>
            <button onClick={assignWO} style={{padding:"12px",background:"rgba(245,158,11,.12)",border:"1px solid rgba(245,158,11,.28)",borderRadius:10,color:"#fbbf24",fontWeight:600,cursor:"pointer",fontFamily:"inherit",width:"100%"}}>Assign Week Off (Auto-approved)</button>
          </FCard>
        )}

        {/* Reschedule inline form */}
        {editItem && (
          <FCard title="Reschedule" onClose={()=>setEditItem(null)}>
            <div style={{color:"#6b7280",fontSize:12,marginBottom:8}}>
              {editItem.kind==="leave"?"Leave":"Week off"} on {fmt(editItem.item.date)} → new date:
            </div>
            <FInput label="New Date" type="date" value={editItem.newDate} onChange={v=>setEditItem(i=>({...i,newDate:v}))}/>
            <button onClick={rescheduleItem} style={{...S.primaryBtn,width:"100%"}}>Confirm Reschedule</button>
          </FCard>
        )}

        {/* Target employee's leaves */}
        <SecTitle>{target.name}'s Leaves</SecTitle>
        {[...(target.leaves||[])].filter(l=>l.status!=="cancelled"&&l.type!=="unpaid").reverse().map((l,i)=>(
          <div key={i} style={S.row}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{color:"#e2e8f0",fontSize:13,fontWeight:500}}>
                  {l.type==="paid"?"Paid":l.type==="medical"?"Medical":"Unpaid"} Leave
                  {l.halfDay&&<span style={{color:"#a78bfa",fontSize:11}}> · {l.halfSlot==="morning"?"AM":"PM"}</span>}
                </div>
                <div style={{color:"#6b7280",fontSize:12}}>{fmt(l.date)}</div>
                {l.assignedBy&&<div style={{color:"#374151",fontSize:11}}>Assigned by {l.assignedBy}</div>}
              </div>
              <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
                <SBadge s={l.status}/>
                <button onClick={()=>setEditItem({empId:target.id,kind:"leave",item:l,newDate:""})}
                  style={{padding:"4px 8px",background:"rgba(99,102,241,.1)",border:"1px solid rgba(99,102,241,.2)",borderRadius:6,color:"#818cf8",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>📅</button>
                <button onClick={()=>removeLeave(target.id,l.on)}
                  style={{padding:"4px 8px",background:"rgba(239,68,68,.08)",border:"1px solid rgba(239,68,68,.18)",borderRadius:6,color:"#f87171",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>✗</button>
              </div>
            </div>
          </div>
        ))}
        {(target.leaves||[]).filter(l=>l.status!=="cancelled"&&l.type!=="unpaid").length===0 && <Empty>No leaves</Empty>}

        <SecTitle>{target.name}'s Week Offs</SecTitle>
        {[...(target.weekOffRequests||[])].filter(w=>w.status!=="cancelled").reverse().map((w,i)=>(
          <div key={i} style={S.row}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{color:"#e2e8f0",fontSize:13,fontWeight:500}}>Week Off</div>
                <div style={{color:"#6b7280",fontSize:12}}>{fmt(w.date)}</div>
                {w.assignedBy&&<div style={{color:"#374151",fontSize:11}}>Assigned by {w.assignedBy}</div>}
              </div>
              <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
                <SBadge s={w.status}/>
                <button onClick={()=>setEditItem({empId:target.id,kind:"wo",item:w,newDate:""})}
                  style={{padding:"4px 8px",background:"rgba(245,158,11,.08)",border:"1px solid rgba(245,158,11,.2)",borderRadius:6,color:"#fbbf24",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>📅</button>
                <button onClick={()=>removeWO(target.id,w.on)}
                  style={{padding:"4px 8px",background:"rgba(239,68,68,.08)",border:"1px solid rgba(239,68,68,.18)",borderRadius:6,color:"#f87171",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>✗</button>
              </div>
            </div>
          </div>
        ))}
        {(target.weekOffRequests||[]).filter(w=>w.status!=="cancelled").length===0 && <Empty>No week offs</Empty>}
      </>)}
      {!selEmpId && <Empty>Select a team member above to manage their leaves</Empty>}
    </div>
  );
}

// ─── OT ───────────────────────────────────────────────────────────────────────
function OTTab({ emp, employees, canApprove, updateEmp, branchHolidays, setBranchHolidays, otConfig, empOTOverrides }) {
  const [otType, setOtType] = useState("regular"); // "regular" | "call"
  const [form, setForm] = useState({show:false,date:"",s:"",e:"",reason:""});
  const [msg, setMsg] = useState("");
  // Holiday management state (for managers/supervisors)
  const [showHolMgmt, setShowHolMgmt] = useState(false);
  const [newHolDate, setNewHolDate] = useState("");
  const [newHolName, setNewHolName] = useState("");
  const flash = m=>{ setMsg(m); setTimeout(()=>setMsg(""),3000); };
  const [showPwChange, setShowPwChange] = useState(false);
  const [pwForm, setPwForm] = useState({cur:"",nw:"",cf:""});
  const [pwMsg, setPwMsg] = useState("");
  const changeHrPw = ()=>{
    if (pwForm.cur !== hrPassword) { setPwMsg("Current password incorrect"); return; }
    if (pwForm.nw.length < 6)      { setPwMsg("Minimum 6 characters"); return; }
    if (pwForm.nw !== pwForm.cf)   { setPwMsg("Passwords don't match"); return; }
    setHrPassword(pwForm.nw);
    setPwMsg("Password updated ✓"); setPwForm({cur:"",nw:"",cf:""});
    setTimeout(()=>setPwMsg(""),3000);
  };

  const hrRate = calcHourlyRate(emp.salary||0);
  const empOTCfg = (empOTOverrides&&empOTOverrides[emp.id]) || otConfig || {};
  const regularPct    = empOTCfg.regularPct     ?? 100;
  const nightHolPct   = empOTCfg.nightHolidayPct ?? 130;
  const branch = emp.branch;

  // Preview calculations depending on OT type
  const rawMins = (()=>{
    if (!form.s||!form.e) return 0;
    const [sh,sm]=form.s.split(":").map(Number),[eh,em]=form.e.split(":").map(Number);
    let m=(eh*60+em)-(sh*60+sm); if(m<0) m+=1440; return m;
  })();
  const ph = otType==="call" ? calcCallOTBlocks(form.s, form.e) : calcOTBlocks(form.s, form.e);
  const pr = form.date ? calcOTRate(form.date, form.s, otConfig, empOTOverrides&&empOTOverrides[emp.id]) : regularPct/100;
  const pc = calcOTCost(emp.salary||0, ph, pr);

  const submitOT = ()=>{
    if (!form.date||!form.s||!form.e){ flash("Fill all fields"); return; }
    if (ph === 0){ flash(otType==="call"?"Below 16-minute minimum":"Below threshold — no OT blocks counted"); return; }
    const hours=ph, rate=calcOTRate(form.date,form.s,otConfig,empOTOverrides&&empOTOverrides[emp.id]), cost=calcOTCost(emp.salary||0,hours,rate);
    updateEmp(emp.id,e=>({ overtime:[...(e.overtime||[]),{date:form.date,startTime:form.s,endTime:form.e,hours,rate,cost,otType,reason:form.reason,status:"pending",on:new Date().toISOString()}] }));
    flash(`${otType==="call"?"Call OT":"OT"} submitted: ${fmtOTHours(hours)} @ ${rate*100}% → ${fmtMoney(cost)} ✓`);
    setForm({show:false,date:"",s:"",e:"",reason:""});
  };

  // Branch holidays management
  const branchHols = (branchHolidays && branchHolidays[branch]) || [];
  const addBranchHoliday = ()=>{
    if (!newHolDate){ flash("Select a date"); return; }
    const existing = branchHolidays[branch]||[];
    if (existing.includes(newHolDate)){ flash("Already added"); return; }
    const label = newHolName.trim() || fmt(newHolDate);
    const entry = `${newHolDate}|${label}`;
    // Store as "date|name" strings for display
    setBranchHolidays(prev=>({...prev, [branch]:[...(prev[branch]||[]), entry]}));
    flash(`Holiday added for ${branch} ✓`); setNewHolDate(""); setNewHolName("");
  };
  const removeBranchHoliday = (entry)=>{
    setBranchHolidays(prev=>({...prev, [branch]:(prev[branch]||[]).filter(e=>e!==entry)}));
  };
  // Parse stored entries (support both plain date strings and "date|name")
  const parsedHols = branchHols.map(e=>{
    const parts = e.split("|"); return {date:parts[0], name:parts[1]||fmt(parts[0]), raw:e};
  });

  const { start: otStart, end: otEnd } = otPeriod();
  const approved = (emp.overtime||[]).filter(o=>o.status==="approved"&&inOTPeriod(o.date));
  const totalH = approved.reduce((s,o)=>s+(o.hours||0),0);
  const totalC = approved.reduce((s,o)=>s+(o.cost||0),0);
  const approvedReg  = approved.filter(o=>o.otType!=="call");
  const approvedCall = approved.filter(o=>o.otType==="call");

  return (
    <Pad>
      <SecTitle style={{marginTop:0}}>Overtime</SecTitle>
      {msg && <SuccBox>{msg}</SuccBox>}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9,marginBottom:14}}>
        <Stat l="Approved Hrs" v={totalH.toFixed(1)} s={fmtPeriod()} c="#f59e0b"/>
        <Stat l="OT Earned"    v={fmtMoney(totalC)} s={fmtPeriod()} c="#6366f1"/>
      </div>

      {/* Rate card */}
      <div style={{...S.banner,marginBottom:14,lineHeight:1.85}}>
        <div style={{color:"#e2e8f0",fontWeight:600,marginBottom:2,fontSize:13}}>Your OT Rates — Salary {fmtMoney(emp.salary||0)}/mo</div>
        <div style={{color:"#4b5563",fontSize:11,marginBottom:6}}>Pay period: <span style={{color:"#818cf8"}}>{fmtPeriod()}</span></div>
        <div style={{fontSize:12,color:"#6b7280"}}>Base hourly (0.5%): <b style={{color:"#fbbf24"}}>{fmtMoney(hrRate)}/hr</b></div>
        <div style={{fontSize:12,color:"#6b7280"}}>Regular OT: <b style={{color:"#10b981"}}>{regularPct}% → {fmtMoney(hrRate*regularPct/100)}/hr</b></div>
        <div style={{fontSize:12,color:"#6b7280"}}>Night / Holiday: <b style={{color:"#f87171"}}>{nightHolPct}% → {fmtMoney(hrRate*nightHolPct/100)}/hr</b></div>
        <div style={{fontSize:12,color:"#6b7280",marginTop:6,paddingTop:6,borderTop:"1px solid rgba(255,255,255,.06)"}}>
          <b style={{color:"#e2e8f0"}}>Regular OT</b> — blocks from clock boundary, start offset deducted
        </div>
        <div style={{fontSize:12,color:"#6b7280"}}>
          <b style={{color:"#a78bfa"}}>Call OT</b> — blocks counted from exact start time, ≥16 min = 0.5h
        </div>
      </div>

      {/* OT type toggle */}
      <div style={{display:"flex",gap:8,marginBottom:10}}>
        <button onClick={()=>setOtType("regular")} style={{flex:1,padding:"10px",background:otType==="regular"?"rgba(245,158,11,.15)":"rgba(255,255,255,.04)",border:`1px solid ${otType==="regular"?"rgba(245,158,11,.4)":"rgba(255,255,255,.08)"}`,borderRadius:9,color:otType==="regular"?"#fbbf24":"#4b5563",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
          ⏱ Regular OT
        </button>
        <button onClick={()=>setOtType("call")} style={{flex:1,padding:"10px",background:otType==="call"?"rgba(167,139,250,.15)":"rgba(255,255,255,.04)",border:`1px solid ${otType==="call"?"rgba(167,139,250,.4)":"rgba(255,255,255,.08)"}`,borderRadius:9,color:otType==="call"?"#a78bfa":"#4b5563",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
          📞 Call OT
        </button>
      </div>

      <OBtn col={otType==="call"?"purple":"amber"} onClick={()=>setForm(f=>({...f,show:!f.show}))} full>
        + Log {otType==="call"?"Call OT":"Regular OT"}
      </OBtn>

      {form.show && (
        <FCard title={`Log ${otType==="call"?"Call OT":"Regular OT"}`} onClose={()=>setForm(f=>({...f,show:false}))}>
          <FInput label="Date" type="date" value={form.date} onChange={v=>setForm(f=>({...f,date:v}))}/>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9}}>
            <FInput label="Start Time" type="time" value={form.s} onChange={v=>setForm(f=>({...f,s:v}))}/>
            <FInput label="End Time"   type="time" value={form.e} onChange={v=>setForm(f=>({...f,e:v}))}/>
          </div>
          {(form.s && form.e) && (
            <div style={{background:ph>0?"rgba(245,158,11,.06)":"rgba(239,68,68,.06)",border:ph>0?"1px solid rgba(245,158,11,.18)":"1px solid rgba(239,68,68,.18)",borderRadius:8,padding:"10px 12px",fontSize:12,marginBottom:8,lineHeight:1.9}}>
              <div style={{color:ph>0?"#fbbf24":"#f87171",fontWeight:600,marginBottom:2}}>
                {rawMins} min → {ph>0 ? ph+"h ("+(ph/0.5)+" block"+(ph/0.5!==1?"s":"")+" × 30 min)" : "0h — below threshold"}
              </div>
              {ph>0 && <div style={{color:"#6b7280"}}>{ph}h × {fmtMoney(hrRate)} × {pr*100}% = <b style={{color:"#fbbf24"}}>{fmtMoney(pc)}</b></div>}
              <div style={{color:"#374151",fontSize:11,marginTop:2}}>
                {otType==="call"
                  ? "Call OT: blocks from exact start · ≥16 min into a block = +0.5h"
                  : "Regular OT: start offset deducted · each block needs ≥16 min"}
              </div>
            </div>
          )}
          <FInput label="Reason / Task" value={form.reason} onChange={v=>setForm(f=>({...f,reason:v}))} placeholder="What were you working on?"/>
          <button onClick={submitOT} style={{padding:"12px",background:otType==="call"?"rgba(167,139,250,.14)":"rgba(245,158,11,.12)",border:`1px solid ${otType==="call"?"rgba(167,139,250,.3)":"rgba(245,158,11,.28)"}`,borderRadius:10,color:otType==="call"?"#a78bfa":"#fbbf24",fontWeight:600,cursor:"pointer",fontFamily:"inherit",width:"100%"}}>
            Submit {otType==="call"?"Call OT":"Regular OT"}
          </button>
        </FCard>
      )}

      {/* Branch Holiday Management — only for managers/supervisors */}
      {canApprove && (
        <div style={{marginTop:8}}>
          <button onClick={()=>setShowHolMgmt(!showHolMgmt)} style={{width:"100%",padding:"10px",background:showHolMgmt?"rgba(99,102,241,.14)":"rgba(255,255,255,.04)",border:`1px solid ${showHolMgmt?"rgba(99,102,241,.3)":"rgba(255,255,255,.08)"}`,borderRadius:9,color:showHolMgmt?"#818cf8":"#4b5563",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit",marginBottom:8}}>
            🗓 Manage {branch} Holidays {parsedHols.length>0?`(${parsedHols.length})`:""}
          </button>
          {showHolMgmt && (
            <FCard title={`${branch} — Branch Holidays`} onClose={()=>setShowHolMgmt(false)}>
              <div style={{fontSize:12,color:"#4b5563",marginBottom:10}}>These holidays apply only to <b style={{color:"#818cf8"}}>{branch}</b>. National holidays are separate.</div>
              <FInput label="Date" type="date" value={newHolDate} onChange={setNewHolDate}/>
              <FInput label="Holiday Name" value={newHolName} onChange={setNewHolName} placeholder="e.g. Founder's Day"/>
              <OBtn col="indigo" onClick={addBranchHoliday} full>+ Add Holiday</OBtn>
              {parsedHols.length===0 && <Empty>No branch holidays added yet</Empty>}
              {parsedHols.map((h,i)=>(
                <div key={i} style={{...S.row,display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 12px"}}>
                  <div>
                    <div style={{color:"#e2e8f0",fontSize:13,fontWeight:500}}>{h.name}</div>
                    <div style={{color:"#6b7280",fontSize:12}}>{fmt(h.date)}</div>
                  </div>
                  <button onClick={()=>removeBranchHoliday(h.raw)} style={S.dangerPill}>Remove</button>
                </div>
              ))}
              <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid rgba(255,255,255,.06)"}}>
                <div style={{color:"#374151",fontSize:12,fontWeight:600,marginBottom:6}}>National Holidays (fixed)</div>
                {NATIONAL_HOLIDAYS_2025.map((d,i)=>(
                  <div key={i} style={{color:"#374151",fontSize:11,padding:"3px 0",borderBottom:"1px solid rgba(255,255,255,.03)"}}>{fmt(d)}</div>
                ))}
              </div>
            </FCard>
          )}
        </div>
      )}

      <SecTitle>My OT Records</SecTitle>
      {(emp.overtime||[]).length===0 && <Empty>No overtime records yet</Empty>}
      {[...(emp.overtime||[])].reverse().map((o,i)=>(
        <div key={i} style={{...S.row,display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
              <div style={{color:"#e2e8f0",fontSize:14,fontWeight:500}}>{fmt(o.date)}</div>
              {o.otType==="call"
                ? <span style={{background:"rgba(167,139,250,.12)",border:"1px solid rgba(167,139,250,.25)",borderRadius:5,padding:"1px 7px",color:"#a78bfa",fontSize:10,fontWeight:600}}>CALL</span>
                : <span style={{background:"rgba(245,158,11,.1)",border:"1px solid rgba(245,158,11,.22)",borderRadius:5,padding:"1px 7px",color:"#fbbf24",fontSize:10,fontWeight:600}}>OT</span>
              }
            </div>
            <div style={{color:"#6b7280",fontSize:12}}>{o.startTime}–{o.endTime} · {fmtOTHours(o.hours)} @ {o.rate*100}%</div>
            {o.reason && <div style={{color:"#374151",fontSize:11,marginTop:2}}>{o.reason}</div>}
          </div>
          <div style={{textAlign:"right",flexShrink:0,marginLeft:8}}>
            <div style={{color:"#fbbf24",fontSize:13,fontWeight:700}}>{fmtMoney(o.cost)}</div>
            <SBadge s={o.status}/>
          </div>
        </div>
      ))}
    </Pad>
  );
}

// ─── PROFILE ─────────────────────────────────────────────────────────────────
function ProfileTab({ emp, updateEmp, onLogout, otConfig, empOTOverrides, latePolicy }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(emp.name);
  const [pw, setPw] = useState({cur:"",nw:"",cf:""});
  const [pwMsg, setPwMsg] = useState("");
  const [showPay, setShowPay] = useState(false); // hidden by default

  const cfg = (empOTOverrides&&empOTOverrides[emp.id])||otConfig||{};
  const rPct = cfg.regularPct ?? 100;
  const nPct = cfg.nightHolidayPct ?? 130;
  const hrRate = calcHourlyRate(emp.salary||0);

  // Current period OT
  const approvedOT = (emp.overtime||[]).filter(o=>o.status==="approved"&&inOTPeriod(o.date));
  const otHours = approvedOT.reduce((s,o)=>s+(o.hours||0),0);
  const otEarnings = approvedOT.reduce((s,o)=>s+(o.cost||0),0);

  // Bonuses this period
  const bonusTotal = (emp.bonuses||[]).filter(b=>inOTPeriod(b.date)).reduce((s,b)=>s+(b.amount||0),0);

  // Deductions this period (late + early)
  const lateTotal = (emp.attendance||[]).filter(a=>inOTPeriod(a.date)).reduce((s,a)=>{
    const d = calcAttendanceDeductions(a.checkIn,a.checkOut,emp.salary||0,otConfig,cfg,latePolicy);
    return s + d.lateDeduct + d.earlyDeduct;
  },0);

  // Unpaid leave deductions
  const unpaidTotal = (emp.leaves||[]).filter(l=>inOTPeriod(l.date)&&(l.type==="unpaid"||l.status==="unpaid"))
    .reduce((s)=>s+calcUnpaidDeduct(emp.salary||0,otConfig,cfg),0);

  const halfDayTotal = (emp.leaves||[]).filter(l=>inOTPeriod(l.date)&&l.halfDay&&l.status==="approved")
    .reduce((s)=>s+calcHalfDayDeduct(emp.salary||0,otConfig,cfg),0);

  const totalDeductions = lateTotal + unpaidTotal + halfDayTotal;
  const estimatedNet = (emp.salary||0) + otEarnings + bonusTotal - totalDeductions;

  const saveName = ()=>{ if(!name.trim()) return; updateEmp(emp.id,()=>({name:name.trim()})); setEditing(false); };
  const changePw = ()=>{
    if (pw.cur!==emp.password){ setPwMsg("Current password incorrect"); return; }
    if (pw.nw.length<6){ setPwMsg("Minimum 6 characters"); return; }
    if (pw.nw!==pw.cf){ setPwMsg("Passwords don't match"); return; }
    updateEmp(emp.id,()=>({password:pw.nw}));
    setPwMsg("Password updated ✓"); setPw({cur:"",nw:"",cf:""});
    setTimeout(()=>setPwMsg(""),3000);
  };

  return (
    <Pad>
      {/* Avatar + name */}
      <div style={{textAlign:"center",marginBottom:20}}>
        <Av name={emp.name} size={64}/>
        <div style={{...S.heading,fontSize:22,marginTop:12}}>{emp.name}</div>
        <div style={{color:"#6366f1",fontSize:14,marginTop:2}}>{emp.designation} · {emp.branch}</div>
        <div style={{color:"#374151",fontSize:12,marginTop:2}}>{emp.id} · @{emp.username}</div>
      </div>

      {/* Leave balances */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9,marginBottom:12}}>
        <IBox l="Paid Leave"  v={`${emp.paidLeaveBalance} / ${emp.paidLeaveMax||14}`}/>
        <IBox l="Medical"     v={`${emp.medicalLeaveBalance} / ${emp.medicalLeaveMax||7}`}/>
        <IBox l="Late Grace"  v={`Until ${latePolicy?.graceEnd||"08:30"}`}/>
        <IBox l="Late Deduct" v={`After ${latePolicy?.lateDeductHr||"09:30"}`}/>
      </div>

      {/* ── Salary & OT card — hidden, tap to reveal ── */}
      <div style={{...S.card,marginBottom:12,overflow:"hidden"}}>
        <button
          onClick={()=>setShowPay(!showPay)}
          style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",padding:0}}
        >
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:16}}>💰</span>
            <span style={{color:"#e2e8f0",fontWeight:600,fontSize:14}}>Pay Summary</span>
            <span style={{color:"#4b5563",fontSize:11}}>{fmtPeriod()}</span>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            {!showPay && (
              <span style={{background:"rgba(99,102,241,.15)",border:"1px solid rgba(99,102,241,.25)",borderRadius:20,padding:"2px 10px",color:"#818cf8",fontSize:11,fontWeight:600}}>
                Tap to reveal
              </span>
            )}
            <span style={{color:"#4b5563",fontSize:16,lineHeight:1}}>{showPay?"▲":"▼"}</span>
          </div>
        </button>

        {showPay && (
          <div style={{marginTop:14,paddingTop:14,borderTop:"1px solid rgba(255,255,255,.07)"}}>
            {/* Net estimate hero */}
            <div style={{textAlign:"center",marginBottom:14,padding:"14px",background:"linear-gradient(135deg,rgba(16,185,129,.1),rgba(99,102,241,.08))",borderRadius:10,border:"1px solid rgba(16,185,129,.15)"}}>
              <div style={{color:"#6b7280",fontSize:11,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.06em"}}>Estimated Net This Period</div>
              <div style={{color:"#10b981",fontFamily:"Syne,sans-serif",fontSize:28,fontWeight:800}}>{fmtMoney(estimatedNet)}</div>
              <div style={{color:"#374151",fontSize:11,marginTop:2}}>
              {salaryMonth().name} {salaryMonth().year} salary · OT: {fmtPeriod()}
            </div>
            <div style={{color:"#374151",fontSize:11}}>Paid in {paymentWeek()}</div>
            </div>

            {/* Breakdown */}
            <div style={{display:"flex",flexDirection:"column",gap:0}}>
              <PayRow icon="🏦" label="Base Salary"   value={fmtMoney(emp.salary||0)}    color="#e2e8f0" positive/>
              <PayRow icon="⏱" label={`OT (${otHours.toFixed(1)}h)`} value={otEarnings>0?"+"+fmtMoney(otEarnings):"—"} color="#fbbf24" positive={otEarnings>0}/>
              <PayRow icon="🎁" label="Bonuses"        value={bonusTotal>0?"+"+fmtMoney(bonusTotal):"—"} color="#a78bfa" positive={bonusTotal>0}/>
              {lateTotal>0    && <PayRow icon="🕐" label="Late deductions"   value={"−"+fmtMoney(lateTotal)}   color="#f87171"/>}
              {unpaidTotal>0  && <PayRow icon="📅" label="Unpaid leave"      value={"−"+fmtMoney(unpaidTotal)} color="#f87171"/>}
              {halfDayTotal>0 && <PayRow icon="🌗" label="Half day deduct"   value={"−"+fmtMoney(halfDayTotal)} color="#f87171"/>}
            </div>

            {/* OT rate reminder */}
            <div style={{marginTop:12,paddingTop:10,borderTop:"1px solid rgba(255,255,255,.06)",display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <div style={{background:"rgba(255,255,255,.04)",borderRadius:8,padding:"8px 10px",textAlign:"center"}}>
                <div style={{color:"#fbbf24",fontSize:13,fontWeight:700}}>{fmtMoney(hrRate*rPct/100)}/hr</div>
                <div style={{color:"#4b5563",fontSize:10,marginTop:2}}>Regular OT ({rPct}%)</div>
              </div>
              <div style={{background:"rgba(255,255,255,.04)",borderRadius:8,padding:"8px 10px",textAlign:"center"}}>
                <div style={{color:"#f87171",fontSize:13,fontWeight:700}}>{fmtMoney(hrRate*nPct/100)}/hr</div>
                <div style={{color:"#4b5563",fontSize:10,marginTop:2}}>Night/Holiday ({nPct}%)</div>
              </div>
            </div>

            <div style={{marginTop:8,fontSize:11,color:"#374151",textAlign:"center"}}>
              Estimated only — final payroll processed by HR
            </div>
          </div>
        )}
      </div>

      {/* Edit name */}
      <div style={S.card}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <span style={{color:"#e2e8f0",fontWeight:600,fontSize:14}}>Display Name</span>
          <button onClick={()=>setEditing(!editing)} style={{background:"none",border:"none",color:"#6366f1",cursor:"pointer",fontSize:13,fontFamily:"inherit"}}>{editing?"Cancel":"Edit"}</button>
        </div>
        {editing ? (
          <div style={{display:"flex",gap:8}}>
            <input value={name} onChange={e=>setName(e.target.value)} style={{...S.input,flex:1}}/>
            <button onClick={saveName} style={{...S.primaryBtn,padding:"10px 16px",fontSize:13}}>Save</button>
          </div>
        ) : <div style={{color:"#6b7280",fontSize:14}}>{emp.name}</div>}
      </div>

      {/* Change password */}
      <div style={{...S.card,marginTop:10}}>
        <div style={{color:"#e2e8f0",fontWeight:600,fontSize:14,marginBottom:12}}>Change Password</div>
        {pwMsg && <div style={{fontSize:12,padding:"8px 12px",borderRadius:8,marginBottom:10,background:pwMsg.includes("✓")?"rgba(16,185,129,.07)":"rgba(239,68,68,.07)",border:`1px solid ${pwMsg.includes("✓")?"rgba(16,185,129,.2)":"rgba(239,68,68,.2)"}`,color:pwMsg.includes("✓")?"#10b981":"#f87171"}}>{pwMsg}</div>}
        <FInput label="Current Password" type="password" value={pw.cur} onChange={v=>setPw(p=>({...p,cur:v}))}/>
        <FInput label="New Password"     type="password" value={pw.nw}  onChange={v=>setPw(p=>({...p,nw:v}))}/>
        <FInput label="Confirm New"      type="password" value={pw.cf}  onChange={v=>setPw(p=>({...p,cf:v}))}/>
        <OBtn col="indigo" onClick={changePw} full>Update Password</OBtn>
      </div>

      <button onClick={onLogout} style={{width:"100%",marginTop:14,padding:14,background:"rgba(239,68,68,.07)",border:"1px solid rgba(239,68,68,.18)",borderRadius:14,color:"#f87171",fontSize:15,fontWeight:600,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
        🚪 Logout
      </button>
    </Pad>
  );
}

// Small helper row for pay breakdown
function PayRow({ icon, label, value, color, positive }) {
  return (
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 0",borderBottom:"1px solid rgba(255,255,255,.04)"}}>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <span style={{fontSize:13}}>{icon}</span>
        <span style={{color:"#6b7280",fontSize:13}}>{label}</span>
      </div>
      <span style={{color: value==="—"?"#1f2937":color,fontSize:13,fontWeight:value==="—"?400:600}}>{value}</span>
    </div>
  );
}

// Compact row for home dashboard
function DashRow({ icon, label, value, color }) {
  return (
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:"1px solid rgba(255,255,255,.04)"}}>
      <div style={{display:"flex",alignItems:"center",gap:7}}>
        <span style={{fontSize:12}}>{icon}</span>
        <span style={{color:"#6b7280",fontSize:12}}>{label}</span>
      </div>
      <span style={{color,fontSize:12,fontWeight:600}}>{value}</span>
    </div>
  );
}

// ─── HR PORTAL ────────────────────────────────────────────────────────────────
function HRPortal({ hrPassword, setHrPassword, employees, setEmployees, branches, setBranches, branchHolidays, setBranchHolidays, designations, setDesignations, otConfig, setOtConfig, empOTOverrides, setEmpOTOverrides, leaveDefaults, setLeaveDefaults, latePolicy, setLatePolicy, bonusTypes, setBonusTypes, onLogout }) {
  const [tab,setTab]=useState("employees");
  const [bFilter,setBFilter]=useState("All");
  const [search,setSearch]=useState("");
  const [msg,setMsg]=useState("");
  const [showAddEmp,setShowAddEmp]=useState(false);
  const [showAddBranch,setShowAddBranch]=useState(false);
  const [newBranch,setNewBranch]=useState("");
  const [editEmpId,setEditEmpId]=useState(null);
  const [confirmDeleteId,setConfirmDeleteId]=useState(null);
  const [showDesgMgmt,setShowDesgMgmt]=useState(false);
  const [newDesgName,setNewDesgName]=useState("");
  const [newDesgCanApprove,setNewDesgCanApprove]=useState(false);
  const [newDesgAutoApprove,setNewDesgAutoApprove]=useState(false);
  const [newDesgAutoApproveManual,setNewDesgAutoApproveManual]=useState(false);
  const blank = {id:"",name:"",designation:"Medical Support Interpreter",branch:branches[0]||"",username:"",password:"",salary:"",hireDate:""};
  const [ne,setNe]=useState(blank);
  const flash = m=>{ setMsg(m); setTimeout(()=>setMsg(""),3000); };
  const [showPwChange, setShowPwChange] = useState(false);
  const [pwForm, setPwForm] = useState({cur:"",nw:"",cf:""});
  const [pwMsg, setPwMsg] = useState("");
  const changeHrPw = ()=>{
    if (pwForm.cur !== hrPassword) { setPwMsg("Current password incorrect"); return; }
    if (pwForm.nw.length < 6)      { setPwMsg("Minimum 6 characters"); return; }
    if (pwForm.nw !== pwForm.cf)   { setPwMsg("Passwords don't match"); return; }
    setHrPassword(pwForm.nw);
    setPwMsg("Password updated ✓"); setPwForm({cur:"",nw:"",cf:""});
    setTimeout(()=>setPwMsg(""),3000);
  };

  const addBranch = ()=>{
    const t = newBranch.trim();
    if (!t){ flash("Enter a branch name"); return; }
    if (branches.includes(t)){ flash("Branch already exists"); return; }
    setBranches(b=>[...b,t]); flash(`"${t}" added ✓`); setNewBranch(""); setShowAddBranch(false);
  };
  const removeBranch = b=>{
    if (employees.some(e=>e.branch===b&&e.active)){ flash("Employees are assigned to this branch — reassign first"); return; }
    setBranches(prev=>prev.filter(x=>x!==b)); flash(`"${b}" removed`);
  };

  const addEmployee = ()=>{
    if (!ne.id||!ne.name||!ne.username||!ne.password){ flash("Fill required fields (*)"); return; }
    if (employees.find(e=>e.id===ne.id)){ flash("Employee ID already exists"); return; }
    if (employees.find(e=>e.username===ne.username)){ flash("Username already taken"); return; }
    const sal = parseInt(ne.salary)||0;
    const plMax=parseInt(ne.paidLeaveMax)||leaveDefaults.paidLeave||14;
    const mlMax=parseInt(ne.medicalLeaveMax)||leaveDefaults.medicalLeave||7;
    setEmployees(prev=>[...prev,{...ne,salary:sal,paidLeaveBalance:plMax,paidLeaveMax:plMax,medicalLeaveBalance:mlMax,medicalLeaveMax:mlMax,weekOffsUsed:0,active:true,attendance:[],leaves:[],overtime:[],weekOffRequests:[]}]);
    flash("Employee added ✓"); setShowAddEmp(false); setNe(blank);
  };

  const filtered = employees.filter(e=>
    (bFilter==="All"||e.branch===bFilter) &&
    (e.name.toLowerCase().includes(search.toLowerCase())||e.id.toLowerCase().includes(search.toLowerCase())||e.username.toLowerCase().includes(search.toLowerCase()))
  );

  const totalH = employees.reduce((s,e)=>(e.overtime||[]).filter(o=>o.status==="approved"&&inOTPeriod(o.date)).reduce((ss,o)=>ss+(o.hours||0),s),0);
  const totalC = employees.reduce((s,e)=>(e.overtime||[]).filter(o=>o.status==="approved"&&inOTPeriod(o.date)).reduce((ss,o)=>ss+(o.cost||0),s),0);

  const TABS=[{id:"employees",l:"👥 Employees"},{id:"branches",l:"🏢 Branches"},{id:"settings",l:"⚙️ Settings"},{id:"ot",l:"💰 OT & Costs"},{id:"payroll",l:"🧾 Payroll"},{id:"today",l:"📋 Today"},{id:"export",l:"📥 Export"}];

  return (
    <Shell>
      <div style={S.header}>
        <div><div style={S.heading}>AttendX</div><div style={{color:"#10b981",fontSize:12,fontWeight:700,letterSpacing:"0.05em"}}>HR PORTAL</div></div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <HRPasswordBtn hrPassword={hrPassword} setHrPassword={setHrPassword} flash={flash}/>
          <button onClick={onLogout} style={{background:"none",border:"none",color:"#f87171",cursor:"pointer",fontSize:13,fontFamily:"inherit",display:"flex",alignItems:"center",gap:5}}>🚪 Logout</button>
        </div>
      </div>
      {showPwChange && (
        <div style={{margin:"0 20px",padding:"16px",background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",borderRadius:12,marginTop:10}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <span style={{color:"#e2e8f0",fontWeight:600,fontSize:14}}>Change HR Password</span>
            <button onClick={()=>{setShowPwChange(false);setPwForm({cur:"",nw:"",cf:""});setPwMsg("");}} style={{background:"none",border:"none",color:"#374151",cursor:"pointer",fontSize:17,lineHeight:1}}>✕</button>
          </div>
          {pwMsg && <div style={{fontSize:12,padding:"8px 12px",borderRadius:8,marginBottom:10,background:pwMsg.includes("✓")?"rgba(16,185,129,.07)":"rgba(239,68,68,.07)",border:`1px solid ${pwMsg.includes("✓")?"rgba(16,185,129,.2)":"rgba(239,68,68,.2)"}`,color:pwMsg.includes("✓")?"#10b981":"#f87171"}}>{pwMsg}</div>}
          <FInput label="Current Password" type="password" value={pwForm.cur} onChange={v=>setPwForm(p=>({...p,cur:v}))}/>
          <FInput label="New Password"     type="password" value={pwForm.nw}  onChange={v=>setPwForm(p=>({...p,nw:v}))}/>
          <FInput label="Confirm New"      type="password" value={pwForm.cf}  onChange={v=>setPwForm(p=>({...p,cf:v}))}/>
          <button onClick={changeHrPw} style={{...S.primaryBtn,width:"100%"}}>Update Password</button>
        </div>
      )}
      <div style={{padding:"16px max(20px,env(safe-area-inset-left,20px)) 0 max(20px,env(safe-area-inset-right,20px))"}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:7,marginBottom:14}}>
          <Stat l="Staff" v={employees.filter(e=>e.active).length} s="active" c="#6366f1"/>
          <Stat l="OT Hrs" v={totalH.toFixed(0)} s="period" c="#f59e0b"/>
          <Stat l="OT Cost" v={fmtMoney(totalC)} s="period" c="#10b981"/>
        </div>
        <div style={{display:"flex",gap:8,overflowX:"auto",marginBottom:14,paddingBottom:2}}>
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{...S.tabBtn,background:tab===t.id?"rgba(99,102,241,.18)":"rgba(255,255,255,.04)",color:tab===t.id?"#818cf8":"#4b5563",borderColor:tab===t.id?"rgba(99,102,241,.38)":"rgba(255,255,255,.08)"}}>
              {t.l}
            </button>
          ))}
        </div>
        {msg && <SuccBox>{msg}</SuccBox>}

        {/* ── EMPLOYEES ── */}
        {tab==="employees" && (
          <div>
            <div style={{display:"flex",gap:7,overflowX:"auto",marginBottom:10,paddingBottom:2}}>
              {["All",...branches].map(b=>(
                <button key={b} onClick={()=>setBFilter(b)} style={{...S.pill,background:bFilter===b?"rgba(99,102,241,.18)":"rgba(255,255,255,.04)",color:bFilter===b?"#818cf8":"#4b5563",borderColor:bFilter===b?"rgba(99,102,241,.38)":"rgba(255,255,255,.08)"}}>
                  {b}
                </button>
              ))}
            </div>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name, ID, username…" style={{...S.input,marginBottom:10}}/>
            <button onClick={()=>setShowAddEmp(!showAddEmp)} style={{...S.greenBtn,width:"100%",marginBottom:10}}>+ Add New Employee</button>

            {showAddEmp && (
              <FCard title="Add Employee" onClose={()=>setShowAddEmp(false)}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9}}>
                  <FInput label="Employee ID *" value={ne.id}   onChange={v=>setNe(f=>({...f,id:v}))}   placeholder="EMP004"/>
                  <FInput label="Full Name *"   value={ne.name} onChange={v=>setNe(f=>({...f,name:v}))}/>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9}}>
                  <FSel label="Designation" value={ne.designation} onChange={v=>setNe(f=>({...f,designation:v}))} opts={(designations||[]).map(d=>({v:d.name,l:d.name}))}/>
                  <FSel label="Branch"      value={ne.branch}      onChange={v=>setNe(f=>({...f,branch:v}))}      opts={branches.map(b=>({v:b,l:b}))}/>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9}}>
                  <FInput label="Username *" value={ne.username} onChange={v=>setNe(f=>({...f,username:v}))}/>
                  <FInput label="Password *" value={ne.password} onChange={v=>setNe(f=>({...f,password:v}))}/>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9}}>
                  <FInput label="Monthly Salary ₹" type="number" value={ne.salary}   onChange={v=>setNe(f=>({...f,salary:v}))}   placeholder="e.g. 50000"/>
                  <FInput label="Hire Date"         type="date"   value={ne.hireDate} onChange={v=>setNe(f=>({...f,hireDate:v}))}/>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9}}>
                  <FInput label="Paid Leave Days" type="number" value={ne.paidLeaveMax} onChange={v=>setNe(f=>({...f,paidLeaveMax:v}))} placeholder={String(leaveDefaults.paidLeave||14)}/>
                  <FInput label="Medical Leave Days" type="number" value={ne.medicalLeaveMax} onChange={v=>setNe(f=>({...f,medicalLeaveMax:v}))} placeholder={String(leaveDefaults.medicalLeave||7)}/>
                </div>
                </div>
                {ne.salary && parseInt(ne.salary)>0 && (
                  <div style={{background:"rgba(255,255,255,.04)",borderRadius:8,padding:"8px 12px",fontSize:12,color:"#6b7280",marginBottom:8}}>
                    Base OT: <b style={{color:"#fbbf24"}}>{fmtMoney(calcHourlyRate(parseInt(ne.salary)))}/hr</b> · Night/Holiday: <b style={{color:"#f87171"}}>{fmtMoney(calcHourlyRate(parseInt(ne.salary))*1.3)}/hr</b>
                  </div>
                )}
                <button onClick={addEmployee} style={{...S.greenBtn,width:"100%"}}>Add Employee</button>
              </FCard>
            )}

            {filtered.length===0 && <Empty>No employees match</Empty>}
            {filtered.map(e=>(
              <div key={e.id} style={{...S.row,opacity:e.active?1:.5}}>
                <div style={{display:"flex",gap:11,alignItems:"flex-start"}}>
                  <Av name={e.name} size={40}/>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                      <div>
                        <div style={{color:"#e2e8f0",fontSize:15,fontWeight:700}}>{e.name}</div>
                        <div style={{color:"#6366f1",fontSize:12}}>{e.designation} · {e.branch}</div>
                      </div>
                      <div style={{display:"flex",gap:6,flexShrink:0}}>
                        {e.active ? (
                          <button onClick={()=>setEmployees(prev=>prev.map(x=>x.id===e.id?{...x,active:false}:x))} style={S.dangerPill}>Deactivate</button>
                        ) : confirmDeleteId===e.id ? (
                          <div style={{display:"flex",gap:5,alignItems:"center"}}>
                            <span style={{color:"#f87171",fontSize:11,fontWeight:600}}>Sure?</span>
                            <button onClick={()=>{ setEmployees(prev=>prev.filter(x=>x.id!==e.id)); setConfirmDeleteId(null); flash(`${e.name} permanently deleted`); }} style={{...S.dangerPill,background:"rgba(239,68,68,.2)",fontWeight:700}}>Yes, Delete</button>
                            <button onClick={()=>setConfirmDeleteId(null)} style={S.greenPill}>Cancel</button>
                          </div>
                        ) : (
                          <div style={{display:"flex",gap:5}}>
                            <button onClick={()=>setEmployees(prev=>prev.map(x=>x.id===e.id?{...x,active:true}:x))} style={S.greenPill}>Restore</button>
                            <button onClick={()=>setConfirmDeleteId(e.id)} style={{...S.dangerPill,background:"rgba(239,68,68,.18)",fontWeight:700}}>🗑 Delete</button>
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"3px 14px",marginBottom:8}}>
                      <KV k="ID"       v={e.id}/>
                      <KV k="Username" v={`@${e.username}`}/>
                      <KV k="Password" v={e.password}/>
                      <KV k="Salary"   v={fmtMoney(e.salary||0)+"/mo"}/>
                      <KV k="OT"       v={`${(empOTOverrides&&empOTOverrides[e.id]?.regularPct)||(otConfig?.regularPct??100)}% / ${(empOTOverrides&&empOTOverrides[e.id]?.nightHolidayPct)||(otConfig?.nightHolidayPct??130)}%`}/>
                      <KV k="PL / ML"  v={`${e.paidLeaveBalance}/${e.paidLeaveMax||14} · ${e.medicalLeaveBalance}/${e.medicalLeaveMax||7}`}/>
                    </div>
                    <button onClick={()=>setEditEmpId(editEmpId===e.id?null:e.id)} style={{width:"100%",padding:"6px",background:"rgba(99,102,241,.08)",border:"1px solid rgba(99,102,241,.18)",borderRadius:7,color:"#818cf8",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                      {editEmpId===e.id?"▲ Close":"✏️ Edit Employee"}
                    </button>
                    {editEmpId===e.id && <HREditEmpPanel e={e} setEmployees={setEmployees} designations={designations} branches={branches} otConfig={otConfig} empOTOverrides={empOTOverrides} setEmpOTOverrides={setEmpOTOverrides} flash={flash}/>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── BRANCHES ── */}
        {tab==="branches" && (
          <div>
            <button onClick={()=>setShowAddBranch(!showAddBranch)} style={{...S.greenBtn,width:"100%",marginBottom:10}}>+ Add Branch</button>
            {showAddBranch && (
              <FCard title="New Branch" onClose={()=>setShowAddBranch(false)}>
                <FInput label="Branch Name" value={newBranch} onChange={setNewBranch} placeholder="e.g. Pune"/>
                <button onClick={addBranch} style={{...S.greenBtn,width:"100%"}}>Add Branch</button>
              </FCard>
            )}
            <SecTitle>All Branches ({branches.length})</SecTitle>
            {branches.map(b=>{
              const count = employees.filter(e=>e.branch===b&&e.active).length;
              return (
                <div key={b} style={{...S.row,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    <div style={{color:"#e2e8f0",fontSize:15,fontWeight:600}}>🏢 {b}</div>
                    <div style={{color:"#374151",fontSize:12,marginTop:2}}>{count} active employee{count!==1?"s":""}</div>
                  </div>
                  <button onClick={()=>removeBranch(b)} style={S.dangerPill}>Remove</button>
                </div>
              );
            })}
          </div>
        )}

        {/* ── SETTINGS ── */}
        {tab==="settings" && (
          <div>
            {/* Global OT rates */}
            <SecTitle style={{marginTop:0}}>Global OT Rates</SecTitle>
            <div style={{...S.banner,marginBottom:14,fontSize:12,color:"#6b7280",lineHeight:1.8}}>
              These are default rates for all employees. You can override per-employee in the Employees tab.
            </div>
            <HRSettingsPanel otConfig={otConfig} setOtConfig={setOtConfig} leaveDefaults={leaveDefaults} setLeaveDefaults={setLeaveDefaults} flash={flash}/>


            {/* Late Policy */}
            <SecTitle>Late Arrival Policy</SecTitle>
            <HRLatePolicyPanel latePolicy={latePolicy} setLatePolicy={setLatePolicy} flash={flash}/>

            {/* Bonus Types */}
            <SecTitle>Bonus & Award Types</SecTitle>
            <HRBonusTypesPanel bonusTypes={bonusTypes} setBonusTypes={setBonusTypes} flash={flash}/>

            {/* Designation management */}
            <SecTitle>Designations & Permissions</SecTitle>
            <div style={{...S.banner,marginBottom:10,fontSize:12,color:"#6b7280"}}>Designations with "Can Approve" can approve leaves, OT, week-offs and manage holidays.</div>
            <button onClick={()=>setShowDesgMgmt(!showDesgMgmt)} style={{...S.greenBtn,width:"100%",marginBottom:10}}>+ Add Designation</button>
            {showDesgMgmt && (
              <FCard title="New Designation" onClose={()=>setShowDesgMgmt(false)}>
                <FInput label="Designation Name" value={newDesgName} onChange={setNewDesgName} placeholder="e.g. Senior Agent"/>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8,padding:"10px 12px",background:"rgba(255,255,255,.04)",borderRadius:8,border:"1px solid rgba(255,255,255,.08)"}}>
                  <input type="checkbox" id="caCheck" checked={newDesgCanApprove} onChange={e=>setNewDesgCanApprove(e.target.checked)} style={{width:16,height:16,cursor:"pointer"}}/>
                  <label htmlFor="caCheck" style={{color:"#94a3b8",fontSize:13,cursor:"pointer"}}>Can approve leaves, OT & week-offs</label>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8,padding:"10px 12px",background:newDesgAutoApprove?"rgba(16,185,129,.07)":"rgba(255,255,255,.04)",borderRadius:8,border:`1px solid ${newDesgAutoApprove?"rgba(16,185,129,.25)":"rgba(255,255,255,.08)"}`}}>
                  <input type="checkbox" id="aaCheck" checked={newDesgAutoApprove} onChange={e=>setNewDesgAutoApprove(e.target.checked)} style={{width:16,height:16,cursor:"pointer"}}/>
                  <label htmlFor="aaCheck" style={{color:newDesgAutoApprove?"#10b981":"#94a3b8",fontSize:13,cursor:"pointer"}}>Auto-approve own leaves & week-offs</label>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10,padding:"10px 12px",background:newDesgAutoApproveManual?"rgba(99,102,241,.07)":"rgba(255,255,255,.04)",borderRadius:8,border:`1px solid ${newDesgAutoApproveManual?"rgba(99,102,241,.25)":"rgba(255,255,255,.08)"}`}}>
                  <input type="checkbox" id="aamCheck" checked={newDesgAutoApproveManual} onChange={e=>setNewDesgAutoApproveManual(e.target.checked)} style={{width:16,height:16,cursor:"pointer"}}/>
                  <label htmlFor="aamCheck" style={{color:newDesgAutoApproveManual?"#818cf8":"#94a3b8",fontSize:13,cursor:"pointer"}}>Auto-approve manual attendance entries</label>
                </div>
                <button onClick={()=>{
                  const t=newDesgName.trim();
                  if(!t){flash("Enter a name");return;}
                  if((designations||[]).some(d=>d.name===t)){flash("Already exists");return;}
                  setDesignations(prev=>[...prev,{name:t,canApprove:newDesgCanApprove,autoApprove:newDesgAutoApprove,autoApproveManual:newDesgAutoApproveManual}]);
                  flash(`"${t}" added ✓`); setNewDesgName(""); setNewDesgCanApprove(false); setNewDesgAutoApprove(false); setNewDesgAutoApproveManual(false); setShowDesgMgmt(false);
                }} style={{...S.greenBtn,width:"100%"}}>Add Designation</button>
              </FCard>
            )}
            {(designations||[]).map((d,i)=>(
              <div key={i} style={{...S.row,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{color:"#e2e8f0",fontSize:14,fontWeight:600}}>{d.name}</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:"3px 8px",marginTop:3}}>
                    {d.canApprove
                      ? <span style={{color:"#10b981",fontSize:11}}>✓ Can approve</span>
                      : <span style={{color:"#374151",fontSize:11}}>— View only</span>}
                    {d.autoApprove
                      ? <span style={{color:"#818cf8",fontSize:11}}>· ✓ Leave auto-approve</span>
                      : <span style={{color:"#374151",fontSize:11}}>· — Leave manual</span>}
                    {d.autoApproveManual
                      ? <span style={{color:"#6366f1",fontSize:11}}>· ✓ Attendance auto-approve</span>
                      : <span style={{color:"#374151",fontSize:11}}>· — Attendance manual</span>}
                  </div>
                </div>
                <button onClick={()=>{
                  if(employees.some(e=>e.designation===d.name&&e.active)){flash(`Cannot remove: employees assigned to ${d.name}`);return;}
                  setDesignations(prev=>prev.filter(x=>x.name!==d.name));
                  flash(`"${d.name}" removed`);
                }} style={S.dangerPill}>Remove</button>
              </div>
            ))}
          </div>
        )}

        {/* ── OT & COSTS ── */}
        {tab==="ot" && (
          <div>
            <SecTitle style={{marginTop:0}}>Overtime by Employee</SecTitle>
            <div style={{background:"rgba(99,102,241,.07)",border:"1px solid rgba(99,102,241,.18)",borderRadius:8,padding:"8px 12px",fontSize:12,color:"#6b7280",marginBottom:12}}>Pay period: <b style={{color:"#818cf8"}}>{fmtPeriod()}</b> (16th prev. month → 15th current month)</div>
            {employees.filter(e=>e.active).map(e=>{
              const app = (e.overtime||[]).filter(o=>o.status==="approved"&&inOTPeriod(o.date));
              const hrs = app.reduce((s,o)=>s+(o.hours||0),0);
              const cost= app.reduce((s,o)=>s+(o.cost||0),0);
              return (
                <div key={e.id} style={S.row}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:app.length?10:0}}>
                    <div>
                      <div style={{color:"#e2e8f0",fontSize:14,fontWeight:700}}>{e.name}</div>
                      <div style={{color:"#4b5563",fontSize:12}}>{e.designation} · {e.branch}</div>
                      <div style={{color:"#374151",fontSize:11}}>Salary {fmtMoney(e.salary||0)}/mo · Base {fmtMoney(calcHourlyRate(e.salary||0))}/hr</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{color:"#fbbf24",fontSize:15,fontWeight:700}}>{hrs.toFixed(1)}h</div>
                      <div style={{color:"#10b981",fontSize:13,fontWeight:600}}>{fmtMoney(cost)}</div>
                    </div>
                  </div>
                  {app.map((o,i)=>(
                    <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderTop:"1px solid rgba(255,255,255,.05)",fontSize:12}}>
                      <span style={{color:"#6b7280"}}>{fmt(o.date)} · {o.startTime}–{o.endTime}{o.reason?` · ${o.reason}`:""}</span>
                      <span style={{color:"#fbbf24",flexShrink:0,marginLeft:8}}>
                        {o.otType==="call"&&<span style={{background:"rgba(167,139,250,.12)",border:"1px solid rgba(167,139,250,.25)",borderRadius:4,padding:"1px 5px",color:"#a78bfa",fontSize:10,marginRight:4}}>CALL</span>}
                        {fmtOTHours(o.hours)}@{o.rate*100}% = {fmtMoney(o.cost)}
                      </span>
                    </div>
                  ))}
                  {app.length===0 && <div style={{color:"#1f2937",fontSize:12}}>No approved OT</div>}
                </div>
              );
            })}
            {/* Totals */}
            <div style={{...S.row,background:"rgba(99,102,241,.08)",borderColor:"rgba(99,102,241,.22)"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{color:"#e2e8f0",fontWeight:700,fontFamily:"Syne,sans-serif",fontSize:15}}>Total</div>
                <div style={{textAlign:"right"}}>
                  <div style={{color:"#fbbf24",fontSize:17,fontWeight:800}}>{totalH.toFixed(1)}h</div>
                  <div style={{color:"#10b981",fontSize:14,fontWeight:700}}>{fmtMoney(totalC)}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── PAYROLL ── */}
        {tab==="payroll" && (
          <div>
            <SecTitle style={{marginTop:0}}>Payroll — {salaryMonth().name} {salaryMonth().year} <span style={{color:"#4b5563",fontSize:12,fontWeight:400}}>OT: {fmtPeriod()} · Paid: {paymentWeek()}</span></SecTitle>
            <div style={{...S.banner,marginBottom:12,fontSize:12,color:"#6b7280"}}>
              Period: 16th prev month → 15th current month. Includes salary, OT, bonuses, deductions.
            </div>
            {employees.filter(e=>e.active).map(emp=>{
              const e = employees.find(x=>x.id===emp.id)||emp; // always fresh
              const pr = calcPayroll(e, otConfig, empOTOverrides, latePolicy);
              return (
                <div key={e.id} style={S.row}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                    <div>
                      <div style={{color:"#e2e8f0",fontSize:14,fontWeight:700}}>{e.name}</div>
                      <div style={{color:"#4b5563",fontSize:12}}>{e.designation} · {e.branch}</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{color:"#10b981",fontSize:15,fontWeight:800}}>{fmtMoney(pr.netSalary)}</div>
                      <div style={{color:"#4b5563",fontSize:11}}>net payable</div>
                    </div>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"3px 12px",fontSize:12,paddingTop:8,borderTop:"1px solid rgba(255,255,255,.06)"}}>
                    <KV k="Base Salary" v={fmtMoney(pr.baseSalary)}/>
                    <KV k="OT Earnings" v={"+"+fmtMoney(pr.otEarnings)}/>
                    <KV k="Bonuses" v={"+"+fmtMoney(pr.bonuses)}/>
                    <KV k="Late Deductions" v={pr.lateDeductions>0?"-"+fmtMoney(pr.lateDeductions):"—"}/>
                    <KV k="Early-out Deduct" v={pr.earlyDeductions>0?"-"+fmtMoney(pr.earlyDeductions):"—"}/>
                    <KV k="Unpaid Leave" v={pr.unpaidDeductions>0?"-"+fmtMoney(pr.unpaidDeductions):"—"}/>
                    <KV k="Half Day Deduct" v={pr.halfDayDeductions>0?"-"+fmtMoney(pr.halfDayDeductions):"—"}/>
                  </div>
                  {/* Bonus management for this employee */}
                  <HRBonusPanel e={e} setEmployees={setEmployees} bonusTypes={bonusTypes} flash={flash}/>
                </div>
              );
            })}
            {/* Grand total */}
            {(()=>{
              const tot = employees.filter(e=>e.active).reduce((acc,emp)=>{
                const e = employees.find(x=>x.id===emp.id)||emp;
                const pr = calcPayroll(e, otConfig, empOTOverrides, latePolicy);
                return { net: acc.net+pr.netSalary, base: acc.base+pr.baseSalary, ot: acc.ot+pr.otEarnings, bon: acc.bon+pr.bonuses, ded: acc.ded+pr.totalDeductions };
              },{net:0,base:0,ot:0,bon:0,ded:0});
              return (
                <div style={{...S.row,background:"rgba(16,185,129,.07)",borderColor:"rgba(16,185,129,.2)"}}>
                  <div style={{color:"#e2e8f0",fontWeight:700,fontSize:14,marginBottom:8}}>Total Payroll</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"3px 12px",fontSize:12}}>
                    <KV k="Total Base" v={fmtMoney(tot.base)}/>
                    <KV k="Total OT"   v={"+"+fmtMoney(tot.ot)}/>
                    <KV k="Total Bonuses" v={"+"+fmtMoney(tot.bon)}/>
                    <KV k="Total Deductions" v={tot.ded>0?"-"+fmtMoney(tot.ded):"—"}/>
                  </div>
                  <div style={{marginTop:8,paddingTop:8,borderTop:"1px solid rgba(255,255,255,.06)",display:"flex",justifyContent:"space-between"}}>
                    <span style={{color:"#6b7280",fontSize:13}}>Net Payable</span>
                    <span style={{color:"#10b981",fontSize:16,fontWeight:800}}>{fmtMoney(tot.net)}</span>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* ── EXPORT ── */}
        {tab==="export" && (
          <HRExportTab employees={employees} branches={branches} otConfig={otConfig} empOTOverrides={empOTOverrides} latePolicy={latePolicy} bonusTypes={bonusTypes} flash={flash}/>
        )}

        {/* ── TODAY ── */}
        {tab==="today" && (
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <SecTitle style={{margin:0}}>Today — {fmt(todayStr())}</SecTitle>
              <div style={{display:"flex",gap:6}}>
                {isHolidayGlobal(todayStr()) && <Chip c="#fbbf24" sm>Holiday</Chip>}
                {isSunday(todayStr())  && <Chip c="#f87171" sm>Sunday</Chip>}
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9,marginBottom:14}}>
              <Stat l="Present" v={employees.filter(e=>e.active&&(e.attendance||[]).some(a=>a.date===todayStr())).length} s="checked in" c="#10b981"/>
              <Stat l="Absent"  v={employees.filter(e=>e.active&&!(e.attendance||[]).some(a=>a.date===todayStr())).length} s="not seen" c="#f87171"/>
            </div>
            {employees.filter(e=>e.active).map(e=>{
              const r = (e.attendance||[]).find(a=>a.date===todayStr());
              return (
                <div key={e.id} style={{...S.row,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div style={{display:"flex",gap:10,alignItems:"center"}}>
                    <Av name={e.name} size={34}/>
                    <div>
                      <div style={{color:"#e2e8f0",fontSize:14,fontWeight:600}}>{e.name}</div>
                      <div style={{color:"#374151",fontSize:12}}>{e.designation} · {e.branch}</div>
                    </div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    {r ? <>
                      <div style={{color:"#10b981",fontSize:12,fontWeight:600}}>✓ {fmtT(r.checkIn)}{r.checkOut?` → ${fmtT(r.checkOut)}`:""}</div>
                      {r.location && <div style={{color:"#1f2937",fontSize:10}}>📍 {r.location}</div>}
                      {!r.checkOut && <div style={{color:"#f59e0b",fontSize:10}}>Still in</div>}
                    </> : <div style={{color:"#374151",fontSize:12}}>Not checked in</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Shell>
  );
}

// ─── HR SETTINGS PANEL ────────────────────────────────────────────────────────
function HRSettingsPanel({ otConfig, setOtConfig, leaveDefaults, setLeaveDefaults, flash }) {
  const [rPct, setRPct]   = useState(String(otConfig?.regularPct     ?? 100));
  const [nPct, setNPct]   = useState(String(otConfig?.nightHolidayPct ?? 130));
  const [pl,   setPl]     = useState(String(leaveDefaults?.paidLeave    ?? 14));
  const [ml,   setMl]     = useState(String(leaveDefaults?.medicalLeave ?? 7));

  const saveOT = ()=>{
    const r=parseInt(rPct), n=parseInt(nPct);
    if (isNaN(r)||isNaN(n)||r<0||n<0){ flash("Enter valid percentages"); return; }
    setOtConfig({regularPct:r, nightHolidayPct:n});
    flash("OT rates updated ✓ (applies to employees without individual overrides)");
  };
  const saveLeaves = ()=>{
    const p=parseInt(pl), m=parseInt(ml);
    if (isNaN(p)||isNaN(m)||p<0||m<0){ flash("Enter valid numbers"); return; }
    setLeaveDefaults({paidLeave:p, medicalLeave:m});
    flash("Leave defaults updated ✓ (applies to new employees)");
  };

  return (
    <>
      <div style={{...S_DS.card,marginBottom:10}}>
        <div style={{color:"#e2e8f0",fontWeight:600,fontSize:13,marginBottom:12}}>Default OT Percentages</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9}}>
          <FInput label="Regular OT %" type="number" value={rPct} onChange={setRPct} placeholder="100"/>
          <FInput label="Night / Holiday OT %" type="number" value={nPct} onChange={setNPct} placeholder="130"/>
        </div>
        {(parseInt(rPct)||0)>0 && (
          <div style={{fontSize:11,color:"#4b5563",marginBottom:8}}>
            Example (₹50,000 salary): Regular → {fmtMoney(50000*0.005*(parseInt(rPct)/100))}/hr · Night/Holiday → {fmtMoney(50000*0.005*(parseInt(nPct)/100))}/hr
          </div>
        )}
        <button onClick={saveOT} style={{...S_DS.greenBtn,width:"100%"}}>Save OT Rates</button>
      </div>
      <div style={{...S_DS.card,marginBottom:10}}>
        <div style={{color:"#e2e8f0",fontWeight:600,fontSize:13,marginBottom:12}}>Default Leave Entitlements (for new employees)</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9}}>
          <FInput label="Paid Leave Days" type="number" value={pl} onChange={setPl} placeholder="14"/>
          <FInput label="Medical Leave Days" type="number" value={ml} onChange={setMl} placeholder="7"/>
        </div>
        <button onClick={saveLeaves} style={{...S_DS.greenBtn,width:"100%"}}>Save Leave Defaults</button>
      </div>
    </>
  );
}

// ─── HR EDIT EMPLOYEE PANEL ───────────────────────────────────────────────────
function HREditEmpPanel({ e, setEmployees, designations, branches, otConfig, empOTOverrides, setEmpOTOverrides, flash, currentUserIsManager }) {
  const ovr = (empOTOverrides&&empOTOverrides[e.id]) || {};
  const [sal,  setSal]  = useState(String(e.salary||0));
  const [desg, setDesg] = useState(e.designation);
  const [br,   setBr]   = useState(e.branch);
  const [pl,   setPl]   = useState(String(e.paidLeaveBalance));
  const [plMax,setPlMax]= useState(String(e.paidLeaveMax||14));
  const [ml,   setMl]   = useState(String(e.medicalLeaveBalance));
  const [mlMax,setMlMax]= useState(String(e.medicalLeaveMax||7));
  const [rPct, setRPct] = useState(String(ovr.regularPct      ?? (otConfig?.regularPct ?? 100)));
  const [nPct, setNPct] = useState(String(ovr.nightHolidayPct ?? (otConfig?.nightHolidayPct ?? 130)));
  const [pw,   setPw]   = useState(e.password);
  const [useGlobal, setUseGlobal] = useState(!empOTOverrides||!empOTOverrides[e.id]);
  const [autoApprove, setAutoApprove] = useState(e.autoApproveLeave||false);
  const [autoApproveManual, setAutoApproveManual] = useState(e.autoApproveManual||false);

  const hrRate = calcHourlyRate(parseInt(sal)||0);

  const save = ()=>{
    const salNum = parseInt(sal)||0;
    const plNum  = parseInt(pl)||0;
    const plMxNum= parseInt(plMax)||14;
    const mlNum  = parseInt(ml)||0;
    const mlMxNum= parseInt(mlMax)||7;
    if (!pw.trim()){ flash("Password cannot be empty"); return; }
    // Update employee fields
    setEmployees(prev=>prev.map(x=>x.id===e.id?{...x,
      salary:salNum, designation:desg, branch:br,
      paidLeaveBalance:plNum, paidLeaveMax:plMxNum,
      medicalLeaveBalance:mlNum, medicalLeaveMax:mlMxNum,
      password:pw, autoApproveLeave:autoApprove, autoApproveManual:autoApproveManual
    }:x));
    // OT override
    if (useGlobal) {
      setEmpOTOverrides(prev=>{ const n={...prev}; delete n[e.id]; return n; });
    } else {
      setEmpOTOverrides(prev=>({...prev,[e.id]:{regularPct:parseInt(rPct)||100, nightHolidayPct:parseInt(nPct)||130}}));
    }
    flash(`${e.name} updated ✓`);
  };

  return (
    <div style={{marginTop:10,padding:"12px 0 0",borderTop:"1px solid rgba(255,255,255,.07)"}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9}}>
        <FSel label="Designation" value={desg} onChange={setDesg} opts={(designations||[]).map(d=>({v:d.name,l:d.name}))}/>
        <FSel label="Branch"      value={br}   onChange={setBr}   opts={(branches||[]).map(b=>({v:b,l:b}))}/>
      </div>
      <FInput label="Monthly Salary ₹" type="number" value={sal} onChange={setSal} placeholder="e.g. 50000"/>
      {parseInt(sal)>0 && (
        <div style={{fontSize:11,color:"#4b5563",marginBottom:8}}>Base OT: {fmtMoney(hrRate)}/hr</div>
      )}
      <div style={{color:"#64748b",fontSize:11,fontWeight:500,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.05em"}}>OT Rate Override</div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8,padding:"8px 12px",background:"rgba(255,255,255,.04)",borderRadius:8,border:"1px solid rgba(255,255,255,.08)"}}>
        <input type="checkbox" id={`glob-${e.id}`} checked={useGlobal} onChange={ev=>setUseGlobal(ev.target.checked)} style={{width:14,height:14,cursor:"pointer"}}/>
        <label htmlFor={`glob-${e.id}`} style={{color:"#94a3b8",fontSize:12,cursor:"pointer"}}>Use global defaults ({otConfig?.regularPct??100}% / {otConfig?.nightHolidayPct??130}%)</label>
      </div>
      {!useGlobal && (
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9}}>
          <FInput label="Regular OT %" type="number" value={rPct} onChange={setRPct} placeholder="100"/>
          <FInput label="Night/Holiday %" type="number" value={nPct} onChange={setNPct} placeholder="130"/>
        </div>
      )}
      <div style={{color:"#64748b",fontSize:11,fontWeight:500,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.05em",marginTop:4}}>Leave Balances</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9}}>
        <FInput label="Paid Leave Balance" type="number" value={pl} onChange={setPl}/>
        <FInput label="Paid Leave Max/yr"  type="number" value={plMax} onChange={setPlMax}/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9}}>
        <FInput label="Medical Balance" type="number" value={ml} onChange={setMl}/>
        <FInput label="Medical Max/yr"  type="number" value={mlMax} onChange={setMlMax}/>
      </div>
      {/* Auto-approve toggle — show for designations that don't have it set at the role level */}
      {!((designations||[]).find(d=>d.name===desg)?.autoApprove) && (
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10,padding:"10px 12px",background:autoApprove?"rgba(16,185,129,.08)":"rgba(255,255,255,.04)",borderRadius:8,border:`1px solid ${autoApprove?"rgba(16,185,129,.25)":"rgba(255,255,255,.08)"}`}}>
          <input type="checkbox" id={`aa-${e.id}`} checked={autoApprove} onChange={ev=>setAutoApprove(ev.target.checked)} style={{width:15,height:15,cursor:"pointer"}}/>
          <label htmlFor={`aa-${e.id}`} style={{color:autoApprove?"#10b981":"#94a3b8",fontSize:12,cursor:"pointer",fontWeight:autoApprove?600:400}}>
            Auto-approve leaves & week-offs
            <span style={{display:"block",color:"#4b5563",fontSize:11,fontWeight:400}}>Leaves submit as approved immediately</span>
          </label>
        </div>
      )}
      {(designations||[]).find(d=>d.name===desg)?.autoApprove && (
        <div style={{padding:"8px 12px",background:"rgba(16,185,129,.06)",borderRadius:8,border:"1px solid rgba(16,185,129,.15)",marginBottom:10,fontSize:12,color:"#10b981"}}>
          ✓ {desg} designation has leave auto-approval by default
        </div>
      )}
      {/* Manual attendance auto-approve toggle */}
      {!((designations||[]).find(d=>d.name===desg)?.autoApproveManual) ? (
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10,padding:"10px 12px",background:autoApproveManual?"rgba(99,102,241,.08)":"rgba(255,255,255,.04)",borderRadius:8,border:`1px solid ${autoApproveManual?"rgba(99,102,241,.25)":"rgba(255,255,255,.08)"}`}}>
          <input type="checkbox" id={`aam-${e.id}`} checked={autoApproveManual} onChange={ev=>setAutoApproveManual(ev.target.checked)} style={{width:14,height:14,cursor:"pointer"}}/>
          <label htmlFor={`aam-${e.id}`} style={{color:autoApproveManual?"#818cf8":"#94a3b8",fontSize:12,cursor:"pointer",fontWeight:autoApproveManual?600:400}}>
            Auto-approve manual attendance
            <span style={{display:"block",color:"#4b5563",fontSize:11,fontWeight:400}}>Manual entries submit as approved immediately</span>
          </label>
        </div>
      ) : (
        <div style={{padding:"8px 12px",background:"rgba(99,102,241,.05)",borderRadius:8,border:"1px solid rgba(99,102,241,.15)",marginBottom:10,fontSize:12,color:"#6366f1"}}>
          ✓ {desg} designation has manual attendance auto-approval by default
        </div>
      )}
      <FInput label="Password" value={pw} onChange={setPw} placeholder="Employee password"/>
      <button onClick={save} style={{...S_DS.primaryBtn,width:"100%",marginTop:4}}>Save Changes</button>
    </div>
  );
}


// ─── HR EXPORT TAB ────────────────────────────────────────────────────────────
function HRExportTab({ employees, branches, otConfig, empOTOverrides, latePolicy, bonusTypes, flash }) {
  const now = new Date();
  const MONTHS_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  // Default selected month = current salary month
  const defSalMon = salaryMonth();
  const defMonIdx = MONTHS_FULL.indexOf(defSalMon.name);
  const [selMonIdx, setSelMonIdx] = useState(defMonIdx >= 0 ? defMonIdx : now.getMonth());
  const [selYear,   setSelYear]   = useState(defSalMon.year);
  const [exporting, setExporting] = useState(false);
  const [lastExport, setLastExport] = useState(null);

  const selMonName  = MONTHS_FULL[selMonIdx];
  const selMonShort = MONTHS_SHORT[selMonIdx];

  // OT period for selected month
  const pad = n=>String(n).padStart(2,"0");
  const prevM = new Date(selYear, selMonIdx-1, 16);
  const curM  = new Date(selYear, selMonIdx,   15);
  const otStartLabel = prevM.toLocaleDateString("en-IN",{day:"2-digit",month:"short"});
  const otEndLabel   = curM.toLocaleDateString("en-IN",{day:"2-digit",month:"short"});
  const payMonFull = MONTHS_FULL[(selMonIdx+1)%12];
  const payYrLabel = selMonIdx===11 ? selYear+1 : selYear;
  const payLabel = `1st week of ${payMonFull} ${payYrLabel}`;

  // Year options: 3 years back to 1 year forward
  const yearOpts = Array.from({length:5},(_,i)=>now.getFullYear()-3+i);

  // Per-month OT period filter
  const otStart = `${prevM.getFullYear()}-${pad(prevM.getMonth()+1)}-16`;
  const otEnd   = `${selYear}-${pad(selMonIdx+1)}-15`;
  const inSel   = d => d >= otStart && d <= otEnd;
  const selKey  = `${selYear}-${pad(selMonIdx+1)}`;

  // Branch preview stats for selected month
  const branchStats = branches.map(b => {
    const brEmp = employees.filter(e=>e.active&&e.branch===b);
    const otH = brEmp.reduce((s,e)=>(e.overtime||[]).filter(o=>o.status==="approved"&&inSel(o.date)).reduce((ss,o)=>ss+(o.hours||0),s),0);
    const net = brEmp.reduce((s,e)=>{
      const empOTCfg2=(empOTOverrides&&empOTOverrides[e.id])||otConfig||{};
      const otE2=(e.overtime||[]).filter(o=>o.status==="approved"&&inSel(o.date)).reduce((ss,o)=>ss+(o.cost||0),0);
      const bon2=(e.bonuses||[]).filter(b=>inSel(b.date)).reduce((ss,b)=>ss+(b.amount||0),0);
      const att2=(e.attendance||[]).filter(a=>a.date.startsWith(selKey)).reduce((ss,a)=>{const d=calcAttendanceDeductions(a.checkIn,a.checkOut,e.salary||0,otConfig,empOTCfg2,latePolicy);return ss+d.lateDeduct+d.earlyDeduct;},0);
      const unp2=(e.leaves||[]).filter(l=>l.date.startsWith(selKey)&&(l.type==="unpaid"||l.status==="unpaid")).reduce((ss)=>ss+calcUnpaidDeduct(e.salary||0,otConfig,empOTCfg2),0);
      const hd2=(e.leaves||[]).filter(l=>l.date.startsWith(selKey)&&l.halfDay&&l.status==="approved").reduce((ss)=>ss+calcHalfDayDeduct(e.salary||0,otConfig,empOTCfg2),0);
      return s+((e.salary||0)+otE2+bon2-att2-unp2-hd2);
    },0);
    return { branch:b, count:brEmp.length, otH, net };
  });

  const doExport = async () => {
    setExporting(true);
    try {
      const fileName = await exportBranchesExcel(employees, branches, otConfig, empOTOverrides, latePolicy, bonusTypes, selMonIdx, selYear);
      setLastExport(new Date().toLocaleString("en-IN"));
      flash(`Downloaded: ${fileName} ✓`);
    } catch(e) {
      flash("Export failed — " + e.message);
    }
    setExporting(false);
  };

  return (
    <div>
      <SecTitle style={{marginTop:0}}>Monthly Data Export</SecTitle>

      {/* Month / Year selector */}
      <div style={{...S_DS.card,marginBottom:14}}>
        <div style={{color:"#e2e8f0",fontWeight:600,fontSize:13,marginBottom:12}}>Select Salary Month</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9,marginBottom:12}}>
          <div>
            <label style={{display:"block",color:"#4b5563",fontSize:11,fontWeight:500,marginBottom:5,textTransform:"uppercase",letterSpacing:"0.05em"}}>Month</label>
            <select value={selMonIdx} onChange={e=>setSelMonIdx(Number(e.target.value))}
              style={{...S_DS.input,background:"#13131e"}}>
              {MONTHS_FULL.map((m,i)=><option key={i} value={i}>{m}</option>)}
            </select>
          </div>
          <div>
            <label style={{display:"block",color:"#4b5563",fontSize:11,fontWeight:500,marginBottom:5,textTransform:"uppercase",letterSpacing:"0.05em"}}>Year</label>
            <select value={selYear} onChange={e=>setSelYear(Number(e.target.value))}
              style={{...S_DS.input,background:"#13131e"}}>
              {yearOpts.map(y=><option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
        <div style={{...S_DS.banner,fontSize:12,color:"#6b7280",lineHeight:1.8}}>
          <div><b style={{color:"#e2e8f0"}}>Salary month:</b> {selMonName} {selYear}</div>
          <div><b style={{color:"#fbbf24"}}>OT period:</b> {otStartLabel} – {otEndLabel}</div>
          <div><b style={{color:"#10b981"}}>Payment:</b> {payLabel}</div>
        </div>
      </div>

      {/* What's included */}
      <div style={{...S_DS.banner,marginBottom:14,lineHeight:1.9}}>
        <div style={{color:"#e2e8f0",fontWeight:600,marginBottom:6,fontSize:13}}>📋 Report Contents</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"2px 12px",fontSize:12,color:"#6b7280"}}>
          <div>📊 Summary — all branches</div>
          <div>📋 Attendance log</div>
          {branches.map(b=><div key={b}>🏢 {b}</div>)}
          <div>⏱ OT records</div>
        </div>
      </div>

      {/* Branch preview */}
      <SecTitle>Branch Preview</SecTitle>
      {branchStats.map((b,i)=>(
        <div key={i} style={{...S_DS.row,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{color:"#e2e8f0",fontSize:13,fontWeight:600}}>🏢 {b.branch}</div>
            <div style={{color:"#4b5563",fontSize:11}}>{b.count} employees · OT: {b.otH.toFixed(1)}h</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{color:"#10b981",fontSize:13,fontWeight:600}}>{fmtMoney(b.net)}</div>
          </div>
        </div>
      ))}

      {/* Download button — always enabled */}
      <button onClick={doExport} disabled={exporting}
        style={{width:"100%",marginTop:14,padding:"15px",background:"linear-gradient(135deg,#10b981,#059669)",border:"none",borderRadius:13,color:"#fff",fontSize:15,fontWeight:700,cursor:exporting?"not-allowed":"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:10,boxShadow:"0 4px 16px rgba(16,185,129,.3)",opacity:exporting?0.7:1}}
      >
        <span style={{fontSize:18}}>{exporting?"⏳":"📥"}</span>
        {exporting ? "Generating Excel…" : `Download ${selMonName} ${selYear} Report`}
      </button>
      <div style={{textAlign:"center",color:"#374151",fontSize:11,marginTop:6}}>
        AttendX_{selMonShort}{selYear}_{now.toISOString().split("T")[0]}.xlsx
      </div>
      {lastExport&&<div style={{textAlign:"center",color:"#374151",fontSize:11,marginTop:4}}>Last exported: {lastExport}</div>}
    </div>
  );
}


// ─── HR LATE POLICY PANEL ─────────────────────────────────────────────────────
function HRLatePolicyPanel({ latePolicy, setLatePolicy, flash }) {
  const [grace, setGrace] = useState(latePolicy?.graceEnd || "08:30");
  const [late,  setLate]  = useState(latePolicy?.lateDeductHr || "09:30");
  const [wEnd,  setWEnd]  = useState(latePolicy?.workEnd || "17:30");
  const save = ()=>{
    setLatePolicy({ graceEnd:grace, lateDeductHr:late, workStart:"08:30", workEnd:wEnd });
    flash("Late policy saved ✓");
  };
  return (
    <div style={{...S_DS.card,marginBottom:10}}>
      <div style={{fontSize:12,color:"#4b5563",marginBottom:10,lineHeight:1.7}}>
        After <b style={{color:"#fbbf24"}}>Grace End</b>: flat 1 hr deducted from salary.<br/>
        After <b style={{color:"#f87171"}}>Late Deduct Hr</b>: OT-block logic applied on late minutes.<br/>
        Before <b style={{color:"#a78bfa"}}>Work End</b>: early checkout triggers OT-block deduction.
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:9}}>
        <FInput label="Grace End (1hr deduct)" type="time" value={grace} onChange={setGrace}/>
        <FInput label="Late Deduct Hr (OT logic)" type="time" value={late} onChange={setLate}/>
        <FInput label="Work End (early-out)" type="time" value={wEnd} onChange={setWEnd}/>
      </div>
      <button onClick={save} style={{...S_DS.greenBtn,width:"100%"}}>Save Late Policy</button>
    </div>
  );
}

// ─── HR BONUS TYPES PANEL ─────────────────────────────────────────────────────
function HRBonusTypesPanel({ bonusTypes, setBonusTypes, flash }) {
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const add = ()=>{
    if (!newName.trim()){ flash("Enter a name"); return; }
    if ((bonusTypes||[]).some(b=>b.name===newName.trim())){ flash("Type already exists"); return; }
    setBonusTypes(prev=>[...(prev||[]),{name:newName.trim(),description:newDesc.trim()}]);
    flash(`"${newName.trim()}" added ✓`); setNewName(""); setNewDesc("");
  };
  return (
    <div style={{...S_DS.card,marginBottom:10}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9}}>
        <FInput label="Type Name" value={newName} onChange={setNewName} placeholder="e.g. Festival Bonus"/>
        <FInput label="Description (opt)" value={newDesc} onChange={setNewDesc} placeholder="Brief note"/>
      </div>
      <button onClick={add} style={{...S_DS.greenBtn,width:"100%",marginBottom:10}}>+ Add Bonus Type</button>
      {(bonusTypes||[]).map((b,i)=>(
        <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 0",borderTop:"1px solid rgba(255,255,255,.05)"}}>
          <div>
            <span style={{color:"#e2e8f0",fontSize:13,fontWeight:500}}>{b.name}</span>
            {b.description&&<span style={{color:"#374151",fontSize:11,marginLeft:8}}>{b.description}</span>}
          </div>
          <button onClick={()=>setBonusTypes(prev=>prev.filter((_,j)=>j!==i))} style={S_DS.dangerPill}>Remove</button>
        </div>
      ))}
    </div>
  );
}

// ─── HR BONUS PANEL (per employee in payroll) ─────────────────────────────────
function HRBonusPanel({ e, setEmployees, bonusTypes, flash }) {
  const [show,setShow] = useState(false);
  const defaultType = (bonusTypes&&bonusTypes[0]?.name)||"";
  const [form,setForm] = useState({type:defaultType,amount:"",date:todayStr(),note:""});
  // keep type in sync if bonusTypes loads after mount
  useEffect(()=>{ if(!form.type&&bonusTypes&&bonusTypes[0]) setForm(f=>({...f,type:bonusTypes[0].name})); },[bonusTypes]);
  const addBonus = ()=>{
    if (!form.type){ flash("Select a bonus type"); return; }
    if (!form.amount||parseFloat(form.amount)<=0){ flash("Enter a valid amount"); return; }
    const bonus = {type:form.type,amount:parseFloat(form.amount),date:form.date,note:form.note,on:new Date().toISOString()};
    setEmployees(prev=>prev.map(x=>x.id===e.id?{...x,bonuses:[...(x.bonuses||[]),bonus]}:x));
    flash(`${form.type} of ${fmtMoney(bonus.amount)} added for ${e.name} ✓`);
    setForm({type:form.type,amount:"",date:todayStr(),note:""});
  };
  const bonusesThisPeriod = (e.bonuses||[]).filter(b=>inOTPeriod(b.date));
  return (
    <div style={{marginTop:8,paddingTop:8,borderTop:"1px solid rgba(255,255,255,.05)"}}>
      <button onClick={()=>setShow(!show)} style={{background:"none",border:"none",color:"#818cf8",fontSize:12,cursor:"pointer",fontFamily:"inherit",padding:0}}>
        {show?"▲ Hide":"🎁 Add Bonus/Award"} {bonusesThisPeriod.length>0?`(${bonusesThisPeriod.length} this period)`:""}
      </button>
      {show && (
        <div style={{marginTop:8}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <FSel label="Type" value={form.type} onChange={v=>setForm(f=>({...f,type:v}))} opts={(bonusTypes||[]).map(b=>({v:b.name,l:b.name}))}/>
            <FInput label="Amount ₹" type="number" value={form.amount} onChange={v=>setForm(f=>({...f,amount:v}))} placeholder="e.g. 5000"/>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <FInput label="Date" type="date" value={form.date} onChange={v=>setForm(f=>({...f,date:v}))}/>
            <FInput label="Note (opt)" value={form.note} onChange={v=>setForm(f=>({...f,note:v}))}/>
          </div>
          <button onClick={addBonus} style={{...S_DS.greenBtn,width:"100%",padding:"8px"}}>Add Bonus</button>
          {bonusesThisPeriod.map((b,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",fontSize:12,borderTop:"1px solid rgba(255,255,255,.04)"}}>
              <span style={{color:"#818cf8"}}>{b.type}{b.note?` · ${b.note}`:""} · {fmt(b.date)}</span>
              <span style={{color:"#10b981",fontWeight:600}}>+{fmtMoney(b.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ─── HR PASSWORD BUTTON ───────────────────────────────────────────────────────
function HRPasswordBtn({ hrPassword, setHrPassword, flash }) {
  const [show, setShow] = useState(false);
  const [pw, setPw] = useState({cur:"", nw:"", cf:""});
  const [err, setErr] = useState("");

  const save = ()=>{
    if (pw.cur !== hrPassword) { setErr("Current password incorrect"); return; }
    if (pw.nw.length < 6) { setErr("Minimum 6 characters"); return; }
    if (pw.nw !== pw.cf)  { setErr("Passwords don't match"); return; }
    setHrPassword(pw.nw);
    flash("HR password updated ✓");
    setShow(false); setPw({cur:"",nw:"",cf:""}); setErr("");
  };

  return (
    <div style={{position:"relative"}}>
      <button onClick={()=>setShow(!show)}
        style={{background:"none",border:"none",color:"#6b7280",cursor:"pointer",fontSize:13,fontFamily:"inherit",display:"flex",alignItems:"center",gap:4}}>
        🔑 Password
      </button>
      {show && (
        <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,zIndex:100,display:"flex",alignItems:"flex-start",justifyContent:"flex-end",padding:"60px 16px 0",background:"rgba(0,0,0,.5)"}}
          onClick={(e)=>{ if(e.target===e.currentTarget) setShow(false); }}>
          <div style={{background:"#14141f",border:"1px solid rgba(255,255,255,.1)",borderRadius:14,padding:20,width:280,boxShadow:"0 8px 32px rgba(0,0,0,.6)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <span style={{color:"#e2e8f0",fontWeight:600,fontSize:14}}>Change HR Password</span>
              <button onClick={()=>setShow(false)} style={{background:"none",border:"none",color:"#4b5563",cursor:"pointer",fontSize:17,lineHeight:1}}>✕</button>
            </div>
            {err && <div style={{background:"rgba(239,68,68,.08)",border:"1px solid rgba(239,68,68,.2)",borderRadius:8,padding:"7px 10px",color:"#f87171",fontSize:12,marginBottom:10}}>{err}</div>}
            <FInput label="Current Password" type="password" value={pw.cur} onChange={v=>setPw(p=>({...p,cur:v}))}/>
            <FInput label="New Password"     type="password" value={pw.nw}  onChange={v=>setPw(p=>({...p,nw:v}))}/>
            <FInput label="Confirm New"      type="password" value={pw.cf}  onChange={v=>setPw(p=>({...p,cf:v}))}/>
            <button onClick={save} style={{...S_DS.primaryBtn,width:"100%",marginTop:4}}>Update Password</button>
          </div>
        </div>
      )}
    </div>
  );
}


// ─── DESIGN SYSTEM ────────────────────────────────────────────────────────────
const S_DS = {}; // filled after S is defined
const S = {
  heading: { fontFamily:"Syne,sans-serif", fontSize:18, fontWeight:800, color:"#f1f5f9", margin:0 },
  logoBox: { display:"inline-flex",alignItems:"center",justifyContent:"center",width:54,height:54,background:"linear-gradient(135deg,#6366f1,#8b5cf6)",borderRadius:14,marginBottom:14,boxShadow:"0 6px 22px rgba(99,102,241,.38)" },
  header: { background:"rgba(255,255,255,.03)",borderBottom:"1px solid rgba(255,255,255,.06)",padding:"13px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:10,backdropFilter:"blur(14px)" },
  bottomNav: { position:"fixed",bottom:0,left:0,right:0,background:"rgba(8,8,14,.96)",borderTop:"1px solid rgba(255,255,255,.06)",display:"flex",backdropFilter:"blur(14px)",paddingBottom:"env(safe-area-inset-bottom, 0px)" },
  navBtn: { flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3,padding:"10px 4px",background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",transition:"color .15s",minHeight:"52px",WebkitUserSelect:"none" },
  card: { background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",borderRadius:15,padding:18,marginBottom:10 },
  row: { background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.07)",borderRadius:12,padding:13,marginBottom:7 },
  input: { width:"100%",padding:"10px 12px",background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",borderRadius:8,color:"#f1f5f9",fontSize:16,outline:"none",boxSizing:"border-box",fontFamily:"inherit" },
  primaryBtn: { padding:"13px 22px",background:"linear-gradient(135deg,#6366f1,#8b5cf6)",border:"none",borderRadius:12,color:"#fff",fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"inherit",boxShadow:"0 4px 14px rgba(99,102,241,.32)" },
  greenBtn: { padding:"11px 18px",background:"rgba(16,185,129,.09)",border:"1px solid rgba(16,185,129,.22)",borderRadius:10,color:"#10b981",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit" },
  banner: { background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.07)",borderRadius:9,padding:"10px 13px",fontSize:13 },
  tabBtn: { padding:"8px 13px",border:"1px solid",borderRadius:9,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap" },
  pill: { padding:"5px 11px",border:"1px solid",borderRadius:20,fontSize:12,fontWeight:500,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap" },
  dangerPill: { padding:"4px 10px",background:"rgba(239,68,68,.09)",border:"1px solid rgba(239,68,68,.22)",borderRadius:6,color:"#f87171",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit",flexShrink:0 },
  greenPill: { padding:"4px 10px",background:"rgba(16,185,129,.09)",border:"1px solid rgba(16,185,129,.22)",borderRadius:6,color:"#10b981",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit",flexShrink:0 },
  errBox: { background:"rgba(239,68,68,.09)",border:"1px solid rgba(239,68,68,.22)",borderRadius:8,padding:"9px 13px",color:"#f87171",fontSize:13,marginBottom:13 },
};

Object.assign(S_DS, S);
function Shell({ children, center }) {
  useEffect(()=>{
    // Ensure proper mobile viewport
    let mv = document.querySelector('meta[name="viewport"]');
    if (!mv) {
      mv = document.createElement('meta');
      mv.name = 'viewport';
      document.head.appendChild(mv);
    }
    mv.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no';
    // Prevent pull-to-refresh on mobile
    document.body.style.overscrollBehavior = 'none';
  },[]);
  return (
    <div style={{minHeight:"100vh",background:"#090910",fontFamily:"'DM Sans',sans-serif",display:center?"flex":"block",flexDirection:"column",alignItems:center?"center":"unset",justifyContent:center?"center":"unset",padding:center?"24px":0,position:"relative",overflow:"hidden",WebkitTapHighlightColor:"transparent"}}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=Syne:wght@700;800&display=swap" rel="stylesheet"/>
      <div style={{position:"absolute",top:"-18%",right:"-8%",width:460,height:460,background:"radial-gradient(circle,rgba(99,102,241,.1) 0%,transparent 68%)",borderRadius:"50%",pointerEvents:"none"}}/>
      <div style={{position:"absolute",bottom:"-8%",left:"-8%",width:380,height:380,background:"radial-gradient(circle,rgba(16,185,129,.07) 0%,transparent 68%)",borderRadius:"50%",pointerEvents:"none"}}/>
      {children}
    </div>
  );
}

function Av({ name, size=36 }) {
  return <div style={{width:size,height:size,borderRadius:"50%",background:"linear-gradient(135deg,#6366f1,#8b5cf6)",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:size*.38,fontWeight:700,flexShrink:0}}>{(name||"?").charAt(0)}</div>;
}
function Pad({ children }) { return <div style={{padding:"18px max(20px,env(safe-area-inset-left,20px)) 0 max(20px,env(safe-area-inset-right,20px))"}}>{children}</div>; }
function SecTitle({ children, style }) { return <div style={{fontFamily:"Syne,sans-serif",fontSize:16,fontWeight:700,color:"#f1f5f9",margin:"14px 0 9px",...style}}>{children}</div>; }
function Empty({ children }) { return <div style={{color:"#1f2937",fontSize:14,textAlign:"center",padding:20}}>{children}</div>; }
function SuccBox({ children }) { return <div style={{background:"rgba(16,185,129,.07)",border:"1px solid rgba(16,185,129,.18)",borderRadius:8,padding:"9px 13px",color:"#10b981",fontSize:13,marginBottom:12}}>{children}</div>; }
function FCard({ title, onClose, children }) {
  return <div style={{...S.card,marginTop:8,marginBottom:10}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:13}}>
      <span style={{color:"#f1f5f9",fontWeight:700,fontFamily:"Syne,sans-serif",fontSize:14}}>{title}</span>
      <button onClick={onClose} style={{background:"none",border:"none",color:"#374151",cursor:"pointer",fontSize:17,lineHeight:1}}>✕</button>
    </div>
    {children}
  </div>;
}
function FInput({ label, value, onChange, type="text", placeholder="", onEnter }) {
  return <div style={{marginBottom:9}}>
    <label style={{display:"block",color:"#4b5563",fontSize:11,fontWeight:500,marginBottom:5,textTransform:"uppercase",letterSpacing:"0.05em"}}>{label}</label>
    <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} onKeyDown={e=>e.key==="Enter"&&onEnter&&onEnter()} style={S.input}/>
  </div>;
}
function FSel({ label, value, onChange, opts }) {
  return <div style={{marginBottom:9}}>
    <label style={{display:"block",color:"#4b5563",fontSize:11,fontWeight:500,marginBottom:5,textTransform:"uppercase",letterSpacing:"0.05em"}}>{label}</label>
    <select value={value} onChange={e=>onChange(e.target.value)} style={{...S.input,background:"#13131e",fontSize:16}}>
      {opts.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  </div>;
}
function Stat({ l, v, s, c }) {
  return <div style={{background:"rgba(255,255,255,.05)",borderRadius:11,padding:"11px 8px",textAlign:"center"}}>
    <div style={{color:c,fontFamily:"Syne,sans-serif",fontSize:19,fontWeight:800}}>{v}</div>
    <div style={{color:"#6b7280",fontSize:10,marginTop:1}}>{l}</div>
    <div style={{color:"#374151",fontSize:10}}>{s}</div>
  </div>;
}
function IBox({ l, v }) {
  return <div style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.07)",borderRadius:11,padding:13}}>
    <div style={{color:"#374151",fontSize:11,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.04em"}}>{l}</div>
    <div style={{color:"#e2e8f0",fontSize:14,fontWeight:600}}>{v}</div>
  </div>;
}
function KV({ k, v }) { return <div style={{color:"#374151",fontSize:12}}>{k}: <span style={{color:"#6b7280"}}>{v}</span></div>; }
function Chip({ children, c, sm }) {
  return <span style={{background:`${c}22`,border:`1px solid ${c}44`,borderRadius:5,padding:sm?"2px 7px":"3px 9px",color:c,fontSize:sm?10:12,fontWeight:600}}>{children}</span>;
}
function SBadge({ s }) {
  const m={pending:["rgba(245,158,11,.1)","rgba(245,158,11,.28)","#fbbf24"],approved:["rgba(16,185,129,.07)","rgba(16,185,129,.18)","#10b981"],rejected:["rgba(239,68,68,.09)","rgba(239,68,68,.2)","#f87171"],cancelled:["rgba(100,116,139,.1)","rgba(100,116,139,.2)","#64748b"]}[s]||["rgba(245,158,11,.1)","rgba(245,158,11,.28)","#fbbf24"];
  return <span style={{background:m[0],border:`1px solid ${m[1]}`,borderRadius:6,padding:"2px 7px",color:m[2],fontSize:11,fontWeight:600,textTransform:"capitalize"}}>{s}</span>;
}
function SRow({ title, sub, status, note }) {
  return <div style={{...S.row,display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
    <div><div style={{color:"#e2e8f0",fontSize:14,fontWeight:500}}>{title}</div>
    <div style={{color:"#6b7280",fontSize:12}}>{sub}</div>
    {note && <div style={{color:"#374151",fontSize:12,marginTop:2}}>{note}</div>}</div>
    <SBadge s={status}/>
  </div>;
}
function OBtn({ children, onClick, col="indigo", full }) {
  const c={indigo:{bg:"rgba(99,102,241,.1)",brd:"rgba(99,102,241,.25)",fg:"#818cf8"},amber:{bg:"rgba(245,158,11,.08)",brd:"rgba(245,158,11,.22)",fg:"#fbbf24"},green:{bg:"rgba(16,185,129,.08)",brd:"rgba(16,185,129,.22)",fg:"#10b981"},purple:{bg:"rgba(167,139,250,.1)",brd:"rgba(167,139,250,.25)",fg:"#a78bfa"}}[col]||{bg:"rgba(99,102,241,.1)",brd:"rgba(99,102,241,.25)",fg:"#818cf8"};
  return <button onClick={onClick} style={{padding:"10px 16px",background:c.bg,border:`1px solid ${c.brd}`,borderRadius:9,color:c.fg,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit",width:full?"100%":"auto",marginBottom:8}}>{children}</button>;
}
function Abt({ children, onClick, ok }) {
  return <button onClick={onClick} style={{padding:"6px 12px",background:ok?"rgba(16,185,129,.1)":"rgba(239,68,68,.08)",border:`1px solid ${ok?"rgba(16,185,129,.22)":"rgba(239,68,68,.18)"}`,borderRadius:7,color:ok?"#10b981":"#f87171",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>{children}</button>;
}
