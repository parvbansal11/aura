'use strict';
const { getChildren } = require('./_db');

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();
  try {
    res.json(getChildren());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
