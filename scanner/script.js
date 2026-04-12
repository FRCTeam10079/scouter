// ─── CONFIG ──────────────────────────────────────────────────────────────────
const API_URL = "http://localhost:8000";

const TIMEOUT = 5000;
const SCAN_INTERVAL_MS = 120;
const SMART_DECODE_INTERVAL_MS = 420;
const ZXING_LOCAL_IIFE = "./assets/zxing/reader/index.js";
const ZXING_LOCAL_WASM = "./assets/zxing/reader/zxing_reader.wasm";
const ZXING_CDN_IIFE =
  "https://cdn.jsdelivr.net/npm/zxing-wasm@3.0.1/dist/iife/reader/index.js";
const OFFLINE_QUEUE_KEY = "@scanner_pending_reports_v1";
const LOCAL_RECENT_REPORTS_KEY = "@scanner_recent_reports_v1";
const TBA_EVENT_KEY_STORAGE = "@scanner_tba_event_key_v1";
const TBA_SCHEDULE_CACHE_PREFIX = "@scanner_tba_schedule_";

// ─── STATE ───────────────────────────────────────────────────────────────────
let AUTH_TOKEN = "";
let cameraStream = null;
let scanVideoEl = null;
let scanCanvasEl = null;
let scanLoopId = null;
let isDecodingFrame = false;
let lastDecodeTs = 0;
let cameraOn = false;
let processingFlag = false;
let qrLibLoaded = false;
let readBarcodesFn = null;
const scanSavedKeys = Object.create(null);
const scanInFlightKeys = Object.create(null);
let pendingReports = [];
let likelyQrStreak = 0;
let hintHideTimer = null;
let lastHintTs = 0;
let cameraTrack = null;
let zoomCap = null;
let zoomMin = 1;
let zoomMax = 1;
let zoomStep = 0.1;
let currentZoom = 1;
let targetZoom = 1;
let zoomApplyBusy = false;
let lastSmartDecodeTs = 0;
let smartCanvasEl = null;
let smartCtx = null;
let visualZoom = 1;
let visualPanX = 0;
let visualPanY = 0;
let visualTargetZoom = 1;
let visualCurrentZoom = 1;
let advancedScanEnabled = true;
let qrLibInitInFlight = false;
const qrLibReadyCallbacks = [];
let pendingCameraStart = false;

// ─── DOM REFS ────────────────────────────────────────────────────────────────
function $(id) {
  return document.getElementById(id);
}
const loginSec = $("login-section");
const scanSec = $("scan-section");
const printSec = $("print-section");
const navBtns = $("nav-buttons");
const loginBtn = $("login-btn");
const camBtn = $("cam-btn");
const scanOverlay = $("scan-overlay");
const scanInfo = $("scan-info");
const scanHint = $("scan-hint");
const logsBox = $("logs");
const tableBody = $("table-body");
const fileInput = $("file-input");
const statusBadge = $("connection-status");
const libMsg = $("lib-msg");
const camHolder = $("cam-placeholder");
const advancedScanToggle = $("advanced-scan-toggle");

// ─── HELPERS ─────────────────────────────────────────────────────────────────
async function fetchTimeout(url, opts) {
  const ctrl = new AbortController();
  const t = setTimeout(() => {
    ctrl.abort();
  }, TIMEOUT);
  try {
    return await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
  } finally {
    clearTimeout(t);
  }
}

function normalizeReportList(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.results)) return value.results;
  if (Array.isArray(value?.reports)) return value.reports;
  return [];
}

async function fetchReportList(take, skip) {
  const payload = { take: Number(take) || 40, skip: Number(skip) || 0 };

  const res = await fetchTimeout(`${API_URL}/get-reports`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AUTH_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });

  if (res.status === 404) {
    const fallbackRes = await fetchTimeout(`${API_URL}/reports/data`, {
      method: "GET",
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });

    if (!fallbackRes.ok) {
      throw new Error(`report list failed (${fallbackRes.status})`);
    }

    const all = normalizeReportList(await fallbackRes.json());
    all.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    const sliced = all.slice(payload.skip || 0, (payload.skip || 0) + (payload.take || 40));
    return sliced.map((r) => ({
      id: r.id,
      eventCode: r.eventCode,
      matchType: r.matchType,
      matchNumber: r.matchNumber,
      teamNumber: r.teamNumber,
      user: r.user || null,
    }));
  }

  if (!res.ok) {
    throw new Error(`report list failed (${res.status})`);
  }

  return normalizeReportList(await res.json());
}

function loadRecentReports() {
  try {
    const raw = localStorage.getItem(LOCAL_RECENT_REPORTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) {
    return [];
  }
}

function saveRecentReports(items) {
  try {
    localStorage.setItem(LOCAL_RECENT_REPORTS_KEY, JSON.stringify(items));
  } catch (_e) {
    // Best effort cache only.
  }
}

function upsertRecentReport(payload, statusText) {
  const list = loadRecentReports();
  const key = `${payload.matchNumber}|${payload.teamNumber}`;
  const idx = list.findIndex(
    (x) => `${x.matchNumber}|${x.teamNumber}` === key,
  );
  const row = {
    id: Date.now(),
    matchNumber: payload.matchNumber,
    teamNumber: payload.teamNumber,
    username: "Local",
    statusText: statusText || "Saved",
  };
  if (idx >= 0) list[idx] = row;
  else list.unshift(row);
  saveRecentReports(list.slice(0, 120));
}

function renderTableFromLocalCache() {
  const rows = loadRecentReports();
  if (!rows.length) {
    tableBody.innerHTML =
      "<tr class='empty-row'><td colspan='4'>No local cached matches yet.</td></tr>";
    return;
  }

  tableBody.innerHTML = rows
    .map((r) => {
      const mn = r.matchNumber || r.id || "?";
      const sc = r.username || "Local";
      const status = r.statusText || "Saved";
      return (
        "<tr><td style='font-weight:bold;color:#0a84ff'>Q" +
        mn +
        "</td><td style='font-weight:bold;font-size:1.1em'>" +
        r.teamNumber +
        "</td><td style='color:#aaa'>" +
        sc +
        "</td><td style='color:#ff9500'>[" +
        status +
        "]</td></tr>"
      );
    })
    .join("");
}

function log(msg, type) {
  const d = document.createElement("div");
  d.className = `log-${type || "info"}`;
  const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
  d.textContent = `[${ts}] ${msg}`;
  logsBox.prepend(d);
}

function clearLogs() {
  logsBox.innerHTML = "";
  log("Logs cleared.");
}

function loadPendingReports() {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    pendingReports = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(pendingReports)) pendingReports = [];
  } catch (_e) {
    pendingReports = [];
  }
}

function savePendingReports() {
  try {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(pendingReports));
  } catch (_e) {
    // Ignore storage errors; queue is best effort.
  }
}

function pendingReportKey(item) {
  const p = item?.payload ? item.payload : {};
  return [p.eventCode || "", p.matchNumber || "", p.teamNumber || ""].join("|");
}

function enqueuePendingReport(payload) {
  const key = [
    payload.eventCode || "",
    payload.matchNumber || "",
    payload.teamNumber || "",
  ].join("|");
  const exists = pendingReports.some((item) => pendingReportKey(item) === key);
  if (exists) return false;

  pendingReports.push({
    payload: payload,
    queuedAt: new Date().toISOString(),
  });
  savePendingReports();
  return true;
}

function normalizeAutoClimbForBackend(value) {
  const v = String(value || "").toUpperCase();
  if (v === "FAILED") return "FAILED";
  if (v === "LEVEL1") return "LEVEL1";
  return "NONE";
}

function sanitizeReportPayloadForBackend(payload) {
  const p = payload || {};
  const out = JSON.parse(JSON.stringify(p));

  out.eventCode = String(out.eventCode || "pncmp").substring(0, 5).padEnd(5, "A");
  out.matchType = out.matchType || "QUALIFICATION";
  out.alliance = out.alliance === "BLUE" ? "BLUE" : "RED";

  out.auto = out.auto || {};
  out.auto.climb = normalizeAutoClimbForBackend(out.auto.climb);

  return out;
}

