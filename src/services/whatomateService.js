const axios = require('axios');
const config = require('../config');
const { Pool } = require('pg');

const pgPool = new Pool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5433', 10),
    user: process.env.POSTGRES_USER || 'whatomate',
    password: process.env.POSTGRES_PASSWORD || 'whatomate',
    database: process.env.POSTGRES_DB || 'whatomate',
});

class WhatomateService {
    constructor() {
        this.apiUrl = config.WHATOMATE_API_URL;
        this.headers = {
            'Content-Type': 'application/json',
            'Authorization': config.WHATOMATE_API_KEY,
            'X-API-Key': config.WHATOMATE_API_KEY
        };
    }

    _extractContactId(data) {
        if (data?.data?.id) return data.data.id;
        if (data?.data?.contacts?.[0]?.id) return data.data.contacts[0].id;
        if (Array.isArray(data?.data) && data.data[0]?.id) return data.data[0].id;
        if (data?.id) return data.id;
        return null;
    }

    async _fetchContactByPhone(phone) {
        try {
            const url = `${this.apiUrl}/contacts?phone_number=${phone}`;
            const fetchRes = await axios.get(url, { headers: this.headers });
            const contactId = this._extractContactId(fetchRes.data);
            if (!contactId) {
                console.error(`[WhatoMate] Contact ID not found in GET response for ${phone}`);
                return null;
            }
            return contactId;
        } catch (error) {
            console.error(`[WhatoMate] Failed to fetch contact for ${phone}:`, error.message);
            return null;
        }
    }

    async createOrFetchContact(phone, name) {
        if (!this.apiUrl || !config.WHATOMATE_API_KEY) {
            console.warn('[WhatoMate] API config missing. Skipping contact sync.');
            return { id: null, isNew: false };
        }

        const url = `${this.apiUrl}/contacts`;
        const payload = { phone_number: phone, name: name || 'User' };

        try {
            const response = await axios.post(url, payload, { headers: this.headers });
            const contactId = this._extractContactId(response.data);
            if (contactId) return { id: contactId, isNew: true };
            throw new Error('Contact ID missing in create response');
        } catch (error) {
            const errData = error.response?.data || error.message;
            const errMsg = (typeof errData === 'object' ? errData?.message : errData) || '';
            const isConflict =
                error.response?.status === 409 ||
                errMsg.toLowerCase().includes('already exists') ||
                errMsg.toLowerCase().includes('duplicate');

            if (isConflict) {
                const fetchedId = await this._fetchContactByPhone(phone);
                return { id: fetchedId, isNew: false };
            }
            console.error(`[WhatoMate] Error creating contact:`, JSON.stringify(errData));
            return { id: null, isNew: false };
        }
    }

    /**
     * Send a message to WhatoMate CRM.
     * Correct payload format (verified against live API):
     * {
     *   whatsapp_account: "WhatoMate Bot",   <-- MUST match exactly what WhatoMate has stored
     *   type: "text",
     *   content: { body: "plain string" }
     * }
     *
     * @param {string} contactId  - WhatoMate contact UUID
     * @param {string} content    - Plain text message string
     * @param {string} direction  - "inbound" | "outbound" (informational, API ignores it)
     */
    async sendMessage(contactId, content, direction = 'outbound') {
        if (!contactId) {
            console.error(`[WhatoMate] ❌ Cannot send message: Missing contactId`);
            return null;
        }

        const safeContent = String(content || '[No text]').trim();
        if (!safeContent) {
            console.error(`[WhatoMate] ❌ Cannot send message: content is empty`);
            return null;
        }

        const url = `${this.apiUrl}/contacts/${contactId}/messages`;
        const payload = {
            whatsapp_account: config.WHATSAPP_ACCOUNT_NAME,  // must match CRM exactly
            type: 'text',
            content: { body: safeContent }
        };

        // === DEBUG LOGGING ===
        console.log(`\n🚀 [WhatoMate] Sending message [${direction}] to contactId: ${contactId}`);
        console.log(`   URL    : ${url}`);
        console.log(`   payload: ${JSON.stringify(payload)}`);
        console.log(`   typeof content.body: ${typeof payload.content.body}`);

        try {
            const response = await axios.post(url, payload, { headers: this.headers });
            console.log(`✅ [WhatoMate] Sync success [${direction}]:`, JSON.stringify(response.data));
            return response.data;
        } catch (error) {
            console.error(`❌ [WhatoMate] Sync Error [${direction}]:`, JSON.stringify(error.response?.data || error.message));
            console.error(`   Sent payload was: ${JSON.stringify(payload)}`);
            return null;
        }
    }

