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

        const triggerKeywords = JSON.stringify(["apps", "version", "installed apps", "frappe version"]);
        const apiConfig = JSON.stringify({
            url: "http://127.0.0.1:8000/api/method/frappe.utils.change_log.get_versions",
            method: "GET",
            headers: {
                "Authorization": "token 9b44437977f0832:6c074ab77c5e9db"
            }
        });

        const staticContent = "This API fetch provides a list of installed Frappe/ERPNext apps and their current versions. Use this JSON data to answer the user's questions about what apps are installed or what version a specific app is running on.";

        await pool.query(`
            INSERT INTO ai_contexts (
                name, context_type, static_content, trigger_keywords, priority, api_config, is_enabled, organization_id, created_at, updated_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW()
            )
        `, [
            'Frappe Installed Apps', 
            'api', 
            staticContent,
            triggerKeywords,
            130, // Higher priority
            apiConfig,
            true,
            orgId
        ]);
        
        console.log("Successfully inserted Frappe Installed Apps context.");
    } catch (e) {
        console.error("Error:", e);
    } finally {
        pool.end();
    }
}

run();
