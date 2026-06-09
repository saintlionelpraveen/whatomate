const axios = require('axios');
const config = require('../config');

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
            // Forward the raw webhook to the CRM to handle inbound messaging natively
            if (webhookBody) {
                await this.forwardWebhook(webhookBody, originalHeaders);
            }

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
                return;
            }
            await this.sendMessage(contactId, message, 'outbound');
        } catch (error) {
            console.error(`[WhatoMate] ❌ Outgoing Sync Failed:`, error.message);
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
