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
        const orgRes = await pool.query('SELECT organization_id FROM chatbot_settings LIMIT 1');
        const orgId = orgRes.rows[0]?.organization_id;
        
        if (!orgId) {
            console.error("No organization_id found");
            process.exit(1);
        }

        const triggerKeywords = JSON.stringify(["whatomate", "whatomate details", "whatomate doctype", "whatomate resource", "frappe whatomate"]);
        
        const apiConfig = JSON.stringify({
            url: 'http://127.0.0.1:8005/api/resource/Whatomate?fields=["*"]&limit_page_length=None',
            method: "GET",
            headers: {
                "Authorization": "token 9b44437977f0832:6c074ab77c5e9db"
            }
        });

        const staticContent = "This API fetch provides raw JSON data from the Frappe 'Whatomate' Doctype. Please carefully analyze the JSON provided below. Read through the data array and summarize exactly what fields and records exist inside this Whatomate resource. If there are many records, provide a concise summary or a bulleted list of the most important items so that the WhatsApp message remains easily readable.";

        await pool.query(`
            INSERT INTO ai_contexts (
                name, context_type, static_content, trigger_keywords, priority, api_config, is_enabled, organization_id, created_at, updated_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW()
            )
        `, [
            'Frappe Whatomate Resource', 
            'api', 
            staticContent,
            triggerKeywords,
            140, // High priority
            apiConfig,
            true,
            orgId
        ]);
        
        console.log("Successfully inserted Frappe Whatomate Resource context.");
    } catch (e) {
        console.error("Error:", e);
    } finally {
        pool.end();
    }
}

run();
