const axios = require('axios');
const config = require('../config');
const { Pool } = require('pg');

// PostgreSQL connection to WhatoMate's database
const pool = new Pool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5433', 10),
    user: process.env.POSTGRES_USER || 'whatomate',
    password: process.env.POSTGRES_PASSWORD || 'whatomate',
    database: process.env.POSTGRES_DB || 'whatomate',
    max: 5,
    idleTimeoutMillis: 30000,
});

class AIService {
    constructor() {
        // Cache for settings + contexts (refreshed every 5 minutes)
        this._cache = null;
        this._cacheTime = 0;
        this._cacheTTL = 5 * 60 * 1000; // 5 minutes
    }

    /**
     * Fetch AI settings (provider, model, API key, system prompt)
     * and AI contexts (product FAQ, etc.) from WhatoMate's PostgreSQL DB.
     * Results are cached for 5 minutes to avoid excessive DB queries.
     */
    async _getSettings() {
        const now = Date.now();
        if (this._cache && (now - this._cacheTime) < this._cacheTTL) {
            return this._cache;
        }

        try {
            // 1. Fetch chatbot settings (AI provider, model, system prompt, etc.)
            const settingsRes = await pool.query(`
                SELECT ai_enabled, ai_provider, ai_api_key, ai_model,
                       ai_max_tokens, ai_temperature, ai_system_prompt,
                       ai_include_history, ai_history_limit, organization_id
                FROM chatbot_settings
                WHERE deleted_at IS NULL AND ai_enabled = true
                ORDER BY updated_at DESC
                LIMIT 1
            `);

            if (settingsRes.rows.length === 0) {
                console.warn('⚠️ [AI] No active chatbot settings found in DB. Using fallback config.');
                return this._fallbackSettings();
            }

            const settings = settingsRes.rows[0];

            // 2. Fetch all active AI contexts for this organization, ordered by priority
            const contextsRes = await pool.query(`
                SELECT name, context_type, static_content, trigger_keywords, priority
                FROM ai_contexts
                WHERE deleted_at IS NULL
                  AND is_enabled = true
                  AND organization_id = $1
                ORDER BY priority DESC
            `, [settings.organization_id]);

            const result = {
                provider: settings.ai_provider || 'google',
                apiKey: settings.ai_api_key || config.GOOGLE_API_KEY,
                model: settings.ai_model || 'gemini-1.5-flash',
                maxTokens: settings.ai_max_tokens || 500,
                temperature: parseFloat(settings.ai_temperature) || 0.7,
                systemPrompt: settings.ai_system_prompt || '',
                includeHistory: settings.ai_include_history !== false,
                historyLimit: settings.ai_history_limit || 4,
                contexts: contextsRes.rows,
            };

            this._cache = result;
            this._cacheTime = now;

            console.log(`✅ [AI] Loaded settings from DB: provider=${result.provider}, model=${result.model}, contexts=${result.contexts.length}`);
            return result;

        } catch (error) {
            console.error('❌ [AI] Failed to fetch settings from DB:', error.message);
            return this._fallbackSettings();
        }
    }

    /**
     * Fallback settings when DB is unavailable — uses config.toml / .env values
     */
    _fallbackSettings() {
        return {
            provider: 'google',
            apiKey: config.GOOGLE_API_KEY,
            model: config.AI_MODEL || 'gemini-1.5-flash',
            maxTokens: 500,
            temperature: 0.7,
            systemPrompt: '',
            includeHistory: true,
            historyLimit: 4,
            contexts: [],
        };
    }

    /**
     * Build the full system prompt by combining:
     *  1. The system prompt from chatbot_settings
     *  2. All active AI contexts (static content)
     *  3. Keyword-matched contexts get priority labeling
     */
    _buildSystemPrompt(settings, userMessage = '') {
        const parts = [];

        // Add the base system prompt from chatbot settings
        if (settings.systemPrompt && settings.systemPrompt.trim()) {
            parts.push(settings.systemPrompt.trim());
        }

        // Add all AI contexts
        if (settings.contexts && settings.contexts.length > 0) {
            const lowerMsg = (userMessage || '').toLowerCase();

            for (const ctx of settings.contexts) {
                if (!ctx.static_content) continue;

                // Check if this context is keyword-triggered
                let isTriggered = false;
                if (ctx.trigger_keywords && Array.isArray(ctx.trigger_keywords)) {
                    isTriggered = ctx.trigger_keywords.some(kw =>
                        lowerMsg.includes(kw.toLowerCase())
                    );
                }

                // Always include context (it's static knowledge), but mark triggered ones
                if (isTriggered) {
                    parts.push(`\n--- RELEVANT CONTEXT: ${ctx.name} (Priority: ${ctx.priority}) ---`);
                } else {
                    parts.push(`\n--- CONTEXT: ${ctx.name} ---`);
                }
                parts.push(ctx.static_content.trim());
            }
        }

        const combined = parts.join('\n\n');

        if (!combined.trim()) {
            // Ultimate fallback if nothing is configured
            return 'You are a helpful customer support assistant. Keep replies short and friendly.';
        }

        return combined;
    }