function flushPendingReports() {
  if (
    !AUTH_TOKEN ||
    AUTH_TOKEN === "offline-demo-token" ||
    pendingReports.length === 0
  )
    return;

  const queue = pendingReports.slice();
  const nextPending = [];
  let savedCount = 0;

  let chain = Promise.resolve();
  queue.forEach((item) => {
    item.payload = sanitizeReportPayloadForBackend(item.payload);
    chain = chain.then(() =>
      fetchTimeout(`${API_URL}/report`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${AUTH_TOKEN}`,
        },
        body: JSON.stringify(item.payload),
      })
        .then((res) => {
          if (res.status === 201) {
            savedCount++;
            return;
          }
          if (res.status === 400) {
            log("Dropped invalid queued report (HTTP 400).", "error");
            return;
          }
          return res
            .json()
            .then((err) => {
              if (err?.message && err.message.indexOf("Unique") !== -1) {
                savedCount++;
                return;
              }
              nextPending.push(item);
            })
            .catch(() => {
              nextPending.push(item);
            });
        })
        .catch(() => {
          nextPending.push(item);
        }),
    );
  });

  chain.then(() => {
    pendingReports = nextPending;
    savePendingReports();
    if (savedCount > 0) {
      log(`Synced ${savedCount} offline report(s).`, "success");
      fetchData();
    }
  });
}

function hideAllMatches() {
  const w1 = prompt(
    "DANGER: This hides ALL previously scanned matches from this dashboard. They remain in the database but will be invisible here.\n\nType 'I understand' to proceed:",
  );
  if (w1 !== "I understand") return log("Purge cancelled.", "error");

  const w2 = prompt("Type 'HIDE' to confirm:");
  if (w2 !== "HIDE") return log("Purge cancelled.", "error");

  const key = prompt("Enter Master Team Key:");
  if (key !== "SC-TEAM-SEAT")
    return log("Invalid Master Key. Purge denied.", "error");

  // Since we don't always have createdAt, let's just save a timestamp to hide anything fetched before this moment.
  // Actually, wait - let's find the max ID of currently fetched reports and hide all IDs below/equal to it.
  const currentMaxId = window.lastFetchedMaxId || 0;
  const existingHidden = parseInt(
    localStorage.getItem("hideBeforeId") || "0",
    10,
  );
  const newHidden = Math.max(currentMaxId, existingHidden);

  localStorage.setItem("hideBeforeId", newHidden.toString());
  log(
    "Successfully hid all prior matches (IDs up to " +
      newHidden +
      ") from view.",
    "success",
  );
  fetchData();
}

// ─── QR LIBRARY (loaded only when entering scanner tab) ──────────────────────
function ensureQrLib(cb) {
  if (typeof cb === "function") qrLibReadyCallbacks.push(cb);

  if (qrLibLoaded) {
    while (qrLibReadyCallbacks.length) {
      try {
        qrLibReadyCallbacks.shift()();
      } catch (_e) {}
    }
    return;
  }
  if (qrLibInitInFlight) return;

  qrLibInitInFlight = true;
  libMsg.textContent = "Loading zxing-wasm scanner (offline-first)...";

  const flushReadyCallbacks = () => {
    qrLibInitInFlight = false;
    while (qrLibReadyCallbacks.length) {
      try {
        qrLibReadyCallbacks.shift()();
      } catch (_e) {}
    }
  };

  const onReady = () => {
    if (
      !(window.ZXingWASM && typeof window.ZXingWASM.readBarcodes === "function")
    ) {
      return false;
    }
    if (typeof window.ZXingWASM.prepareZXingModule === "function") {
      window.ZXingWASM.prepareZXingModule({
        overrides: {
          locateFile: (path, prefix) => {
            if (path?.endsWith(".wasm")) return ZXING_LOCAL_WASM;
            return prefix + path;
          },
        },
      });
    }
    readBarcodesFn = window.ZXingWASM.readBarcodes;
    qrLibLoaded = true;
    libMsg.textContent = "";
    flushReadyCallbacks();
    return true;
  };

  const loadScript = (src, onFailure) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => {
      if (!onReady()) {
        libMsg.textContent = "zxing-wasm loaded but scanner API missing.";
        libMsg.style.color = "#ff453a";
      }
    };
    s.onerror = onFailure;
    document.body.appendChild(s); // append to BODY, not head — avoids parser issues
  };

  // Try local vendored assets first so scanner works without internet.
  loadScript(ZXING_LOCAL_IIFE, () => {
    libMsg.textContent = "Local scanner assets missing; trying CDN...";
    libMsg.style.color = "#ff9500";
    loadScript(ZXING_CDN_IIFE, () => {
      qrLibInitInFlight = false;
      libMsg.textContent = "QR lib failed (offline and no local assets).";
      libMsg.style.color = "#ff453a";
    });
  });
}

function extractQrTextFromResults(results) {
  if (!results || !results.length) return null;
  const item = results[0] || {};
  return item.text || item.rawValue || item.value || item.content || null;
}

function ensureScanElements() {
  if (scanVideoEl && scanCanvasEl) return;
  const reader = $("reader");
  reader.innerHTML = "";

  scanVideoEl = document.createElement("video");
  scanVideoEl.setAttribute("playsinline", "true");
  scanVideoEl.setAttribute("autoplay", "true");
  scanVideoEl.muted = true;
  scanVideoEl.style.width = "100%";
  scanVideoEl.style.height = "100%";
  scanVideoEl.style.objectFit = "cover";
  scanVideoEl.style.display = "block";
  reader.appendChild(scanVideoEl);

  scanCanvasEl = document.createElement("canvas");
  smartCanvasEl = document.createElement("canvas");
  smartCtx = smartCanvasEl.getContext("2d", { willReadFrequently: true });
}

function normalizeCameraViewport() {
  const wrapper = document.querySelector(".cam-wrapper");
  if (!wrapper) return;

  // Keep camera stable: prefer 4:3 from current width, bounded by viewport and min/max.
  const w = wrapper.clientWidth || 0;
  const desired = w ? Math.round(w * 0.75) : 420;
  const maxByViewport = Math.round(window.innerHeight * 0.62);
  const h = Math.max(
    320,
    Math.min(560, Math.min(desired, maxByViewport || 560)),
  );
  wrapper.style.height = `${h}px`;
}

function showScanHint(msg) {
  if (!scanHint || processingFlag) return;
  scanHint.textContent =
    msg || "Possible QR seen. Move closer and hold steady.";
  scanHint.classList.remove("hidden");
  if (hintHideTimer) clearTimeout(hintHideTimer);
  hintHideTimer = setTimeout(() => {
    if (scanHint) scanHint.classList.add("hidden");
    hintHideTimer = null;
  }, 1300);
}

function hideScanHint() {
  if (!scanHint) return;
  if (hintHideTimer) {
    clearTimeout(hintHideTimer);
    hintHideTimer = null;
  }
  scanHint.classList.add("hidden");
}

function applyDigitalZoomVisual(zoom, panX, panY) {
  if (!scanVideoEl) return;
  const z = Math.max(1, Number(zoom || 1));
  let px = Number(panX || 0);
  let py = Number(panY || 0);
  if (px < -1) px = -1;
  if (px > 1) px = 1;
  if (py < -1) py = -1;
  if (py > 1) py = 1;

  const maxPanPct = Math.max(0, (z - 1) * 22);
  const tx = (px * maxPanPct).toFixed(2);
  const ty = (py * maxPanPct).toFixed(2);

  visualZoom = z;
  visualPanX = px;
  visualPanY = py;
  scanVideoEl.style.transform = `translate(${tx}%, ${ty}%) scale(${z.toFixed(2)})`;
}

function updateDigitalZoomVisualSmooth() {
  const alpha = 0.18;
  visualCurrentZoom =
    visualCurrentZoom + (visualTargetZoom - visualCurrentZoom) * alpha;
  if (Math.abs(visualCurrentZoom - visualTargetZoom) < 0.01)
    visualCurrentZoom = visualTargetZoom;
  applyDigitalZoomVisual(visualCurrentZoom, 0, 0);
}

function resetDigitalZoomVisual() {
  visualZoom = 1;
  visualPanX = 0;
  visualPanY = 0;
  visualTargetZoom = 1;
  visualCurrentZoom = 1;
  if (scanVideoEl) scanVideoEl.style.transform = "translate(0%, 0%) scale(1)";
}

function resetAdaptiveCameraState() {
  cameraTrack = null;
  zoomCap = null;
  zoomMin = 1;
  zoomMax = 1;
  zoomStep = 0.1;
  currentZoom = 1;
  targetZoom = 1;
  zoomApplyBusy = false;
  lastSmartDecodeTs = 0;
  resetDigitalZoomVisual();
}

function setAdvancedScanEnabled(enabled) {
  advancedScanEnabled = !!enabled;
  likelyQrStreak = 0;
  hideScanHint();
  visualTargetZoom = 1;
  resetDigitalZoomVisual();

  if (zoomCap) {
    targetZoom = zoomMin;
    maybeUpdateHardwareZoom();
  }

  log(
    "Advanced scan assist " +
      (advancedScanEnabled ? "enabled" : "disabled") +
      ".",
    "info",
  );
}

function smartDecodeImageData(frame, w, h, roi) {
  if (!smartCanvasEl || !smartCtx || !frame?.data) return null;
  const sw = Math.max(40, Math.min(w, Math.round(roi.sw)));
  const sh = Math.max(40, Math.min(h, Math.round(roi.sh)));
  const sx = Math.max(0, Math.min(w - sw, Math.round(roi.sx)));
  const sy = Math.max(0, Math.min(h - sh, Math.round(roi.sy)));
  let scale = Number(roi.scale || 1);
  if (!Number.isFinite(scale) || scale < 1) scale = 1;

  // Cap upscaled size to keep CPU bounded while improving tiny-QR readability.
  const dw = Math.min(1600, Math.max(sw, Math.round(sw * scale)));
  const dh = Math.min(1600, Math.max(sh, Math.round(sh * scale)));

  smartCanvasEl.width = dw;
  smartCanvasEl.height = dh;

  // Convert frame ImageData into source canvas by reusing scanCanvasEl pixels.
  const ctx = scanCanvasEl.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.putImageData(frame, 0, 0);

  smartCtx.clearRect(0, 0, dw, dh);
  smartCtx.imageSmoothingEnabled = false;
  smartCtx.drawImage(scanCanvasEl, sx, sy, sw, sh, 0, 0, dw, dh);

  return smartCtx.getImageData(0, 0, dw, dh);
}

function maybeUpdateHardwareZoom() {
  if (!cameraTrack || !zoomCap || zoomApplyBusy) return;

  if (Math.abs(targetZoom - currentZoom) < 0.05) return;
  zoomApplyBusy = true;

  let snapped = targetZoom;
  if (zoomStep > 0) snapped = Math.round(snapped / zoomStep) * zoomStep;
  snapped = Math.max(zoomMin, Math.min(zoomMax, snapped));

  cameraTrack
    .applyConstraints({ advanced: [{ zoom: snapped }] })
    .then(() => {
      currentZoom = snapped;
    })
    .catch(() => {
      /* silently ignore unsupported/blocked zoom writes */
    })
    .finally(() => {
      zoomApplyBusy = false;
    });
}

function runSmartDecodeSweep(frame, w, h) {
  const now = Date.now();
  if (now - lastSmartDecodeTs < SMART_DECODE_INTERVAL_MS)
    return Promise.resolve(null);
  lastSmartDecodeTs = now;

  const rois = [
    { sx: 0, sy: 0, sw: w, sh: h, scale: 1.0 },
    { sx: w * 0.1, sy: h * 0.1, sw: w * 0.8, sh: h * 0.8, scale: 1.2 },
    {
      sx: w * 0.18,
      sy: h * 0.18,
      sw: w * 0.64,
      sh: h * 0.64,
      scale: 1.5,
    },
    { sx: w * 0.25, sy: h * 0.25, sw: w * 0.5, sh: h * 0.5, scale: 2.0 },
    { sx: w * 0.3, sy: h * 0.3, sw: w * 0.4, sh: h * 0.4, scale: 2.3 },
    {
      sx: w * 0.02,
      sy: h * 0.18,
      sw: w * 0.64,
      sh: h * 0.64,
      scale: 1.4,
    },
    {
      sx: w * 0.34,
      sy: h * 0.18,
      sw: w * 0.64,
      sh: h * 0.64,
      scale: 1.4,
    },
    {
      sx: w * 0.18,
      sy: h * 0.02,
      sw: w * 0.64,
      sh: h * 0.64,
      scale: 1.4,
    },
    {
      sx: w * 0.18,
      sy: h * 0.34,
      sw: w * 0.64,
      sh: h * 0.64,
      scale: 1.4,
    },
  ];

  let idx = 0;
  function next() {
    if (idx >= rois.length) return Promise.resolve(null);
    const roiFrame = smartDecodeImageData(frame, w, h, rois[idx++]);
    if (!roiFrame) return next();
    return readBarcodesFn(roiFrame, {
      formats: ["QRCode"],
      maxNumberOfSymbols: 1,
      tryHarder: true,
    })
      .then((results) => {
        const text = extractQrTextFromResults(results);
        if (text) return text;
        return next();
      })
      .catch(() => next());
  }

  return next();
}

function adaptScannerWhenLikelyQr() {
  if (!advancedScanEnabled) return;

  if (likelyQrStreak >= 2) {
    showScanHint("QR spotted. Move closer and hold steady.");
  }

  // Always apply digital zoom for laptop/webcam scenarios.
  if (likelyQrStreak >= 2) {
    let z = 1.18;
    if (likelyQrStreak >= 3) z = 1.35;
    if (likelyQrStreak >= 4) z = 1.52;
    if (likelyQrStreak >= 5) z = 1.7;
    visualTargetZoom = z;
  } else {
    visualTargetZoom = 1;
  }

  if (zoomCap) {
    let desired = zoomMin;
    if (likelyQrStreak >= 2) desired = zoomMin + (zoomMax - zoomMin) * 0.25;
    if (likelyQrStreak >= 3) desired = zoomMin + (zoomMax - zoomMin) * 0.45;
    if (likelyQrStreak >= 4) desired = zoomMin + (zoomMax - zoomMin) * 0.6;
    targetZoom = desired;
    maybeUpdateHardwareZoom();
  }
}

function detectLikelyQrPresence(frame, w, h) {
  if (!frame?.data || !w || !h) return false;

  const data = frame.data;
  const x0 = Math.floor(w * 0.2);
  const y0 = Math.floor(h * 0.2);
  const x1 = Math.floor(w * 0.8);
  const y1 = Math.floor(h * 0.8);
  const step = 5;

  let sum = 0;
  let sumSq = 0;
  let count = 0;
  let prevRowVals = [];
  let transitionCount = 0;

  for (let y = y0; y < y1; y += step) {
    let prevGray = -1;
    const rowVals = [];
    let rowIdx = 0;
    for (let x = x0; x < x1; x += step) {
      const idx = (y * w + x) * 4;
      const r = data[idx],
        g = data[idx + 1],
        b = data[idx + 2];
      const gray = r * 0.299 + g * 0.587 + b * 0.114;
      sum += gray;
      sumSq += gray * gray;
      count++;

      if (prevGray >= 0 && Math.abs(gray - prevGray) > 42) transitionCount++;
      if (
        prevRowVals.length > rowIdx &&
        Math.abs(gray - prevRowVals[rowIdx]) > 42
      )
        transitionCount++;

      rowVals.push(gray);
      prevGray = gray;
      rowIdx++;
    }
    prevRowVals = rowVals;
  }

  if (count < 120) return false;
  const mean = sum / count;
  const letiance = Math.max(0, sumSq / count - mean * mean);
  const stdDev = Math.sqrt(letiance);
  const transRatio = transitionCount / count;

  // Heuristic: QR like frames usually have pretty high contrast and strong edge transitions.
  return stdDev > 33 && transRatio > 0.3;
}

function buildScanKey(rawChunk) {
  const p = rawChunk.split("|");
  if (p.length < 3) return `RAW|${rawChunk}`;
  return [p[0] || "", p[1] || "", p[2] || ""].join("|");
}

// ─── NAVIGATION ──────────────────────────────────────────────────────────────
function switchTab(tab) {
  scanSec.classList.add("hidden");
  printSec.classList.add("hidden");
  const allianceSec = $("alliance-section");
  if (allianceSec) allianceSec.classList.add("hidden");

  $("nav-scan-btn").classList.add("secondary");
  $("nav-print-btn").classList.add("secondary");
  const allianceBtn = $("nav-alliance-btn");
  if (allianceBtn) allianceBtn.classList.add("secondary");

  if (tab === "scan") {
    scanSec.classList.remove("hidden");
    normalizeCameraViewport();
    $("nav-scan-btn").classList.remove("secondary");
    ensureQrLib(() => {
      log("QR scanner ready.", "success");
    });
  } else if (tab === "alliance") {
    if (allianceSec) allianceSec.classList.remove("hidden");
    if (allianceBtn) allianceBtn.classList.remove("secondary");
    if (cameraOn) toggleCamera();
    if (typeof loadAllianceData === 'function' && !window.allianceDataLoaded) loadAllianceData();
    return;
  } else {
    printSec.classList.remove("hidden");
    $("nav-print-btn").classList.remove("secondary");
    if (cameraOn) toggleCamera();
  }
}

// ─── LOGIN ───────────────────────────────────────────────────────────────────
function login() {
  const u = $("username").value;
  const p = $("password").value;
  loginBtn.disabled = true;
  loginBtn.textContent = "Connecting...";

  fetchTimeout(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: u, password: p }),
  })
    .then((res) =>
      res.json().then((data) => ({ status: res.status, data: data })),
    )
    .then((r) => {
      if (r.status === 200 || r.status === 201) {
        AUTH_TOKEN = r.data.accessToken || r.data.access_token || r.data.token;
        setConnected("CONNECTED", "#4cd964");
        log("Login successful.", "success");
        fetchData();
      } else {
        log(
          "Login error " +
            r.status +
            ": " +
            (r.data.message || r.data.code || "Invalid credentials"),
          "error",
        );
        loginBtn.disabled = false;
        loginBtn.textContent = "Connect to Backend";
        return; // don't proceed to show scanner
      }
      showScanner();
    })
    .catch(() => {
      AUTH_TOKEN = "offline-demo-token";
      setConnected("OFFLINE MODE", "#ff9500");
      log("Backend unreachable — offline demo mode active.", "info");
      showScanner();
    });
}

function setConnected(label, color) {
  statusBadge.textContent = label;
  statusBadge.style.color = color;
}

function showScanner() {
  loginSec.classList.add("hidden");
  navBtns.classList.remove("hidden");
  loginBtn.disabled = false;
  loginBtn.textContent = "Connect to Backend";
  switchTab("scan");
  flushPendingReports();
}

// ─── CAMERA ──────────────────────────────────────────────────────────────────
function toggleCamera() {
  if (cameraOn) {
    pendingCameraStart = false;
    stopCamera();
    return;
  }

  if (!qrLibLoaded || !readBarcodesFn) {
    pendingCameraStart = true;
    log("Initializing QR scanner engine...", "info");
    ensureQrLib(() => {
      if (!pendingCameraStart || cameraOn) return;
      if (!qrLibLoaded || !readBarcodesFn) {
        pendingCameraStart = false;
        log("QR scanner engine failed to initialize.", "error");
        return;
      }
      startCamera();
    });
    return;
  }

  pendingCameraStart = false;
  startCamera();
}

function startCamera() {
  pendingCameraStart = false;
  ensureScanElements();
  normalizeCameraViewport();
  likelyQrStreak = 0;
  hideScanHint();
  resetAdaptiveCameraState();

  if (!navigator?.mediaDevices?.getUserMedia) {
    log(
      "Camera API unavailable. Open this page over https:// or localhost (not plain file://).",
      "error",
    );
    return;
  }

  if (window.isSecureContext === false) {
    log(
      "Insecure page context. Camera requires https:// or localhost.",
      "error",
    );
    return;
  }

  navigator.mediaDevices
    .getUserMedia({
      video: { facingMode: "environment" },
      audio: false,
    })
    .then((stream) => {
      cameraStream = stream;
      cameraTrack = stream.getVideoTracks?.()[0]
        ? stream.getVideoTracks()[0]
        : null;

      if (cameraTrack && typeof cameraTrack.getCapabilities === "function") {
        try {
          const caps = cameraTrack.getCapabilities() || {};
          if (caps.zoom) {
            zoomCap = caps.zoom;
            zoomMin = Number(caps.zoom.min || 1);
            zoomMax = Number(caps.zoom.max || 1);
            zoomStep = Number(caps.zoom.step || 0.1) || 0.1;
            currentZoom = Number(cameraTrack.getSettings?.().zoom || zoomMin);
            targetZoom = zoomMin;
            maybeUpdateHardwareZoom();
          }
          if (caps.focusMode && cameraTrack.applyConstraints) {
            cameraTrack
              .applyConstraints({
                advanced: [{ focusMode: "continuous" }],
              })
              .catch(() => {});
          }
        } catch (_e) {
          // Some browsers throw when probing capabilities.
        }
      }

      scanVideoEl.srcObject = stream;
      camHolder.style.display = "none";
      cameraOn = true;
      camBtn.textContent = "Stop Camera";
      camBtn.classList.add("secondary");
      processingFlag = false;
      scanOverlay.classList.add("hidden");
      hideScanHint();
      if (scanLoopId) cancelAnimationFrame(scanLoopId);
      scanLoopId = requestAnimationFrame(scanFrameLoop);
      log("Camera started.", "success");
    })
    .catch((err) => {
      let msg = err?.message ? err.message : "Unknown camera error";
      if (err && err.name === "NotAllowedError") {
        msg =
          "Camera permission denied. Allow camera access in browser site settings.";
      } else if (err && err.name === "NotFoundError") {
        msg = "No camera device found.";
      } else if (err && err.name === "NotReadableError") {
        msg = "Camera is busy (in use by another app).";
      }
      log(`Camera error: ${msg}`, "error");
      stopCamera();
    });
}

function stopCamera() {
  pendingCameraStart = false;
  if (scanLoopId) {
    cancelAnimationFrame(scanLoopId);
    scanLoopId = null;
  }
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => {
      t.stop();
    });
    cameraStream = null;
  }
  if (scanVideoEl) scanVideoEl.srcObject = null;
  cameraOn = false;
  camBtn.textContent = "Start Camera";
  camBtn.classList.remove("secondary");
  camHolder.style.display = "";
  isDecodingFrame = false;
  likelyQrStreak = 0;
  hideScanHint();
  resetAdaptiveCameraState();
}

function scanFrameLoop(ts) {
  if (!cameraOn || !scanVideoEl || !scanCanvasEl) {
    scanLoopId = null;
    return;
  }

  if (
    processingFlag ||
    isDecodingFrame ||
    scanVideoEl.readyState < 2 ||
    ts - lastDecodeTs < SCAN_INTERVAL_MS
  ) {
    updateDigitalZoomVisualSmooth();
    scanLoopId = requestAnimationFrame(scanFrameLoop);
    return;
  }

  lastDecodeTs = ts;
  isDecodingFrame = true;

  const w = scanVideoEl.videoWidth || 0;
  const h = scanVideoEl.videoHeight || 0;
  if (!w || !h) {
    isDecodingFrame = false;
    updateDigitalZoomVisualSmooth();
    scanLoopId = requestAnimationFrame(scanFrameLoop);
    return;
  }

  if (scanCanvasEl.width !== w) scanCanvasEl.width = w;
  if (scanCanvasEl.height !== h) scanCanvasEl.height = h;
  const ctx = scanCanvasEl.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    isDecodingFrame = false;
    updateDigitalZoomVisualSmooth();
    scanLoopId = requestAnimationFrame(scanFrameLoop);
    return;
  }

  ctx.drawImage(scanVideoEl, 0, 0, w, h);
  const frame = ctx.getImageData(0, 0, w, h);

  readBarcodesFn(frame, {
    formats: ["QRCode"],
    maxNumberOfSymbols: 1,
    tryHarder: true,
  })
    .then((results) => {
      const qrText = extractQrTextFromResults(results);
      if (qrText) {
        likelyQrStreak = 0;
        hideScanHint();
        resetDigitalZoomVisual();
        targetZoom = zoomMin;
        maybeUpdateHardwareZoom();
        onScanSuccess(qrText);
        return;
      }

      if (!advancedScanEnabled) {
        likelyQrStreak = 0;
        hideScanHint();
        visualTargetZoom = 1;
        if (zoomCap) {
          targetZoom = zoomMin;
          maybeUpdateHardwareZoom();
        }
        return;
      }

      const likely = detectLikelyQrPresence(frame, w, h);
      if (likely) likelyQrStreak = Math.min(likelyQrStreak + 1, 5);
      else likelyQrStreak = Math.max(0, likelyQrStreak - 1);

      const now = Date.now();
      if (likelyQrStreak >= 2 && now - lastHintTs > 1800 && !processingFlag) {
        showScanHint("Possible QR seen. Move closer and hold steady.");
        lastHintTs = now;
      }

      adaptScannerWhenLikelyQr();

      if (likelyQrStreak >= 1 && !processingFlag) {
        return runSmartDecodeSweep(frame, w, h).then((foundText) => {
          if (foundText) {
            likelyQrStreak = 0;
            hideScanHint();
            resetDigitalZoomVisual();
            targetZoom = zoomMin;
            maybeUpdateHardwareZoom();
            onScanSuccess(foundText);
          }
        });
      }

      if (likelyQrStreak === 0 && zoomCap) {
        targetZoom = zoomMin;
        maybeUpdateHardwareZoom();
      }
    })
    .catch(() => {
      // Ignore per-frame decode misses/errors to keep scanner smooth.
    })
    .finally(() => {
      updateDigitalZoomVisualSmooth();
      isDecodingFrame = false;
      if (cameraOn) scanLoopId = requestAnimationFrame(scanFrameLoop);
    });
}

function onScanSuccess(txt) {
  if (processingFlag) return;
  processingFlag = true;
  log("QR detected! Processing...", "info");
  handleRawQR(txt);
}

function resetScanner() {
  scanOverlay.classList.add("hidden");
  hideScanHint();
  resetDigitalZoomVisual();
  processingFlag = false;
  if (cameraOn && !scanLoopId)
    scanLoopId = requestAnimationFrame(scanFrameLoop);
  log("Ready for next tablet.", "info");
}

function showSuccess(match, team) {
  scanInfo.textContent = `Match ${match} \u2022 Team ${team}`;
  scanOverlay.classList.remove("hidden");
}
// ─── QR DATA PROCESSING ──────────────────────────────────────────────────────
function handleRawQR(raw) {
  const chunks = raw.split("#").filter((s) => s.trim().length > 0);
  const accepted = [];
  const batchSeen = Object.create(null);

  chunks.forEach((chunk) => {
    const normalized = chunk.trim();
    const key = buildScanKey(normalized);
    if (batchSeen[key]) {
      log(`Duplicate code in same scan payload ignored (${key}).`, "info");
      return;
    }
    batchSeen[key] = true;

    if (scanSavedKeys[key]) {
      log(
        `Duplicate scan blocked (already saved this session): ${key}`,
        "error",
      );
      return;
    }
    if (scanInFlightKeys[key]) {
      log(`Duplicate scan blocked (already processing): ${key}`, "info");
      return;
    }

    scanInFlightKeys[key] = true;
    accepted.push({ chunk: normalized, key: key });
  });

  if (accepted.length === 0) {
    log("No new match data to process from this scan.", "info");
    processingFlag = false;
    if (cameraOn && !scanLoopId)
      scanLoopId = requestAnimationFrame(scanFrameLoop);
    return;
  }

  let chain = Promise.resolve(null);
  let last = null;
  accepted.forEach((item) => {
    chain = chain
      .then(() => {
        // Intercept PIT Scouting reports directly
        if (item.chunk.startsWith("PIT|")) {
          return processPitReport(item.chunk);
        }
        return processSingleMatch(item.chunk);
      })
      .then((r) => {
        delete scanInFlightKeys[item.key];
        if (r) {
          scanSavedKeys[item.key] = true;
          last = r;
        }
      })
      .catch(() => {
        delete scanInFlightKeys[item.key];
      });
  });
  chain.then(() => {
    if (last) {
      showSuccess(last.match, last.team);
      fetchData();
    } else {
      processingFlag = false;
      if (cameraOn && !scanLoopId)
        scanLoopId = requestAnimationFrame(scanFrameLoop);
    }
  });
}

function processPitReport(str) {
  const p = str.split("|");
  const knownIndexers = {
    VERTICAL: true,
    SPINDEXER: true,
    ROLLER: true,
    BELT: true,
    GRAVITY: true,
  };

  const indexerToken = String(p[4] || "").toUpperCase();
  const isNewPitFormat = !!knownIndexers[indexerToken];
  let pitData;

  if (isNewPitFormat) {
    const levelsNew = p[15] ? p[15].split(",").filter(Boolean).map(Number) : [];
    let topClimbNew = 0;
    levelsNew.forEach((l) => {
      const n = parseInt(l, 10) || 0;
      if (n > topClimbNew) topClimbNew = n;
    });

    pitData = {
      teamNumber: p[1] || "Unknown",
      drivetrain: p[2] || "",
      shooter: p[3] || "",
      indexer: p[4] || "VERTICAL",
      estimatedBps: p[5] || "",
      driverEvents: p[6] || "0",
      driverExperience: p[6] || "0",
      weightLbs: p[7] || "",
      weight: p[7] || "",
      autoRoutines: p[8] || "",
      canPass: p[9] === "1",
      canFerry: p[9] === "1",
      canDefend: p[10] === "1",
      canCrossBump: p[11] === "1",
      canCrossTrench: p[12] === "1",
      hopperCapacity: p[13] || "1",
      canClimb: p[14] === "1",
      climbLevels: levelsNew,
      climbLevel: topClimbNew,
      notes: p[16] || "",
      hasDrumShooter: String(p[3] || "").toUpperCase().includes("DRUM"),
      createdAt: new Date().toISOString(),
    };
  } else {
    pitData = {
      teamNumber: p[1] || "Unknown",
      drivetrain: p[2] || "",
      shooter: p[3] || "",
      hasDrumShooter: p[4] === "1",
      estimatedBps: p[5] || "",
      driverExperience: p[6] || "",
      driverEvents: p[6] || "",
      weight: p[7] || "",
      weightLbs: p[7] || "",
      width: p[8] || "",
      length: p[9] || "",
      autoRoutines: p[10] || "",
      canFerry: p[11] === "1",
      canPass: p[11] === "1",
      canClimb: p[12] === "1",
      climbLevels: p[13] ? p[13].split(",").filter(Boolean).map(Number) : [],
      notes: p[14] || "",
      indexer: p[15] || "",
      createdAt: new Date().toISOString(),
    };
  }

  let existing = JSON.parse(
    localStorage.getItem("@scanner_pit_reports") || "[]",
  );
  // Overwrite existing data for the same team
  existing = existing.filter((r) => r.teamNumber !== pitData.teamNumber);
  existing.push(pitData);
  localStorage.setItem("@scanner_pit_reports", JSON.stringify(existing));

  log(`Saved local Pit Report for Team ${pitData.teamNumber}`, "success");
  return Promise.resolve({ match: "PIT", team: pitData.teamNumber });
}

function printAllPitReports() {
  const reports = JSON.parse(
    localStorage.getItem("@scanner_pit_reports") || "[]",
  );
  if (reports.length === 0) {
    alert("No Pit Reports scanned yet.");
    return;
  }

  const rows = reports
    .map(
      (r) =>
        "<tr><td style='font-weight:bold'>" +
        r.teamNumber +
        "</td><td>" +
        r.drivetrain +
        "</td><td>" +
        r.shooter +
        "</td><td>" +
        (r.hasDrumShooter ? "Yes" : "No") +
        "</td><td>" +
        r.estimatedBps +
        "</td><td>" +
        r.driverExperience +
        "</td><td>" +
        r.weight +
        "</td><td>" +
        r.autoRoutines +
        "</td><td>" +
        r.notes +
        "</td></tr>",
    )
    .join("");

  const html =
    "<h1>Scanned Pit Reports (Offline Cache)</h1>" +
    "<p>These reports were scanned via QR Code directly from devices.</p>" +
    "<table border='1' cellspacing='0' cellpadding='8' style='width:100%; text-align:left; border-collapse:collapse;'>" +
    "<tr style='background:#f0f0f0'><th>Team</th><th>Drive</th><th>Shooter</th><th>Drum?</th><th>Est. BPS</th><th>Exp</th><th>Weight</th><th>Auto</th><th>Notes</th></tr>" +
    rows +
    "</table>";

  openPrint(html, "");
}

function processSingleMatch(str) {
  const p = str.split("|");
  if (p.length < 3) {
    log(`Invalid format (len ${p.length}).`, "error");
    return Promise.resolve(null);
  }

  const normalizePlayoffRef = (rawRef) => {
    const cleaned = String(rawRef || "")
      .toUpperCase()
      .replace(/\s+/g, "")
      .replace(/[-_]/g, "");

    if (!cleaned) return "";
    if (/^F\d+$/.test(cleaned)) return cleaned;

    const bracketMatch = cleaned.match(/^(EF|QF|SF)(\d+)(?:M)?(\d+)$/);
    if (bracketMatch) {
      return `${bracketMatch[1]}${bracketMatch[2]}M${bracketMatch[3]}`;
    }

    return cleaned;
  };

  const encodePlayoffRef = (playoffRef) => {
    const normalized = normalizePlayoffRef(playoffRef);
    const finalMatch = normalized.match(/^F(\d+)$/);
    if (finalMatch) {
      return 4000 + (parseInt(finalMatch[1], 10) || 0);
    }

    const bracketMatch = normalized.match(/^(EF|QF|SF)(\d+)M(\d+)$/);
    if (bracketMatch) {
      const baseMap = {
        EF: 1000,
        QF: 2000,
        SF: 3000,
      };
      const setNum = parseInt(bracketMatch[2], 10) || 0;
      const matchNum = parseInt(bracketMatch[3], 10) || 0;
      return baseMap[bracketMatch[1]] + setNum * 10 + matchNum;
    }

    return Math.max(1, parseInt(normalized, 10) || 1);
  };

  const rawMatchRef = String(p[26] || p[1] || "").trim();
  const normalizedPlayoffRef = normalizePlayoffRef(rawMatchRef);
  const rawMatchType = String(p[27] || "").toUpperCase();
  const inferredPlayoff = /^(EF|QF|SF)\d+M\d+$/.test(normalizedPlayoffRef) || /^F\d+$/.test(normalizedPlayoffRef);
  const isPlayoff = rawMatchType === "PLAY" || rawMatchType === "PLAYOFF" || inferredPlayoff;

  const matchRef = isPlayoff
    ? normalizedPlayoffRef || rawMatchRef || "1"
    : String(parseInt(rawMatchRef || p[1] || "1", 10) || 1);

  const matchNum = isPlayoff
    ? encodePlayoffRef(matchRef)
    : Math.max(1, parseInt(matchRef, 10) || 1);

  const teamNum = parseInt(p[2], 10);
  if (Number.isNaN(teamNum)) {
    log("Invalid match/team values in QR payload.", "error");
    return Promise.resolve(null);
  }

  // Support old schema vs new schema (indexes 18 & 19 contain pure auto and teleop notes respectively)
  const rawNotes = p[17] || "";
  const autoNotes = p[18] || "";
  const teleNotes = p[19] || "";

  const deadFromFlag = p[16] === "DIE" ? 150 : 0;
  let deadFromNotes = 0;
  const deadMatch = rawNotes.match(/(?:\[DeadTime:|dT:)(\d+)/i);
  if (deadMatch?.[1]) deadFromNotes = parseInt(deadMatch[1], 10) || 0;
  const incapSeconds = deadFromNotes || deadFromFlag;

  const payload = {
    createdAt: new Date().toISOString(),
    eventCode: (p[0] || "pncmp").substring(0, 5).padEnd(5, "A"),
    matchType: isPlayoff ? "PLAYOFF" : "QUALIFICATION",
    matchNumber: matchNum,
    alliance: p[21] ? (p[21].startsWith("Blue") ? "BLUE" : "RED") : "RED",
    teamNumber: teamNum,
    inMatch: true,
    notes: rawNotes.substring(0, 400),
    minorFouls: parseInt(p[22], 10) || 0,
    majorFouls: 0,
    secondsIncapacitated: incapSeconds,
    secondsDead: incapSeconds,
    shootingConfidence: 3,
    auto: {
      notes: autoNotes.substring(0, 400),
      hubScores: parseInt(p[5], 10) || 0,
      hubMisses: parseInt(p[6], 10) || 0,
      climb: p[7] === "Yes" ? "LEVEL1" : p[7] === "Fail" ? "FAILED" : "NONE",
      passes: p[8] === "High" ? 3 : p[8] === "Med" ? 2 : p[8] === "Low" ? 1 : 0,
    },
    teleop: {
      notes: teleNotes.substring(0, 400),
      hubScores: parseInt(p[10], 10) || 0,
      hubMisses: 0,
      level: 0,
      climbFailed: false,
      defended: p[20] === "true" || p[20] === "1",
      passes: parseInt(p[11], 10) || 0,
      wasDefended: false,
    },
    endgame: {
      notes: "",
      level:
        p[14] === "Level 3"
          ? 3
          : p[14] === "Level 2"
            ? 2
            : p[14] === "Level 1"
              ? 1
              : 0,
      climbFailed: p[14] === "Failed",
    },
  };

  const sanitizedPayload = sanitizeReportPayloadForBackend(payload);

  return fetchTimeout(`${API_URL}/report`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AUTH_TOKEN}`,
    },
    body: JSON.stringify(sanitizedPayload),
  })
    .then((res) => {
      if (res.status === 201) {
        log(`Saved Match ${matchRef} (Team ${p[2]})`, "success");
        upsertRecentReport(sanitizedPayload, "Saved");
        return { match: matchRef, team: p[2] };
      }
      return res.json().then((err) => {
        if (err.message && err.message.indexOf("Unique") !== -1) {
          log(`Match ${matchRef} already saved. Skipped.`, "info");
          upsertRecentReport(sanitizedPayload, "Saved");
          return { match: matchRef, team: p[2] };
        }
        log(
          `Backend rejected Match ${matchRef} (Team ${p[2]}): ${err.message || JSON.stringify(err)}`,
          "error",
        );
        const queued = enqueuePendingReport(sanitizedPayload);
        if (queued) {
          log(`Offline save queued for Match ${matchRef} (Team ${p[2]}).`, "info");
          upsertRecentReport(sanitizedPayload, "Queued");
        }
        return { match: matchRef, team: p[2] };
      });
    })
    .catch((_e) => {
      const queued = enqueuePendingReport(sanitizedPayload);
      if (queued) {
        log(`Offline save queued for Match ${matchRef} (Team ${p[2]}).`, "info");
        upsertRecentReport(sanitizedPayload, "Queued");
      } else {
        log(`Already queued offline: Match ${matchRef} (Team ${p[2]}).`, "info");
      }
      return { match: matchRef, team: p[2] };
    });
}

// ─── STATBOTICS INTEGRATION ──────────────────────────────────────────────────
function fetchStatboticsPrediction() {
  var year = $("sb-year-input").value.trim();
  var eventCode = $("sb-event-input").value.trim().toLowerCase();
  var matchNum = $("sb-match-input").value.trim();
  var resultDiv = $("sb-pred-result");

  if (!year || !eventCode || !matchNum) { 
    alert("Enter Year, Event (e.g., wasno), and Match # to predict."); 
    return; 
  }

  var matchKey = year + eventCode + "_qm" + matchNum;
  resultDiv.style.display = "block";

  if (!navigator.onLine) {
    resultDiv.innerHTML = "<span class='dnp-flag'>Offline. Cannot fetch predictions.</span>";
    return;
  }

  resultDiv.innerHTML = "Fetching...";
  fetch("https://api.statbotics.io/v3/match/" + matchKey)
    .then(r => {
      if (!r.ok) throw new Error("Match not found or API error.");
      return r.json();
    })
    .then(data => {
      var rOdds = (data.pred.red_win_prob * 100).toFixed(1);
      var bOdds = ((1 - data.pred.red_win_prob) * 100).toFixed(1);

      var redTeams = data.alliances.red.team_keys.join(", ");
      var blueTeams = data.alliances.blue.team_keys.join(", ");

      var html = `
        <div style="font-size:12px; color:#888; text-align:center; margin-bottom:8px">Match ${matchNum} Teams</div>
        <div style="display:flex; justify-content: space-between; margin-top: 10px; font-weight:bold;">
          <div style="color:var(--rd); text-align:left;">
            <div style="font-size:16px; margin-bottom:4px; color:#ff453a;">${redTeams}</div>
            RED<br>Score: ${data.pred.red_score.toFixed(1)}<br>Win: ${rOdds}%
          </div>
          <div style="color:var(--bu); text-align:right;">
            <div style="font-size:16px; margin-bottom:4px; color:#0a84ff;">${blueTeams}</div>
            BLUE<br>Score: ${data.pred.blue_score.toFixed(1)}<br>Win: ${bOdds}%
          </div>
        </div>
      `;
      resultDiv.innerHTML = html;
    })
    .catch(e => {
      resultDiv.innerHTML = "<span class='dnp-flag'>Error: " + e.message + "</span>";
    });
}

function fetchStatboticsAllianceData() {
  $("alliance-roster-body").innerHTML = "<tr><td colspan='9' style='text-align:center'>Fetching Statbotics EPA...</td></tr>";

  var year = $("sb-year-input").value.trim();
  var eventCode = $("sb-event-input").value.trim().toLowerCase();

  // Try to construct using our inputs, fallback to prompt
  var eventKey = "";
  if (year && eventCode) {
    eventKey = year + eventCode;
  } else {
    eventKey = prompt("Enter event key (e.g., 2024wasno) for Statbotics data:", "2024wasno");
    if(eventKey) {
      var yr = eventKey.substring(0,4);
      var evt = eventKey.substring(4);
      if(!isNaN(yr)) {
        $("sb-year-input").value = yr;
        $("sb-event-input").value = evt;
      } else {
        $("sb-event-input").value = eventKey;
      }
    }
  }

  if (!eventKey) {
    $("alliance-datasource-statbotics").checked = false;
    return loadAllianceData(); // fallback
  }

  fetch("https://api.statbotics.io/v3/team_events?event=" + eventKey)
    .then(r => r.json())
    .then(data => {
      if (data.length === 0) throw new Error("No data for event " + eventKey);

      var tableHtml = "";
      // In Statbotics v3, team_events usually has epa stats.
      // We map it to our roster format.
      var mappedRoster = data.map(te => {
        var breakdown = te.epa ? te.epa.breakdown : null;
        return {
          team: te.team,
          matches: te.count || 0,
          opr: breakdown ? breakdown.total_points : 0,
          autoAvg: breakdown ? breakdown.auto_points : 0,
          teleAvg: breakdown ? breakdown.teleop_points : 0,
          ferryAvg: breakdown ? breakdown.endgame_points : 0,
          incapAvg: 0 // statbotics doesn't have incap easily
        };
      });

      mappedRoster.sort((a,b) => b.opr - a.opr);
      window.currentAllianceRoster = mappedRoster;

      mappedRoster.forEach(function(r, idx){
        tableHtml += "<tr class='team-row' data-team='"+r.team+"'>" +
          "<td>"+(idx+1)+"</td>" +
          "<td><strong>"+r.team+"</strong></td>" +
          "<td>"+r.opr.toFixed(1)+"</td>" + // using EPA as OPR
          "<td>"+r.autoAvg.toFixed(1)+"</td>" + // auto EPA
          "<td>"+r.teleAvg.toFixed(1)+"</td>" + // tele EPA
          "<td>"+r.ferryAvg.toFixed(1)+"</td>" + // endgame EPA
          "<td>N/A</td>" +
          "<td>N/A</td>" +
          "<td>-</td>" +
        "</tr>";
      });
      $("alliance-roster-body").innerHTML = tableHtml;

      // Select the top team by default
      if(mappedRoster.length > 0) {
        renderTeamDeepDive(mappedRoster[0].team);
        renderPredictedPickList(); // Update pick list
      }
    })
    .catch(e => {
      alert("Error fetching Statbotics data: " + e.message + ". Falling back to local scouting data.");
      $("alliance-datasource-statbotics").checked = false;
      loadAllianceData();
    });
}

// ─── ALLIANCE SELECTION ──────────────────────────────────────────────────────
function loadAllianceData() {
  var statToggle = $("alliance-datasource-statbotics");
  var useStatbotics = statToggle && statToggle.checked;
  $("statbotics-pred-card").classList.toggle("hidden", !useStatbotics);

  if (useStatbotics) {
    if (!navigator.onLine) {
      alert("Warning: No internet connection detected. Falling back to offline scouting data.");
      statToggle.checked = false;
      return loadAllianceData();
    }
    fetchStatboticsAllianceData();
    return;
  }

  if(!AUTH_TOKEN) { alert("Connect to backend first."); return; }
  $("alliance-roster-body").innerHTML = "<tr><td colspan='9' style='text-align:center'>Loading full event data...</td></tr>";

  fetchAllFullReports().then(function(all){
    var teamsMap = {};
    all.forEach(function(r) {
      if(!r.teamNumber) return;
      if(!teamsMap[r.teamNumber]) teamsMap[r.teamNumber] = [];
      teamsMap[r.teamNumber].push(r);
    });

    var roster = [];
    Object.keys(teamsMap).forEach(function(teamNum) {
      var stats = computeStatsFromMatches(teamsMap[teamNum]);
      if (stats && stats.matchesPlayed > 0) {
        var pwr = (stats.avgAutoHub * 2.5) + (stats.avgTeleHub * 1) + (stats.avgEndPts * 0.8) + (stats.avgFerry * 0.5);
        pwr -= (stats.avgIncap * 0.5);

        var dnpReasons = [];
        var goodFlags = [];
        if (stats.deadPct !== "0%") dnpReasons.push("Dead in " + stats.deadPct + " of matches");
        if (stats.avgIncap > 10) dnpReasons.push("Avg " + stats.avgIncap + "s incapacitation");
        if (stats.climbFails > 0) dnpReasons.push(stats.climbFails + " climb fails");

        if (stats.avgIncap === 0 && stats.climbFails === 0 && stats.matchesPlayed > 3) goodFlags.push("High Reliability");
        if (stats.maxAutoHub >= 5) goodFlags.push("Strong Auto");
        if (stats.avgFerry > 10) goodFlags.push("Ferry Specialist");

        roster.push({
          teamNumber: parseInt(teamNum, 10),
          opr: pwr,
          avgScore: stats.avgScore,
          avgAuto: stats.avgAutoHub,
          avgTele: stats.avgTeleHub,
          avgFerry: stats.avgFerry,
          climbRate: stats.climbAttempts > 0 ? Math.round((stats.climbSuccesses / stats.matchesPlayed)*100) : 0,
          avgIncap: stats.avgIncap,
          matches: stats.matchesPlayed,
          dnpReasons: dnpReasons,
          goodFlags: goodFlags,
          rawStats: stats,
          rawMatches: teamsMap[teamNum]
        });
      }
    });

    window.currentAllianceRoster = roster;
    window.allianceDataLoaded = true;

    renderAllianceDashboard();
  }).catch(function(e){ log("Alliance fetch error: " + e.message, "error"); });
}

function renderAllianceDashboard() {
  var roster = window.currentAllianceRoster.slice();

  roster.sort(function(a,b){ return b.opr - a.opr; });
  var recHtml = roster.filter(function(t){ return t.dnpReasons.length <= 1; }).slice(0, 10).map(function(t) {
    var flags = t.goodFlags.map(function(f){ return "<span class='good-flag'>&#x2713; "+f+"</span>"; }).join(" ");
    return "<div style='padding:8px 0;border-bottom:1px solid #333;display:flex;justify-content:space-between'><span><b>" + t.teamNumber + "</b> (Pwr: " + t.opr.toFixed(1) + ")</span> <span>" + flags + "</span></div>";
  }).join("");
  $("alliance-recommended-list").innerHTML = recHtml || "<div style='color:#666;padding:10px 0'>Not enough data</div>";

  var dnpRoster = window.currentAllianceRoster.filter(function(t){ return t.dnpReasons.length > 0 || t.avgIncap > 5; });
  dnpRoster.sort(function(a,b){ return b.avgIncap - a.avgIncap; });
  var dnpHtml = dnpRoster.map(function(t) {
    var flags = t.dnpReasons.map(function(f){ return "<span class='dnp-flag'>&#x26A0; "+f+"</span>"; }).join(" ");
    return "<div style='padding:8px 0;border-bottom:1px solid #333'><b>" + t.teamNumber + "</b><br>" + flags + "</div>";
  }).join("");
  $("alliance-dnp-list").innerHTML = dnpHtml || "<div style='color:#666;padding:10px 0'>No teams flagged for DNP.</div>";

  renderPredictedPickList();

  sortAllianceTable(window.currentAllianceSort.col, true);
}

function renderPredictedPickList() {
  if (!window.currentAllianceRoster || window.currentAllianceRoster.length === 0) return;

  var useStatbotics = $("alliance-datasource-statbotics") && $("alliance-datasource-statbotics").checked;
  var isStat = useStatbotics ? "Statbotics EPA" : "Local Scouting Data";
  var subtitle = $("predicted-list-subtitle");
  if (subtitle) subtitle.innerHTML = "Based on calculated Power Rank (" + isStat + ")";

  // Make a shallow copy and sort by OPR/EPA descending
  var sortedRoster = window.currentAllianceRoster.slice().sort(function(a,b) {
    return b.opr - a.opr;
  });

  // Depending on if it's statbotics or local, the team key varies. 
  // Try '.team' first, fallback to '.teamNumber'
  var getTeamStrOuter = function(t){ 
    if(!t) return "<i style='color:#666'>TBD</i>";
    var tNum = typeof t.team !== 'undefined' ? t.team : t.teamNumber; 
    return "<b>" + tNum + "</b> <span style='color:#aaa;font-size:11px'>(" + t.opr.toFixed(1) + ")</span>";
  };

  var html = "";
  for (var i = 0; i < 8; i++) {
    var cap = sortedRoster[i];
    var pick1 = sortedRoster[8 + i];
    var pick2 = sortedRoster[23 - i]; // Snake draft format for the 2nd pick

    html += "<div style='background:#1a1a1a; border: 1px solid #333; padding:10px; border-radius:6px;'>" +
              "<div style='color:#a855f7; font-weight:bold; margin-bottom:5px; border-bottom:1px solid #333; padding-bottom:3px;'>Alliance " + (i+1) + "</div>" +
              "<div style='display:flex; justify-content:space-between; margin-bottom:4px;'><span>Captain:</span> <span>" + getTeamStrOuter(cap) + "</span></div>" +
              "<div style='display:flex; justify-content:space-between; margin-bottom:4px;'><span>1st Pick:</span> <span>" + getTeamStrOuter(pick1) + "</span></div>" +
              "<div style='display:flex; justify-content:space-between;'><span>2nd Pick:</span> <span>" + getTeamStrOuter(pick2) + "</span></div>" +
            "</div>";
  }

  var grid = $("predicted-alliances-grid");
  if (grid) grid.innerHTML = html;
}

function sortAllianceTable(col, forceRetainDirection) {
  if (!forceRetainDirection) {
    if (window.currentAllianceSort.col === col) {
      window.currentAllianceSort.asc = !window.currentAllianceSort.asc;
    } else {
      window.currentAllianceSort.col = col;
      window.currentAllianceSort.asc = false;
    }
  }

  var colKey = window.currentAllianceSort.col;
  var asc = window.currentAllianceSort.asc;

  var roster = window.currentAllianceRoster.slice();
  roster.sort(function(a, b) {
    var valA = a[colKey];
    var valB = b[colKey];
    if (valA < valB) return asc ? -1 : 1;
    if (valA > valB) return asc ? 1 : -1;
    return 0;
  });

  var html = roster.map(function(t) {
    var rowBg = t.dnpReasons.length > 1 ? "background:rgba(255,69,58,0.15)" : "";
    return "<tr style='"+rowBg+"'>" +
      "<td><b>"+t.teamNumber+"</b></td>" +
      "<td>"+t.opr.toFixed(1)+"</td>" +
      "<td>"+t.avgScore.toFixed(1)+"</td>" +
      "<td>"+t.avgAuto.toFixed(1)+"</td>" +
      "<td>"+t.avgTele.toFixed(1)+"</td>" +
      "<td>"+t.avgFerry.toFixed(1)+"</td>" +
      "<td>"+t.climbRate+"%</td>" +
      "<td>"+t.avgIncap.toFixed(1)+"</td>" +
      "<td>"+t.matches+"</td>" +
    "</tr>";
  }).join("");
  $("alliance-roster-body").innerHTML = html;
}

function renderTeamDeepDive() {
  var teamInput = parseInt($("alliance-search-input").value, 10);
  if(!teamInput || isNaN(teamInput)) return;

  var tm = window.currentAllianceRoster.find(function(t){ return t.teamNumber === teamInput; });
  var panel = $("alliance-deep-dive-content");
  if(!tm) {
    panel.style.display = "block";
    panel.innerHTML = "<div style='color:#ff453a'>Team " + teamInput + " not found. Ensure you fetched data.</div>";
    return;
  }

  var issues = "";
  if(tm.dnpReasons.length > 0) issues = "<div style='color:#ff453a;margin-top:10px;padding:10px;background:rgba(255,69,58,0.1);border-radius:6px'><b>Flags:</b> " + tm.dnpReasons.join(" | ") + "</div>";
  else issues = "<div style='color:#34d399;margin-top:10px;padding:10px;background:rgba(52,211,153,0.1);border-radius:6px'><b>Flags:</b> None (Solid Performer)</div>";

  panel.style.display = "block";
  panel.innerHTML = 
    "<h4 style='margin:0 0 10px;color:#0a84ff;font-size:18px'>Team " + tm.teamNumber + " Overview</h4>" +
    "<div style='display:grid;grid-template-columns:1fr 1fr;gap:20px;font-size:14px'>" +
      "<div><b>Power Rank:</b> "+tm.opr.toFixed(1)+"</div>" +
      "<div><b>Avg Score:</b> "+tm.avgScore.toFixed(1)+" (High: "+tm.rawStats.maxScore+")</div>" +
      "<div><b>Matches Played:</b> "+tm.matches+"</div>" +
      "<div><b>Ferry Avg:</b> "+tm.avgFerry.toFixed(1)+"</div>" +
    "</div>" + issues +

    "<div style='margin-top:25px; display:flex; justify-content:space-between; align-items:flex-end; border-bottom:1px solid #444; padding-bottom:5px;'>" +
      "<h5 style='margin:0'>Match Performance Timeline</h5>" +
      "<select id='alliance-metric-select' style='width:auto; padding:5px 10px; background:#2c2c2c; color:#fff; border:1px solid #444; border-radius:4px; font-size:12px; margin:0;' onchange='updateTeamTimeline()'>" +
        "<option value='totalPts'>Total Points</option>" +
        "<option value='autoHubs'>Auto Hubs</option>" +
        "<option value='teleHubs'>Teleop Hubs</option>" +
        "<option value='ferry'>Ferry Volume</option>" +
        "<option value='incap'>Seconds Dead (Incap)</option>" +
      "</select>" +
    "</div>" +
    "<div id='team-timeline-graph' style='display:flex;overflow-x:auto;padding-top:20px;padding-bottom:10px'></div>";

  updateTeamTimeline();
}

function updateTeamTimeline() {
  var teamInput = parseInt($("alliance-search-input").value, 10);
  var tm = window.currentAllianceRoster.find(function(t){ return t.teamNumber === teamInput; });
  if(!tm) return;

  var metric = $("alliance-metric-select").value;
  var sortedMatches = tm.rawMatches.slice().sort(function(a,b){ return (a.matchNumber||0) - (b.matchNumber||0); });

  var maxVal = 1;
  var graphData = sortedMatches.map(function(m) {
    var aHubs = parseInt((m.auto && m.auto.hubScores)||0, 10);
    var tHubs = parseInt((m.teleop && m.teleop.hubScores)||0, 10);
    var p = parsePackedNotes(m.notes);
    var ep = 0;
    if (m.notes && m.notes.includes("Level 3")) ep = 3;
    else if (m.notes && m.notes.includes("Level 2")) ep = 2;
    else if (m.notes && m.notes.includes("Level 1")) ep = 1;
    var fVol = parseInt((m.teleop && m.teleop.passes)||0, 10) || parseInt(p.ferry||0, 10);
    var incapSec = parseInt(m.secondsIncapacitated || m.secondsDead || p.deadTime, 10) || parseInt(p.climbTime, 10) || 0;

    var autoPts = aHubs * 2;
    var totalPts = autoPts + tHubs + (ep * 10);

    var val = 0;
    var color = "#0a84ff";
    var label = "";

    if(metric === "totalPts") { val = totalPts; label = totalPts; color = "#0a84ff"; }
    else if(metric === "autoHubs") { val = aHubs; label = aHubs; color = "#8a2be2"; }
    else if(metric === "teleHubs") { val = tHubs; label = tHubs; color = "#22c55e"; }
    else if(metric === "ferry") { val = fVol; label = fVol; color = "#ff9500"; }
    else if(metric === "incap") { 
      val = incapSec; label = incapSec+"s"; 
      color = incapSec > 10 ? "#ff453a" : (incapSec > 0 ? "#ff9500" : "#34d399"); 
    }

    if(metric !== "incap" && val > maxVal) maxVal = val;

    return { matchNum: m.matchNumber||"?", val: val, label: label, color: color };
  });

  if (metric === "incap") maxVal = 150; 
  if (maxVal === 0) maxVal = 1; // Prevent div by 0

  var barsHtml = graphData.map(function(d) {
    var pct = Math.max(2, Math.min(100, (d.val / maxVal) * 100));
    return "<div style='display:flex;flex-direction:column;align-items:center;margin-right:15px'>" +
      "<div style='height:120px;display:flex;align-items:flex-end;width:30px;background:#333;border-radius:4px'>" +
        "<div style='width:100%;height:"+pct+"%;background:"+d.color+";border-radius:4px;position:relative'>" +
          "<span style='position:absolute;top:-18px;left:0;right:0;text-align:center;font-size:10px;font-weight:bold'>"+d.label+"</span>" +
        "</div>" +
      "</div>" +
      "<div style='font-size:11px;margin-top:6px;color:#aaa'>Q"+d.matchNum+"</div>" +
    "</div>";
  }).join("");

  $("team-timeline-graph").innerHTML = barsHtml || "<span style='color:#666'>No data</span>";
}

function printAllianceSheet() {
  if(!window.currentAllianceRoster || window.currentAllianceRoster.length === 0) {
    alert("Fetch data first by opening the Alliance Sel. tab.");
    return;
  }

  var roster = window.currentAllianceRoster.slice();
  roster.sort(function(a,b){ return b.opr - a.opr; });

  var top24 = roster.slice(0, 24);

  var rowsHtml = top24.map(function(t, i) {
    var flags = t.dnpReasons.length > 0 ? ("<span style='color:#b91c1c;font-size:11px;font-weight:bold;margin-right:8px'>" + t.dnpReasons.join(", ") + "</span>") : "";
    var gFlags = t.goodFlags.length > 0 ? ("<span style='color:#15803d;font-size:11px;font-weight:bold'>" + t.goodFlags.join(", ") + "</span>") : "";

    return "<tr>" +
      "<td style='border:1px solid #000;padding:6px;text-align:center'>" + (i+1) + "</td>" +
      "<td style='border:1px solid #000;padding:6px;font-size:16px;font-weight:bold'>" + t.teamNumber + "</td>" +
      "<td style='border:1px solid #000;padding:6px;text-align:center;font-weight:bold'>" + t.opr.toFixed(1) + "</td>" +
      "<td style='border:1px solid #000;padding:6px;text-align:center'>" + t.avgAuto.toFixed(1) + "</td>" +
      "<td style='border:1px solid #000;padding:6px;text-align:center'>" + t.avgFerry.toFixed(1) + "</td>" +
      "<td style='border:1px solid #000;padding:6px;text-align:center'>" + t.climbRate + "%</td>" +
      "<td style='border:1px solid #000;padding:6px'>" + flags + gFlags + "</td>" +
    "</tr>";
  }).join("");

  var html = 
    "<h1 style='text-align:center;margin-bottom:5px'>Alliance Strategy Cheat Sheet</h1>" +
    "<p style='text-align:center;font-size:12px;margin-top:0'>Top 24 Teams ordered by Power Rank. Pick strategically.</p>" +
    "<table style='width:100%;border-collapse:collapse;margin-top:15px'>" +
      "<thead><tr style='background:#f0f0f0'>" +
        "<th style='border:1px solid #000;padding:6px;width:40px'>Rank</th>" +
        "<th style='border:1px solid #000;padding:6px;width:60px'>Team</th>" +
        "<th style='border:1px solid #000;padding:6px;width:60px'>Power</th>" +
        "<th style='border:1px solid #000;padding:6px;width:60px'>Avg Auto</th>" +
        "<th style='border:1px solid #000;padding:6px;width:60px'>Avg Ferry</th>" +
        "<th style='border:1px solid #000;padding:6px;width:60px'>Climb %</th>" +
        "<th style='border:1px solid #000;padding:6px'>Notable Flags</th>" +
      "</tr></thead>" +
      "<tbody>" + rowsHtml + "</tbody>" +
    "</table>";

  openPrint(html, "@media print{@page{size:portrait}} body{color:#000;font-size:12px}");
}

// ─── EVENT MANAGEMENT ────────────────────────────────────────────────────────
function renderEventUI() {
  if($("active-event-input")) $("active-event-input").value = activeEventName;
  var container = $("event-filters-container");
  if(!container) return;

  var uniqueEvents = {};
  knownEvents.forEach(function(ev){ uniqueEvents[ev] = true; });
  uniqueEvents[activeEventName] = true;
  Object.keys(eventTags).forEach(function(k){ uniqueEvents[eventTags[k]] = true; });

  // Keep known events strictly in sync
  knownEvents = Object.keys(uniqueEvents);
  localStorage.setItem("@scanner_known_events", JSON.stringify(knownEvents));

  var html = "";
  knownEvents.sort().forEach(function(ev){
    if(!ev) return;
    var checked = selectedFilterEvents.indexOf(ev) !== -1 ? "checked" : "";
    html += "<label style='background:#333;padding:8px 12px;border-radius:4px;cursor:pointer;display:flex;align-items:center;gap:6px;border:1px solid "+(checked?"#0a84ff":"#444")+"'><input type='checkbox' value='"+ev+"' onchange='toggleEventFilter(this)' "+checked+"> <b>" + ev + "</b></label>";
  });
  if(selectedFilterEvents.length === 0) {
    html += "<div style='color:#ff9500;margin-top:4px;font-style:italic'>No events selected. System is currently analyzing ALL events.</div>";
  }
  container.innerHTML = html;
}

function updateActiveEvent() {
  var val = ($("active-event-input").value || "").trim();
  if(val && val !== activeEventName) {
    activeEventName = val;
    localStorage.setItem("@scanner_active_event", activeEventName);

    var needsSave = false;
    // Auto-migrate any placeholder "Default Event" tags safely
    Object.keys(eventTags).forEach(function(k){
      if(eventTags[k] === "Default Event") {
        eventTags[k] = activeEventName;
        needsSave = true;
      }
    });

    var filterIdx = selectedFilterEvents.indexOf("Default Event");
    if(filterIdx !== -1) {
      selectedFilterEvents[filterIdx] = activeEventName;
      localStorage.setItem("@scanner_filter_events", JSON.stringify(selectedFilterEvents));
    }

    if(needsSave){
      localStorage.setItem("@scanner_event_tags", JSON.stringify(eventTags));
    }

    renderEventUI();
    log("Active event updated to: " + activeEventName, "info");
    fetchData(); // Instantly refresh the Recent Matches table!
  }
}

function createNewEventBucket() {
  var eName = prompt("Enter a name for the new Event Bucket:");
  if (!eName || !eName.trim()) return;
  eName = eName.trim();
  if (knownEvents.indexOf(eName) === -1) {
    knownEvents.push(eName);
    localStorage.setItem("@scanner_known_events", JSON.stringify(knownEvents));
    renderEventUI();
  } else {
    alert("Event bucket already exists: " + eName);
  }
}

function toggleEventFilter(cb) {
  var val = cb.value;
  if(cb.checked) {
    if(selectedFilterEvents.indexOf(val) === -1) selectedFilterEvents.push(val);
  } else {
    var idx = selectedFilterEvents.indexOf(val);
    if(idx !== -1) selectedFilterEvents.splice(idx, 1);
  }
  localStorage.setItem("@scanner_filter_events", JSON.stringify(selectedFilterEvents));
  renderEventUI();
}

function tagAllVisibleWithActiveEvent() {
  var w = prompt("Type 'TAG' to assign ALL currently downloaded matches in the database to the Active Event ("+activeEventName+").");
  if (w !== 'TAG') return log("Tagging cancelled.", "error");

  if(!AUTH_TOKEN) return log("Must connect first.", "error");

  fetchReportList(2000, 0)
  .then(function(data){
    var hideId = parseInt(localStorage.getItem("hideBeforeId") || "0", 10);
    var visibleData = data.filter(function(d){ return (d.id || Infinity) > hideId; });
    var count = 0;
    visibleData.forEach(function(r){
      if(r.id && eventTags[r.id] !== activeEventName){
        eventTags[r.id] = activeEventName;
        count++;
      }
    });
    localStorage.setItem("@scanner_event_tags", JSON.stringify(eventTags));
    renderEventUI();
    log("Successfully grouped " + count + " available matches into active event: " + activeEventName, "success");
    fetchData(); // refresh table
  })
  .catch(function(e){ log("Failed to fetch matches for tagging: " + e.message, "error"); });
}

function applyLocalFilters(all) {
  all = normalizeReportList(all);
  var hideId = parseInt(localStorage.getItem("hideBeforeId") || "0", 10);
  all = all.filter(function(d) { return (d.id || Infinity) > hideId; });

  var needsSave = false;
  all.forEach(function(r) {
    if (r.id && !eventTags[r.id]) {
      eventTags[r.id] = activeEventName;
      needsSave = true;
    }
  });
  if (needsSave) {
    localStorage.setItem("@scanner_event_tags", JSON.stringify(eventTags));
    renderEventUI();
  }

  if (selectedFilterEvents.length > 0) {
    all = all.filter(function(r) {
      if (!r.id) return true;
      return selectedFilterEvents.indexOf(eventTags[r.id]) !== -1;
    });
  }
  return all;
}



// ─── DATA TABLE ──────────────────────────────────────────────────────────────
function fetchData() {
  if (!AUTH_TOKEN) return;

  fetchReportList(40, 0)
    .then((data) => {
      window.lastFetchedMaxId = data.reduce(
        (max, d) => Math.max(max, d.id || 0),
        0,
      );
      const hideId = parseInt(localStorage.getItem("hideBeforeId") || "0", 10);
      const visibleData = data.filter((d) => (d.id || Infinity) > hideId);

      visibleData.sort((a, b) => b.id - a.id);
      tableBody.innerHTML =
        visibleData
          .map((r) => {
            // Support nested user object or raw user string dynamically
            let sc = r.user
              ? r.user.username || r.user.firstName || "Scouter"
              : "Unknown";
            if (!r.user && r.username) sc = r.username;

            const mn = r.matchNumber || r.id;
            return (
              "<tr><td style='font-weight:bold;color:#0a84ff;cursor:pointer;text-decoration:underline' onclick='printMatchReport(" +
              Number(mn) +
              ")' title='Print all 6 teams for this match'>Q" +
              mn +
              "</td><td style='font-weight:bold;font-size:1.1em'>" +
              r.teamNumber +
              "</td><td style='color:#aaa'>" +
              sc +
              "</td><td style='color:#4cd964'>Saved</td></tr>"
            );
          })
          .join("") ||
        "<tr class='empty-row'><td colspan='4'>No matches yet.</td></tr>";
    })
    .catch((e) => {
      log(`Table sync error: ${e.message}`, "error");
      renderTableFromLocalCache();
    });
}

// ─── PRINT ───────────────────────────────────────────────────────────────────

// Translate raw climb enum to readable label
function climbLabel(val) {
  if (!val) return "None";
  if (val === "LEVEL1" || val === "Yes") return "✓ L1";
  if (val === "FAILED" || val === "Fail") return "✗ Fail";
  return val;
}

// Translate endgame level number to label
function endLabel(r) {
  if (!r?.endgame) return "None";
  if (r.endgame.climbFailed) return "✗ Failed";
  const lv = r.endgame.level;
  return lv > 0 ? `L${lv}` : "None";
}

// Parse the structured extras we packed into the notes field by index.tsx
// Format: "[Start:X] [Pass:X] ... | scouter notes"
function parsePackedNotes(notesStr) {
  const out = { raw: notesStr || "" };
  if (!notesStr) return out;
  const extract = (key, shortKey) => {
    const m = notesStr.match(new RegExp(`\\[${key}:([^\\]]+)\\]`, "i"));
    if (m) return m[1];
    if (shortKey) {
      const m2 = notesStr.match(
        new RegExp(`(?:^|\\s)${shortKey}:([^\\s]+)`, "i"),
      );
      if (m2) return m2[1];
    }
    return null;
  };
  const boolVal = (v) =>
    v === "true" || v === "1" || v === "DIE" || v === "Yes";

  out.start = extract("Start", "S");
  out.pass = extract("Pass", "P");
  out.autoWin = extract("AutoWin", "W");
  out.ferry = extract("Ferry", "F");
  out.bump = boolVal(extract("Bump", "B"));
  out.trench = boolVal(extract("Trench", "T"));
  out.dead = boolVal(extract("Dead", "X"));
  out.deadTime = extract("DeadTime", "dT") || "0";
  out.climbTime = extract("Time", "t");
  // Scouter free-text is everything after the " | " separator
  const pipeIdx = notesStr.indexOf(" | ");
  out.scouterNote = pipeIdx >= 0 ? notesStr.substring(pipeIdx + 3).trim() : "";
  return out;
}

function computeStatsFromMatches(matches) {
  const n = matches.length;
  if (n === 0) return null;

  let totAutoHub = 0,
    totAutoMiss = 0,
    totTeleHub = 0,
    totTeleFerry = 0,
    totEndPts = 0,
    totIncap = 0;
  let maxAutoHub = 0,
    maxAutoMiss = 0,
    maxTeleHub = 0,
    maxTeleFerry = 0,
    maxEndPts = 0,
    maxScore = 0;
  let bumpCount = 0,
    trenchCount = 0,
    deadCount = 0;
  let climbAttempts = 0,
    climbSuccesses = 0;
  const endLevelCounts = { 0: 0, 1: 0, 2: 0, 3: 0, fail: 0 };
  const startPosCounts = { Left: 0, Center: 0, Right: 0, Unknown: 0 };
  let bestMatch = null;

  matches.forEach((r) => {
    const a = r.auto || {};
    const t = r.teleop || {};
    const e = r.endgame || {};
    const p = parsePackedNotes(r.notes);
    const autoHub = parseInt(a.hubScores || 0, 10) || 0;
    const autoMiss = parseInt(a.hubMisses || 0, 10) || 0;
    const teleHub = parseInt(t.hubScores || 0, 10) || 0;
    const teleFerry = parseInt(t.passes || p.ferry || 0, 10) || 0;

    totAutoHub += autoHub;
    totAutoMiss += autoMiss;
    totTeleHub += teleHub;
    totTeleFerry += teleFerry;
    if (autoHub > maxAutoHub) maxAutoHub = autoHub;
    if (autoMiss > maxAutoMiss) maxAutoMiss = autoMiss;
    if (teleHub > maxTeleHub) maxTeleHub = teleHub;
    if (teleFerry > maxTeleFerry) maxTeleFerry = teleFerry;

    let parsedLevel = 0;
    if (r.notes?.includes("Level 3")) parsedLevel = 3;
    else if (r.notes?.includes("Level 2")) parsedLevel = 2;
    else if (r.notes?.includes("Level 1")) parsedLevel = 1;
    const endPts = parseInt(e.level || parsedLevel, 10) * 10 || 0;
    totEndPts += endPts;
    if (endPts > maxEndPts) maxEndPts = endPts;

    totIncap +=
      parseInt(r.secondsIncapacitated || r.secondsDead || p.deadTime, 10) ||
      parseInt(p.climbTime, 10) ||
      0;

    if (r.overBump || p.bump) bumpCount++;
    if (r.underTrench || p.trench) trenchCount++;
    if ((r.secondsIncapacitated > 0) || (r.secondsDead > 0) || p.dead) deadCount++;

    const start = (r.startingPosition || p.start || "Unknown")
      .toString()
      .toLowerCase();
    if (start.indexOf("left") !== -1) startPosCounts.Left++;
    else if (start.indexOf("center") !== -1 || start.indexOf("centre") !== -1)
      startPosCounts.Center++;
    else if (start.indexOf("right") !== -1) startPosCounts.Right++;
    else startPosCounts.Unknown++;

    const el = e.level || 0;
    if (e.climbFailed) endLevelCounts.fail++;
    else endLevelCounts[el] = (endLevelCounts[el] || 0) + 1;

    const attemptedClimb = !!(e.climbFailed || parseInt(e.level || 0, 10) > 0);
    if (attemptedClimb) climbAttempts++;
    if (parseInt(e.level || 0, 10) > 0 && !e.climbFailed) climbSuccesses++;

    const totalScore = autoHub * 2 + teleHub + endPts;
    if (totalScore > maxScore) {
      maxScore = totalScore;
      bestMatch = {
        matchNumber: r.matchNumber || "?",
        totalScore: totalScore,
        auto: autoHub,
        tele: teleHub,
        end: endPts,
      };
    }
  });

  const avg = (v) => Number((v / n).toFixed(1));
  const pct = (v) => `${Math.round((v / n) * 100)}%`;
  let dominantStart = "Unknown";
  let bestStartCount = -1;
  ["Left", "Center", "Right", "Unknown"].forEach((pos) => {
    if (startPosCounts[pos] > bestStartCount) {
      bestStartCount = startPosCounts[pos];
      dominantStart = pos;
    }
  });

  return {
    matches: matches,
    matchesPlayed: n,
    avgAutoHub: avg(totAutoHub),
    maxAutoHub: maxAutoHub,
    avgAutoMiss: avg(totAutoMiss),
    maxAutoMiss: maxAutoMiss,
    avgTeleHub: avg(totTeleHub),
    maxTeleHub: maxTeleHub,
    avgFerry: avg(totTeleFerry),
    maxFerry: maxTeleFerry,
    avgEndPts: avg(totEndPts),
    maxEndPts: maxEndPts,
    avgScore: avg(totAutoHub * 2 + totTeleHub + totEndPts),
    maxScore: maxScore,
    avgIncap: avg(totIncap),
    bumpPct: pct(bumpCount),
    trenchPct: pct(trenchCount),
    deadPct: pct(deadCount),
    endLevelCounts: endLevelCounts,
    climbAttempts: climbAttempts,
    climbSuccesses: climbSuccesses,
    climbFails: Math.max(0, climbAttempts - climbSuccesses),
    climbTryFreq: `${climbAttempts}/${n}`,
    climbSuccessFreq: `${climbSuccesses}/${n}`,
    startPosCounts: startPosCounts,
    dominantStart: dominantStart,
    bestMatch: bestMatch,
  };
}

function printTeamReport() {
  const team = $("print-team-input").value;
  if (!team) {
    alert("Enter a team number.");
    return;
  }
  log(`Fetching report for Team ${team}...`, "info");

  if (AUTH_TOKEN === "offline-demo-token") {
    // Build mock raw match records matching the backend schema
    const mockMatches = Array.from({ length: 6 }, (_, i) => ({
      matchNumber: i + 1,
      teamNumber: parseInt(team, 10),
      user: {
        firstName: ["Alex", "Sam", "Jordan", "Riley", "Morgan", "Casey"][i],
      },
      startingPosition: ["Left", "Center", "Right", "Left", "Center", "Right"][
        i
      ],
      secondsIncapacitated: i === 3 ? 45 : 0,
      overBump: i % 2 === 0,
      underTrench: i % 3 === 0,
      auto: {
        hubScores: 10 + i * 5,
        hubMisses: i,
        climb: i === 1 ? "LEVEL1" : "NONE",
        passes: i % 3,
      },
      teleop: { hubScores: 20 + i * 3, hubMisses: i, passes: i * 2 },
      endgame: { level: [0, 1, 2, 3, 0, 2][i], climbFailed: i === 4 },
      notes:
        "[Start:" +
        ["Left", "Center", "Right", "Left", "Center", "Right"][i] +
        "] [Pass:" +
        ["None", "Low", "Med", "High", "None", "Med"][i] +
        "] [AutoWin:" +
        ["Red", "Blue", "Tie", "Red", "Blue", "Red"][i] +
        "] [Ferry:" +
        i * 2 +
        "] [Bump:" +
        (i % 2 === 0) +
        "] [Trench:" +
        (i % 3 === 0) +
        "] [Dead:" +
        (i === 3) +
        "] [DeadTime:" +
        (i === 3 ? 45 : 0) +
        "] [Time:" +
        (10 + i * 3) +
        "] | " +
        [
          "Strong auto",
          "Missed climbs",
          "Reliable ferry",
          "Died mid-match",
          "Couldn't climb",
          "Solid all-around",
        ][i],
    }));
    renderTeamPrint(team, computeStatsFromMatches(mockMatches), true);
    return;
  }

  // Try the stats endpoint first; fall back to raw reports on any non-200
  // Note: the backend `/reports` list endpoint usually only returns id, teamNumber, user.
  // We need to fetch details for these specific reports!
  fetchReportList(200, 0)
    .then((all) => {
      const hideId = parseInt(localStorage.getItem("hideBeforeId") || "0", 10);
      all = all.filter((d) => (d.id || Infinity) > hideId);

      console.log(
        "[DEBUG] Fetch all matching reports returned records:",
        all.length,
      );
      if (all.length > 0) {
        console.log("[DEBUG] Sample first report:", all[0]);
      }

      const teamMatches = all.filter(
        (m) => String(m.teamNumber) === String(team),
      );
      console.log(`[DEBUG] Filtered matches for team ${team}:`, teamMatches);

      if (teamMatches.length === 0) {
        log(`No matches found for Team ${team}`, "error");
        alert(`Team ${team} has no scouted matches in the system yet.`);
        return;
      }

      // FETCH THE FULL DATA FOR THESE REPORTS!
      log(
        `Fetching full data for ${teamMatches.length} team matches...`,
        "info",
      );
      const fullMatchPromises = teamMatches.map((m) =>
        fetchTimeout(`${API_URL}/report/${m.id}`, {
          headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
        })
          .then((r) => r.json())
          .catch((e) => {
            console.error("Failed getting full report", m.id, e);
            return m;
          }),
      );

      return Promise.all(fullMatchPromises);
    })
    .then((fullTeamMatches) => {
      if (!fullTeamMatches) return;

      fullTeamMatches.sort(
        (a, b) => (a.matchNumber || 0) - (b.matchNumber || 0),
      );

      // Output raw match debugging to the UI logs so we can see what the backend actually saved
      log(
        `DEBUG: Found ${fullTeamMatches.length} matches for team ${team}`,
        "info",
      );
      const firstMatch = fullTeamMatches[0];
      log(
        "DEBUG M" +
          firstMatch.matchNumber +
          " auto: " +
          (firstMatch.auto ? JSON.stringify(firstMatch.auto) : "MISSING"),
        "info",
      );
      log(
        "DEBUG M" +
          firstMatch.matchNumber +
          " teleop: " +
          (firstMatch.teleop ? JSON.stringify(firstMatch.teleop) : "MISSING"),
        "info",
      );
      log(
        "DEBUG M" +
          firstMatch.matchNumber +
          " notes: " +
          (firstMatch.notes || "MISSING"),
        "info",
      );

      renderTeamPrint(team, computeStatsFromMatches(fullTeamMatches), false);
    })
    .catch((e) => {
      log(`Report error: ${e.message}`, "error");
      console.error(e);
    });
}

function fmtNum(v) {
  const n = Number(v || 0);
  return n.toFixed(1);
}

function statCard(val, label, color) {
  return (
    "<div style='display:inline-block;margin-right:16px;margin-bottom:12px'>" +
    "<div style='font-size:28px;font-weight:700;color:" +
    (color || "#222") +
    "'>" +
    val +
    "</div>" +
    "<div style='font-size:12px;color:#666;margin-top:2px'>" +
    label +
    "</div></div>"
  );
}

function buildAutoPositionHTML(s) {
  const total = Math.max(1, s.matchesPlayed);
  const left = Math.round((s.startPosCounts.Left / total) * 100);
  const center = Math.round((s.startPosCounts.Center / total) * 100);
  const right = Math.round((s.startPosCounts.Right / total) * 100);

  return (
    "<div style='margin-top:20px'>" +
    "<h3 style='margin:0 0 8px;font-size:14px;color:#333'>Auto Start Positions</h3>" +
    "<p style='margin:0 0 12px;font-size:13px;color:#666'>Team prefers to start at <b>" +
    s.dominantStart +
    "</b>. Out of " +
    total +
    " matches:</p>" +
    "<ul style='margin:8px 0;padding-left:20px;font-size:12px;color:#444'>" +
    "<li>Left: " +
    s.startPosCounts.Left +
    " times (" +
    left +
    "%)</li>" +
    "<li>Center: " +
    s.startPosCounts.Center +
    " times (" +
    center +
    "%)</li>" +
    "<li>Right: " +
    s.startPosCounts.Right +
    " times (" +
    right +
    "%)</li>" +
    "</ul>" +
    "</div>"
  );
}

function buildTeamSummaryHTML(team, s) {
  const el = s.endLevelCounts;
  const best = s.bestMatch || {
    matchNumber: "?",
    totalScore: 0,
    auto: 0,
    tele: 0,
    end: 0,
  };

  const climbSummary =
    el.fail > 0 ? `struggled with climb (${el.fail} fails)` : "solid climber";
  const climbStr =
    el[3] > 0
      ? "Level 3"
      : el[2] > 0
        ? "Level 2"
        : el[1] > 0
          ? "Level 1"
          : "rarely climbs";

  return (
    "<h1 style='margin:0 0 6px;font-size:28px;font-weight:700'>Team " +
    team +
    "</h1>" +
    "<p style='color:#666;margin:0 0 18px;font-size:13px'>" +
    s.matchesPlayed +
    " matches analyzed • Last report " +
    new Date().toLocaleDateString() +
    "</p>" +
    "<div style='background:#f5f5f5;border-left:4px solid #0a84ff;padding:14px;margin-bottom:24px'>" +
    "<p style='margin:0;font-size:14px'><b>Team summary:</b> This team averages <b>" +
    fmtNum(s.avgScore) +
    " points</b> per match with a high of <b>" +
    s.maxScore +
    "</b> (Match Q" +
    best.matchNumber +
    "). They typically " +
    climbStr +
    " and " +
    climbSummary +
    ".</p>" +
    "</div>" +
    "<h3 style='margin:20px 0 8px;font-size:15px;font-weight:600'>Scoring Overview</h3>" +
    "<div style='font-size:13px;line-height:1.6;margin-bottom:20px;color:#333'>" +
    "<p style='margin:6px 0'><b>Auto Phase:</b> Averages " +
    fmtNum(s.avgAutoHub) +
    " hits (max " +
    s.maxAutoHub +
    "), with " +
    fmtNum(s.avgAutoMiss) +
    " misses</p>" +
    "<p style='margin:6px 0'><b>Teleop Phase:</b> Averages " +
    fmtNum(s.avgTeleHub) +
    " hits (max " +
    s.maxTeleHub +
    "), ferry volume " +
    fmtNum(s.avgFerry) +
    " (max " +
    s.maxFerry +
    ")</p>" +
    "</div>" +
    buildAutoPositionHTML(s) +
    "<h3 style='margin:20px 0 8px;font-size:15px;font-weight:600'>Endgame & Reliability</h3>" +
    "<div style='font-size:13px;line-height:1.6;margin-bottom:20px;color:#333'>" +
    "<p style='margin:6px 0'><b>Climb attempts:</b> " +
    s.climbAttempts +
    " times, " +
    s.climbSuccesses +
    " successful (" +
    s.climbTryFreq +
    "%)</p>" +
    "<p style='margin:6px 0'><b>Climb levels:</b> L3: " +
    el[3] +
    " | L2: " +
    el[2] +
    " | L1: " +
    el[1] +
    " | L0: " +
    el[0] +
    " | Failed: " +
    el["fail"] +
    "</p>" +
    "<p style='margin:6px 0'><b>Mobility:</b> Bump crosses " +
    s.bumpPct +
    "% of time, Trench " +
    s.trenchPct +
    "%</p>" +
    "<p style='margin:6px 0'><b>Reliability:</b> Robot died in " +
    s.deadPct +
    "% of matches (avg " +
    fmtNum(s.avgIncap) +
    " sec downtime)</p>" +
    "</div>" +
    "<div style='font-size:12px;color:#888;margin-top:24px;padding-top:12px;border-top:1px solid #ddd'>" +
    "<p style='margin:0'>Report generated for team analysis. Use this alongside direct observations from events.</p>" +
    "</div>"
  );
}

function renderTeamPrint(team, s, isFallback) {
  const disclaimer = isFallback
    ? "<p style='color:#888;font-size:12px;border:1px solid #ddd;padding:8px;border-radius:4px;margin-bottom:14px'>&#9432; Stats computed directly from raw match records.</p>"
    : "";
  const body = disclaimer + buildTeamSummaryHTML(team, s);
  openPrint(body, "");
}

function getStoredTbaConfig() {
  const eventKey = (
    $("tba-event-key-input")?.value ||
    localStorage.getItem(TBA_EVENT_KEY_STORAGE) ||
    ""
  ).trim();
  const runtimeApiKey = window?.TBA_API_KEY ? String(window.TBA_API_KEY) : "";
  const apiKey = ($("tba-api-key-input")?.value || runtimeApiKey || "").trim();
  return { eventKey: eventKey, apiKey: apiKey };
}

function persistTbaConfig(eventKey, apiKey) {
  if (eventKey) localStorage.setItem(TBA_EVENT_KEY_STORAGE, eventKey);
}

function buildScheduleMapFromTbaMatches(tbaMatches) {
  const out = {};
  tbaMatches.forEach((m) => {
    if (m.comp_level !== "qm") return;
    const red = m.alliances?.red?.team_keys || [];
    const blue = m.alliances?.blue?.team_keys || [];
    const matchNum = Number(m.match_number);
    out[matchNum] = {
      Red1: red[0] ? red[0].replace("frc", "") : "",
      Red2: red[1] ? red[1].replace("frc", "") : "",
      Red3: red[2] ? red[2].replace("frc", "") : "",
      Blue1: blue[0] ? blue[0].replace("frc", "") : "",
      Blue2: blue[1] ? blue[1].replace("frc", "") : "",
      Blue3: blue[2] ? blue[2].replace("frc", "") : "",
    };
  });
  return out;
}

function loadScheduleFromCache(eventKey) {
  try {
    const raw = localStorage.getItem(TBA_SCHEDULE_CACHE_PREFIX + eventKey);
    return raw ? JSON.parse(raw) : null;
  } catch (_e) {
    return null;
  }
}

function saveScheduleToCache(eventKey, scheduleMap) {
  try {
    localStorage.setItem(
      TBA_SCHEDULE_CACHE_PREFIX + eventKey,
      JSON.stringify(scheduleMap),
    );
  } catch (_e) {
    // Ignore localStorage write errors.
  }
}

async function ensureScheduleMap(eventKey, apiKey) {
  const cached = loadScheduleFromCache(eventKey);
  if (cached && Object.keys(cached).length > 0) return Promise.resolve(cached);
  if (!eventKey || !apiKey) return Promise.resolve(null);

  try {
    const res = await fetchTimeout(
      "https://www.thebluealliance.com/api/v3/event/" +
        eventKey +
        "/matches/simple",
      {
        headers: { "X-TBA-Auth-Key": apiKey },
      },
    );
    if (!res.ok) throw new Error(`TBA schedule fetch failed (${res.status})`);
    const matches = await res.json();
    const map = buildScheduleMapFromTbaMatches(matches || []);
    saveScheduleToCache(eventKey, map);
    return map;
  } catch (err) {
    log(`Schedule fetch warning: ${err.message}`, "error");
    return null;
  }
}

async function fetchAllFullReports() {
  const all = await fetchReportList(2000, 0);
  const hideId = parseInt(localStorage.getItem("hideBeforeId") || "0", 10);
  const filtered = all.filter((d) => (d.id || Infinity) > hideId);
  const fullMatchPromises = filtered.map((m) =>
    fetchTimeout(`${API_URL}/report/${m.id}`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    })
      .then((res) => res.json())
      .catch(() => m),
  );
  return await Promise.all(fullMatchPromises);
}

