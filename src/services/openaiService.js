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
    connectionTimeoutMillis: 5000,
});

// Handle pool-level errors so they don't crash the process
pool.on('error', (err) => {
    console.error('❌ [AI] PostgreSQL pool error (non-fatal):', err.message);
});

// Validate pool on startup
pool.query('SELECT 1')
    .then(() => console.log('✅ [AI] PostgreSQL pool connected'))
    .catch((err) => console.error('⚠️ [AI] PostgreSQL pool initial check failed:', err.message));

// Known-good Gemini model names (ordered by preference)
const GEMINI_MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];

/**
 * Mask an API key for safe logging: show first 8 and last 4 chars only.
 */
function maskKey(key) {
    if (!key || key.length < 16) return '***';
    return key.substring(0, 8) + '...' + key.substring(key.length - 4);
}

/**
 * Retry a function with exponential backoff.
 * Retries on 429 (rate limit) and 5xx errors; does NOT retry 401/403 (auth).
 */
async function retryWithBackoff(fn, maxRetries = 2, baseDelayMs = 1000) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;
            const status = err.response?.status || err.status || 0;

            // Don't retry on auth errors — they won't resolve by retrying
            if (status === 401 || status === 403) {
                console.error(`❌ [AI] Auth error (${status}), not retrying`);
                throw err;
            }

            // Don't retry on billing/quota exhaustion — also won't resolve
            if (err.code === 'insufficient_quota' || err.type === 'insufficient_quota') {
                console.error(`❌ [AI] Quota exhausted (${err.code}), not retrying`);
                throw err;
            }

            if (attempt < maxRetries) {
                // Use Retry-After header if provided, otherwise exponential backoff
                const retryAfter = err.response?.headers?.['retry-after'];
                const delayMs = retryAfter
                    ? parseInt(retryAfter, 10) * 1000
                    : baseDelayMs * Math.pow(2, attempt);
                const safeDelay = Math.min(delayMs || baseDelayMs, 10000);
                console.warn(`⏳ [AI] Retry ${attempt + 1}/${maxRetries} in ${safeDelay}ms (status: ${status})`);
                await new Promise(resolve => setTimeout(resolve, safeDelay));
            }
        }
    }
    throw lastError;
}

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
                model: settings.ai_model || 'gemini-2.0-flash',
                maxTokens: settings.ai_max_tokens || 500,
                temperature: parseFloat(settings.ai_temperature) || 0.7,
                systemPrompt: settings.ai_system_prompt || '',
                includeHistory: settings.ai_include_history !== false,
                historyLimit: settings.ai_history_limit || 4,
                organizationId: settings.organization_id,
                contexts: contextsRes.rows,
            };

            this._cache = result;
            this._cacheTime = now;

            console.log(`✅ [AI] Loaded settings from DB: provider=${result.provider}, model=${result.model}, contexts=${result.contexts.length}, key=${maskKey(result.apiKey)}`);
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
            model: config.AI_MODEL || 'gemini-2.0-flash',
            maxTokens: 500,
            temperature: 0.7,
            systemPrompt: '',
            includeHistory: true,
            historyLimit: 4,
            organizationId: null,
            contexts: [],
        };
    }

    /**
     * Fetch conversation history from WhatoMate's PostgreSQL chatbot_session_messages.
     * Falls back to empty array if unavailable.
     */
    async getConversationHistory(phoneNumber, limit = 4) {
        try {
            const res = await pool.query(`
                SELECT csm.direction, csm.message
                FROM chatbot_session_messages csm
                JOIN chatbot_sessions cs ON csm.session_id = cs.id
                WHERE cs.phone_number = $1
                  AND cs.deleted_at IS NULL
                  AND csm.deleted_at IS NULL
                  AND csm.message IS NOT NULL
                  AND csm.message != ''
                ORDER BY csm.created_at DESC
                LIMIT $2
            `, [phoneNumber, limit]);

            // Convert WhatoMate's direction format to OpenAI-style roles
            // and reverse to chronological order
            return res.rows.reverse().map(row => ({
                role: row.direction === 'inbound' ? 'user' : 'assistant',
                content: row.message,
            }));
        } catch (error) {
            console.warn('⚠️ [AI] Failed to fetch conversation history from PG:', error.message);
            return [];
        }
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

    /**
     * Normalize a Gemini model name to a known-good version.
     */
    _normalizeGeminiModel(model) {
        if (!model) return 'gemini-2.0-flash';
        
        // Always upgrade 1.5 models as they may not be available for new keys
        if (model.includes('gemini-1.5')) return 'gemini-2.0-flash';
        
        // Upgrade 2.5 to 2.0 just to be safe, though 2.5 is available now
        if (model.includes('gemini-2.5')) return 'gemini-2.0-flash';

        return model; 
    }

    async generateReply(userMessage, contextMessages = [], phoneNumber = null) {
        const settings = await this._getSettings();
        const systemPrompt = this._buildSystemPrompt(settings, userMessage);

        // If we have a phone number and history is enabled, fetch PG history
        let history = contextMessages;
        if (phoneNumber && settings.includeHistory) {
            const pgHistory = await this.getConversationHistory(phoneNumber, settings.historyLimit);
            if (pgHistory.length > 0) {
                history = pgHistory;
                console.log(`📜 [AI] Using ${pgHistory.length} messages from PG history for ${phoneNumber}`);
            } else if (contextMessages.length > 0) {
                console.log(`📜 [AI] Using ${contextMessages.length} messages from local SQLite for ${phoneNumber}`);
            }
        }

        // Log system prompt size for debugging (but not the content to avoid leaking data)
        console.log(`📝 [AI] System prompt: ${systemPrompt.length} chars, ${settings.contexts.length} contexts loaded`);

        // ── Try primary provider ────────────────────────────────────────────
        const primaryIsGoogle = settings.provider === 'google' || (!settings.provider && config.GOOGLE_API_KEY);
        const primaryIsOpenAI = settings.provider === 'openai' || (!settings.provider && !config.GOOGLE_API_KEY && config.OPENAI_API_KEY);

        // Attempt 1: Primary provider
        if (primaryIsGoogle) {
            const apiKey = settings.apiKey || config.GOOGLE_API_KEY;
            if (apiKey) {
                try {
                    return await retryWithBackoff(
                        () => this._generateWithGemini(userMessage, history, { ...settings, apiKey }, systemPrompt),
                        1
                    );
                } catch (err) {
                    console.error(`❌ [AI] Gemini failed after retries: ${err.message}`);
                }
            }
        }

        if (primaryIsOpenAI) {
            const apiKey = settings.apiKey || config.OPENAI_API_KEY;
            if (apiKey && apiKey !== 'NONE') {
                try {
                    return await retryWithBackoff(
                        () => this._generateWithOpenAI(userMessage, history, { ...settings, apiKey }, systemPrompt),
                        1
                    );
                } catch (err) {
                    console.error(`❌ [AI] OpenAI (primary) failed after retries: ${err.message}`);
                }
            }
        }

        // Attempt 2: Fallback to the other provider
        if (primaryIsGoogle && config.OPENAI_API_KEY && config.OPENAI_API_KEY !== 'NONE') {
            try {
                console.log('🔄 [AI] Falling back to OpenAI...');
                return await retryWithBackoff(
                    () => this._generateWithOpenAI(userMessage, history, {
                        ...settings,
                        apiKey: config.OPENAI_API_KEY,
                        model: 'gpt-4o-mini'
                    }, systemPrompt),
                    1
                );
            } catch (err) {
                console.error(`❌ [AI] OpenAI fallback also failed: ${err.message}`);
            }
        }

        if (primaryIsOpenAI && config.GOOGLE_API_KEY) {
            try {
                console.log('🔄 [AI] Falling back to Gemini...');
                return await retryWithBackoff(
                    () => this._generateWithGemini(userMessage, history, {
                        ...settings,
                        apiKey: config.GOOGLE_API_KEY,
                        model: 'gemini-2.0-flash'
                    }, systemPrompt),
                    1
                );
            } catch (err) {
                console.error(`❌ [AI] Gemini fallback also failed: ${err.message}`);
            }
        }

        // All providers failed
        console.error('🚨 [AI] ALL AI providers failed. Check your API keys and billing.');
        return "I'm sorry, I'm having trouble connecting right now. Let me connect you to our team for help. Please type *menu* or try again in a moment! 🙏";
    }

    async _generateWithGemini(userMessage, contextMessages = [], settings, systemPrompt) {
        const model = this._normalizeGeminiModel(settings.model);
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

        console.log(`🤖 [AI] Sending to Gemini (${model}): "${userMessage.substring(0, 80)}..."`);

        const response = await axios.post(url, payload, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000
        });

        const reply = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!reply) {
            // Check for blocked content
            const finishReason = response.data?.candidates?.[0]?.finishReason;
            if (finishReason === 'SAFETY') {
                console.warn('⚠️ [AI] Gemini response blocked by safety filters');
                throw new Error('Gemini response blocked by safety filters');
            }
            throw new Error('Gemini returned empty response');
        }

        console.log(`✅ [AI] Gemini reply (${reply.length} chars): "${reply.substring(0, 100)}..."`);
        return reply.trim();
    }

    async _generateWithOpenAI(userMessage, contextMessages = [], settings, systemPrompt) {
        const { OpenAI } = require('openai');
        
        const openaiConfig = {
            apiKey: settings.apiKey,
            timeout: 30000,
        };
        
        // Support for custom OpenAI-compatible providers (Nvidia, Groq, OpenRouter)
        if (config.OPENAI_BASE_URL) {
            openaiConfig.baseURL = config.OPENAI_BASE_URL;
        }

        const openai = new OpenAI(openaiConfig);

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

        let modelName = settings.model || "gpt-4o-mini";
        
        // If we are using standard OpenAI, don't pass 'gemini-*' model names to it
        // However, if we are using a custom provider (like OpenRouter), they MIGHT support 'gemini-*' names!
        const isCustomProvider = !!config.OPENAI_BASE_URL;
        if (!isCustomProvider && modelName.startsWith('gemini')) {
            modelName = 'gpt-4o-mini';
        }

        console.log(`🤖 [AI] Sending to OpenAI-Compatible API (${modelName}): "${userMessage.substring(0, 80)}..."`);

        const response = await openai.chat.completions.create({
            model: modelName,
            messages: messages,
            max_tokens: settings.maxTokens || 500,
            temperature: settings.temperature || 0.7
        });

        const reply = response.choices[0].message.content.trim();
        console.log(`✅ [AI] OpenAI API reply (${reply.length} chars): "${reply.substring(0, 100)}..."`);
        return reply;
    }

    /**
     * Force refresh the cached settings (call after updating AI contexts in the UI)
     */
    clearCache() {
        this._cache = null;
        this._cacheTime = 0;
        console.log('🔄 [AI] Settings cache cleared');
    }

    /**
     * Health check — verify DB and AI provider connectivity
     */
    async healthCheck() {
        const checks = { db: false, provider: 'unknown', hasApiKey: false };

        try {
            await pool.query('SELECT 1');
            checks.db = true;
        } catch (e) {
            checks.dbError = e.message;
        }

        try {
            const settings = await this._getSettings();
            checks.provider = settings.provider;
            checks.hasApiKey = !!(settings.apiKey);
            checks.model = settings.model;
            checks.contextCount = settings.contexts?.length || 0;
        } catch (e) {
            checks.settingsError = e.message;
        }

        return checks;
    }
}

module.exports = new AIService();
