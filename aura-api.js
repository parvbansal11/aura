/* ============================================================================
   A.U.R.A — FRONTEND INTEGRATION SURFACE   (web/aura-api.js)
   ----------------------------------------------------------------------------
   This is the ONLY file the backend team needs to edit.

   Every UI action in index.html calls one of these AURA_API functions.
   Each currently returns MOCK data so the whole app runs end-to-end today.
   Replace each function body with the real call described in its comment.

   Three integration styles are used (see API_CONTRACT.md for the full map):
     [BROWSER]      runs client-side, import the engine from ../ml_pipeline
     [SERVER]       needs a Node endpoint (db uses better-sqlite3 = Node only)
     [NOT BUILT]    engine does not exist in the repo yet (ASR, SARR, OCR, sync)

   Loaded as a classic <script> BEFORE the main app script, so AURA_API,
   AURA_DB and MOCK live on the shared global scope (no bundler required).
   ============================================================================ */

const AURA_API = {

  /* ── [NOT BUILT] sherpa-onnx on-device ASR ───────────────────────────────
     Input : MediaRecorder Blob (audio/webm)
     Output: { text:string, confidence:0..1 }
     Wire  : load sherpa-onnx WASM, transcribe(audioBlob). No engine in repo yet. */
  transcribeVoice: async (audioBlob) => {
    return { text: 'Rahul aaj nahi aaya, Priya ko double ration, Meera ka weight naapo', confidence: 0.94 };
  },

  /* ── [NOT BUILT] language + dialect detection ────────────────────────────
     Input : MediaRecorder Blob
     Output: { language, dialect, confidence, langCode } */
  detectLanguage: async (audioBlob) => {
    return { language: 'Hindi', dialect: 'Mundari', confidence: 0.96, langCode: 'hi' };
  },

  /* ── [SERVER / NOT BUILT] worker auth (voice-print or name match) ─────────
     Input : transcript string
     Output: { id, name, centre, block, childCount }
     Wire  : match against a workers table (not in schema yet) OR Poshan Tracker. */
  authenticateWorker: async (transcript) => {
    return MOCK.workerProfile;
  },

  /* ── [SERVER] children roster ────────────────────────────────────────────
     Backend: db/ — SELECT beneficiary_id, child_name, dob, gender, type
                    FROM beneficiary_directory  (better-sqlite3 = Node only)
     Wire   : GET /api/children?centre={centreId}
     Output : Array<{ id, name, age, status }> */
  getChildren: async (centreId) => {
    // const res = await fetch(`/api/children?centre=${centreId}`); return res.json();
    return MOCK.children;
  },

  /* ── [NOT BUILT] SARR — Semantic Automated Register Routing (Qwen2.5-0.5B) ─
     Input : { transcript, centreId, children }
     Output: { registers:[{ name, value, confidence, tier }] }
     tier  : 1 (>=0.92 auto-commit) | 2 (0.70-0.91 confirm) | 3 (<0.70 redictate)
     Wire   : Qwen2.5-0.5B router. Confirm-card name match uses Jaro-Winkler+Metaphone. */
  runSARR: async ({ transcript, centreId, children }) => {
    return { registers: MOCK.sarrResult };
  },

  /* ── [BROWSER] YOLOv8n headcount ─────────────────────────────────────────
     Backend: ml_pipeline/vision_engine.js
              export async function analyzeClassroomPhoto(canvas, onnxModelPath)
              → { success, headcount, confidenceAvg, message }
     Wire   : import { analyzeClassroomPhoto } from '../ml_pipeline/vision_engine.js'
              const r = await analyzeClassroomPhoto(canvasEl, '/ml_pipeline/yolov8n.onnx')
              return { count: r.headcount, confidence: r.confidenceAvg }
     Note   : runs fully client-side via onnxruntime-web; includes Zero-DCE low-light. */
  countHeadsByCamera: async (imageCanvas) => {
    return { count: 24, confidence: 0.91, boxes: [] };
  },

  /* ── [SERVER] submit attendance (queues CRDT sync) ───────────────────────
     Backend: db/ — INSERT INTO daily_tracking (beneficiary_id, record_date, attendance, ...)
     Wire   : POST /api/attendance  { centreId, present[], absent[], photoCount }
     Output : { success, syncStatus } */
  submitAttendance: async ({ centreId, present, absent, photoCount }) => {
    AURA_DB.queue({ op: 'attendance', centreId, present: present.length, absent: absent.length, ts: Date.now() });
    return { success: true, syncStatus: 'queued' };
  },

  /* ── [BROWSER] WHO Z-score + LightGBM 6-8 week early warning ──────────────
     Backend: ml_pipeline/clinical_engine.js
                calculateWHOZScore(weight, length, gender)  → number
                getClinicalDiagnosis(zScore)                → 'SAM'|'MAM'|'NORMAL'
              ml_pipeline/ml_inference.js
                predictMalnutritionRisk(childData, modelText)
                childData = { zwfl, z_velocity, attendance_rate, missed_vaccine_streak, migrant_flag }
                modelText = text of ml_pipeline/aura_sam_predictor_80kb.txt
                → { isHighRisk, riskScore, reason }
     Wire   : import both; compute z = calculateWHOZScore(...); category = getClinicalDiagnosis(z);
              const risk = predictMalnutritionRisk(childData, modelText);
              return { zscore:z, category, ...risk, vitals }
     Note   : both pure JS, run client-side; fetch the .txt model once and cache. */
  getHealthRisk: async (childId) => {
    return MOCK.healthRisk;
  },

  /* ── [SERVER] log meal count ─────────────────────────────────────────────
     Backend: db/ — daily_tracking (total_hcm_days / snacks) + inventory_ledger decrement
     Wire   : POST /api/meal  { centreId, fedCount, totalPresent } */
  logMeal: async ({ centreId, fedCount, totalPresent }) => {
    AURA_DB.queue({ op: 'meal', centreId, fedCount, ts: Date.now() });
    return { success: true };
  },

  /* ── [SERVER] ECE activity briefing ──────────────────────────────────────
     Backend: ml_pipeline/education_engine.js
                async generateDailyBriefing({ ageCohort, rawActivity, localDatabaseNudges, voiceLogObservations })
                → { cohort, daily_20min_session, ... }   (calls an LLM via fetch)
     Wire   : POST /api/ece  { centreId, children }  (server runs generateDailyBriefing)
     Output : { activity: { name, desc, duration, ageRange, focusChildren } } */
  getECEActivity: async ({ centreId, children }) => {
    return { activity: MOCK.eceActivity };
  },

  /* ── [SERVER] Reflection Audit — human-gate commit ───────────────────────
     Backend: db/ commit + db/universal_pdf_generator.js (legal register PDF)
     Wire   : POST /api/audit/commit  { centreId, approvedItems[], workerId }
              server: cr-sqlite CRDT commit → generate PDF → queue Poshan sync
     Output : { success, pdfUrl, syncStatus } */
  commitAudit: async ({ centreId, approvedItems }) => {
    AURA_DB.set('lastAuditTs', Date.now());
    AURA_DB.queue({ op: 'audit_commit', centreId, items: approvedItems.length, ts: Date.now() });
    return { success: true, pdfUrl: null, syncStatus: 'queued' };
  },

  /* ── [NOT BUILT] PaddleOCR Aadhaar scan (child registration) ─────────────
     Input : imageBlob   Output: { name, dob, uid, address } */
  ocrAadhaar: async (imageBlob) => {
    return { name: '', dob: '', uid: '', address: '' };
  },

  /* ── [NOT BUILT] CRDT sync to Poshan Tracker ─────────────────────────────
     Called from the service worker background-sync event.
     Wire  : push AURA_DB syncQueue (pending rows) to Poshan Tracker API.
     Output: { success, synced, failed } */
  syncNow: async () => {
    return { success: true, synced: 0, failed: 0 };
  }
};

