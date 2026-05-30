'use strict';
const { getDB } = require('./_db');

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { centreId = 'AWC_04', present = [], absent = [], photoCount = 0 } = req.body || {};
    const today = new Date().toISOString().slice(0, 10);
    const db    = getDB();

    if (db) {
      const ins = db.prepare(
        `INSERT OR REPLACE INTO daily_tracking
           (tracking_id, beneficiary_id, record_date, attendance, morning_snacks)
         VALUES (?, ?, ?, ?, ?)`
      );
      const tx = db.transaction(() => {
        for (const id of present) ins.run(`TRK-${id}-${today.replace(/-/g,'')}`, id, today, 1, 1);
        for (const id of absent)  ins.run(`TRK-${id}-${today.replace(/-/g,'')}`, id, today, 0, 0);
      });
      tx();
    }

    res.json({ success: true, syncStatus: db ? 'saved' : 'queued', date: today, photoCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
