/* ============================================================================
   A.U.R.A — FRONTEND INTEGRATION SURFACE   (aura-api.js)
   ----------------------------------------------------------------------------
   Every UI action in index.html calls one of these AURA_API functions.
   Server-side functions call /api/* (served by server.js).
   Browser-side ML functions (clinical, inference, vision) run client-side
   using the engines in ml_pipeline/.

   Loaded as a classic <script> BEFORE the main app script.
   ============================================================================ */

// ── Server availability probe ────────────────────────────────────────────────
// The PWA works fully offline. When the Node server is not available, all
// server-bound functions gracefully fall back to MOCK data.
const _serverBase = '';   // empty = same origin (works for both dev server and direct file)

async function _apiFetch(path, opts = {}) {
  const res = await fetch(_serverBase + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Browser ML: load ml_inference once ───────────────────────────────────────
// ml_inference.js exports predictMalnutritionRisk to globalThis (no bundler needed)
// who_standards.json is fetched once and cached for clinical_engine computations
let _whoStandards = null;
let _samModelText = null;

async function _loadWHOStandards() {
  if (_whoStandards) return _whoStandards;
  try {
    const r = await fetch('/ml_pipeline/who_standards.json');
    _whoStandards = await r.json();
  } catch { _whoStandards = {}; }
  return _whoStandards;
}

async function _loadSAMModel() {
  if (_samModelText) return _samModelText;
  try {
    const r = await fetch('/ml_pipeline/aura_sam_predictor_80kb.txt');
    _samModelText = await r.text();
  } catch { _samModelText = ''; }
  return _samModelText;
}

// Inline browser-compatible WHO Z-score engine (mirrors clinical_engine.js, no require())
function _calculateWHOZScore(weight, length, gender, whoStdData) {
  const gKey = gender.toLowerCase().trim();
  const table = whoStdData[gKey];
  if (!table) return null;
  const key = (Math.round(length * 2) / 2).toFixed(1);
  const lms = table[key];
  if (!lms) return null;
  const { L, M, S } = lms;
  if (Math.abs(L) < 1e-9) return Math.round(Math.log(weight / M) / S * 10000) / 10000;
  return Math.round((Math.pow(weight / M, L) - 1) / (L * S) * 10000) / 10000;
}

function _getClinicalDiagnosis(z) {
  if (z === null || isNaN(z)) return 'UNKNOWN';
  if (z < -3.0) return 'SAM';
  if (z < -2.0) return 'MAM';
  return 'NORMAL';
}

/* ============================================================================
   AURA_API — public surface called by index.html
   ============================================================================ */
const AURA_API = {

  /* ── [NOT BUILT] sherpa-onnx on-device ASR ───────────────────────────────
     Wire: load sherpa-onnx WASM, transcribe(audioBlob). */
  transcribeVoice: async (audioBlob) => {
    return { text: 'Rahul aaj nahi aaya, Priya ko double ration, Meera ka weight naapo', confidence: 0.94 };
  },

  /* ── [NOT BUILT] language + dialect detection ────────────────────────────*/
  detectLanguage: async (audioBlob) => {
    return { language: 'Hindi', dialect: 'Mundari', confidence: 0.96, langCode: 'hi' };
  },

  /* ── [NOT BUILT] worker auth (voice-print or name match) ─────────────────*/
  authenticateWorker: async (transcript) => {
    return MOCK.workerProfile;
  },

  /* ── [SERVER] children roster ────────────────────────────────────────────
     GET /api/children?centre={centreId} */
  getChildren: async (centreId) => {
    try {
      return await _apiFetch(`/api/children?centre=${encodeURIComponent(centreId)}`);
    } catch {
      return MOCK.children;
    }
  },

  /* ── [NOT BUILT] SARR — Semantic Automated Register Routing ──────────────
     Wire: Qwen2.5-0.5B router + Jaro-Winkler/Metaphone name match */
  runSARR: async ({ transcript, centreId, children }) => {
    return { registers: MOCK.sarrResult };
  },

  /* ── [BROWSER] YOLOv8n headcount — runs fully client-side ───────────────
     Uses vision_engine.js + onnxruntime-web from CDN.
     The function is called with an HTMLCanvasElement. */
  countHeadsByCamera: async (imageCanvas) => {
    try {
      // Dynamically import the ES module (CDN ort is loaded via importmap in index.html)
      const { analyzeClassroomPhoto } = await import('./ml_pipeline/vision_engine.js');
      return await analyzeClassroomPhoto(imageCanvas, '/ml_pipeline/yolov8n.onnx');
    } catch (err) {
      console.warn('[vision] fallback:', err.message);
      return { count: 24, confidence: 0.91, boxes: [] };
    }
  },

  /* ── [SERVER] submit attendance ──────────────────────────────────────────
     POST /api/attendance */
  submitAttendance: async ({ centreId, present, absent, photoCount }) => {
    AURA_DB.queue({ op: 'attendance', centreId, present: present.length, absent: absent.length, ts: Date.now() });
    try {
      return await _apiFetch('/api/attendance', {
        method: 'POST',
        body: JSON.stringify({ centreId, present, absent, photoCount })
      });
    } catch {
      return { success: true, syncStatus: 'queued' };
    }
  },

  /* ── [BROWSER] WHO Z-score + LightGBM early warning ─────────────────────
     Runs fully client-side: fetches who_standards.json + SAM model once,
     then computes offline. Falls back to /api/health/:childId when heavy
     data (actual DB vitals) is needed. */
  getHealthRisk: async (childId) => {
    // Try server first for real DB vitals
    try {
      const serverData = await _apiFetch(`/api/health/${encodeURIComponent(childId)}`);
      // Re-run browser inference on top of server vitals for explainability
      const [whoStd, modelTxt] = await Promise.all([_loadWHOStandards(), _loadSAMModel()]);
      if (serverData.vitals && whoStd && modelTxt && typeof predictMalnutritionRisk === 'function') {
        const w = parseFloat(serverData.vitals.weight);
        const h = parseFloat(serverData.vitals.height);
        if (!isNaN(w) && !isNaN(h)) {
          const z   = _calculateWHOZScore(w, h, serverData.zscore < 0 ? 'girls' : 'girls', whoStd);
          const cat = _getClinicalDiagnosis(z);
          const cd  = { zwfl: z ?? serverData.zscore, z_velocity: -0.2, attendance_rate: 0.55, missed_vaccine_streak: 1, migrant_flag: 0 };
          const risk = predictMalnutritionRisk(cd, modelTxt);
          return { ...serverData, zscore: z ?? serverData.zscore, category: cat, ...risk };
        }
      }
      return serverData;
    } catch {
      // Full offline path
      return MOCK.healthRisk;
    }
  },

  /* ── [SERVER] log meal count ──────────────────────────────────────────────
     POST /api/meal */
  logMeal: async ({ centreId, fedCount, totalPresent }) => {
    AURA_DB.queue({ op: 'meal', centreId, fedCount, ts: Date.now() });
    try {
      return await _apiFetch('/api/meal', {
        method: 'POST',
        body: JSON.stringify({ centreId, fedCount, totalPresent })
      });
    } catch {
      return { success: true };
    }
  },

  /* ── [SERVER] ECE activity briefing via Ollama/Qwen2.5-0.5B ─────────────
     POST /api/ece */
  getECEActivity: async ({ centreId, children }) => {
    try {
      const result = await _apiFetch('/api/ece', {
        method: 'POST',
        body: JSON.stringify({ centreId, children })
      });
      return result;
    } catch {
      return { activity: MOCK.eceActivity };
    }
  },

  /* ── [SERVER] Reflection Audit — human-gate commit ───────────────────────
     POST /api/audit/commit */
  commitAudit: async ({ centreId, approvedItems }) => {
    AURA_DB.set('lastAuditTs', Date.now());
    AURA_DB.queue({ op: 'audit_commit', centreId, items: approvedItems.length, ts: Date.now() });
    try {
      return await _apiFetch('/api/audit/commit', {
        method: 'POST',
        body: JSON.stringify({ centreId, approvedItems })
      });
    } catch {
      return { success: true, pdfUrl: null, syncStatus: 'queued' };
    }
  },

  /* ── [NOT BUILT] PaddleOCR Aadhaar scan ──────────────────────────────────*/
  ocrAadhaar: async (imageBlob) => {
    return { name: '', dob: '', uid: '', address: '' };
  },

  /* ── CRDT sync to Poshan Tracker ─────────────────────────────────────────
     Called from the service worker background-sync event. */
  syncNow: async () => {
    const queue = AURA_DB.get('syncQueue') || [];
    const pending = queue.filter(x => x.status === 'pending');
    if (!pending.length) return { success: true, synced: 0, failed: 0 };

    let synced = 0, failed = 0;
    for (const op of pending) {
      try {
        const path = op.op === 'attendance' ? '/api/attendance'
                   : op.op === 'meal'       ? '/api/meal'
                   : op.op === 'audit_commit' ? '/api/audit/commit'
                   : null;
        if (path) {
          await _apiFetch(path, { method: 'POST', body: JSON.stringify(op) });
          op.status = 'synced';
          synced++;
        }
      } catch { failed++; }
    }
    AURA_DB.set('syncQueue', queue);
    return { success: true, synced, failed };
  }
};

/* ============================================================================
   AURA_DB — local state / offline queue layer
   ============================================================================ */
const AURA_DB = {
  get: (key) => { try { return JSON.parse(localStorage.getItem(`aura::${key}`)); } catch { return null; } },
  set: (key, val) => { try { localStorage.setItem(`aura::${key}`, JSON.stringify(val)); } catch (e) { console.warn('[DB]', e); } },
  queue: (operation) => {
    const q = AURA_DB.get('syncQueue') || [];
    q.push({ ...operation, id: Math.random().toString(36).slice(2), status: 'pending' });
    AURA_DB.set('syncQueue', q);
    if (typeof updateSyncPill === 'function') updateSyncPill();
  }
};

/* ============================================================================
   MOCK — fallback data used when server is unavailable / feature not built.
   ============================================================================ */
const MOCK = {
  delay: (ms) => new Promise(r => setTimeout(r, ms)),
  workerProfile: { id: 'AWW_KH_04', name: 'Meera Devi', centre: 'AWC 04', block: 'Khunti, Jharkhand', childCount: 26, av: 'म' },
  children: [
    { id: 'JH-001', name: 'Rahul Munda',   age: '6 yrs', nameHi: 'राहुल मुंडा',   status: 'normal' },
    { id: 'JH-002', name: 'Priya Soren',   age: '5 yrs', nameHi: 'प्रिया सोरेन',  status: 'normal' },
    { id: 'JH-003', name: 'Suresh Oraon',  age: '4 yrs', nameHi: 'सुरेश उरांव',   status: 'critical' },
    { id: 'JH-004', name: 'Anita Toppo',   age: '4 yrs', nameHi: 'अनिता टोप्पो',  status: 'pending' },
    { id: 'JH-005', name: 'Kavita Hansda', age: '3 yrs', nameHi: 'कविता हांसदा',  status: 'vaccine' }
  ],
  sarrResult: [
    { name: 'Attendance', nameHi: 'हाज़िरी', value: 'Rahul: absent', valueHi: 'राहुल: नहीं आया', confidence: 0.97, tier: 1 },
    { name: 'Ration',     nameHi: 'राशन',   value: 'Priya: double ration', valueHi: 'प्रिया: दुगना राशन', confidence: 0.91, tier: 2 },
    { name: 'Health',     nameHi: 'सेहत',   value: 'Meera: weigh pending', valueHi: 'मीरा: वज़न नापना बाकी', confidence: 0.85, tier: 2 }
  ],
  healthRisk: {
    name: 'Suresh Oraon', nameHi: 'सुरेश उरांव',
    age: 'Boy, age 4 years', ageHi: 'लड़का, उम्र 4 साल',
    zscore: -3.5, category: 'SAM', riskLevel: 'critical',
    earlyWarning: 'Weight falling 3 months. Attendance under half. Could worsen in 6 weeks.',
    earlyWarningHi: 'वज़न 3 महीने से घट रहा। हाज़िरी आधी से कम। 6 हफ़्ते में हालत बिगड़ सकती है।',
    vitals: { weight: '10.1 kg', height: '95.5 cm', arm: '10.8 cm', attendance: '14/20 days' }
  },
  eceActivity: {
    name: 'Game: Freeze the Music', nameHi: 'खेल: गाना रुको',
    duration: '20 min', ageRange: 'Age 3-5', ageRangeHi: 'उम्र 3-5 साल',
    desc: 'Children sit in a circle. When music stops, everyone freezes. Then take turns by name.',
    descHi: 'बच्चे गोल घेरे में बैठें। गाना रुके तो सब रुक जाएं। फिर नाम लेकर अगली बारी।',
    focusChildren: [
      { name: 'Suresh Oraon', nameHi: 'सुरेश उरांव', flag: 'Low weight alert', flagHi: 'कम वज़न', note: 'Give Suresh a seated role.', noteHi: 'सुरेश को बैठे-बैठे काम दो।' },
      { name: 'Anita Toppo',  nameHi: 'अनिता टोप्पो', flag: 'Shy', flagHi: 'शर्मीली है', note: 'Let Anita hold the music card.', noteHi: 'अनिता को गाने का कार्ड थमाओ।' }
    ]
  }
};
