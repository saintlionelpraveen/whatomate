const whatsappService = require('./whatsappService');
const openaiService = require('./openaiService');
const crmService = require('./crmService');
const whatomateService = require('./whatomateService');

const { Pool } = require('pg');
const pgPool = new Pool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5433', 10),
    user: process.env.POSTGRES_USER || 'whatomate',
    password: process.env.POSTGRES_PASSWORD || 'whatomate',
    database: process.env.POSTGRES_DB || 'whatomate',
    max: 2
});

class FlowService {
    async handleIncomingMessage(fromPhone, messageObj, user, whatomateContactId = null) {
        try {
            // Only handle text and interactive messages. Ignore statuses, images, etc.
            if (messageObj.type !== 'text' && messageObj.type !== 'interactive') {
                await whatsappService.sendTextMessage(fromPhone, "Sorry, I can only understand text messages right now. 📷❌");
                return;
            }

            let text = "";
            if (messageObj.type === 'text') {
                text = messageObj.text.body;
            } else if (messageObj.type === 'interactive') {
                text = messageObj.interactive?.button_reply?.title
                    || messageObj.interactive?.list_reply?.title
                    || '';
            }

            const lowerText = text.toLowerCase().trim();
            console.log(`📩 Received from ${fromPhone}: ${text}`);

            // 1. Save user message to CRM context
            await crmService.saveMessage(fromPhone, 'user', text);

            // ── Dynamic WhatsApp Flow Trigger ──────────────────────────────────
            try {
                if (lowerText.length > 2) {
                    const flowRes = await pgPool.query(
                        `SELECT name, meta_flow_id FROM whatsapp_flows
                         WHERE LOWER(name) LIKE $1
                           AND meta_flow_id IS NOT NULL
                           AND meta_flow_id != ''
                           AND status = 'PUBLISHED'
                           AND deleted_at IS NULL
                         LIMIT 1`,
                        [`%${lowerText}%`]
                    );
                    
                    if (flowRes.rows.length > 0) {
                        const flow = flowRes.rows[0];
                        const sent = await whatsappService.sendFlowMessage(
                            fromPhone,
                            `${flow.name} 🚀`, 
                            `Tap the button below to open ${flow.name}.`, 
                            "Powered by Idlistack", 
                            flow.meta_flow_id
                        );
                        
                        if (sent) {
                            console.log(`📞 Sent Flow "${flow.name}" to ${fromPhone}`);
                            return; // Stop processing — flow sent successfully
                        }
                        // Flow send failed (invalid flow_id, wrong WABA, etc.)
                        // Fall through to IVR / AI fallback below
                        console.warn(`⚠️ Flow "${flow.name}" (${flow.meta_flow_id}) failed to send — falling through to IVR/AI`);
                    }
                }
            } catch (dbErr) {
                console.error("❌ DB Error fetching flows:", dbErr.message);
            }
            // ───────────────────────────────────────────────────────────────────

            // 3. Fallback to AI (Google Gemini / OpenAI)
            // Fetch local history as a fallback; the AI service will prefer PG history
            console.log(`🤖 Processing text "${text}" with AI...`);
            const history = await crmService.getRecentMessages(fromPhone, 5);
            const aiReply = await openaiService.generateReply(text, history, fromPhone);

            // Send to user via WhatsApp + sync to CRM
            await this._sendAndSync(fromPhone, aiReply, whatomateContactId);

        } catch (error) {
            console.error("❌ FlowService Error:", error);
            // Send a friendly fallback message so the user never sees silence
            try {
                const fallback = "I'm sorry, something went wrong on my end. Please try again or type *Menu* for options! 🙏";
                await whatsappService.sendTextMessage(fromPhone, fallback);
                await whatomateService.sendOutgoingMessage(whatomateContactId, fallback);
            } catch (e) {
                console.error("❌ FlowService: Even fallback failed:", e.message);
            }
        }
    }

    /**
     * Send a reply to the user via WhatsApp AND sync to both CRM databases.
     * This is the single point where all outgoing messages are dispatched.
     */
    async _sendAndSync(toPhone, message, whatomateContactId) {
        // 1. Save to local SQLite CRM for conversation context
        await crmService.saveMessage(toPhone, 'bot', message);

        // 2. Send the message.
        // If WhatoMate CRM is available, sending to the CRM automatically dispatches
        // the message to WhatsApp via their API. Otherwise, send directly.
        if (whatomateContactId) {
            await whatomateService.sendOutgoingMessage(whatomateContactId, message);
        } else {
            await whatsappService.sendTextMessage(toPhone, message);
        }
    }

    async sendMenu(to, whatomateContactId = null) {
        const header = "Welcome to Dress Shop! 👗";
        const body = "Please choose an option below:";
        const footer = "Powered by Tech4Good Community";
        const buttons = [
            { id: "btn_products", title: "Products" },
            { id: "btn_pricing", title: "Pricing" },
            { id: "btn_purchase", title: "Purchase" }
        ];

        await whatsappService.sendInteractiveButtons(to, header, body, footer, buttons);
        await crmService.saveMessage(to, 'bot', 'Sent Interactive Menu');
    }

    async sendPurchaseMenu(to, whatomateContactId = null) {
        const header = "Ready to Shop? 🛍️";
        const body = "What kind of dress are you looking for today?";
        const footer = "Select a category to see options";
        const buttons = [
            { id: "cat_casual", title: "Casual Wear" },
            { id: "cat_formal", title: "Formal Wear" },
            { id: "cat_party", title: "Party Wear" }
        ];

        await whatsappService.sendInteractiveButtons(to, header, body, footer, buttons);
        await crmService.saveMessage(to, 'bot', 'Sent Purchase Menu');
        
        const reply = "I've sent you some categories to choose from! Once you select one, I'll show you our bestsellers. 👗✨";
        await whatomateService.sendOutgoingMessage(whatomateContactId, reply);
    }
}

module.exports = new FlowService();
