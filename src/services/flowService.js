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
            // Only handle text, interactive, and button (template quick reply) messages.
            if (messageObj.type !== 'text' && messageObj.type !== 'interactive' && messageObj.type !== 'button') {
                await whatsappService.sendTextMessage(fromPhone, "Sorry, I can only understand text messages right now. 📷❌");
                return;
            }

            let text = "";
            let interactiveId = "";
            if (messageObj.type === 'text') {
                text = messageObj.text.body;
            } else if (messageObj.type === 'interactive') {
                text = messageObj.interactive?.button_reply?.title
                    || messageObj.interactive?.list_reply?.title
                    || '';
                interactiveId = messageObj.interactive?.button_reply?.id
                    || messageObj.interactive?.list_reply?.id
                    || '';
            } else if (messageObj.type === 'button') {
                // Template Quick Reply buttons — use text or payload
                text = messageObj.button?.text || messageObj.button?.payload || '';
            }

            const lowerText = text.toLowerCase().trim();
            console.log(`📩 Received from ${fromPhone}: ${text} (id: ${interactiveId})`);

            // 1. Save user message to CRM context
            await crmService.saveMessage(fromPhone, 'user', text);

            // ── Dynamic Keyword Rules Processing ───────────────────────────────
            try {
                // Fetch all active keyword rules ordered by priority
                const rulesRes = await pgPool.query(
                    `SELECT * FROM keyword_rules
                     WHERE is_enabled = true
                       AND deleted_at IS NULL
                     ORDER BY priority DESC`
                );

                for (const rule of rulesRes.rows) {
                    const keywords = rule.keywords || [];
                    const matchType = rule.match_type || 'contains';
                    const caseSensitive = rule.case_sensitive || false;

                    const textToMatch = caseSensitive ? text : lowerText;
                    let isMatch = false;

                    for (const kw of keywords) {
                        const kwMatch = caseSensitive ? kw : kw.toLowerCase();
                        if (matchType === 'exact') {
                            if (textToMatch === kwMatch || interactiveId === kwMatch) {
                                isMatch = true;
                                break;
                            }
                        } else { // contains
                            if (textToMatch.includes(kwMatch) || interactiveId.includes(kwMatch)) {
                                isMatch = true;
                                break;
                            }
                        }
                    }

                    if (isMatch) {
                        console.log(`🎯 [Keyword Rule] Matched rule "${rule.name}" for ${fromPhone}`);
                        await this._executeKeywordRule(fromPhone, rule, whatomateContactId);
                        return; // Stop processing, rule handled it
                    }
                }
            } catch (dbErr) {
                console.error("❌ DB Error fetching keyword rules:", dbErr.message);
            }
            // ──────────────────────────────────────────────────────────────────────

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
            const history = await crmService.getRecentMessages(fromPhone, 40);
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
     * Executes a keyword rule's response based on its response_type.
     */
    async _executeKeywordRule(toPhone, rule, whatomateContactId) {
        // The WhatoMate frontend might save everything as response_type: 'text'
        // We will infer the actual WhatsApp type based on the JSON payload structure.
        const type = rule.response_type;
        let content = rule.response_content || {};

        // If the user pasted raw JSON into the text box, the frontend wraps it as a string inside "body"
        if (typeof content.body === 'string' && content.body.trim().startsWith('{') && content.body.trim().endsWith('}')) {
            try {
                const parsedBody = JSON.parse(content.body);
                // Merge the parsed JSON into the main content object
                content = { ...content, ...parsedBody };
            } catch (e) {
                // Not valid JSON, ignore and treat as normal text
                console.log("Not a valid JSON string in body, treating as text.");
            }
        }

        if (content.sections && Array.isArray(content.sections) && content.sections.length > 0) {
            // Raw JSON injection for Interactive List
            await whatsappService.sendInteractiveList(
                toPhone,
                content.header || '',
                content.body || '',
                content.footer || '',
                content.button_text || 'Menu',
                content.sections
            );
            await crmService.saveMessage(toPhone, 'bot', `[Interactive List] ${content.body}`);
        } else if (content.url) {
            // Raw JSON injection for CTA URL
            await whatsappService.sendCTAUrlButton(
                toPhone,
                content.header || '',
                content.body || '',
                content.footer || '',
                content.button_text || 'Visit',
                content.url
            );
            await crmService.saveMessage(toPhone, 'bot', `[CTA URL] ${content.body}`);
        } else if (content.buttons && Array.isArray(content.buttons) && content.buttons.length > 0) {
            
            if (content.buttons.length <= 3) {
                // Interactive Buttons (Quick Replies)
                await whatsappService.sendInteractiveButtons(
                    toPhone,
                    content.header || '',
                    content.body || '',
                    content.footer || '',
                    content.buttons
                );
                await crmService.saveMessage(toPhone, 'bot', `[Interactive Buttons] ${content.body}`);
            } else {
                // The WhatoMate frontend allows >3 buttons, but WhatsApp requires >3 to be an Interactive List.
                // We will dynamically convert the buttons array into a List format.
                const listSections = [
                    {
                        title: "Options",
                        rows: content.buttons.map(btn => ({
                            id: btn.id,
                            title: btn.title,
                            description: "" 
                        }))
                    }
                ];
                await whatsappService.sendInteractiveList(
                    toPhone,
                    content.header || '',
                    content.body || '',
                    content.footer || '',
                    'Menu', // default list button text
                    listSections
                );
                await crmService.saveMessage(toPhone, 'bot', `[Interactive List] ${content.body}`);
            }
            
        } else if (type === 'transfer') {
            // Transfer to agent logic
            await whatsappService.sendTextMessage(toPhone, content.body || 'Transferring to agent...');
            await crmService.saveMessage(toPhone, 'bot', `[Transfer] ${content.body}`);
        } else {
            // Plain Text
            await whatsappService.sendTextMessage(toPhone, content.body || '');
            await crmService.saveMessage(toPhone, 'bot', content.body || '');
        }

        // Add follow-up text if specified in rule (useful for CTA flows)
        if (content.follow_up_text) {
            await whatsappService.sendTextMessage(toPhone, content.follow_up_text);
            await crmService.saveMessage(toPhone, 'bot', content.follow_up_text);
        }

        if (whatomateContactId) {
            await whatomateService.sendOutgoingMessage(
                whatomateContactId,
                `🤖 System Rule [${rule.name}]: Replied to user.`
            );
        }
    }

    async _sendAndSync(toPhone, message, whatomateContactId) {
        // 1. Save to local SQLite CRM for conversation context
        await crmService.saveMessage(toPhone, 'bot', message);

        // 2. Send the message.
        // If WhatoMate CRM is available, sending to the CRM automatically dispatches
        // the message to WhatsApp via their API. Otherwise, send directly.
        let sentViaCrm = false;
        if (whatomateContactId) {
            sentViaCrm = await whatomateService.sendOutgoingMessage(whatomateContactId, message);
        }
        
        if (!sentViaCrm) {
            // CRM API failed or contactId is null.
            // Send directly via WhatsApp
            await whatsappService.sendTextMessage(toPhone, message);
            
            // AND ensure it's logged in CRM DB
            await whatomateService.logMessageDirectlyToDB(toPhone, message, 'outbound');
        }
    }


}

module.exports = new FlowService();
