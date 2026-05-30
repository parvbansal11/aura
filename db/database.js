'use strict';
/**
 * Database adapter.
 * Tries better-sqlite3 first: prebuilt binaries ship for Node 18/20/22
 * on Linux/macOS/Windows, so this works on Vercel out of the box.
 *
 * Falls back to the node:sqlite shim for Node 26+ dev machines where
 * better-sqlite3 prebuilts don't yet exist and Python 3.14 breaks
 * native compilation.
 */

function tryBetterSqlite() {
  try {
    const Sqlite = require('better-sqlite3');
    // The require() succeeds even when the native binding is missing —
    // probe the binding by opening an in-memory DB.
    const probe = new Sqlite(':memory:');
    probe.close();
    return Sqlite;
  } catch (_) {
    return null;
  }
}

const BetterSqlite = tryBetterSqlite();

if (BetterSqlite) {
  module.exports = BetterSqlite;
} else {
  // Local dev on Node 26+ — fall back to Node's built-in node:sqlite
  // (stable since Node 24; experimental in 22.5+ with --experimental-sqlite).
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
      if (!opts) {
        this._db.exec(`PRAGMA ${pragmaStr}`);
        return this;
      }
      const key  = pragmaStr.trim();
      const row  = this._db.prepare(`PRAGMA ${key}`).get();
      if (!row) return null;
      const vals = Object.values(row);
      return opts.simple ? vals[0] : vals;
    }

    prepare(sql) {
      return new Statement(this._db.prepare(sql));
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

    close() { this._db.close(); }
  }

  class Statement {
    constructor(raw) { this._raw = raw; }
    run(...args)  { return this._raw.run(..._flat(args)); }
    all(...args)  { return this._raw.all(..._flat(args)); }
    get(...args)  { return this._raw.get(..._flat(args)); }
  }

  function _flat(a) {
    return a.length === 1 && Array.isArray(a[0]) ? a[0] : a;
  }

  module.exports = Database;
}
