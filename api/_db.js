'use strict';
/**
 * Shared DB helper for Vercel API functions.
 * Tries to open the SQLite database (works when better-sqlite3 prebuilt
 * binaries are available on Node 18/20/22 Linux). Falls back to seed-data
 * helpers when the DB is unavailable.
 */
const { CHILDREN } = require('./_seed');

let _db = null;

function getDB() {
  if (_db) return _db;
  try {
    const Database    = require('../db/database');
    const { setupDatabase } = require('../db/setup_database');
    _db = setupDatabase();
    return _db;
  } catch (err) {
    console.warn('[api/_db] SQLite unavailable, using seed:', err.message);
    return null;
  }
}

// Returns an array of children rows (from DB or seed).
function getChildren() {
  const db = getDB();
  if (db) {
    return db.prepare(
      `SELECT beneficiary_id AS id, child_name AS name,
              CAST((julianday('now') - julianday(dob)) / 365.25 AS INTEGER) || ' yrs' AS age,
              gender, dob, type
       FROM beneficiary_directory WHERE type='child' ORDER BY child_name`
    ).all();
  }
  return CHILDREN.map(c => ({ id:c.id, name:c.name, age:c.age, gender:c.gender, type:'child' }));
}

// Returns the latest growth record for a child id (from DB or seed).
function getChildHealth(id) {
  const db = getDB();
  if (db) {
    return db.prepare(
      `SELECT g.beneficiary_id, b.child_name, b.gender, b.dob,
              g.weight_kg, g.height_cm, g.z_score, g.sam_mam_status,
              CAST((julianday('now') - julianday(b.dob)) / 365.25 AS INTEGER) AS age_yrs
       FROM growth_monitoring g
       JOIN beneficiary_directory b ON g.beneficiary_id = b.beneficiary_id
       WHERE g.beneficiary_id = ? ORDER BY g.date DESC LIMIT 1`
    ).get(id);
  }
  const c = CHILDREN.find(x => x.id === id);
  if (!c) return null;
  const age_yrs = Math.floor((Date.now() - new Date(c.dob)) / (365.25*24*3600*1000));
  return { beneficiary_id:c.id, child_name:c.name, gender:c.gender, dob:c.dob,
           weight_kg:c.weight_kg, height_cm:c.height_cm,
           z_score:c.z_score, sam_mam_status:c.sam_mam_status, age_yrs };
}

module.exports = { getDB, getChildren, getChildHealth };
