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
app.use(express.json({ 
    limit: '1mb',
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));

// ── Routes ────────────────────────────────────────────────────────────────────
const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

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
// ── Frappe Webhook — Auto-notify on Doctype save ─────────────────────────────
const whatomateService = require('./services/whatomateService');
const whatsappService = require('./services/whatsappService');

/**
 * POST /api/frappe-webhook
 * Called by Frappe Server Script when a Whatomate Doctype record is saved.
 * Automatically creates a contact and sends an order notification via WhatsApp.
 *
 * Body: {
 *   "customer_name": "PRAVEEN",
 *   "phone": "918825607244",
 *   "product": "Laptop",
 *   "status": "Confirmed",
 *   "datetime": "2026-06-02 17:30:00",
 *   "doc_name": "order-1",       // optional
 *   "event": "after_insert"       // optional
 * }
 */
app.post('/api/frappe-webhook', async (req, res) => {
    try {
        const { customer_name, phone, product, status, datetime, doc_name, event } = req.body;

        console.log(`\n📡 [Frappe Webhook] Received event=${event || 'unknown'} for doc=${doc_name || 'unknown'}`);

        // ── Validate required fields ──
        const missing = [];
        if (!customer_name) missing.push('customer_name');
        if (!phone) missing.push('phone');
        if (!product) missing.push('product');

        if (missing.length > 0) {
            console.warn(`⚠️ [Frappe Webhook] Missing fields: ${missing.join(', ')}`);
            return res.status(400).json({
                status: 'error',
                message: `Missing required fields: ${missing.join(', ')}`
            });
        }

        // ── Sanitize phone number (digits only, 10-15 chars) ──
        const cleanPhone = String(phone).replace(/\D/g, '');
        if (cleanPhone.length < 10 || cleanPhone.length > 15) {
            return res.status(400).json({
                status: 'error',
                message: `Invalid phone number: ${phone}`
            });
        }

        // ── 1. Create or fetch the contact in WhatoMate CRM ──
        const { id: contactId } = await whatomateService.createOrFetchContact(cleanPhone, String(customer_name).trim());
        if (!contactId) {
            console.error(`❌ [Frappe Webhook] Could not resolve contact for ${cleanPhone}`);
            return res.status(500).json({
                status: 'error',
                message: `Failed to create/fetch contact for phone: ${cleanPhone}`
            });
        }

        console.log(`✅ [Frappe Webhook] Contact resolved: ${contactId} for ${customer_name} (${cleanPhone})`);

        // ── 2. Format the WhatsApp message ──
        const safeName = String(customer_name).trim();
        const safeProduct = String(product || 'N/A').trim();
        const safeStatus = String(status || 'N/A').trim();
        const safeDate = datetime ? String(datetime).trim() : new Date().toISOString().slice(0, 19).replace('T', ' ');

        let msg = `Hi ${safeName}! 👋\n\n`;

        // Customize message based on event type
        if (event === 'after_insert') {
            msg += `Your order has been placed successfully! 🎉\n`;
        } else if (event === 'on_update') {
            msg += `Your order has been updated! 📋\n`;
        } else {
            msg += `Here's your order update:\n`;
        }

        msg += `\n📦 *Order Details*\n`;
        msg += `   Product: ${safeProduct}\n`;
        msg += `   Status: ${safeStatus}\n`;
        msg += `   Date: ${safeDate}\n`;

        if (doc_name) {
            msg += `   Order ID: ${doc_name}\n`;
        }

        msg += `\nThank you for choosing us! 🙏`;

        // ── 3. Send the WhatsApp message ──
        // 1. Send template directly via Meta API to guarantee delivery
        await whatsappService.sendTemplateMessage(cleanPhone, 'hello_world', 'en_US');
        
        // 2. Log a dummy text message in the CRM UI so you know it was sent
        await whatomateService.sendMessage(contactId, '🤖 [Auto-Sent Template: hello_world]', 'outbound');

        const result = await whatomateService.sendMessage(contactId, msg, 'outbound');

        console.log(`✅ [Frappe Webhook] WhatsApp notification sent to ${safeName} (${cleanPhone})`);

        res.json({
            status: 'success',
            message: 'Contact created and notification sent',
            data: {
                contactId,
                phone: cleanPhone,
                customer_name: safeName,
                message_sent: msg,
                messageId: result?.data?.id || null
            }
        });

    } catch (err) {
        console.error('❌ [Frappe Webhook] Error:', err.message);
        res.status(500).json({ status: 'error', message: 'Webhook processing failed' });
    }
});

// ── Outbound Messaging API ────────────────────────────────────────────────────

/**
 * POST /api/send-message
 * Send any message to any customer by phone number.
 * Body: { "phone": "918825607244", "message": "Hello!" }
 */
app.post('/api/send-message', async (req, res) => {
    try {
        const { phone, message } = req.body;

        if (!phone || !message) {
            return res.status(400).json({
                status: 'error',
                message: 'Missing required fields: phone, message'
            });
        }

        // Sanitize phone (digits only)
        const cleanPhone = String(phone).replace(/\D/g, '');
        if (cleanPhone.length < 10 || cleanPhone.length > 15) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid phone number format'
            });
        }

        // Resolve or create the contact in WhatoMate CRM
        const { id: contactId } = await whatomateService.createOrFetchContact(cleanPhone, null);
        if (!contactId) {
            return res.status(404).json({
                status: 'error',
                message: `Could not resolve contact for phone: ${cleanPhone}`
            });
        }

        // Send the message
        const result = await whatomateService.sendMessage(contactId, String(message).trim(), 'outbound');

        res.json({
            status: 'success',
            message: 'Message sent successfully',
            data: { contactId, phone: cleanPhone, messageId: result?.data?.id || null }
        });
    } catch (err) {
        console.error('❌ [API] /api/send-message error:', err.message);
        res.status(500).json({ status: 'error', message: 'Failed to send message' });
    }
});

