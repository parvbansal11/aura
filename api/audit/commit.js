'use strict';
const { getDB } = require('../_db');

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { approvedItems = [] } = req.body || {};
    const db = getDB();
    if (db) {
      db.prepare(
        `INSERT OR REPLACE INTO home_visits_and_referrals
           (id, beneficiary_id, visit_date, counseling_notes, referred_to_chc)
         VALUES (?, 'JH-001', date('now'), ?, 0)`
      ).run(`AUDIT-${Date.now()}`, `Daily audit: ${approvedItems.length} items approved.`);
    }
    res.json({ success: true, pdfUrl: null, syncStatus: db ? 'saved' : 'queued' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