function detectConflictsForTeamMatch(reports) {
  const conflicts = [];
  if (!reports || reports.length <= 1) return conflicts;

  const autoVals = reports.map(
    (r) => parseInt(r.auto?.hubScores || 0, 10) || 0,
  );
  const teleVals = reports.map(
    (r) => parseInt(r.teleop?.hubScores || 0, 10) || 0,
  );
  const starts = reports.map((r) => {
    const p = parsePackedNotes(r.notes);
    return `${r.startingPosition || p.start || "Unknown"}`.toUpperCase();
  });
  const minAuto = Math.min.apply(Math, autoVals);
  const maxAuto = Math.max.apply(Math, autoVals);
  const minTele = Math.min.apply(Math, teleVals);
  const maxTele = Math.max.apply(Math, teleVals);

  if (maxAuto - minAuto >= 8)
    conflicts.push(`Auto score disagreement (range ${minAuto}-${maxAuto})`);
  if (maxTele - minTele >= 10)
    conflicts.push(`Tele score disagreement (range ${minTele}-${maxTele})`);

  const uniqueStarts = Object.create(null);
  starts.forEach((s) => {
    uniqueStarts[s] = true;
  });
  if (Object.keys(uniqueStarts).length > 1)
    conflicts.push("Start position disagreement");

  return conflicts;
}

