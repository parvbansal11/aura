'use strict';

/**
 * A.U.R.A. API Server
 * Exposes db/ and education_engine.js as /api/* routes.
 * Also serves the static PWA files from the project root.
 *
 * Start: node server.js  (or npm start)
 * The frontend's aura-api.js already points fetch() calls at /api/*.
 */

const express = require('express');
const path    = require('path');
const cors    = require('cors');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ── Serve static PWA shell ──────────────────────────────────────────────────
// Order matters: serve root files but let /api/* routes below take priority.
app.use(express.static(path.join(__dirname), {
  index: 'index.html',
  // Don't intercept /api/ paths
  setHeaders(res, filePath) {
    if (filePath.endsWith('.onnx')) {
      res.setHeader('Content-Type', 'application/octet-stream');
    }
    if (filePath.endsWith('.wasm')) {
      res.setHeader('Content-Type', 'application/wasm');
    }
  }
}));

// ── Lazy-load DB (initialises once on first request) ───────────────────────
let _db = null;
function getDB() {
  if (_db) return _db;
  const { setupDatabase } = require('./db/setup_database');
  _db = setupDatabase();
  return _db;
}

// ── GET /api/children?centre=AWC_04 ────────────────────────────────────────
app.get('/api/children', (req, res) => {
  try {
    const db = getDB();
    const rows = db.prepare(
      `SELECT beneficiary_id AS id, child_name AS name,
              CAST((julianday('now') - julianday(dob)) / 365.25 AS INTEGER) || ' yrs' AS age,
              gender, type
       FROM beneficiary_directory
       WHERE type = 'child'
       ORDER BY child_name`
    ).all();
    res.json(rows);
  } catch (err) {
    console.error('[/api/children]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/attendance ───────────────────────────────────────────────────
app.post('/api/attendance', (req, res) => {
  try {
    const { centreId, present = [], absent = [], photoCount = 0 } = req.body;
    const db    = getDB();
    const today = new Date().toISOString().slice(0, 10);

    const insert = db.prepare(
      `INSERT OR REPLACE INTO daily_tracking
         (tracking_id, beneficiary_id, record_date, attendance, morning_snacks)
       VALUES (?, ?, ?, ?, ?)`
    );

    const tx = db.transaction(() => {
      for (const id of present) {
        insert.run(`TRK-${id}-${today.replace(/-/g, '')}`, id, today, 1, 1);
      }
      for (const id of absent) {
        insert.run(`TRK-${id}-${today.replace(/-/g, '')}`, id, today, 0, 0);
      }
    });
    tx();

    res.json({ success: true, syncStatus: 'saved', date: today, photoCount });
  } catch (err) {
    console.error('[/api/attendance]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/meal ─────────────────────────────────────────────────────────
app.post('/api/meal', (req, res) => {
  try {
    const { centreId, fedCount = 0, totalPresent = 0 } = req.body;
    const db    = getDB();
    const today = new Date().toISOString().slice(0, 10);

    db.prepare(
      `UPDATE daily_tracking
       SET hot_cooked_meal = 1
       WHERE record_date = ? AND attendance = 1`
    ).run(today);

    res.json({ success: true, fedCount, totalPresent, date: today });
  } catch (err) {
    console.error('[/api/meal]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/health/:childId ────────────────────────────────────────────────
app.get('/api/health/:childId', (req, res) => {
  try {
    const db  = getDB();
    const row = db.prepare(
      `SELECT g.id, g.beneficiary_id, b.child_name, b.gender, b.dob,
              g.weight_kg, g.height_cm, g.z_score, g.sam_mam_status,
              CAST((julianday('now') - julianday(b.dob)) / 365.25 AS INTEGER) AS age_yrs
       FROM growth_monitoring g
       JOIN beneficiary_directory b ON g.beneficiary_id = b.beneficiary_id
       WHERE g.beneficiary_id = ?
       ORDER BY g.date DESC LIMIT 1`
    ).get(req.params.childId);

    if (!row) return res.status(404).json({ error: 'Child not found' });

    const { calculateWHOZScore, getClinicalDiagnosis } = require('./ml_pipeline/clinical_engine');

    let zscore = row.z_score;
    let category = row.sam_mam_status;

    if (row.weight_kg && row.height_cm) {
      try {
        zscore   = calculateWHOZScore(row.weight_kg, row.height_cm, row.gender === 'M' ? 'boys' : 'girls');
        category = getClinicalDiagnosis(zscore);
      } catch (_) { /* use stored values */ }
    }

    res.json({
      name:     row.child_name,
      nameHi:   row.child_name,
      age:      `${row.gender === 'M' ? 'Boy' : 'Girl'}, age ${row.age_yrs} years`,
      ageHi:    `${row.gender === 'M' ? 'लड़का' : 'लड़की'}, उम्र ${row.age_yrs} साल`,
      zscore,
      category,
      riskLevel: zscore < -3 ? 'critical' : zscore < -2 ? 'moderate' : 'normal',
      earlyWarning: `Z-Score: ${zscore}. Status: ${category}. Weight: ${row.weight_kg}kg, Height: ${row.height_cm}cm.`,
      earlyWarningHi: `Z-स्कोर: ${zscore}। स्थिति: ${category}। वज़न: ${row.weight_kg}kg, कद: ${row.height_cm}cm।`,
      vitals: {
        weight: `${row.weight_kg} kg`,
        height: `${row.height_cm} cm`,
        arm: 'N/A',
        attendance: 'N/A'
      }
    });
  } catch (err) {
    console.error('[/api/health]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/ece ──────────────────────────────────────────────────────────
app.post('/api/ece', async (req, res) => {
  try {
    const { centreId, ageCohort = '3-5 years', rawActivity = 'Free play', voiceLogObservations = '' } = req.body;
    const db = getDB();

    const nudges = db.prepare(
      `SELECT b.child_name AS name,
              CASE
                WHEN g.sam_mam_status IN ('SAM','MAM') THEN 'low_weight_alert'
                WHEN (SELECT COUNT(*) FROM daily_tracking t WHERE t.beneficiary_id = b.beneficiary_id
                        AND t.record_date >= date('now','-7 days') AND t.attendance = 0) >= 2
                     THEN 'absent_2_days'
                ELSE 'monitor'
              END AS flag
       FROM beneficiary_directory b
       LEFT JOIN growth_monitoring g ON g.beneficiary_id = b.beneficiary_id
       WHERE b.type = 'child'
       ORDER BY b.child_name LIMIT 5`
    ).all();

    const { generateDailyBriefing } = require('./ml_pipeline/education_engine');
    const result = await generateDailyBriefing({
      ageCohort,
      rawActivity,
      localDatabaseNudges: nudges,
      voiceLogObservations
    });

    res.json({ activity: result });
  } catch (err) {
    console.error('[/api/ece]', err.message);
    // Return a structured fallback so the frontend never crashes
    res.json({
      activity: {
        cohort: '3-5 years',
        daily_20min_session: {
          title: 'Free Play & Circle Time',
          execution_steps: 'Seat children in a circle. Sing together for 5 minutes. Then allow free play for 15 minutes.'
        },
        reintegration_protocols: [],
        behavioral_adaptations: { low_pressure_roles: '', worker_observation_response: '' }
      }
    });
  }
});

// ── POST /api/audit/commit ─────────────────────────────────────────────────
app.post('/api/audit/commit', (req, res) => {
  try {
    const { centreId, approvedItems = [], workerId = 'AWW_KH_04' } = req.body;
    const db = getDB();
    db.prepare(
      `INSERT OR REPLACE INTO home_visits_and_referrals
         (id, beneficiary_id, visit_date, counseling_notes, referred_to_chc)
       VALUES (?, ?, date('now'), ?, 0)`
    ).run(`AUDIT-${Date.now()}`, 'JH-001', `Daily audit committed. ${approvedItems.length} items approved.`);

    res.json({ success: true, pdfUrl: null, syncStatus: 'saved' });
  } catch (err) {
    console.error('[/api/audit/commit]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/pdf/:register ────────────────────────────────────────────────
app.post('/api/pdf/:register', (req, res) => {
  const fs = require('fs');
  try {
    const { month = new Date().getMonth() + 1, year = new Date().getFullYear(), meta = {} } = req.body;
    const db     = getDB();
    const regKey = req.params.register.toUpperCase();

    const { REGISTER_CONFIGS }     = require('./db/registerConfig');
    const { generateUniversalPDF } = require('./db/universal_pdf_generator');
    const extQ                     = require('./db/extended_queries');

    const fetchFn = {
      REGISTER_2:  extQ.fetchRegister2Data,
      REGISTER_3:  extQ.fetchRegister3Data,
      REGISTER_4:  extQ.fetchRegister4Data,
      REGISTER_6:  extQ.fetchRegister6Data,
      REGISTER_11: extQ.fetchRegister11Data,
      REGISTER_15: extQ.fetchRegister15Data,
    }[regKey];

    if (!fetchFn || !REGISTER_CONFIGS[regKey]) {
      return res.status(400).json({ error: `Unknown register: ${regKey}` });
    }

    const data     = fetchFn(db, month, year);
    const metaData = {
      state:      meta.state      || 'Jharkhand',
      centerName: meta.centerName || 'AWC 04, Khunti',
      workerName: meta.workerName || 'Meera Devi',
      month:      month.toString(),
      year:       year.toString()
    };

    // generateUniversalPDF writes a file to CWD; we read it back then delete
    generateUniversalPDF(metaData, REGISTER_CONFIGS[regKey], data);

    const safeState = (metaData.state).replace(/\s+/g, '_');
    const safeTitle = REGISTER_CONFIGS[regKey].title.split(':')[0].replace(/\s+/g, '_').replace(/\./g, '');
    const fileName  = `${safeState}_${safeTitle}_${metaData.month}_${metaData.year}.pdf`;
    const filePath  = path.join(__dirname, fileName);

    if (!fs.existsSync(filePath)) {
      return res.status(500).json({ error: 'PDF generation produced no file' });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${regKey}_${month}_${year}.pdf"`);
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    stream.on('end', () => fs.unlink(filePath, () => {}));
  } catch (err) {
    console.error('[/api/pdf]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Fallback: serve index.html for any unmatched GET (SPA) ─────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── Export for Vercel serverless; listen only when run directly ────────────
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[AURA] Server running at http://localhost:${PORT}`);
    console.log(`[AURA] Open the PWA at http://localhost:${PORT}`);
  });
}

module.exports = app;