    async generateReply(userMessage, contextMessages = []) {
        const settings = await this._getSettings();
        const systemPrompt = this._buildSystemPrompt(settings, userMessage);

        try {
            // Route to the configured provider first
            if (settings.provider === 'google' || (!settings.provider && config.GOOGLE_API_KEY)) {
                const apiKey = settings.apiKey || config.GOOGLE_API_KEY;
                if (apiKey) {
                    try {
                        return await this._generateWithGemini(userMessage, contextMessages, { ...settings, apiKey }, systemPrompt);
                    } catch (err) {
                        console.error('❌ [AI] Gemini failed, attempting OpenAI fallback:', err.message);
                        if (config.OPENAI_API_KEY && config.OPENAI_API_KEY !== 'NONE') {
                            return await this._generateWithOpenAI(userMessage, contextMessages, { ...settings, apiKey: config.OPENAI_API_KEY, model: 'gpt-4o-mini' }, systemPrompt);
                        }
                    }
                }
            }

            if (settings.provider === 'openai' || (!settings.provider && config.OPENAI_API_KEY)) {
                const apiKey = settings.apiKey || config.OPENAI_API_KEY;
                if (apiKey && apiKey !== 'NONE') {
                    try {
                        return await this._generateWithOpenAI(userMessage, contextMessages, { ...settings, apiKey }, systemPrompt);
                    } catch (err) {
                        console.error('❌ [AI] OpenAI failed, attempting Gemini fallback:', err.message);
                        if (config.GOOGLE_API_KEY) {
                            return await this._generateWithGemini(userMessage, contextMessages, { ...settings, apiKey: config.GOOGLE_API_KEY, model: 'gemini-2.5-flash' }, systemPrompt);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('❌ [AI] Both AI providers failed:', error.message);
        }

        return "I'm sorry, I'm having trouble connecting to my AI brain right now because the AI service is overloaded. Please try again in a few minutes! 🧠⚡";
    }

    async _generateWithGemini(userMessage, contextMessages = [], settings, systemPrompt) {
        try {
            let model = settings.model || 'gemini-2.5-flash';
            // Upgrade old 1.5 models to 2.5
            if (model.includes('gemini-1.5')) {
                model = 'gemini-2.5-flash';
            }
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${settings.apiKey}`;

            // Build conversation history for Gemini
            const contents = [];

            // Add conversation history
            for (const msg of contextMessages) {
                contents.push({
                    role: msg.role === 'user' ? 'user' : 'model',
                    parts: [{ text: msg.content }]
                });
            }

            // Add current user message
            contents.push({
                role: 'user',
                parts: [{ text: userMessage }]
            });

            const payload = {
                contents: contents,
                system_instruction: {
                    parts: [{ text: systemPrompt }]
                },
                generationConfig: {
                    maxOutputTokens: settings.maxTokens || 500,
                    temperature: settings.temperature || 0.7
                }
            };

            console.log(`🤖 [AI] Sending to Gemini (${model}): "${userMessage}"`);

            const response = await axios.post(url, payload, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 30000
            });

            const reply = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;

            if (!reply) {
                throw new Error('Gemini returned empty response');
            }

            console.log(`✅ [AI] Gemini reply: "${reply.substring(0, 100)}..."`);
            return reply.trim();

        } catch (error) {
            console.error('❌ [AI] Gemini Error Details:', error.response?.data || error.message);
            throw error; // throw to trigger fallback
        }
    }

    async _generateWithOpenAI(userMessage, contextMessages = [], settings, systemPrompt) {
        try {
            const { OpenAI } = require('openai');
            const openai = new OpenAI({
                apiKey: settings.apiKey,
            });

            const messages = [
                { role: "system", content: systemPrompt },
            ];

            contextMessages.forEach(msg => {
                messages.push({
                    role: msg.role === 'user' ? 'user' : 'assistant',
                    content: msg.content
                });
            });

            messages.push({ role: "user", content: userMessage });

            console.log(`🤖 [AI] Sending to OpenAI (${settings.model || "gpt-4o-mini"}): "${userMessage}"`);
            
            const response = await openai.chat.completions.create({
                model: settings.model || "gpt-4o-mini",
                messages: messages,
                max_tokens: settings.maxTokens || 500,
                temperature: settings.temperature || 0.7
            });

            const reply = response.choices[0].message.content.trim();
            console.log(`✅ [AI] OpenAI reply: "${reply.substring(0, 100)}..."`);
            return reply;
        } catch (error) {
            console.error("❌ [AI] OpenAI Error Details:", error.message);
            throw error; // throw to trigger fallback
        }
    }

    /**
     * Force refresh the cached settings (call after updating AI contexts in the UI)
     */
    clearCache() {
        this._cache = null;
        this._cacheTime = 0;
        console.log('🔄 [AI] Settings cache cleared');
    }
}

module.exports = new AIService();
