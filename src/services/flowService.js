const whatsappService = require('./whatsappService');
const openaiService = require('./openaiService');
const crmService = require('./crmService');
const whatomateService = require('./whatomateService');
const config = require('../config');
const crypto = require('crypto');

const { Pool } = require('pg');
const pgPool = new Pool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5433', 10),
    user: process.env.POSTGRES_USER || 'whatomate',
    password: process.env.POSTGRES_PASSWORD || 'whatomate',
    database: process.env.POSTGRES_DB || 'whatomate',
    max: 2
});

// Default session timeout in minutes (overridden by chatbot_settings if available)
const DEFAULT_SESSION_TIMEOUT_MINS = 30;


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

            // ── CRM Chatbot Flow Processing ────────────────────────────────────
            // Priority 1: Check if the user is in an active chatbot flow session
            // Priority 2: Check if the incoming text triggers a new chatbot flow
            try {
                const chatbotHandled = await this._handleChatbotFlow(fromPhone, text, lowerText, interactiveId, whatomateContactId);
                if (chatbotHandled) {
                    return; // Chatbot flow handled the message
                }
            } catch (chatbotErr) {
                console.error("❌ Chatbot Flow Error:", chatbotErr.message);
                // Fall through to keyword rules / AI
            }
            // ──────────────────────────────────────────────────────────────────────

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

    // ═══════════════════════════════════════════════════════════════════════════
    // CRM Chatbot Flow Engine
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Main entry point for CRM chatbot flow processing.
     * Returns true if the message was handled by a chatbot flow, false otherwise.
     */
    async _handleChatbotFlow(fromPhone, text, lowerText, interactiveId, whatomateContactId) {
        // 1. Check for an active session
        const session = await this._getActiveSession(fromPhone);

        if (session) {
            console.log(`🔄 [Chatbot Flow] Active session found for ${fromPhone}, step: ${session.current_step}`);
            await this._processChatbotStep(fromPhone, text, interactiveId, session, whatomateContactId);
            return true;
        }

        // 2. No active session — check if the text triggers a new chatbot flow
        const flow = await this._matchChatbotFlow(lowerText);
        if (flow) {
            console.log(`🚀 [Chatbot Flow] Triggered flow "${flow.name}" for ${fromPhone}`);
            await this._startChatbotFlow(fromPhone, flow, whatomateContactId);
            return true;
        }

        return false;
    }

    /**
     * Get the active chatbot session for a phone number (if any).
     * Returns null if no active session or if the session has timed out.
     */
    async _getActiveSession(phone) {
        const res = await pgPool.query(
            `SELECT cs.*, cf.name as flow_name, cf.completion_message, cf.cancel_keywords
             FROM chatbot_sessions cs
             JOIN chatbot_flows cf ON cs.current_flow_id = cf.id
             WHERE cs.phone_number = $1
               AND cs.status = 'active'
               AND cs.deleted_at IS NULL
               AND cf.deleted_at IS NULL
             ORDER BY cs.last_activity_at DESC
             LIMIT 1`,
            [phone]
        );

        if (res.rows.length === 0) return null;

        const session = res.rows[0];

        // Check session timeout
        const timeoutMins = await this._getSessionTimeout(session.organization_id);
        const lastActivity = new Date(session.last_activity_at || session.created_at);
        const elapsed = (Date.now() - lastActivity.getTime()) / 1000 / 60;

        if (elapsed > timeoutMins) {
            console.log(`⏰ [Chatbot Flow] Session timed out for ${phone} (${Math.floor(elapsed)} mins > ${timeoutMins} mins)`);
            await this._endSession(session.id, 'timed_out');
            return null;
        }

        return session;
    }

    /**
     * Get session timeout from chatbot_settings.
     */
    async _getSessionTimeout(organizationId) {
        try {
            const res = await pgPool.query(
                `SELECT session_timeout_mins FROM chatbot_settings
                 WHERE organization_id = $1 AND is_enabled = true AND deleted_at IS NULL
                 LIMIT 1`,
                [organizationId]
            );
            return res.rows[0]?.session_timeout_mins || DEFAULT_SESSION_TIMEOUT_MINS;
        } catch {
            return DEFAULT_SESSION_TIMEOUT_MINS;
        }
    }

    /**
     * Match incoming text against chatbot flow trigger keywords.
     */
    async _matchChatbotFlow(lowerText) {
        const res = await pgPool.query(
            `SELECT * FROM chatbot_flows
             WHERE is_enabled = true AND deleted_at IS NULL`
        );

        for (const flow of res.rows) {
            const keywords = flow.trigger_keywords || [];
            for (const kw of keywords) {
                if (lowerText === kw.toLowerCase().trim()) {
                    return flow;
                }
            }
        }
        return null;
    }

    /**
     * Start a new chatbot flow session for a phone number.
     */
    async _startChatbotFlow(fromPhone, flow, whatomateContactId) {
        // Resolve contact and organization for the session
        const contactRes = await pgPool.query(
            `SELECT id, organization_id FROM contacts WHERE phone_number = $1 LIMIT 1`,
            [fromPhone]
        );

        let contactId, orgId;
        if (contactRes.rows.length > 0) {
            contactId = contactRes.rows[0].id;
            orgId = contactRes.rows[0].organization_id;
        } else {
            // Use the flow's organization_id as fallback
            orgId = flow.organization_id;
            // Try to find by partial phone match
            const partialRes = await pgPool.query(
                `SELECT id FROM contacts WHERE phone_number LIKE $1 AND organization_id = $2 LIMIT 1`,
                [`%${fromPhone.slice(-10)}`, orgId]
            );
            contactId = partialRes.rows[0]?.id;
        }

        if (!contactId) {
            console.warn(`⚠️ [Chatbot Flow] No contact found in DB for ${fromPhone}, cannot create session`);
            // Still send the flow messages, just don't create a DB session
        }

        // Get the first step
        const stepsRes = await pgPool.query(
            `SELECT * FROM chatbot_flow_steps
             WHERE flow_id = $1 AND deleted_at IS NULL
             ORDER BY step_order ASC`,
            [flow.id]
        );

        const firstStep = stepsRes.rows[0];
        if (!firstStep) {
            console.warn(`⚠️ [Chatbot Flow] Flow "${flow.name}" has no steps`);
            return;
        }

        // Create the session
        let sessionId = null;
        if (contactId) {
            const sessionRes = await pgPool.query(
                `INSERT INTO chatbot_sessions
                 (id, created_at, updated_at, organization_id, contact_id, whats_app_account,
                  phone_number, status, current_flow_id, current_step, step_retries,
                  session_data, started_at, last_activity_at)
                 VALUES ($1, $2, $2, $3, $4, $5, $6, 'active', $7, $8, 0, '{}', $2, $2)
                 RETURNING id`,
                [
                    crypto.randomUUID(), new Date(), orgId, contactId,
                    config.WHATSAPP_ACCOUNT_NAME || 'WhatoMate Bot',
                    fromPhone, flow.id, firstStep.step_name
                ]
            );
            sessionId = sessionRes.rows[0].id;
        }

        // Send initial message if exists
        if (flow.initial_message) {
            await whatsappService.sendTextMessage(fromPhone, flow.initial_message);
            await crmService.saveMessage(fromPhone, 'bot', flow.initial_message);
            if (sessionId) {
                await this._logSessionMessage(sessionId, 'outbound', flow.initial_message, 'initial');
            }
        }

        // Send the first step's message
        await this._sendStepMessage(fromPhone, firstStep, whatomateContactId, sessionId);

        // Sync to CRM
        if (whatomateContactId) {
            await whatomateService.sendOutgoingMessage(
                whatomateContactId,
                `🤖 [Chatbot Flow] Started "${flow.name}"`
            );
        }
    }

    /**
     * Process the current step in a chatbot flow session.
     * The user's reply is stored and the next step is executed.
     */
    async _processChatbotStep(fromPhone, text, interactiveId, session, whatomateContactId) {
        // Check if user wants to cancel
        const cancelKeywords = session.cancel_keywords || [];
        const lowerText = text.toLowerCase().trim();
        for (const ck of cancelKeywords) {
            if (lowerText === ck.toLowerCase().trim()) {
                console.log(`🚫 [Chatbot Flow] User ${fromPhone} cancelled flow`);
                await this._endSession(session.id, 'cancelled');
                await whatsappService.sendTextMessage(fromPhone, "Flow cancelled. Type *Menu* for options. 👋");
                await crmService.saveMessage(fromPhone, 'bot', "Flow cancelled.");
                return;
            }
        }

        // Get current step details
        const stepRes = await pgPool.query(
            `SELECT * FROM chatbot_flow_steps
             WHERE flow_id = $1 AND step_name = $2 AND deleted_at IS NULL
             LIMIT 1`,
            [session.current_flow_id, session.current_step]
        );

        const currentStep = stepRes.rows[0];
        if (!currentStep) {
            console.error(`❌ [Chatbot Flow] Step "${session.current_step}" not found`);
            await this._endSession(session.id, 'error');
            return;
        }

        // Validate input if the step requires it
        if (currentStep.validation_regex) {
            const regex = new RegExp(currentStep.validation_regex);
            if (!regex.test(text)) {
                const retries = (session.step_retries || 0) + 1;
                const maxRetries = currentStep.max_retries || 3;

                if (retries >= maxRetries) {
                    console.log(`🚫 [Chatbot Flow] Max retries reached for ${fromPhone}`);
                    await this._endSession(session.id, 'max_retries');
                    await whatsappService.sendTextMessage(fromPhone, "Too many invalid attempts. Please start again. 🔄");
                    return;
                }

                // Update retry count
                await pgPool.query(
                    `UPDATE chatbot_sessions SET step_retries = $1, updated_at = $2 WHERE id = $3`,
                    [retries, new Date(), session.id]
                );

                const errorMsg = currentStep.validation_error || "Invalid input. Please try again.";
                await whatsappService.sendTextMessage(fromPhone, errorMsg);
                return;
            }
        }

        // Store user's answer in session_data if store_as is defined
        if (currentStep.store_as) {
            const sessionData = session.session_data || {};
            sessionData[currentStep.store_as] = text;

            await pgPool.query(
                `UPDATE chatbot_sessions SET session_data = $1, updated_at = $2 WHERE id = $3`,
                [JSON.stringify(sessionData), new Date(), session.id]
            );
        }

        // Log the user's message in session messages
        await this._logSessionMessage(session.id, 'inbound', text, session.current_step);

        // Determine next step
        let nextStepName = currentStep.next_step;

        // Check conditional_next rules (button-based branching)
        if (currentStep.conditional_next && typeof currentStep.conditional_next === 'object') {
            const condKey = interactiveId || lowerText;
            if (currentStep.conditional_next[condKey]) {
                nextStepName = currentStep.conditional_next[condKey];
            }
        }

        // If no explicit next_step, find the step after the current one by order
        if (!nextStepName) {
            const nextRes = await pgPool.query(
                `SELECT step_name FROM chatbot_flow_steps
                 WHERE flow_id = $1 AND step_order > $2 AND deleted_at IS NULL
                 ORDER BY step_order ASC
                 LIMIT 1`,
                [session.current_flow_id, currentStep.step_order]
            );

            if (nextRes.rows.length > 0) {
                nextStepName = nextRes.rows[0].step_name;
            }
        }

        // No next step — flow is complete
        if (!nextStepName) {
            console.log(`✅ [Chatbot Flow] Flow completed for ${fromPhone}`);

            // Send completion message
            if (session.completion_message) {
                await whatsappService.sendTextMessage(fromPhone, session.completion_message);
                await crmService.saveMessage(fromPhone, 'bot', session.completion_message);
                await this._logSessionMessage(session.id, 'outbound', session.completion_message, 'completion');
            }

            await this._endSession(session.id, 'completed');

            if (whatomateContactId) {
                await whatomateService.sendOutgoingMessage(
                    whatomateContactId,
                    `🤖 [Chatbot Flow] "${session.flow_name}" completed.`
                );
            }
            return;
        }

        // Fetch the next step
        const nextStepRes = await pgPool.query(
            `SELECT * FROM chatbot_flow_steps
             WHERE flow_id = $1 AND step_name = $2 AND deleted_at IS NULL
             LIMIT 1`,
            [session.current_flow_id, nextStepName]
        );

        const nextStep = nextStepRes.rows[0];
        if (!nextStep) {
            console.error(`❌ [Chatbot Flow] Next step "${nextStepName}" not found`);
            await this._endSession(session.id, 'error');
            return;
        }

        // Update session to the next step
        await pgPool.query(
            `UPDATE chatbot_sessions
             SET current_step = $1, step_retries = 0, last_activity_at = $2, updated_at = $2
             WHERE id = $3`,
            [nextStepName, new Date(), session.id]
        );

        // Send the next step's message
        await this._sendStepMessage(fromPhone, nextStep, whatomateContactId, session.id);
    }

    /**
     * Send a chatbot flow step message to the user.
     * Supports: text, whatsapp_flow, buttons, interactive_list.
     */
    async _sendStepMessage(fromPhone, step, whatomateContactId, sessionId) {
        const message = step.message || '';
        const messageType = step.message_type || 'text';

        if (messageType === 'whatsapp_flow') {
            // Send a native WhatsApp Flow
            const inputConfig = step.input_config || {};
            const flowId = inputConfig.whatsapp_flow_id;

            if (flowId) {
                const header = inputConfig.flow_header || '';
                const cta = inputConfig.flow_cta || 'Open Flow';

                const sent = await whatsappService.sendFlowMessage(
                    fromPhone,
                    header,
                    message || 'Tap below to continue',
                    null, // footer — null so it's omitted from the API call
                    flowId,
                    crypto.randomUUID(), // unique flow token
                    cta // flow CTA button text
                );

                if (sent) {
                    console.log(`✅ [Chatbot Flow] WhatsApp Flow ${flowId} sent to ${fromPhone}`);
                } else {
                    // Fallback: send as text
                    await whatsappService.sendTextMessage(fromPhone, message || 'Please continue with the next step.');
                }
            } else {
                await whatsappService.sendTextMessage(fromPhone, message || 'Please continue.');
            }

            await crmService.saveMessage(fromPhone, 'bot', `[WhatsApp Flow] ${message}`);

        } else if (step.buttons && Array.isArray(step.buttons) && step.buttons.length > 0) {
            // Interactive buttons
            if (step.buttons.length <= 3) {
                await whatsappService.sendInteractiveButtons(
                    fromPhone,
                    '', // header
                    message,
                    '', // footer
                    step.buttons
                );
            } else {
                // Convert to list for > 3 buttons
                const sections = [{
                    title: "Options",
                    rows: step.buttons.map(btn => ({
                        id: btn.id,
                        title: btn.title,
                        description: btn.description || ''
                    }))
                }];
                await whatsappService.sendInteractiveList(
                    fromPhone,
                    '', // header
                    message,
                    '', // footer
                    'Select',
                    sections
                );
            }
            await crmService.saveMessage(fromPhone, 'bot', `[Buttons] ${message}`);

        } else {
            // Plain text
            if (message) {
                await whatsappService.sendTextMessage(fromPhone, message);
                await crmService.saveMessage(fromPhone, 'bot', message);
            }
        }

        // Log in session messages
        if (sessionId) {
            await this._logSessionMessage(sessionId, 'outbound', message, step.step_name);
        }
    }

    /**
     * Log a message in the chatbot_session_messages table.
     */
    async _logSessionMessage(sessionId, direction, message, stepName) {
        try {
            const now = new Date();
            await pgPool.query(
                `INSERT INTO chatbot_session_messages
                 (id, created_at, updated_at, session_id, direction, message, step_name)
                 VALUES ($1, $2, $2, $3, $4, $5, $6)`,
                [crypto.randomUUID(), now, sessionId, direction, message || '', stepName || '']
            );
        } catch (e) {
            console.error(`⚠️ [Chatbot Flow] Failed to log session message:`, e.message);
        }
    }

    /**
     * End a chatbot session.
     */
    async _endSession(sessionId, status = 'completed') {
        try {
            const now = new Date();
            await pgPool.query(
                `UPDATE chatbot_sessions
                 SET status = $1, completed_at = $2, updated_at = $2
                 WHERE id = $3`,
                [status, now, sessionId]
            );
            console.log(`📋 [Chatbot Flow] Session ${sessionId} ended with status: ${status}`);
        } catch (e) {
            console.error(`⚠️ [Chatbot Flow] Failed to end session:`, e.message);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Keyword Rules Engine (existing)
    // ═══════════════════════════════════════════════════════════════════════════

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
