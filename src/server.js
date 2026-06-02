'use strict';

require('dotenv').config();

const express = require('express');
const config  = require('./config');

// ── Validate critical environment variables ──────────────────────────────────
const required = ['WHATSAPP_TOKEN'];
const requiredOneOf = [['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_PHONE_ID']];
const missing = required.filter(key => !process.env[key]);
// Check that at least one of the alternate names is set
for (const alts of requiredOneOf) {
    if (!alts.some(key => process.env[key])) {
        missing.push(alts.join(' or '));
    }
}
if (missing.length > 0) {
    console.error(`🚨 Missing required env vars: ${missing.join(', ')}`);
    console.error('   Please set them in .env or your environment.');
    // Don't crash — allow healthcheck to report status
}

if (!process.env.GOOGLE_API_KEY && !process.env.OPENAI_API_KEY) {
    console.warn('⚠️ No AI API key configured (GOOGLE_API_KEY or OPENAI_API_KEY). AI replies will not work.');
}

// ── Bootstrap database (creates tables if missing) ───────────────────────────
require('./config/db');

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();

// ── Security headers ─────────────────────────────────────────────────────────
app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '0'); // Modern browsers don't need this; CSP is better
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
});

// ── Request size limit (1MB max to prevent abuse) ────────────────────────────
app.use(express.json({ limit: '1mb' }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/webhook', require('./routes/webhook'));
app.use('/webhook', require('./routes/webhook')); // keep original just in case

// ── Health check endpoint ────────────────────────────────────────────────────
const aiService = require('./services/openaiService');

app.get('/health', async (_req, res) => {
    try {
        const aiHealth = await aiService.healthCheck();
        const status = aiHealth.db ? 'healthy' : 'degraded';
        res.status(aiHealth.db ? 200 : 503).json({
            status,
            uptime: Math.floor(process.uptime()),
            timestamp: new Date().toISOString(),
            ai: aiHealth,
        });
    } catch (err) {
        res.status(503).json({
            status: 'unhealthy',
            error: 'Health check failed',
        });
    }
});

// Root health check (simple)
app.get('/', (_req, res) => res.send('WhatoMate Bot is running! 🚀'));

// ── Cache clear endpoint (call after updating AI contexts in the dashboard) ──
app.post('/api/ai/clear-cache', (_req, res) => {
    aiService.clearCache();
    res.json({ status: 'ok', message: 'AI settings cache cleared' });
});

// ── Mock API for Gold Rates (For API Fetch Testing) ──────────────────────────
app.get('/api/gold-rate', (_req, res) => {
    // Generate a slightly fluctuating mock price
    const baseUsd = 2345.50; // $ per oz
    const baseInr = 72150.00; // ₹ per 10g
    
    // +/- 0.5% random fluctuation
    const fluctuate = (base) => (base * (1 + (Math.random() * 0.01 - 0.005))).toFixed(2);
    
    res.json({
        success: true,
        timestamp: new Date().toISOString(),
        rates: {
            USD_PER_OUNCE: fluctuate(baseUsd),
            INR_PER_10G: fluctuate(baseInr)
        }
    });
});

// ── Global 404 handler ────────────────────────────────────────────────────────
app.use((_req, res) => {
    res.status(404).json({ status: 'error', message: 'Not found' });
});

// ── Global error handler ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
    console.error('❌ Unhandled server error:', err.message);
    res.status(500).json({ status: 'error', message: 'Internal Server Error' });
});

// ── Process-level error handlers ──────────────────────────────────────────────
process.on('uncaughtException', (err) => {
    console.error('🚨 Uncaught Exception:', err.message);
    console.error(err.stack);
    // Don't exit — let the process manager (pm2) decide
});

process.on('unhandledRejection', (reason) => {
    console.error('🚨 Unhandled Promise Rejection:', reason);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
let server;

function gracefulShutdown(signal) {
    console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);

    if (server) {
        server.close(() => {
            console.log('✅ HTTP server closed');
            process.exit(0);
        });

        // Force close after 10s
        setTimeout(() => {
            console.error('⚠️ Forced shutdown after timeout');
            process.exit(1);
        }, 10000);
    } else {
        process.exit(0);
    }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ── Start server ──────────────────────────────────────────────────────────────
server = app.listen(config.PORT, () => {
    console.log(`✅ WhatoMate server running on port ${config.PORT}`);
    console.log(`   Environment: ${config.APP_ENV}`);
    console.log(`   Health check: http://localhost:${config.PORT}/health`);
});