/**
 * POST /api/send-status
 * Fetch order data from the Frappe Whatomate API and send the status to a customer.
 * Body: { "phone": "918825607244", "customer_name": "PRAVEEN" }
 */
app.post('/api/send-status', async (req, res) => {
    try {
        const { phone, customer_name } = req.body;

        if (!phone || !customer_name) {
            return res.status(400).json({
                status: 'error',
                message: 'Missing required fields: phone, customer_name'
            });
        }

        // Sanitize phone
        const cleanPhone = String(phone).replace(/\D/g, '');
        if (cleanPhone.length < 10 || cleanPhone.length > 15) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid phone number format'
            });
        }

        // 1. Fetch the Frappe API config from the database
        const { Pool } = require('pg');
        const pool = new Pool({
            host: process.env.DB_HOST || '127.0.0.1',
            port: parseInt(process.env.DB_PORT || '5433', 10),
            user: process.env.POSTGRES_USER || 'whatomate',
            password: process.env.POSTGRES_PASSWORD || 'whatomate',
            database: process.env.POSTGRES_DB || 'whatomate',
            max: 2,
        });

        const ctxRes = await pool.query(`
            SELECT api_config FROM ai_contexts
            WHERE name = 'Frappe Whatomate Resource' AND is_enabled = true AND deleted_at IS NULL
            LIMIT 1
        `);
        await pool.end();

        if (ctxRes.rows.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'Frappe Whatomate Resource context not found or disabled'
            });
        }

        const apiConfig = typeof ctxRes.rows[0].api_config === 'string'
            ? JSON.parse(ctxRes.rows[0].api_config)
            : ctxRes.rows[0].api_config;

        // 2. Fetch live data from the Frappe API
        const axios = require('axios');
        const frappeRes = await axios({
            method: apiConfig.method || 'GET',
            url: apiConfig.url,
            headers: apiConfig.headers || {},
            timeout: 10000
        });

        const records = frappeRes.data?.data || [];
        if (!Array.isArray(records) || records.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'No records found in Frappe Whatomate API'
            });
        }

        // 3. Find orders for this customer (case-insensitive match)
        const searchName = String(customer_name).trim().toLowerCase();
        const customerOrders = records.filter(
            r => String(r.customer_name || '').trim().toLowerCase() === searchName
        );

        if (customerOrders.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: `No orders found for customer: ${customer_name}`,
                available_customers: [...new Set(records.map(r => r.customer_name))]
            });
        }

        // 4. Format a nice WhatsApp message
        const customerDisplayName = customerOrders[0].customer_name;
        let msg = `Hi ${customerDisplayName}! 👋\n\nHere's your order update:\n`;

        customerOrders.forEach((order, i) => {
            const orderNum = customerOrders.length > 1 ? ` ${i + 1}` : '';
            msg += `\n📦 *Order${orderNum}*\n`;
            msg += `   Product: ${order.product || 'N/A'}\n`;
            msg += `   Status: ${order.status || 'N/A'}\n`;
            if (order.datetime) {
                msg += `   Date: ${order.datetime}\n`;
            }
        });

        msg += `\nThank you for choosing us! 🙏`;

        // 5. Resolve contact and send
        const { id: contactId } = await whatomateService.createOrFetchContact(cleanPhone, customerDisplayName);
        if (!contactId) {
            return res.status(404).json({
                status: 'error',
                message: `Could not resolve contact for phone: ${cleanPhone}`
            });
        }

        const result = await whatomateService.sendMessage(contactId, msg, 'outbound');

        res.json({
            status: 'success',
            message: 'Status message sent successfully',
            data: {
                contactId,
                phone: cleanPhone,
                customer_name: customerDisplayName,
                orders_found: customerOrders.length,
                message_sent: msg,
                messageId: result?.data?.id || null
            }
        });

    } catch (err) {
        console.error('❌ [API] /api/send-status error:', err.message);
        res.status(500).json({ status: 'error', message: 'Failed to send status' });
    }
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