function normalizeStationName(raw) {
  if (!raw) return "";
  const s = String(raw).trim().toLowerCase().replace(/\s+/g, "");
  if (s === "red1" || s === "r1") return "Red1";
  if (s === "red2" || s === "r2") return "Red2";
  if (s === "red3" || s === "r3") return "Red3";
  if (s === "blue1" || s === "b1") return "Blue1";
  if (s === "blue2" || s === "b2") return "Blue2";
  if (s === "blue3" || s === "b3") return "Blue3";
  return "";
}

function extractScoutStation(report) {
  if (!report) return "";

  // Try direct fields if backend stores station.
  const direct = normalizeStationName(
    report.station ||
      report.scoutStation ||
      (report.user &&
        (report.user.station ||
          report.user.scoutStation ||
          report.user.position)) ||
      report.position,
  );
  if (direct) return direct;

  // Try notes payload patterns.
  const notes = String(report.notes || "");
  const m = notes.match(/\[(?:Station|Seat|ScoutStation):([^\]]+)\]/i);
  if (m?.[1]) {
    const parsed = normalizeStationName(m[1]);
    if (parsed) return parsed;
  }

  // Optional username convention fallback like "red1_scout".
  const uname = String(
    (report.user && (report.user.username || report.user.firstName)) ||
      report.username ||
      "",
  );
  const byName = normalizeStationName(uname);
  if (byName) return byName;

  return "";
}

