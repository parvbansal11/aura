'use strict';
/**
 * Thin shim that wraps node:sqlite's DatabaseSync to match the
 * better-sqlite3 surface used by setup_database.js and extended_queries.js.
 *
 * Supports: exec(), prepare(), pragma(), transaction(), close().
 * Stmt supports: run(), all(), get().
 */

const { DatabaseSync } = require('node:sqlite');

class Database {
  constructor(filePath, _opts) {
    this._db = new DatabaseSync(filePath);
  }

  exec(sql) {
    this._db.exec(sql);
    return this;
  }

  pragma(pragmaStr, opts) {
    // Handle "PRAGMA foo = bar" form
    if (!opts) {
      this._db.exec(`PRAGMA ${pragmaStr}`);
      return this;
    }
    // Handle pragma('foreign_keys', { simple: true }) → returns scalar
    const key   = pragmaStr.trim();
    const stmt  = this._db.prepare(`PRAGMA ${key}`);
    const row   = stmt.get();
    if (!row) return null;
    const vals  = Object.values(row);
    return opts.simple ? vals[0] : vals;
  }

  prepare(sql) {
    const raw = this._db.prepare(sql);
    return new Statement(raw);
  }

  transaction(fn) {
    return (...args) => {
      this._db.exec('BEGIN IMMEDIATE');
      try {
        const result = fn(...args);
        this._db.exec('COMMIT');
        return result;
      } catch (err) {
        this._db.exec('ROLLBACK');
        throw err;
      }
    };
  }

  close() {
    this._db.close();
  }
}

class Statement {
  constructor(raw) {
    this._raw = raw;
  }

  run(...args) {
    // node:sqlite run() returns { changes, lastInsertRowid }
    return this._raw.run(..._flatten(args));
  }

  all(...args) {
    return this._raw.all(..._flatten(args));
  }

  get(...args) {
    return this._raw.get(..._flatten(args));
  }
}

// better-sqlite3 accepts stmt.run(p1, p2, p3) or stmt.run([p1,p2,p3])
function _flatten(args) {
  if (args.length === 1 && Array.isArray(args[0])) return args[0];
  return args;
}

module.exports = Database;