/* ============================================================================
   AURA_DB — local state layer
   Replace localStorage with cr-sqlite (wa-sqlite + CRDT) for the real offline store.
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
   MOCK — realistic responses so the UI runs before the backend is wired.
   Delete this object once every AURA_API function returns real data.
   ============================================================================ */
const MOCK = {
  delay: (ms) => new Promise(r => setTimeout(r, ms)),
  workerProfile: { id: 'AWW_KH_04', name: 'Meera Devi', centre: 'AWC 04', block: 'Khunti, Jharkhand', childCount: 26, av: 'म' },
  children: [
    { id: 'CLD_001', name: 'Meera Sharma', age: '3 yrs', nameHi: 'मीरा शर्मा', status: 'critical' },
    { id: 'CLD_002', name: 'Ravi Das', age: '2 yrs', nameHi: 'रवि दास', status: 'critical' },
    { id: 'CLD_003', name: 'Anita Kumari', age: '4 yrs', nameHi: 'अनिता कुमारी', status: 'pending' },
    { id: 'CLD_004', name: 'Rahul Murmu', age: '2 yrs', nameHi: 'राहुल मुर्मू', status: 'returned' },
    { id: 'CLD_005', name: 'Suresh Yadav', age: '3 yrs', nameHi: 'सुरेश यादव', status: 'vaccine' }
  ],
  sarrResult: [
    { name: 'Attendance', nameHi: 'हाज़िरी', value: 'Rahul: absent', valueHi: 'राहुल: नहीं आया', confidence: 0.97, tier: 1 },
    { name: 'Ration', nameHi: 'राशन', value: 'Priya: double ration', valueHi: 'प्रिया: दुगना राशन', confidence: 0.91, tier: 2 },
    { name: 'Health', nameHi: 'सेहत', value: 'Meera: weigh pending', valueHi: 'मीरा: वज़न नापना बाकी', confidence: 0.85, tier: 2 }
  ],
  healthRisk: {
    name: 'Meera Sharma', nameHi: 'मीरा शर्मा',
    age: 'Girl, age 3 years 2 months', ageHi: 'बच्ची, उम्र 3 साल 2 महीने',
    zscore: -3.2, category: 'SAM', riskLevel: 'critical',
    earlyWarning: 'Weight falling 3 months. Attendance under half. Could worsen in 6 weeks.',
    earlyWarningHi: 'वज़न 3 महीने से घट रहा। हाज़िरी आधी से कम। 6 हफ़्ते में हालत बिगड़ सकती है।',
    vitals: { weight: '7.8 kg', height: '89 cm', arm: '10.8 cm', attendance: '12/22 days' }
  },
  eceActivity: {
    name: 'Game: Freeze the Music', nameHi: 'खेल: गाना रुको',
    duration: '20 min', ageRange: 'Age 3-5', ageRangeHi: 'उम्र 3-5 साल',
    desc: 'Children sit in a circle. When music stops, everyone freezes. Then take turns by name.',
    descHi: 'बच्चे गोल घेरे में बैठें। गाना रुके तो सब रुक जाएं। फिर नाम लेकर अगली बारी।',
    focusChildren: [
      { name: 'Rahul Murmu', nameHi: 'राहुल मुर्मू', flag: 'Back after 5 days', flagHi: '5 दिन बाद आया', note: 'Give Rahul the first turn.', noteHi: 'राहुल को पहली बारी दो।' },
      { name: 'Priya Devi', nameHi: 'प्रिया देवी', flag: 'Shy', flagHi: 'शर्मीली है', note: 'Let Priya hold the music box.', noteHi: 'प्रिया को गाना बजाने वाला बनाओ।' }
    ]
  }
};