function buildLayoutFromScoutingInfo(matchReports) {
  const layout = {
    Red1: "",
    Red2: "",
    Red3: "",
    Blue1: "",
    Blue2: "",
    Blue3: "",
  };
  const usedTeams = Object.create(null);

  (matchReports || []).forEach((r) => {
    if (!r?.teamNumber) return;
    const station = extractScoutStation(r);
    const team = String(r.teamNumber);
    if (!station) return;
    if (layout[station] && layout[station] !== team) return;
    layout[station] = team;
    usedTeams[team] = true;
  });

  // Fill any missing slots with unmatched teams in this match.
  const unmatchedTeams = Array.from(
    new Set(
      (matchReports || [])
        .filter((r) => r?.teamNumber)
        .map((r) => String(r.teamNumber))
        .filter((team) => !usedTeams[team]),
    ),
  );

  ["Red1", "Red2", "Red3", "Blue1", "Blue2", "Blue3"].forEach((slot) => {
    if (!layout[slot] && unmatchedTeams.length > 0) {
      layout[slot] = unmatchedTeams.shift();
    }
  });

  return layout;
}

function teamBoxHtml(slot, teamNum, teamStats, matchReports, conflictLines) {
  if (!teamNum) {
    return (
      "<div style='border:1px solid #ddd;border-radius:8px;padding:10px;background:#fafafa'>" +
      "<div style='font-weight:bold'>" +
      slot +
      "</div><div style='color:#888'>No team mapped</div></div>"
    );
  }
  const s = teamStats || {
    avgAutoHub: 0,
    maxAutoHub: 0,
    avgTeleHub: 0,
    maxTeleHub: 0,
    bestMatch: { matchNumber: "?", totalScore: 0 },
    climbAttempts: 0,
    climbSuccesses: 0,
    dominantStart: "Unknown",
    matchesPlayed: 0,
  };

  let currentMatchAuto = 0;
  let currentMatchTele = 0;
  if (matchReports && matchReports.length > 0) {
    const picked = matchReports[0];
    currentMatchAuto = parseInt(picked.auto?.hubScores || 0, 10) || 0;
    currentMatchTele = parseInt(picked.teleop?.hubScores || 0, 10) || 0;
  }

  const conflictBlock = conflictLines.length
    ? "<div style='margin-top:6px;font-size:11px;color:#b91c1c'><b>Conflicts:</b> " +
      conflictLines.join("; ") +
      "</div>"
    : "<div style='margin-top:6px;font-size:11px;color:#15803d'>No major conflicts</div>";

  return (
    "<div style='border:1px solid #ddd;border-radius:8px;padding:10px;background:#fff'>" +
    "<div style='display:flex;justify-content:space-between;align-items:center'><div style='font-weight:bold'>" +
    slot +
    " - Team " +
    teamNum +
    "</div><div style='font-size:11px;color:#666'>" +
    s.matchesPlayed +
    " total matches</div></div>" +
    "<div style='font-size:12px;margin-top:6px'>Current match: Auto <b>" +
    currentMatchAuto +
    "</b>, Tele <b>" +
    currentMatchTele +
    "</b></div>" +
    "<div style='font-size:12px;margin-top:4px'>Auto Avg/Max: <b>" +
    fmtNum(s.avgAutoHub) +
    " / " +
    s.maxAutoHub +
    "</b> &nbsp; | &nbsp; Tele Avg/Max: <b>" +
    fmtNum(s.avgTeleHub) +
    " / " +
    s.maxTeleHub +
    "</b></div>" +
    "<div style='font-size:12px;margin-top:4px'>Best Match: <b>Q" +
    (s.bestMatch ? s.bestMatch.matchNumber : "?") +
    " (" +
    (s.bestMatch ? s.bestMatch.totalScore : 0) +
    ")</b> &nbsp; | &nbsp; Climb Try/Succeed: <b>" +
    s.climbAttempts +
    " / " +
    s.climbSuccesses +
    "</b></div>" +
    "<div style='font-size:12px;margin-top:4px'>Dominant Auto Start: <b>" +
    s.dominantStart +
    "</b></div>" +
    conflictBlock +
    "</div>"
  );
}

