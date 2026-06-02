const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5433', 10),
    user: process.env.POSTGRES_USER || 'whatomate',
    password: process.env.POSTGRES_PASSWORD || 'whatomate',
    database: process.env.POSTGRES_DB || 'whatomate',
});

async function run() {
    try {
        // Fetch organization ID from settings
        const orgRes = await pool.query('SELECT organization_id FROM chatbot_settings LIMIT 1');
        const orgId = orgRes.rows[0]?.organization_id;
        
        if (!orgId) {
            console.error("No organization_id found in chatbot_settings");
            process.exit(1);
        }

        const triggerKeywords = JSON.stringify(["gold", "rate", "price", "gold rate"]);
        const apiConfig = JSON.stringify({
            url: "http://127.0.0.1:8080/api/gold-rate",
            method: "GET",
            headers: {}
        });

        const staticContent = "This context provides live gold rates. When you receive the JSON API response, answer the user's question accurately in a short, friendly sentence. Mention both USD and INR if appropriate, or just the one they asked about.";

        await pool.query(`
            INSERT INTO ai_contexts (
                name, context_type, static_content, trigger_keywords, priority, api_config, is_enabled, organization_id, created_at, updated_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW()
            )
        `, [
            'Live Gold Rate', 
            'api', 
            staticContent,
            triggerKeywords,
            110, // High priority
            apiConfig,
            true,
            orgId
        ]);
        
        console.log("Successfully inserted Gold Rate API context.");
    } catch (e) {
        console.error("Error:", e);
    } finally {
        pool.end();
    }
}

run();
