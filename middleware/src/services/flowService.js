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
                if (messageObj.interactive?.type === 'nfm_reply' || messageObj.interactive?.nfm_reply) {
                    text = messageObj.interactive.nfm_reply.response_json || 'Submitted Form';
                    interactiveId = 'nfm_reply';
                    try {
                        const responseData = typeof text === 'string' && text.startsWith('{') ? JSON.parse(text) : { raw: text };
                        
                        let flowId = null;
                        let orgId = null;
                        if (responseData.flow_token) {
                            // 1. Try to look up by exact token in whatsapp_flow_sessions
                            const sessionRes = await pgPool.query(
                                `SELECT wfs.flow_id, wf.organization_id FROM whatsapp_flow_sessions wfs JOIN whatsapp_flows wf ON wfs.flow_id = wf.id WHERE wfs.token = $1 LIMIT 1`,
                                [responseData.flow_token]
                            );
                            if (sessionRes.rows.length > 0) {
                                flowId = sessionRes.rows[0].flow_id;
                                orgId = sessionRes.rows[0].organization_id;
                            }
                        }

                        // 2. Fallback: if flow_id is still null (e.g. Meta-generated flow_* tokens from
                        //    native testing or direct flow links), try to resolve the flow by:
                        //    a) Finding the most recent flow session for this phone number
                        //    b) Finding the only published flow in the org
                        if (!flowId) {
                            // Try most recent session for this phone
                            const recentSessionRes = await pgPool.query(
                                `SELECT wfs.flow_id, wf.organization_id FROM whatsapp_flow_sessions wfs
                                 JOIN whatsapp_flows wf ON wfs.flow_id = wf.id
                                 WHERE wfs.phone_number = $1
                                 ORDER BY wfs.created_at DESC LIMIT 1`,
                                [fromPhone]
                            );
                            if (recentSessionRes.rows.length > 0) {
                                flowId = recentSessionRes.rows[0].flow_id;
                                orgId = recentSessionRes.rows[0].organization_id;
                                console.log(`🔗 [Flow Fallback] Linked submission to flow ${flowId} via recent session for ${fromPhone}`);
                            } else {
                                // Last resort: find flow by contact's organization
                                const contactRes = await pgPool.query(
                                    `SELECT organization_id FROM contacts WHERE phone_number = $1 LIMIT 1`,
                                    [fromPhone]
                                );
                                if (contactRes.rows.length > 0) {
                                    orgId = contactRes.rows[0].organization_id;
                                    // Find published flows for this org
                                    const publishedFlowRes = await pgPool.query(
                                        `SELECT id FROM whatsapp_flows WHERE organization_id = $1 AND status = 'PUBLISHED' AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1`,
                                        [orgId]
                                    );
                                    if (publishedFlowRes.rows.length > 0) {
                                        flowId = publishedFlowRes.rows[0].id;
                                        console.log(`🔗 [Flow Fallback] Linked submission to published flow ${flowId} for org ${orgId}`);
                                    }
                                }
                            }
                        }
                        
                        await pgPool.query(
                            `INSERT INTO whatsapp_flow_submissions (phone_number, response_data, flow_id, organization_id) VALUES ($1, $2, $3, $4)`,
                            [fromPhone, responseData, flowId, orgId]
                        );
                        console.log(`✅ Logged flow submission from ${fromPhone}, linked to flow: ${flowId}`);
                    } catch (e) {
                        console.error('❌ Failed to log flow submission:', e.message);
                    }
                } else {
                    text = messageObj.interactive?.button_reply?.title
                        || messageObj.interactive?.list_reply?.title
                        || '';
                    interactiveId = messageObj.interactive?.button_reply?.id
                        || messageObj.interactive?.list_reply?.id
                        || '';
                }
            } else if (messageObj.type === 'button') {
                // Template Quick Reply buttons — use text or payload
                text = messageObj.button?.text || messageObj.button?.payload || '';
            }

            const lowerText = text.toLowerCase().trim();
            console.log(`📩 Received from ${fromPhone}: ${text} (id: ${interactiveId})`);

            // 1. Save user message to CRM context
            await crmService.saveMessage(fromPhone, 'user', text);

            // ── CRM Chatbot Flow Processing ────────────────────────────────────
            try {
                const chatbotHandled = await this._handleChatbotFlow(fromPhone, text, lowerText, interactiveId, whatomateContactId);
                if (chatbotHandled) return;
            } catch (chatbotErr) {
                console.error("❌ Chatbot Flow Error:", chatbotErr.message);
            }

            // ── Dynamic Keyword Rules Processing ───────────────────────────────
            try {
                const rulesRes = await pgPool.query(
                    `SELECT * FROM keyword_rules
                     WHERE is_enabled = true AND deleted_at IS NULL
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
                            if (textToMatch === kwMatch || interactiveId === kwMatch) { isMatch = true; break; }
                        } else {
                            if (textToMatch.includes(kwMatch) || interactiveId.includes(kwMatch)) { isMatch = true; break; }
                        }
                    }

                    if (isMatch) {
                        console.log(`🎯 [Keyword Rule] Matched rule "${rule.name}" for ${fromPhone}`);
                        await this._executeKeywordRule(fromPhone, rule, whatomateContactId);
                        return;
                    }
                }
            } catch (dbErr) {
                console.error("❌ DB Error fetching keyword rules:", dbErr.message);
            }

            try {
                if (lowerText.startsWith('!flow ')) {
                    const flowName = lowerText.replace('!flow ', '').trim();
                    const flowRes = await pgPool.query(
                        `SELECT name, meta_flow_id, flow_json, status FROM whatsapp_flows
                         WHERE LOWER(name) = $1
                           AND meta_flow_id IS NOT NULL AND meta_flow_id != ''
                           AND deleted_at IS NULL
                         LIMIT 1`,
                        [flowName]
                    );
                    if (flowRes.rows.length > 0) {
                        const flow = flowRes.rows[0];
                        const mode = (flow.status === 'PUBLISHED') ? 'published' : 'draft';
                        
                        let firstScreen = 'SCREEN_A';
                        let flowData = {};
                        
                        try {
                            const flowJson = typeof flow.flow_json === 'string' ? JSON.parse(flow.flow_json) : flow.flow_json;
                            const screens = flowJson?.screens || [];
                            if (screens.length > 0) {
                                firstScreen = screens[0].id || 'SCREEN_A';
                                if (screens[0].data) {
                                    for (const [key, val] of Object.entries(screens[0].data)) {
                                        if (val && val.__example__ !== undefined) {
                                            flowData[key] = val.__example__;
                                        }
                                    }
                                }
                            }
                        } catch(e) {
                            console.error("❌ Failed to parse flow JSON:", e.message);
                        }
                        
                        const flowToken = crypto.randomUUID();
                        // Save session to database so we can link the response back to this flow
                        await pgPool.query(
                            `INSERT INTO whatsapp_flow_sessions (token, flow_id, phone_number) VALUES ($1, $2, $3)`,
                            [flowToken, flow.id, fromPhone]
                        ).catch(e => console.error("❌ Failed to save flow session:", e.message));

                        const sent = await whatsappService.sendFlowMessage(
                            fromPhone, `${flow.name}`,
                            `Tap below to open ${flow.name}.`,
                            "", flow.meta_flow_id, flowToken, "Open", firstScreen, mode, Object.keys(flowData).length > 0 ? flowData : null
                        );
                        if (sent) { console.log(`📞 Sent Flow "${flow.name}" to ${fromPhone}`); return; }
                        console.warn(`⚠️ Flow "${flow.name}" (${flow.meta_flow_id}) failed to send`);
                    }
                }
            } catch (dbErr) {
                console.error("❌ DB Error fetching flows:", dbErr.message);
            }

            // 3. Fallback to AI
            console.log(`🤖 Processing text "${text}" with AI...`);
            const history = await crmService.getRecentMessages(fromPhone, 40);
            const aiReply = await openaiService.generateReply(text, history, fromPhone);
            if (!aiReply) {
                console.log(`🤖 [Chatbot Flow] AI is disabled or returned no reply for ${fromPhone}. Skipping.`);
                return;
            }
            await this._sendAndSync(fromPhone, aiReply, whatomateContactId);

        } catch (error) {
            console.error("❌ FlowService Error:", error);
            try {
                const fallbackRes = await pgPool.query(`SELECT fallback_message FROM chatbot_settings WHERE deleted_at IS NULL AND is_enabled = true LIMIT 1`);
                const fallback = fallbackRes.rows[0]?.fallback_message || "I'm sorry, something went wrong on my end. Please try again or type *Menu* for options! 🙏";
                await whatsappService.sendTextMessage(fromPhone, fallback);
                await whatomateService.sendOutgoingMessage(whatomateContactId, fallback);
            } catch (e) {
                console.error("❌ FlowService: Even fallback failed:", e.message);
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Graph-Based Chatbot Flow Engine
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Main entry point for CRM chatbot flow processing.
     * Returns true if the message was handled by a chatbot flow, false otherwise.
     */
    async _handleChatbotFlow(fromPhone, text, lowerText, interactiveId, whatomateContactId) {
        // 1. Check if the text triggers a new chatbot flow (even if session is active)
        const flow = await this._matchChatbotFlow(lowerText);

        // 2. Check for an active session
        const session = await this._getActiveSession(fromPhone);

        if (session) {
            // If the user typed a trigger keyword, restart the flow from scratch
            if (flow) {
                console.log(`🔄 [Chatbot Flow] Re-trigger detected for ${fromPhone}. Restarting flow "${flow.name}"`);
                await this._endSession(session.id, 'restarted');
                await this._startGraphFlow(fromPhone, flow, whatomateContactId);
                return true;
            }

            // Check if user is at a whatsapp_flow node but sent plain text (ignored the form)
            if (!interactiveId) {
                const graph = this._parseGraph(session);
                if (graph) {
                    const currentNode = this._findNode(graph, session.current_step);
                    if (currentNode && currentNode.type === 'whatsapp_flow') {
                        console.log(`🚫 [Chatbot Flow] User ${fromPhone} sent text during whatsapp_flow. Cancelling flow to allow AI processing.`);
                        await this._endSession(session.id, 'cancelled');
                        return false; // Fall back to keyword/AI processing
                    }
                }
            }

            console.log(`🔄 [Chatbot Flow] Active session for ${fromPhone}, node: ${session.current_step}`);
            const swallowed = await this._processGraphStep(fromPhone, text, lowerText, interactiveId, session, whatomateContactId);
            return swallowed;
        }

        // 3. No active session — start a new flow if trigger matched
        if (flow) {
            console.log(`🚀 [Chatbot Flow] Triggered flow "${flow.name}" for ${fromPhone}`);
            await this._startGraphFlow(fromPhone, flow, whatomateContactId);
            return true;
        }
        return false;
    }

    /**
     * Get the active chatbot session for a phone number (if any).
     */
    async _getActiveSession(phone) {
        const res = await pgPool.query(
            `SELECT cs.*, cf.name as flow_name, cf.completion_message, cf.cancel_keywords, cf.graph
             FROM chatbot_sessions cs
             JOIN chatbot_flows cf ON cs.current_flow_id = cf.id
             WHERE cs.phone_number = $1 AND cs.status = 'active'
               AND cs.deleted_at IS NULL AND cf.deleted_at IS NULL
             ORDER BY cs.last_activity_at DESC LIMIT 1`,
            [phone]
        );
        if (res.rows.length === 0) return null;

        const session = res.rows[0];
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

    async _getSessionTimeout(organizationId) {
        try {
            const res = await pgPool.query(
                `SELECT session_timeout_mins FROM chatbot_settings
                 WHERE organization_id = $1 AND is_enabled = true AND deleted_at IS NULL LIMIT 1`,
                [organizationId]
            );
            return res.rows[0]?.session_timeout_mins || DEFAULT_SESSION_TIMEOUT_MINS;
        } catch { return DEFAULT_SESSION_TIMEOUT_MINS; }
    }

    async _matchChatbotFlow(lowerText) {
        const res = await pgPool.query(
            `SELECT * FROM chatbot_flows WHERE is_enabled = true AND deleted_at IS NULL`
        );
        for (const flow of res.rows) {
            const keywords = flow.trigger_keywords || [];
            for (const kw of keywords) {
                if (lowerText === kw.toLowerCase().trim()) return flow;
            }
        }
        return null;
    }

    // ── Graph helpers ──────────────────────────────────────────────────────────

    /** Parse graph from flow row, handling both string and object */
    _parseGraph(flow) {
        if (!flow.graph) return null;
        return typeof flow.graph === 'string' ? JSON.parse(flow.graph) : flow.graph;
    }

    /** Find a node by id in the graph */
    _findNode(graph, nodeId) {
        return (graph.nodes || []).find(n => n.id === nodeId) || null;
    }

    /** Find the first node after __start__ */
    _getEntryNode(graph) {
        const entryEdge = (graph.edges || []).find(e => e.from === '__start__');
        if (!entryEdge) return null;
        return this._findNode(graph, entryEdge.to);
    }

    /**
     * Resolve next node from edges based on user input.
     * Checks button:id, list:id conditions, then falls back to "default".
     */
    _resolveNextNode(graph, currentNodeId, interactiveId, lowerText) {
        const edges = (graph.edges || []).filter(e => e.from === currentNodeId);
        if (edges.length === 0) return null;

        // Separate conditional edges from the default edge
        const conditionalEdges = edges.filter(e => e.condition && e.condition !== 'default');
        const defaultEdge = edges.find(e => e.condition === 'default');

        // 1. Try exact match on interactive button/list ID
        if (interactiveId) {
            const btnEdge = conditionalEdges.find(e => e.condition === `button:${interactiveId}`);
            if (btnEdge) return this._findNode(graph, btnEdge.to);
            const listEdge = conditionalEdges.find(e => e.condition === `list:${interactiveId}`);
            if (listEdge) return this._findNode(graph, listEdge.to);
        }

        // 2. Try matching by text (button title as lowerText)
        if (lowerText) {
            const textEdge = conditionalEdges.find(e => {
                const cond = e.condition || '';
                const parts = cond.split(':');
                if (parts.length === 2) {
                    return parts[1].toLowerCase() === lowerText;
                }
                return false;
            });
            if (textEdge) return this._findNode(graph, textEdge.to);
        }

        // 3. Default edge — ONLY use when there are NO conditional edges
        //    (e.g., CTA URL nodes that auto-advance after display)
        //    If there ARE conditional edges, user must click a button/list item.
        if (defaultEdge && conditionalEdges.length === 0) {
            return this._findNode(graph, defaultEdge.to);
        }

        // 4. If only one edge (default) and user sent text, use it for nodes
        //    that expect free-text input (no buttons/lists)
        if (edges.length === 1 && defaultEdge) {
            return this._findNode(graph, defaultEdge.to);
        }

        return null;
    }

    // ── Start a new graph flow ─────────────────────────────────────────────────

    async _startGraphFlow(fromPhone, flow, whatomateContactId) {
        const graph = this._parseGraph(flow);
        if (!graph) {
            console.warn(`⚠️ [Chatbot Flow] Flow "${flow.name}" has no graph`);
            return;
        }

        const entryNode = this._getEntryNode(graph);
        if (!entryNode) {
            console.warn(`⚠️ [Chatbot Flow] Flow "${flow.name}" has no entry node`);
            return;
        }

        // End any existing active sessions for this phone number
        try {
            await pgPool.query(
                `UPDATE chatbot_sessions SET status = 'superseded', completed_at = NOW(), updated_at = NOW()
                 WHERE phone_number = $1 AND status = 'active' AND deleted_at IS NULL`,
                [fromPhone]
            );
        } catch (e) {
            console.warn(`⚠️ [Chatbot Flow] Failed to close old sessions:`, e.message);
        }

        // Resolve contact
        const contactRes = await pgPool.query(
            `SELECT id, organization_id FROM contacts WHERE phone_number = $1 LIMIT 1`,
            [fromPhone]
        );

        let contactId, orgId;
        if (contactRes.rows.length > 0) {
            contactId = contactRes.rows[0].id;
            orgId = contactRes.rows[0].organization_id;
        } else {
            orgId = flow.organization_id;
            const partialRes = await pgPool.query(
                `SELECT id FROM contacts WHERE phone_number LIKE $1 AND organization_id = $2 LIMIT 1`,
                [`%${fromPhone.slice(-10)}`, orgId]
            );
            contactId = partialRes.rows[0]?.id;
        }

        if (!contactId) {
            console.warn(`⚠️ [Chatbot Flow] No contact found for ${fromPhone}`);
        }

        // Create session
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
                    fromPhone, flow.id, entryNode.id
                ]
            );
            sessionId = sessionRes.rows[0].id;
        }

        // Send initial message
        if (flow.initial_message) {
            await whatsappService.sendTextMessage(fromPhone, flow.initial_message);
            await crmService.saveMessage(fromPhone, 'bot', flow.initial_message);
            if (sessionId) await this._logSessionMessage(sessionId, 'outgoing', flow.initial_message, 'initial');
        }

        // Send the entry node message
        await this._sendNodeMessage(fromPhone, entryNode, whatomateContactId, sessionId);
    }

    /**
     * Broadcast a flow to an array of contacts
     */
    async startBroadcast(contacts, flow) {
        console.log(`🚀 [Broadcast] Starting broadcast of flow "${flow.name}" to ${contacts.length} contacts`);
        
        for (const contact of contacts) {
            try {
                const { phone_number, id } = contact;
                // We use a small delay between messages to avoid rate limits (e.g. 200ms)
                await new Promise(res => setTimeout(res, 200));
                
                await this._startGraphFlow(phone_number, flow, id);
            } catch (err) {
                console.error(`❌ [Broadcast] Failed to start flow for contact ${contact.phone_number}:`, err.message);
            }
        }
        
        console.log(`✅ [Broadcast] Completed broadcast trigger for ${contacts.length} contacts`);
    }

    // ── Process user input against current graph node ──────────────────────────

    async _processGraphStep(fromPhone, text, lowerText, interactiveId, session, whatomateContactId) {
        // Check cancel keywords
        const cancelKeywords = session.cancel_keywords || [];
        for (const ck of cancelKeywords) {
            if (lowerText === ck.toLowerCase().trim()) {
                console.log(`🚫 [Chatbot Flow] User ${fromPhone} cancelled flow`);
                await this._endSession(session.id, 'cancelled');
                await whatsappService.sendTextMessage(fromPhone, "Flow cancelled. Type *Menu* for options. 👋");
                await crmService.saveMessage(fromPhone, 'bot', "Flow cancelled.");
                return true;
            }
        }

        const graph = this._parseGraph(session);
        if (!graph) {
            console.error(`❌ [Chatbot Flow] No graph data in session`);
            await this._endSession(session.id, 'error');
            return true;
        }

        const currentNodeId = session.current_step;
        await this._logSessionMessage(session.id, 'inbound', text, currentNodeId);

        // Store user input in session_data
        let sessionData = {};
        try {
            sessionData = typeof session.session_data === 'string' ? JSON.parse(session.session_data) : (session.session_data || {});
        } catch(e) {}
        
        sessionData[currentNodeId] = interactiveId || lowerText;
        
        // If it's a native form reply, merge its payload directly into the session data
        // so it becomes available in dashboard widget analytics
        if (interactiveId === 'nfm_reply' && text && text.startsWith('{')) {
            try {
                const parsedPayload = JSON.parse(text);
                sessionData = { ...sessionData, ...parsedPayload };
            } catch (e) {
                console.error("Failed to parse nfm_reply for session_data", e.message);
            }
        }

        // Resolve next node
        const nextNode = this._resolveNextNode(graph, currentNodeId, interactiveId, lowerText);

        if (!nextNode) {
            console.warn(`⚠️ [Chatbot Flow] No matching edge from node "${currentNodeId}" for input "${interactiveId || lowerText}"`);
            await whatsappService.sendTextMessage(fromPhone, "Please select one of the options above, or type *cancel* to exit. 🙏");
            return true;
        }

        // Handle end node
        if (nextNode.type === 'end' || nextNode.id === '__end__') {
            console.log(`✅ [Chatbot Flow] Flow completed for ${fromPhone}`);

            // Send end node message if it has one
            const endMsg = nextNode.config?.message;
            if (endMsg) {
                await whatsappService.sendTextMessage(fromPhone, endMsg);
                await crmService.saveMessage(fromPhone, 'bot', endMsg);
                await this._logSessionMessage(session.id, 'outgoing', endMsg, nextNode.id);
            }

            // Send completion message
            if (session.completion_message) {
                await whatsappService.sendTextMessage(fromPhone, session.completion_message);
                await crmService.saveMessage(fromPhone, 'bot', session.completion_message);
                await this._logSessionMessage(session.id, 'outgoing', session.completion_message, 'completion');
            }

            await this._endSession(session.id, 'completed');
            
            // If the user reached end node by sending plain text, don't swallow the text, pass to AI
            if (!interactiveId) {
                return false;
            }
            return true;
        }

        // Update session to next node
        await pgPool.query(
            `UPDATE chatbot_sessions
             SET current_step = $1, step_retries = 0, last_activity_at = $2, updated_at = $2, session_data = $4
             WHERE id = $3`,
            [nextNode.id, new Date(), session.id, JSON.stringify(sessionData)]
        );

        // Send next node's message
        await this._sendNodeMessage(fromPhone, nextNode, whatomateContactId, session.id);
        return true;
    }

    // ── Send a graph node's message ────────────────────────────────────────────

    async _sendNodeMessage(fromPhone, node, whatomateContactId, sessionId) {
        const cfg = node.config || {};
        const body = cfg.body || cfg.message || '';
        const nodeType = node.type || 'text';

        if (nodeType === 'cta_url' && cfg.url) {
            // CTA URL button
            await whatsappService.sendCTAUrlButton(
                fromPhone, cfg.header || '', body, cfg.footer || '',
                cfg.button_text || 'Visit', cfg.url
            );
            await crmService.saveMessage(fromPhone, 'bot', `[CTA URL] ${body}`);

        } else if (nodeType === 'list' && cfg.sections) {
            // Interactive list
            await whatsappService.sendInteractiveList(
                fromPhone, cfg.header || '', body, cfg.footer || '',
                cfg.button_text || 'Select', cfg.sections
            );
            await crmService.saveMessage(fromPhone, 'bot', `[List] ${body}`);

        } else if (nodeType === 'action_tag') {
            // Apply tags to contact
            const tags = Array.isArray(cfg.tags) ? cfg.tags : (cfg.tags ? [cfg.tags] : []);
            if (tags.length > 0) {
                try {
                    await pgPool.query(
                        `UPDATE contacts SET tags = (COALESCE(tags, '[]'::jsonb) || $1::jsonb) WHERE phone_number = $2`,
                        [JSON.stringify(tags), fromPhone]
                    );
                    console.log(`🏷️ [Chatbot Flow] Tagged ${fromPhone} with ${tags.join(', ')}`);
                } catch (e) {
                    console.error(`❌ [Chatbot Flow] Tagging error:`, e.message);
                }
            }
            
            if (cfg.url) {
                await whatsappService.sendCTAUrlButton(
                    fromPhone, cfg.header || '', body, cfg.footer || '',
                    cfg.button_text || 'Visit', cfg.url
                );
                await crmService.saveMessage(fromPhone, 'bot', `[Tag & CTA] ${body}`);
            } else if (body) {
                await whatsappService.sendTextMessage(fromPhone, body);
                await crmService.saveMessage(fromPhone, 'bot', body);
            }

        } else if (nodeType === 'whatsapp_flow' && cfg.whatsapp_flow_id) {
            let mode = 'draft';
            let flowScreen = cfg.flow_screen || null;
            let flowData = {};
            let internalFlowId = null;
            
            try {
                const fRes = await pgPool.query(`SELECT id, flow_json, status FROM whatsapp_flows WHERE meta_flow_id = $1 LIMIT 1`, [cfg.whatsapp_flow_id]);
                if (fRes.rows.length > 0) {
                    const row = fRes.rows[0];
                    internalFlowId = row.id;
                    mode = (row.status === 'PUBLISHED') ? 'published' : 'draft';
                    
                    const flowJson = typeof row.flow_json === 'string' ? JSON.parse(row.flow_json) : row.flow_json;
                    const screens = flowJson?.screens || [];
                    if (screens.length > 0) {
                        flowScreen = screens[0].id || flowScreen || 'SCREEN_A';
                        if (screens[0].data) {
                            for (const [key, val] of Object.entries(screens[0].data)) {
                                if (val && val.__example__ !== undefined) {
                                    flowData[key] = val.__example__;
                                }
                            }
                        }
                    }
                }
            } catch(e) {
                console.error("❌ Failed to get flow screen/data:", e.message);
            }
            
            const flowToken = crypto.randomUUID();
            if (internalFlowId) {
                // Save session to database so we can link the response back to this flow
                await pgPool.query(
                    `INSERT INTO whatsapp_flow_sessions (token, flow_id, phone_number) VALUES ($1, $2, $3)`,
                    [flowToken, internalFlowId, fromPhone]
                ).catch(e => console.error("❌ Failed to save flow session in dynamic node:", e.message));
            }

            const sent = await whatsappService.sendFlowMessage(
                fromPhone, cfg.flow_header || '', body || 'Tap below to continue',
                null, cfg.whatsapp_flow_id, flowToken, cfg.flow_cta || 'Start Flow', flowScreen || 'SCREEN_A', mode, Object.keys(flowData).length > 0 ? flowData : null
            );
            if (!sent) await whatsappService.sendTextMessage(fromPhone, body || 'Please continue.');
            await crmService.saveMessage(fromPhone, 'bot', `[WhatsApp Flow] ${body}`);

        } else if (cfg.buttons && Array.isArray(cfg.buttons) && cfg.buttons.length > 0) {
            
            // Check if it's meant to be a CTA URL Button (WhatsApp allows exactly 1 URL button per CTA message)
            const urlButton = cfg.buttons.find(b => b.type === 'url' && b.url);
            if (urlButton && cfg.buttons.length === 1) {
                await whatsappService.sendCTAUrlButton(
                    fromPhone, cfg.header || '', body, cfg.footer || '',
                    urlButton.title || 'Visit', urlButton.url
                );
                await crmService.saveMessage(fromPhone, 'bot', `[CTA URL] ${body}`);
            } else {
                // Interactive buttons (max 3 for WhatsApp)
                if (cfg.buttons.length <= 3) {
                    await whatsappService.sendInteractiveButtons(
                        fromPhone, cfg.header || '', body, cfg.footer || '', cfg.buttons
                    );
                } else {
                    // Convert to list if > 3 buttons
                    const sections = [{
                        title: "Options",
                        rows: cfg.buttons.map(btn => ({
                            id: btn.id, title: btn.title, description: btn.description || ''
                        }))
                    }];
                    await whatsappService.sendInteractiveList(
                        fromPhone, cfg.header || '', body, cfg.footer || '', 'Select', sections
                    );
                }
                await crmService.saveMessage(fromPhone, 'bot', `[Buttons] ${body}`);
            }

        } else if (body) {
            // Plain text
            await whatsappService.sendTextMessage(fromPhone, body);
            await crmService.saveMessage(fromPhone, 'bot', body);
        }

        if (sessionId) {
            await this._logSessionMessage(sessionId, 'outgoing', body, node.id);
        }
    }

    // ── Session helpers ────────────────────────────────────────────────────────

    async _logSessionMessage(sessionId, direction, message, stepName) {
        try {
            await pgPool.query(
                `INSERT INTO chatbot_session_messages
                 (id, created_at, updated_at, session_id, direction, message, step_name)
                 VALUES ($1, $2, $2, $3, $4, $5, $6)`,
                [crypto.randomUUID(), new Date(), sessionId, direction, message || '', stepName || '']
            );
        } catch (e) {
            console.error(`⚠️ [Chatbot Flow] Failed to log session message:`, e.message);
        }
    }

    async _endSession(sessionId, status = 'completed') {
        try {
            const now = new Date();
            await pgPool.query(
                `UPDATE chatbot_sessions SET status = $1, completed_at = $2, updated_at = $2 WHERE id = $3`,
                [status, now, sessionId]
            );
            console.log(`📋 [Chatbot Flow] Session ${sessionId} ended: ${status}`);
        } catch (e) {
            console.error(`⚠️ [Chatbot Flow] Failed to end session:`, e.message);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Keyword Rules Engine (existing)
    // ═══════════════════════════════════════════════════════════════════════════

    async _executeKeywordRule(toPhone, rule, whatomateContactId) {
        const type = rule.response_type;
        let content = rule.response_content || {};

        if (typeof content.body === 'string' && content.body.trim().startsWith('{') && content.body.trim().endsWith('}')) {
            try { content = { ...content, ...JSON.parse(content.body) }; } catch (e) { /* not JSON */ }
        }

        if (content.sections && Array.isArray(content.sections) && content.sections.length > 0) {
            await whatsappService.sendInteractiveList(toPhone, content.header || '', content.body || '', content.footer || '', content.button_text || 'Menu', content.sections);
            await crmService.saveMessage(toPhone, 'bot', `[Interactive List] ${content.body}`);
        } else if (content.url) {
            await whatsappService.sendCTAUrlButton(toPhone, content.header || '', content.body || '', content.footer || '', content.button_text || 'Visit', content.url);
            await crmService.saveMessage(toPhone, 'bot', `[CTA URL] ${content.body}`);
        } else if (content.buttons && Array.isArray(content.buttons) && content.buttons.length > 0) {
            if (content.buttons.length <= 3) {
                await whatsappService.sendInteractiveButtons(toPhone, content.header || '', content.body || '', content.footer || '', content.buttons);
                await crmService.saveMessage(toPhone, 'bot', `[Interactive Buttons] ${content.body}`);
            } else {
                const listSections = [{ title: "Options", rows: content.buttons.map(btn => ({ id: btn.id, title: btn.title, description: "" })) }];
                await whatsappService.sendInteractiveList(toPhone, content.header || '', content.body || '', content.footer || '', 'Menu', listSections);
                await crmService.saveMessage(toPhone, 'bot', `[Interactive List] ${content.body}`);
            }
        } else if (type === 'transfer') {
            await whatsappService.sendTextMessage(toPhone, content.body || 'Transferring to agent...');
            await crmService.saveMessage(toPhone, 'bot', `[Transfer] ${content.body}`);
        } else {
            await whatsappService.sendTextMessage(toPhone, content.body || '');
            await crmService.saveMessage(toPhone, 'bot', content.body || '');
        }

        if (content.follow_up_text) {
            await whatsappService.sendTextMessage(toPhone, content.follow_up_text);
            await crmService.saveMessage(toPhone, 'bot', content.follow_up_text);
        }

        if (whatomateContactId) {
            await whatomateService.sendOutgoingMessage(whatomateContactId, `🤖 System Rule [${rule.name}]: Replied to user.`);
        }
    }

    async _sendAndSync(toPhone, message, whatomateContactId) {
        await crmService.saveMessage(toPhone, 'bot', message);

        let sentViaCrm = false;
        if (whatomateContactId) {
            sentViaCrm = await whatomateService.sendOutgoingMessage(whatomateContactId, message);
        }
        if (!sentViaCrm) {
            await whatsappService.sendTextMessage(toPhone, message);
            await whatomateService.logMessageDirectlyToDB(toPhone, message, 'outgoing');
        }
    }
}

module.exports = new FlowService();