    async sendTemplateMessage(contactId, templateName, languageCode = 'en_US') {
        if (!contactId) {
            console.error(`[WhatoMate] ❌ Cannot send template: Missing contactId`);
            return null;
        }

        const url = `${this.apiUrl}/contacts/${contactId}/messages`;
        const payload = {
            whatsapp_account: config.WHATSAPP_ACCOUNT_NAME,
            type: 'template',
            template: {
                name: templateName,
                language: { code: languageCode }
            }
        };

        try {
            const response = await axios.post(url, payload, { headers: this.headers });
            console.log(`✅ [WhatoMate] Template Sync success:`, JSON.stringify(response.data));
            return response.data;
        } catch (error) {
            console.error(`❌ [WhatoMate] Template Sync Error:`, JSON.stringify(error.response?.data || error.message));
            return null;
        }
    }

    async forwardRawWebhook(rawBody, originalHeaders = {}) {
        if (!this.apiUrl || !rawBody) return;
        
        const url = `${this.apiUrl}/webhook`;
        
        try {
            console.log(`[WhatoMate] Forwarding raw inbound webhook to CRM at ${url}...`);
            const headers = { 'Content-Type': 'application/json' };
            
            if (originalHeaders['x-hub-signature-256']) {
                headers['x-hub-signature-256'] = originalHeaders['x-hub-signature-256'];
            }
            if (originalHeaders['x-hub-signature']) {
                headers['x-hub-signature'] = originalHeaders['x-hub-signature'];
            }

            await axios.post(url, rawBody, { headers });
            console.log(`[WhatoMate] ✅ Successfully forwarded inbound webhook.`);
        } catch (error) {
            console.error(`[WhatoMate] ❌ Failed to forward webhook:`, JSON.stringify(error.response?.data || error.message));
        }
    }

    async forwardWebhook(body, originalHeaders = {}) {
        if (!this.apiUrl) return;
        
        const url = `${this.apiUrl}/webhook`;
        
        try {
            console.log(`[WhatoMate] Forwarding raw inbound webhook to CRM at ${url}...`);
            const headers = { 'Content-Type': 'application/json' };
            
            if (originalHeaders['x-hub-signature-256']) {
                headers['x-hub-signature-256'] = originalHeaders['x-hub-signature-256'];
            }
            if (originalHeaders['x-hub-signature']) {
                headers['x-hub-signature'] = originalHeaders['x-hub-signature'];
            }

            await axios.post(url, body, { headers });
            console.log(`[WhatoMate] ✅ Successfully forwarded inbound webhook.`);
        } catch (error) {
            console.error(`[WhatoMate] ❌ Failed to forward webhook:`, JSON.stringify(error.response?.data || error.message));
        }
    }

    async syncIncoming(phone, name, textContent, webhookBody, originalHeaders = {}) {
        try {
            // NOTE: We intentionally do NOT forward the raw webhook to the CRM here.
            // Forwarding causes the CRM to process the message and send its own auto-reply,
            // resulting in duplicate messages to the user. The CRM is only used to:
            //   1. Resolve/create the contact
            //   2. Log outbound messages (handled by sendOutgoingMessage)
            // Status updates and call events are forwarded separately in webhookController.

            // Ensure the contact exists for outbound replies
            const { id: contactId } = await this.createOrFetchContact(phone, name);
            if (!contactId) {
                console.error(`[WhatoMate] Could not resolve contact ID for ${phone}`);
                return null;
            }

            console.log(`[WhatoMate] ✅ Contact resolved: ${contactId} for ${phone}`);
            return contactId;
        } catch (error) {
            console.error(`[WhatoMate] ❌ Incoming Sync Failed:`, error.message);
            return null;
        }
    }

