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
        const apiConfig = JSON.stringify({
            url: "http://127.0.0.1:8005/api/method/frappe.utils.change_log.get_versions",
            method: "GET",
            headers: {
                "Authorization": "token 9b44437977f0832:6c074ab77c5e9db"
            }
        });

        // Add more trigger keywords to make sure it triggers easily
        const triggerKeywords = JSON.stringify(["app", "apps", "version", "installed apps", "frappe version", "bench manager", "framework", "what is installed"]);

        await pool.query(`
            UPDATE ai_contexts 
            SET api_config = $1, trigger_keywords = $2
            WHERE name = 'Frappe Installed Apps'
        `, [apiConfig, triggerKeywords]);
        
        console.log("Successfully updated Frappe Installed Apps port and keywords.");
    } catch (e) {
        console.error("Error:", e);
    } finally {
        pool.end();
    }
}

run();
