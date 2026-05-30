'use strict';
const path = require('path');
const fs   = require('fs');
const { getChildHealth } = require('../_db');
const { calculateWHOZScore, getClinicalDiagnosis } = require('../../ml_pipeline/clinical_engine');
const { predictMalnutritionRisk } = require('../../ml_pipeline/ml_inference');

// Load SAM model text once per cold start
let _modelText = null;
function getModel() {
  if (_modelText) return _modelText;
  try {
    _modelText = fs.readFileSync(
      path.join(__dirname, '../../ml_pipeline/aura_sam_predictor_80kb.txt'), 'utf8'
    );
  } catch { _modelText = ''; }
  return _modelText;
}

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  const id  = req.query.id;
  const row = getChildHealth(id);
  if (!row) return res.status(404).json({ error: 'Child not found' });

  let zscore   = row.z_score;
  let category = row.sam_mam_status;

  if (row.weight_kg && row.height_cm) {
    try {
      const g = row.gender === 'M' ? 'boys' : 'girls';
      zscore   = calculateWHOZScore(row.weight_kg, row.height_cm, g);
      category = getClinicalDiagnosis(zscore);
    } catch (_) { /* out of WHO range — keep stored value */ }
  }

  const riskLevel = zscore < -3 ? 'critical' : zscore < -2 ? 'moderate' : 'normal';

  // Run LightGBM SAM predictor
  let earlyWarning = `Z-Score: ${zscore}. Status: ${category}.`;
  let earlyWarningHi = `Z-स्कोर: ${zscore}। स्थिति: ${category}।`;
  try {
    const modelText = getModel();
    if (modelText) {
      const childData = { zwfl: zscore, z_velocity: -0.2, attendance_rate: 0.6, missed_vaccine_streak: 1, migrant_flag: 0 };
      const risk      = predictMalnutritionRisk(childData, modelText);
      earlyWarning    = risk.reason;
      earlyWarningHi  = risk.reason;
    }
  } catch (_) {}

  res.json({
    name:    row.child_name,
    nameHi:  row.child_name,
    age:     `${row.gender === 'M' ? 'Boy' : 'Girl'}, age ${row.age_yrs} years`,
    ageHi:   `${row.gender === 'M' ? 'लड़का' : 'लड़की'}, उम्र ${row.age_yrs} साल`,
    zscore,
    category,
    riskLevel,
    earlyWarning,
    earlyWarningHi,
    vitals: {
      weight:     `${row.weight_kg} kg`,
      height:     `${row.height_cm} cm`,
      arm:        'N/A',
      attendance: 'N/A'
    }
  });
};
