'use strict';

require('dotenv').config();

const express = require('express');
const config = require('./config');

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
// NOTE: Only one webhook route is registered to prevent duplicate processing.
// Make sure your Meta webhook URL in the App Dashboard points to: https://<your-domain>/api/webhook

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

/**
 * POST /api/broadcast-flow
 * Trigger a chatbot flow for all contacts matching a specific gender.
 * Body: { "flow_id": "uuid", "target_gender": "Female" }
 */
app.post('/api/broadcast-flow', async (req, res) => {
    try {
        const { flow_id, target_gender } = req.body;

        if (!flow_id || !target_gender) {
            return res.status(400).json({
                status: 'error',
                message: 'Missing required fields: flow_id, target_gender'
            });
        }

        const { Pool } = require('pg');
        const pool = new Pool({
            host: process.env.DB_HOST || '127.0.0.1',
            port: parseInt(process.env.DB_PORT || '5433', 10),
            user: process.env.POSTGRES_USER || 'whatomate',
            password: process.env.POSTGRES_PASSWORD || 'whatomate',
            database: process.env.POSTGRES_DB || 'whatomate',
            max: 2,
        });

        // Verify the flow exists
        const flowRes = await pool.query(
            `SELECT * FROM chatbot_flows WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
            [flow_id]
        );

        if (flowRes.rows.length === 0) {
            await pool.end();
            return res.status(404).json({
                status: 'error',
                message: `Flow not found with id: ${flow_id}`
            });
        }

        const flow = flowRes.rows[0];

        // Get contacts with the target gender
        const contactsRes = await pool.query(
            `SELECT id, phone_number, organization_id FROM contacts WHERE gender = $1 AND deleted_at IS NULL`,
            [target_gender]
        );

        await pool.end();

        const contacts = contactsRes.rows;
        if (contacts.length === 0) {
            return res.json({
                status: 'success',
                message: `No contacts found for gender: ${target_gender}`,
                count: 0
            });
        }

        // Trigger broadcast via flowService in the background
        const flowService = require('./services/flowService');
        flowService.startBroadcast(contacts, flow).catch(err => {
            console.error('❌ Broadcast Error:', err);
        });

        res.json({
            status: 'success',
            message: `Broadcast started for ${contacts.length} ${target_gender}(s)`,
            count: contacts.length
        });

    } catch (err) {
        console.error('❌ [API] /api/broadcast-flow error:', err.message);
        res.status(500).json({ status: 'error', message: 'Failed to start broadcast' });
    }
});


// ── Flow Submissions Visual Dashboard ─────────────────────────────────────────

// Helper to get Postgres Pool
function getDbPool() {
    const { Pool } = require('pg');
    return new Pool({
        host: process.env.DB_HOST || '127.0.0.1',
        port: parseInt(process.env.DB_PORT || '5433', 10),
        user: process.env.POSTGRES_USER || 'whatomate',
        password: process.env.POSTGRES_PASSWORD || 'whatomate',
        database: process.env.POSTGRES_DB || 'whatomate',
        max: 2,
    });
}

// ── JSON API for Flow Submissions (used by Vue frontend) ─────────────────────

// List all flows with submission counts
app.get('/api/flow-submissions', async (req, res) => {
    try {
        const pool = getDbPool();
        const flowsRes = await pool.query(`
            SELECT f.id, f.name, f.status, COUNT(s.id) as submission_count 
            FROM whatsapp_flows f
            LEFT JOIN whatsapp_flow_submissions s ON f.id = s.flow_id
            WHERE f.deleted_at IS NULL
            GROUP BY f.id, f.name, f.status
            ORDER BY f.created_at DESC
        `);
        await pool.end();

        res.json({
            status: 'success',
            data: flowsRes.rows.map(f => ({
                id: f.id,
                name: f.name,
                status: f.status,
                submission_count: parseInt(f.submission_count, 10)
            }))
        });
    } catch (err) {
        console.error('❌ [API] /api/flow-submissions error:', err.message);
        res.status(500).json({ status: 'error', message: 'Failed to fetch flows' });
    }
});

// Get submissions for a specific flow
app.get('/api/flow-submissions/:flowId', async (req, res) => {
    try {
        const flowId = req.params.flowId;
        const pool = getDbPool();

        // Fetch flow info
        const flowRes = await pool.query(
            `SELECT name, status FROM whatsapp_flows WHERE id = $1 LIMIT 1`,
            [flowId]
        );
        if (flowRes.rows.length === 0) {
            await pool.end();
            return res.status(404).json({ status: 'error', message: 'Flow not found' });
        }

        // Fetch all submissions for this flow
        const result = await pool.query(
            `SELECT id, phone_number, response_data, created_at 
             FROM whatsapp_flow_submissions 
             WHERE flow_id = $1 
             ORDER BY created_at DESC`,
            [flowId]
        );
        await pool.end();

        res.json({
            status: 'success',
            data: {
                flow: {
                    id: flowId,
                    name: flowRes.rows[0].name,
                    status: flowRes.rows[0].status
                },
                submissions: result.rows.map(row => ({
                    id: row.id,
                    phone_number: row.phone_number,
                    response_data: row.response_data || {},
                    created_at: row.created_at
                })),
                total: result.rows.length
            }
        });
    } catch (err) {
        console.error('❌ [API] /api/flow-submissions/:flowId error:', err.message);
        res.status(500).json({ status: 'error', message: 'Failed to fetch submissions' });
    }
});

// 1. Home Page: List all Flows
app.get('/submissions', async (req, res) => {
    try {
        const pool = getDbPool();
        const flowsRes = await pool.query(`
            SELECT f.id, f.name, f.status, COUNT(s.id) as submission_count 
            FROM whatsapp_flows f
            LEFT JOIN whatsapp_flow_submissions s ON f.id = s.flow_id
            WHERE f.deleted_at IS NULL
            GROUP BY f.id, f.name, f.status
            ORDER BY f.created_at DESC
        `);
        await pool.end();

        let cardsHtml = '';
        if (flowsRes.rows.length === 0) {
            cardsHtml = '<p style="color: #6b7280; text-align: center; padding: 40px;">No WhatsApp Flows created yet.</p>';
        } else {
            flowsRes.rows.forEach(flow => {
                const statusColor = flow.status === 'PUBLISHED' ? '#059669' : '#d97706';
                const statusBg = flow.status === 'PUBLISHED' ? '#dcfce7' : '#fef3c7';
                const safeName = String(flow.name || 'Unnamed Flow').replace(/["']/g, '');

                cardsHtml += `
                    <a href="/submissions/${flow.id}" style="display: flex; flex-direction: column; justify-content: space-between; min-height: 160px; background: white; border: 1px solid #e5e7eb; border-radius: 16px; padding: 28px; text-decoration: none; color: inherit; transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: 0 1px 3px rgba(0,0,0,0.05);" onmouseover="this.style.borderColor='#10b981'; this.style.boxShadow='0 10px 15px -3px rgba(16, 185, 129, 0.1), 0 4px 6px -2px rgba(16, 185, 129, 0.05)'; this.style.transform='translateY(-2px)';" onmouseout="this.style.borderColor='#e5e7eb'; this.style.boxShadow='0 1px 3px rgba(0,0,0,0.05)'; this.style.transform='none';">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; gap: 16px;">
                            <h3 style="margin: 0; font-size: 20px; color: #111827; font-weight: 600; line-height: 1.4; word-break: break-word;">${safeName}</h3>
                            <span style="background-color: ${statusBg}; color: ${statusColor}; padding: 6px 14px; border-radius: 9999px; font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; flex-shrink: 0;">${flow.status}</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 10px; color: #6b7280; font-size: 15px; font-weight: 500; background-color: #f9fafb; padding: 12px 16px; border-radius: 10px; border: 1px solid #f3f4f6;">
                            <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" style="color: #9ca3af;"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                            <span style="color: #4b5563;"><strong>${flow.submission_count}</strong> Total Submissions</span>
                        </div>
                    </a>
                `;
            });
        }

        const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Flows | WhatoMate</title>
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
            <style>
                body { font-family: 'Inter', sans-serif; background-color: #f3f4f6; margin: 0; padding: 0; }
                .header { background-color: #ffffff; border-bottom: 1px solid #e5e7eb; padding: 24px 48px; box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05); }
                .header h1 { margin: 0; font-size: 24px; color: #111827; }
                .container { padding: 48px; max-width: 1280px; margin: 0 auto; }
                .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 32px; }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>WhatsApp Flows Dashboard</h1>
            </div>
            <div class="container">
                <div style="margin-bottom: 32px; color: #4b5563; font-size: 16px;">Select a flow below to view its submissions:</div>
                <div class="grid">
                    ${cardsHtml}
                </div>
            </div>
            <script>
                // Seamlessly live-update the dashboard every 3 seconds
                setInterval(() => {
                    fetch(window.location.href)
                        .then(res => res.text())
                        .then(html => {
                            const parser = new DOMParser();
                            const doc = parser.parseFromString(html, 'text/html');
                            const newGrid = doc.querySelector('.grid');
                            if (newGrid) {
                                document.querySelector('.grid').innerHTML = newGrid.innerHTML;
                            }
                        })
                        .catch(err => console.error('Live update failed:', err));
                }, 3000);
            </script>
        </body>
        </html>
        `;
        res.status(200).send(html);
    } catch (err) {
        console.error('❌ [API] /submissions error:', err.message);
        res.status(500).send('Internal Server Error.');
    }
});

// 2. Detail Page: Show Submissions for a Specific Flow
app.get('/submissions/:flowId', async (req, res) => {
    try {
        const flowId = req.params.flowId;
        const pool = getDbPool();

        // Fetch Flow Info
        const flowRes = await pool.query(`SELECT name FROM whatsapp_flows WHERE id = $1 LIMIT 1`, [flowId]);
        if (flowRes.rows.length === 0) {
            await pool.end();
            return res.status(404).send('Flow not found.');
        }
        const flowName = flowRes.rows[0].name;

        // Fetch Submissions
        const result = await pool.query(`SELECT id, phone_number, response_data, created_at FROM whatsapp_flow_submissions WHERE flow_id = $1 ORDER BY created_at DESC`, [flowId]);
        await pool.end();

        let rowsHtml = '';
        if (result.rows.length === 0) {
            rowsHtml = `<tr><td colspan="4" style="text-align: center; padding: 4rem; color: #6b7280; font-size: 15px;">No submissions found for "${flowName}" yet.</td></tr>`;
        } else {
            result.rows.forEach(row => {
                const date = new Date(row.created_at).toLocaleString(undefined, {
                    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
                });

                let formattedDataHtml = '<div style="display: flex; flex-direction: column; gap: 12px;">';
                const excludeKeys = ['flow_token'];
                const dataObj = row.response_data || {};

                for (const [key, val] of Object.entries(dataObj)) {
                    if (excludeKeys.includes(key)) continue;
                    const displayKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                    if (Array.isArray(val)) {
                        const pills = val.map(v => `<span style="background-color: #e0e7ff; color: #4338ca; padding: 4px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600; display: inline-block; margin-right: 6px; margin-bottom: 6px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">${String(v).replace(/_/g, ' ')}</span>`).join('');
                        formattedDataHtml += `<div style="font-size: 14px;"><strong style="color: #374151; display: block; margin-bottom: 6px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em;">${displayKey}</strong><div>${pills || '<span style="color: #9ca3af; font-style: italic; font-size: 13px;">None selected</span>'}</div></div>`;
                    } else {
                        const pill = `<span style="background-color: #dcfce7; color: #166534; padding: 4px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600; display: inline-block; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">${String(val).replace(/_/g, ' ')}</span>`;
                        formattedDataHtml += `<div style="font-size: 14px; display: flex; align-items: center; gap: 10px;"><strong style="color: #374151; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em;">${displayKey}:</strong> ${pill}</div>`;
                    }
                }
                formattedDataHtml += '</div>';

                rowsHtml += `
                    <tr style="transition: background-color 0.15s ease;">
                        <td style="padding: 24px; border-bottom: 1px solid #e5e7eb; color: #111827; font-weight: 600; font-size: 15px;">${row.phone_number}</td>
                        <td style="padding: 24px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">${date}</td>
                        <td style="padding: 24px; border-bottom: 1px solid #e5e7eb;">
                            <div style="background: #f9fafb; border: 1px solid #f3f4f6; border-radius: 8px; padding: 16px;">
                                ${formattedDataHtml}
                            </div>
                        </td>
                        <td style="padding: 24px; border-bottom: 1px solid #e5e7eb; color: #9ca3af; font-family: monospace; font-size: 11px;">${row.id}</td>
                    </tr>
                `;
            });
        }

        const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${flowName} Submissions | WhatoMate</title>
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
            <style>
                body { font-family: 'Inter', sans-serif; background-color: #f9fafb; margin: 0; padding: 0; }
                .header { background-color: #ffffff; border-bottom: 1px solid #e5e7eb; padding: 20px 48px; display: flex; justify-content: space-between; align-items: center; }
                .header h1 { margin: 0; font-size: 20px; color: #111827; display: flex; align-items: center; gap: 12px; }
                .back-btn { color: #6b7280; text-decoration: none; display: flex; align-items: center; transition: color 0.2s; }
                .back-btn:hover { color: #111827; }
                .refresh-btn { background-color: #10b981; color: white; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-weight: 500; font-size: 14px; transition: background-color 0.2s; }
                .refresh-btn:hover { background-color: #059669; }
                .container { padding: 40px 48px; max-width: 1200px; margin: 0 auto; }
                table { width: 100%; background: white; border-radius: 12px; overflow: hidden; border-collapse: collapse; box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06); }
                th { background-color: #f3f4f6; padding: 16px 24px; text-align: left; font-size: 12px; font-weight: 600; color: #374151; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #e5e7eb; }
                tbody tr:hover { background-color: #f9fafb; }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>
                    <a href="/submissions" class="back-btn" title="Back to Flows">
                        <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"></path></svg>
                    </a>
                    ${flowName} Submissions
                </h1>
                <a href="/submissions/${flowId}" class="refresh-btn">Refresh Data</a>
            </div>
            <div class="container">
                <table>
                    <thead>
                        <tr>
                            <th style="width: 15%">Phone Number</th>
                            <th style="width: 15%">Submitted At</th>
                            <th style="width: 55%">Form Response Data</th>
                            <th style="width: 15%">Submission ID</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>
            </div>
            <script>
                // Seamlessly live-update the table every 3 seconds
                setInterval(() => {
                    fetch(window.location.href)
                        .then(res => res.text())
                        .then(html => {
                            const parser = new DOMParser();
                            const doc = parser.parseFromString(html, 'text/html');
                            const newTbody = doc.querySelector('tbody');
                            if (newTbody) {
                                document.querySelector('tbody').innerHTML = newTbody.innerHTML;
                            }
                        })
                        .catch(err => console.error('Live update failed:', err));
                }, 3000);
            </script>
        </body>
        </html>
        `;
        res.status(200).send(html);
    } catch (err) {
        console.error('❌ [API] /submissions/:flowId error:', err.message);
        res.status(500).send('Internal Server Error while loading flow submissions.');
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