function buildAllianceSummary(name, slots, teamStatsByNumber) {
  const vals = slots.map((slot) => {
    const t = teamStatsByNumber[slot.team];
    return {
      auto: t ? Number(t.avgAutoHub || 0) : 0,
      tele: t ? Number(t.avgTeleHub || 0) : 0,
      total: t ? Number(t.avgScore || 0) : 0,
    };
  });
  const count = Math.max(1, vals.length);
  const sumAuto = vals.reduce((a, b) => a + b.auto, 0);
  const sumTele = vals.reduce((a, b) => a + b.tele, 0);
  const sumTotal = vals.reduce((a, b) => a + b.total, 0);
  return {
    name: name,
    avg3Auto: (sumAuto / count).toFixed(1),
    avg3Tele: (sumTele / count).toFixed(1),
    avg3Total: (sumTotal / count).toFixed(1),
  };
}

function buildMatchReportHTML(
  matchNum,
  redSlots,
  blueSlots,
  teamStatsByNumber,
  matchReportsByTeam,
  allConflicts,
) {
  const redSummary = buildAllianceSummary("Red", redSlots, teamStatsByNumber);
  const blueSummary = buildAllianceSummary(
    "Blue",
    blueSlots,
    teamStatsByNumber,
  );

  const redHtml = redSlots
    .map((slot) =>
      teamBoxHtml(
        slot.slot,
        slot.team,
        teamStatsByNumber[slot.team],
        matchReportsByTeam[slot.team] || [],
        slot.conflicts || [],
      ),
    )
    .join("");
  const blueHtml = blueSlots
    .map((slot) =>
      teamBoxHtml(
        slot.slot,
        slot.team,
        teamStatsByNumber[slot.team],
        matchReportsByTeam[slot.team] || [],
        slot.conflicts || [],
      ),
    )
    .join("");

  const conflictHtml = allConflicts.length
    ? "<ul style='margin:6px 0 0 18px;padding:0'>" +
      allConflicts.map((c) => `<li>${c}</li>`).join("") +
      "</ul>"
    : "<div style='color:#15803d'>No major conflicts detected for this match.</div>";

  return (
    "<h1 style='margin-bottom:4px'>Match " +
    matchNum +
    " - All 6 Team Report</h1>" +
    "<p style='color:#666;margin-top:0'>One-page view with Red/Blue grouping, position mapping, team summaries, and conflicts.</p>" +
    "<div style='display:grid;grid-template-columns:1fr 1fr;gap:14px'>" +
    "<div style='border:1px solid #ddd;border-radius:8px;padding:12px;background:#fff5f5'>" +
    "<h2 style='margin:0 0 8px 0;color:#b91c1c'>Red Alliance</h2>" +
    "<div style='font-size:12px;margin-bottom:8px'><b>3-Team Avg:</b> Auto " +
    redSummary.avg3Auto +
    " | Tele " +
    redSummary.avg3Tele +
    " | Total " +
    redSummary.avg3Total +
    "</div>" +
    redHtml +
    "</div>" +
    "<div style='border:1px solid #ddd;border-radius:8px;padding:12px;background:#eff6ff'>" +
    "<h2 style='margin:0 0 8px 0;color:#1d4ed8'>Blue Alliance</h2>" +
    "<div style='font-size:12px;margin-bottom:8px'><b>3-Team Avg:</b> Auto " +
    blueSummary.avg3Auto +
    " | Tele " +
    blueSummary.avg3Tele +
    " | Total " +
    blueSummary.avg3Total +
    "</div>" +
    blueHtml +
    "</div>" +
    "</div>" +
    "<h2 style='margin-top:14px'>Conflicts</h2>" +
    conflictHtml
  );
}

