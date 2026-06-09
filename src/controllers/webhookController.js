const crypto = require('crypto');
const config = require('../config');
const flowService = require('../services/flowService');
const crmService = require('../services/crmService');
const whatomateService = require('../services/whatomateService');

// ── Message deduplication ────────────────────────────────────────────────────
// Track recently processed message IDs to prevent duplicate processing
// (Meta sometimes sends the same webhook multiple times)
const processedMessages = new Map();
const DEDUP_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Clean up old entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, timestamp] of processedMessages) {
        if (now - timestamp > DEDUP_TTL_MS) {
            processedMessages.delete(key);
        }
    }
}, DEDUP_TTL_MS);

/**
 * Verify webhook signature from Meta using HMAC-SHA256.
 * If APP_SECRET is not configured, skip verification (with warning).
 */
function verifySignature(req) {
    const appSecret = process.env.APP_SECRET;
    if (!appSecret) {
        // TODO(security): App Secret should be configured in production
        // for webhook signature verification
        return true;
    }

    const signature = req.headers['x-hub-signature-256'];
    if (!signature) {
        console.warn('⚠️ [Webhook] Missing X-Hub-Signature-256 header');
        return false;
    }

    const expectedSignature = 'sha256=' + crypto
        .createHmac('sha256', appSecret)
        .update(JSON.stringify(req.body))
        .digest('hex');

    return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
    );
}

exports.verifyWebhook = (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === config.WHATSAPP_VERIFY_TOKEN) {
            console.log('✅ Webhook verified by Meta!');
            return res.status(200).send(challenge);
        } else {
            return res.sendStatus(403);
        }
    }
    return res.status(400).send('Bad Request');
};

exports.processMessage = async (req, res) => {
    // Always return 200 first so Meta never retries
    res.status(200).send('OK');

    try {
        // Verify webhook signature if APP_SECRET is configured
        if (!verifySignature(req)) {
            console.error('❌ [Webhook] Invalid signature — rejecting payload');
            return;
        }

        const body = req.body;

        if (body.object !== 'whatsapp_business_account') return;

        const entry   = body.entry?.[0];
        const changes = entry?.changes?.[0];
        const value   = changes?.value;

        // Skip status updates (delivery receipts, read receipts)
        if (value?.statuses?.length) return;

        // ── Forward WebRTC calls to Go backend ──
        const field = changes?.field;

        // Meta recently renamed `webrtc` to `calls`. The Go backend expects `webrtc`.
        if (field === 'calls' || value?.calls) {
            console.log(`\n[Webhook] 📞 Translating Meta 'calls' event to 'webrtc' format...`);
            
            const translatedBody = JSON.parse(JSON.stringify(body));
            const change = translatedBody.entry[0].changes[0];
            
            if (change.field === 'calls') change.field = 'webrtc';
            if (change.value.calls) {
                change.value.webrtc = change.value.calls;
                delete change.value.calls;
            }

            const translatedRawBody = Buffer.from(JSON.stringify(translatedBody));
            
            // Re-sign or strip signature to avoid HMAC failure on the modified payload
            if (process.env.APP_SECRET) {
                const crypto = require('crypto');
                const newSig = 'sha256=' + crypto.createHmac('sha256', process.env.APP_SECRET).update(translatedRawBody).digest('hex');
                req.headers['x-hub-signature-256'] = newSig;
            } else {
                delete req.headers['x-hub-signature-256'];
                delete req.headers['x-hub-signature'];
            }

            await whatomateService.forwardRawWebhook(translatedRawBody, req.headers);
            return;
        }

        // Fallback for legacy format
        if (field === 'webrtc' || field === 'call' || value?.webrtc || value?.call) {
            console.log(`\n[Webhook] 📞 Received Legacy Call event (field: ${field})! Forwarding raw bytes...`);
            await whatomateService.forwardRawWebhook(req.rawBody, req.headers);
            return;
        }

        const message = value?.messages?.[0];
        const contact = value?.contacts?.[0];

        if (!message) return;

        // ── Deduplication: skip if we've already processed this message ──────
        const messageId = message.id;
        if (messageId && processedMessages.has(messageId)) {
            console.log(`⏭️ [Webhook] Duplicate message ${messageId} — skipping`);
            return;
        }
        if (messageId) {
            processedMessages.set(messageId, Date.now());
        }

        const fromPhone   = message.from;
        const contactName = contact?.profile?.name || 'User';

        // ── Extract text from all supported message types ──────────────────
        let textContent = '';
        if (message.type === 'text') {
            textContent = message.text?.body || '';
        } else if (message.type === 'interactive') {
            textContent =
                message.interactive?.button_reply?.title ||
                message.interactive?.list_reply?.title  ||
                '';
        } else {
            textContent = `[Received ${message.type} message]`;
        }

        console.log(`\n[Webhook] Incoming message from ${fromPhone}: "${textContent}"`);

        // 1. Local SQLite Sync
        let user = await crmService.getUser(fromPhone);
        if (!user) {
            await crmService.createUser(fromPhone, contactName);
            user = await crmService.getUser(fromPhone);
        }

        // 2. WhatoMate Sync — forward raw webhook + resolve contact ID
        const whatomateContactId = await whatomateService.syncIncoming(
            fromPhone, contactName, textContent, body, req.headers
        );

        if (!whatomateContactId) {
            console.warn(`[Webhook] ⚠️  whatomateContactId is null for ${fromPhone}. Outbound syncs will be skipped.`);
        }

        // 3. Process chatbot flow & send bot reply
        await flowService.handleIncomingMessage(fromPhone, message, user, whatomateContactId);

    } catch (error) {
        console.error('❌ Error processing webhook:', error);
        // 200 already sent above — no action needed
    }
};