    async sendOutgoingMessage(contactId, message) {
        try {
            if (!message) {
                console.warn('[WhatoMate] sendOutgoingMessage called with empty message — skipping.');
                return false;
            }
            const res = await this.sendMessage(contactId, message, 'outbound');
            return !!res;
        } catch (error) {
            console.error(`[WhatoMate] ❌ Outgoing Sync Failed:`, error.message);
            return false;
        }
    }

    async logMessageDirectlyToDB(phone, messageText, direction = 'outbound') {
        try {
            // Find contact
            const contactRes = await pgPool.query('SELECT id, organization_id FROM contacts WHERE phone_number = $1 LIMIT 1', [phone]);
            if (contactRes.rows.length === 0) {
                console.warn(`[WhatoMate] ⚠️ Cannot log message to DB: Contact not found for ${phone}`);
                return;
            }
            const contact = contactRes.rows[0];
            
            const crypto = require('crypto');
            const msgId = crypto.randomUUID();
            const now = new Date();
            
            await pgPool.query(`
                INSERT INTO messages (
                    id, created_at, updated_at, organization_id, contact_id, 
                    direction, message_type, content, status, whats_app_account
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            `, [
                msgId, now, now, contact.organization_id, contact.id,
                direction, 'text', messageText, 'delivered', config.WHATSAPP_ACCOUNT_NAME || 'WhatoMate Bot'
            ]);
            console.log(`[WhatoMate] ✅ Successfully logged message directly to DB for ${phone}`);
        } catch (e) {
            console.error(`[WhatoMate] ❌ Failed to log directly to DB:`, e.message);
        }
    }

    /**
     * Send a media message via WhatoMate CRM to sync it as an outbound message.
     * @param {string} contactId - WhatoMate contact UUID
     * @param {string} mediaType - 'image', 'video', 'document', or 'audio'
     * @param {string} mediaUrl - The publicly accessible URL
     * @param {string} caption - Optional caption
     */
    async sendMediaMessage(contactId, mediaType, mediaUrl, caption = '') {
        if (!contactId) {
            console.error(`[WhatoMate] ❌ Cannot send media: Missing contactId`);
            return null;
        }
        if (!mediaUrl) {
            console.error(`[WhatoMate] ❌ Cannot send media: Missing mediaUrl`);
            return null;
        }

        const url = `${this.apiUrl}/contacts/${contactId}/messages`;
        
        // Construct the payload. Depending on WhatoMate CRM's API, it might support natively
        // the media type. If not, we fallback to sending a text message containing the link.
        // Assuming the CRM accepts identical structure to WhatsApp Cloud API or at least the type.
        const payload = {
            whatsapp_account: config.WHATSAPP_ACCOUNT_NAME,
            type: mediaType,
            content: { link: mediaUrl, caption: caption }
        };

        console.log(`\n🚀 [WhatoMate] Sending media message [outbound] to contactId: ${contactId}`);
        
        try {
            const response = await axios.post(url, payload, { headers: this.headers });
            console.log(`✅ [WhatoMate] Media Sync success:`, JSON.stringify(response.data));
            return response.data;
        } catch (error) {
            console.error(`❌ [WhatoMate] Media Sync Error:`, JSON.stringify(error.response?.data || error.message));
            
            // Fallback: If CRM doesn't support the specific media type yet, log it as text
            if (error.response?.status === 400) {
                console.warn(`[WhatoMate] ⚠️ Falling back to text sync for media message...`);
                let fallbackText = `[${mediaType.toUpperCase()} SENT]\nLink: ${mediaUrl}`;
                if (caption) fallbackText += `\nCaption: ${caption}`;
                return this.sendMessage(contactId, fallbackText, 'outbound');
            }
            
            return null;
        }
    }
}

module.exports = new WhatomateService();