function printMatchReportFromInput() {
  const matchNum = parseInt($("print-match-input")?.value || "", 10);
  if (!matchNum || Number.isNaN(matchNum)) {
    alert("Enter a valid match number.");
    return;
  }
  printMatchReport(matchNum);
}

function printMatchReport(matchNum) {
  if (!AUTH_TOKEN) {
    alert("Please connect to backend first.");
    return;
  }

  const tba = getStoredTbaConfig();
  persistTbaConfig(tba.eventKey, tba.apiKey);

  log(`Building one-page report for Match ${matchNum}...`, "info");

  fetchAllFullReports()
    .then((fullReports) => {
      const reports = fullReports || [];
      const reportsByTeam = {};
      reports.forEach((r) => {
        if (!r?.teamNumber) return;
        const team = String(r.teamNumber);
        if (!reportsByTeam[team]) reportsByTeam[team] = [];
        reportsByTeam[team].push(r);
      });

      const matchReports = reports.filter(
        (r) => Number(r.matchNumber) === Number(matchNum),
      );
      const scoutingLayout = buildLayoutFromScoutingInfo(matchReports);

      return ensureScheduleMap(tba.eventKey, tba.apiKey).then(
        (scheduleMap) => ({
          fullReports: reports,
          reportsByTeam: reportsByTeam,
          scheduleMap: scheduleMap,
          scoutingLayout: scoutingLayout,
        }),
      );
    })
    .then((ctx) => {
      const fullReports = ctx.fullReports;
      const reportsByTeam = ctx.reportsByTeam;
      const scheduleMap = ctx.scheduleMap || {};
      const scoutingLayout = ctx.scoutingLayout || {
        Red1: "",
        Red2: "",
        Red3: "",
        Blue1: "",
        Blue2: "",
        Blue3: "",
      };

      const layout = {
        Red1: scoutingLayout.Red1 || "",
        Red2: scoutingLayout.Red2 || "",
        Red3: scoutingLayout.Red3 || "",
        Blue1: scoutingLayout.Blue1 || "",
        Blue2: scoutingLayout.Blue2 || "",
        Blue3: scoutingLayout.Blue3 || "",
      };

      const hasFullScoutingLayout = !!(
        layout.Red1 &&
        layout.Red2 &&
        layout.Red3 &&
        layout.Blue1 &&
        layout.Blue2 &&
        layout.Blue3
      );
      if (!hasFullScoutingLayout && scheduleMap[matchNum]) {
        const fromSchedule = scheduleMap[matchNum];
        layout.Red1 = layout.Red1 || String(fromSchedule.Red1 || "");
        layout.Red2 = layout.Red2 || String(fromSchedule.Red2 || "");
        layout.Red3 = layout.Red3 || String(fromSchedule.Red3 || "");
        layout.Blue1 = layout.Blue1 || String(fromSchedule.Blue1 || "");
        layout.Blue2 = layout.Blue2 || String(fromSchedule.Blue2 || "");
        layout.Blue3 = layout.Blue3 || String(fromSchedule.Blue3 || "");
      }

      const fallbackTeams = fullReports
        .filter((r) => Number(r.matchNumber) === Number(matchNum))
        .map((r) => String(r.teamNumber));
      const uniqueFallback = Array.from(new Set(fallbackTeams));

      if (
        !(
          layout.Red1 &&
          layout.Red2 &&
          layout.Red3 &&
          layout.Blue1 &&
          layout.Blue2 &&
          layout.Blue3
        )
      ) {
        if (!layout.Red1) layout.Red1 = uniqueFallback[0] || "";
        if (!layout.Red2) layout.Red2 = uniqueFallback[1] || "";
        if (!layout.Red3) layout.Red3 = uniqueFallback[2] || "";
        if (!layout.Blue1) layout.Blue1 = uniqueFallback[3] || "";
        if (!layout.Blue2) layout.Blue2 = uniqueFallback[4] || "";
        if (!layout.Blue3) layout.Blue3 = uniqueFallback[5] || "";

        if (uniqueFallback.length < 6) {
          log(
            "Could not map all 6 teams for this match from scouting data.",
            "error",
          );
        }
      }

      const teamStatsByNumber = {};
      Object.keys(reportsByTeam).forEach((team) => {
        const stats = computeStatsFromMatches(reportsByTeam[team]);
        if (stats) teamStatsByNumber[team] = stats;
      });

      const reportsInMatchByTeam = {};
      fullReports.forEach((r) => {
        if (Number(r.matchNumber) !== Number(matchNum) || !r.teamNumber) return;
        const team = String(r.teamNumber);
        if (!reportsInMatchByTeam[team]) reportsInMatchByTeam[team] = [];
        reportsInMatchByTeam[team].push(r);
      });

      const allConflicts = [];
      function slotObj(slotName) {
        const team = String(layout[slotName] || "");
        const teamReportsThisMatch = reportsInMatchByTeam[team] || [];
        const conflicts = detectConflictsForTeamMatch(teamReportsThisMatch);
        conflicts.forEach((c) => {
          allConflicts.push(`${slotName} Team ${team}: ${c}`);
        });
        return { slot: slotName, team: team, conflicts: conflicts };
      }

      const redSlots = [slotObj("Red1"), slotObj("Red2"), slotObj("Red3")];
      const blueSlots = [slotObj("Blue1"), slotObj("Blue2"), slotObj("Blue3")];

      const redDominants = redSlots.map(
        (s) =>
          (teamStatsByNumber[s.team] &&
            teamStatsByNumber[s.team].dominantStart) ||
          "Unknown",
      );
      const blueDominants = blueSlots.map(
        (s) =>
          (teamStatsByNumber[s.team] &&
            teamStatsByNumber[s.team].dominantStart) ||
          "Unknown",
      );
      [
        { name: "Red", vals: redDominants },
        { name: "Blue", vals: blueDominants },
      ].forEach((a) => {
        const counts = {};
        a.vals.forEach((v) => {
          if (!v || v === "Unknown") return;
          counts[v] = (counts[v] || 0) + 1;
        });
        Object.keys(counts).forEach((k) => {
          if (counts[k] >= 2)
            allConflicts.push(
              a.name +
                " alliance auto-position congestion: " +
                counts[k] +
                " teams favor " +
                k,
            );
        });
      });

      const html = buildMatchReportHTML(
        matchNum,
        redSlots,
        blueSlots,
        teamStatsByNumber,
        reportsInMatchByTeam,
        allConflicts,
      );
      openPrint(
        html,
        "@media print{@page{size:landscape}} body{font-size:12px}",
      );
      log(`Match ${matchNum} report ready.`, "success");
    })
    .catch((err) => {
      log(`Match report error: ${err.message}`, "error");
    });
}

