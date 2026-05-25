'use strict';

require('dotenv').config();

const express = require('express');
const config  = require('./config');

// ── Bootstrap database (creates tables if missing) ───────────────────────────
require('./config/db');

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();

app.use(express.json());

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/webhook', require('./routes/webhook'));
app.use('/webhook', require('./routes/webhook')); // keep original just in case

// Health check
app.get('/', (_req, res) => res.send('WhatoMate Bot is running! 🚀'));

// ── Global 404 handler ────────────────────────────────────────────────────────
app.use((_req, res) => {
    res.status(404).json({ status: 'error', message: 'Not found' });
});

// ── Global error handler ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
    console.error('❌ Unhandled server error:', err);
    res.status(500).json({ status: 'error', message: 'Internal Server Error' });
});

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(config.PORT, () => {
    console.log(`✅ WhatoMate server running on port ${config.PORT}`);
});
