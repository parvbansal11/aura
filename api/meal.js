'use strict';
const { getDB } = require('./_db');

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { fedCount = 0, totalPresent = 0 } = req.body || {};
    const today = new Date().toISOString().slice(0, 10);
    const db    = getDB();

    if (db) {
      db.prepare(
        `UPDATE daily_tracking SET hot_cooked_meal=1 WHERE record_date=? AND attendance=1`
      ).run(today);
    }

    res.json({ success: true, fedCount, totalPresent, date: today });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