function printRankings() {
  const limitInput = parseInt($("rankings-limit-input").value, 10);
  const limit = Number.isNaN(limitInput) || limitInput < 1 ? 10 : limitInput;
  const metricInput = $("rankings-metric-input");
  const metric = metricInput ? metricInput.value : "avgScore";
  const metricLabel = metricInput?.options[metricInput.selectedIndex]
    ? metricInput.options[metricInput.selectedIndex].text
    : "Average Total Score";

  log(`Fetching rankings for top ${limit} by ${metricLabel}...`, "info");

  if (AUTH_TOKEN === "offline-demo-token") {
    const list = Array.from({ length: limit }, (_, i) => ({
      teamNumber: 1000 + i,
      avgScore: 50 - i * 2,
      avgAuto: 15,
      avgTele: 35 - i * 2,
      avgEndPts: 10,
      avgFerry: i * 2,
      avgAutoMiss: i,
      avgIncap: 0,
      matchesPlayed: 4,
    }));
    renderRankingsHTML(list, limit, metricLabel, metric);
    return;
  }

  // Since /stats/rankings is returning 404, we will fetch all reports,
  // request their full details, map them by team, compute averages, and sort them top to bottom.
  fetchReportList(2000, 0)
    .then((all) => {
      all = normalizeReportList(all);
      const hideId = parseInt(localStorage.getItem("hideBeforeId") || "0", 10);
      all = all.filter((d) => (d.id || Infinity) > hideId);

      log(
        `Processing ${all.length} match records to build rankings...`,
        "info",
      );

      // We only have metadata. We must fetch the full object for everything...
      // To prevent DDoSing the server, we will fetch them in parallel but be careful.
      const fullMatchPromises = all.map((m) =>
        fetchTimeout(`${API_URL}/report/${m.id}`, {
          headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
        })
          .then((res) => res.json())
          .catch(() => m),
      );

      return Promise.all(fullMatchPromises);
    })
    .then((fullMatches) => {
      if (!fullMatches) return;

      // Group all full reports by teamNumber
      const teamsMap = {};
      fullMatches.forEach((r) => {
        if (!r.teamNumber) return;
        if (!teamsMap[r.teamNumber]) teamsMap[r.teamNumber] = [];
        teamsMap[r.teamNumber].push(r);
      });

      const rankingsList = [];

      // Compute total averages for every team in the map
      Object.keys(teamsMap).forEach((teamNum) => {
        const matches = teamsMap[teamNum];
        const stats = computeStatsFromMatches(matches);
        if (stats) {
          rankingsList.push({
            teamNumber: teamNum,
            avgScore: parseFloat(stats.avgScore),
            avgAuto: parseFloat(stats.avgAutoHub) * 2, // Simple approximation of auto pts
            avgTele: parseFloat(stats.avgTeleHub),
            avgEndPts: parseFloat(stats.avgEndPts),
            avgFerry: parseFloat(stats.avgFerry),
            avgAutoMiss: parseFloat(stats.avgAutoMiss),
            avgIncap: parseFloat(stats.avgIncap),
            matchesPlayed: stats.matchesPlayed,
          });
        }
      });

      // Sort descending by highest metric
      if (metric === "avgAutoMiss" || metric === "avgIncap") {
        // For misses and incapacitation, lower is better usually, but who knows maybe highest might be needed

        rankingsList.sort((a, b) => b[metric] - a[metric]);
      } else {
        rankingsList.sort((a, b) => b[metric] - a[metric]);
      }

      renderRankingsHTML(rankingsList, limit, metricLabel, metric);
    })
    .catch((e) => {
      log(`Rankings error: ${e.message}`, "error");
    });
}

function renderRankingsHTML(list, limit, metricLabel, metric) {
  const rows = list
    .slice(0, limit)
    .map(
      (r, i) =>
        "<tr><td style='padding:10px;border-bottom:1px solid #ddd'>" +
        (i + 1) +
        "</td><td style='padding:10px;border-bottom:1px solid #ddd'><strong>" +
        r.teamNumber +
        "</strong></td><td style='padding:10px;border-bottom:1px solid #ddd'>" +
        Number(r.avgScore).toFixed(1) +
        "</td><td style='padding:10px;border-bottom:1px solid #ddd'>" +
        Number(r.avgAuto).toFixed(1) +
        "</td><td style='padding:10px;border-bottom:1px solid #ddd'>" +
        Number(r.avgTele).toFixed(1) +
        "</td><td style='padding:10px;border-bottom:1px solid #ddd'>" +
        Number(r.avgFerry).toFixed(1) +
        "</td><td style='padding:10px;border-bottom:1px solid #ddd'>" +
        Number(r.avgEndPts).toFixed(1) +
        "</td><td style='padding:10px;border-bottom:1px solid #ddd'>" +
        Number(r.avgAutoMiss).toFixed(1) +
        "</td><td style='padding:10px;border-bottom:1px solid #ddd'>" +
        Number(r.avgIncap).toFixed(1) +
        "</td><td style='padding:10px;border-bottom:1px solid #ddd;color:#888'>" +
        r.matchesPlayed +
        "</td></tr>",
    )
    .join("");
  openPrint(
    "<h1>Event Rankings: Top " +
      limit +
      " Teams</h1><h3 style='margin-top:0;color:#555'>Sorted by: " +
      metricLabel +
      "</h3><table style='width:100%;border-collapse:collapse;text-align:left;font-size:12px'><thead><tr style='background:#f0f0f0'><th style='padding:10px'>Rank</th><th style='padding:10px'>Team</th><th style='padding:10px'>Avg Total</th><th style='padding:10px'>Auto Pts</th><th style='padding:10px'>Tele Hubs</th><th style='padding:10px'>Ferry</th><th style='padding:10px'>End Pts</th><th style='padding:10px'>Auto Miss</th><th style='padding:10px'>Incap Sec</th><th style='padding:10px'>Matches</th></tr></thead><tbody>" +
      rows +
      "</tbody></table>",
  );
}

function openPrint(html, extraStyle) {
  const w = window.open("", "", "width=1000,height=700");
  w.document.write(
    "<html><head><title>Scouting Report</title><style>" +
      "body{font-family:sans-serif;padding:30px;font-size:13px}" +
      "h1{border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:6px}" +
      "h2{font-size:16px;margin-top:20px}" +
      "@media print{button{display:none}}" +
      (extraStyle || "") +
      "</style></head><body>" +
      "<button onclick='window.print()' style='margin-bottom:20px;padding:10px 20px;background:#0a84ff;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:bold;cursor:pointer'>&#x1F5A8; Print / Save PDF</button>" +
      html +
      "</body></html>",
  );
  w.document.close();
  w.focus();
}

// ─── FILE UPLOAD ─────────────────────────────────────────────────────────────
fileInput.addEventListener("change", (e) => {
  if (!e.target.files.length) return;
  if (!qrLibLoaded || !readBarcodesFn) {
    log("QR library not loaded yet.", "error");
    return;
  }
  const file = e.target.files[0];
  readBarcodesFn(file, {
    formats: ["QRCode"],
    maxNumberOfSymbols: 1,
    tryHarder: true,
  })
    .then((results) => {
      const text = extractQrTextFromResults(results);
      if (text) {
        onScanSuccess(text);
      } else {
        log("Could not read QR from image.", "error");
      }
    })
    .catch((err) => {
      log(
        "Could not read QR from image: " +
          (err?.message ? err.message : "Unknown error"),
        "error",
      );
    });
  e.target.value = "";
});

if (advancedScanToggle) {
  advancedScanToggle.checked = true;
  advancedScanToggle.addEventListener("change", (e) => {
    setAdvancedScanEnabled(e.target.checked);
  });
}

// Boot offline queue and auto-sync when browser comes back online.
loadPendingReports();
if ($("tba-event-key-input")) {
  $("tba-event-key-input").value =
    localStorage.getItem(TBA_EVENT_KEY_STORAGE) || "";
}
if ($("tba-api-key-input")) {
  const runtimeApiKey = window?.TBA_API_KEY ? String(window.TBA_API_KEY) : "";
  $("tba-api-key-input").value = runtimeApiKey;
}
window.addEventListener("online", () => {
  log("Network restored. Trying to sync offline reports...", "info");
  flushPendingReports();
});
window.addEventListener("resize", normalizeCameraViewport);
window.addEventListener("orientationchange", normalizeCameraViewport);
normalizeCameraViewport();
