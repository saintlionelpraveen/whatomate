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
        // FIX 1: Remove trigger keywords so the API is ALWAYS fetched on every message.
        // This ensures the AI always has the real JSON data.
        // The API is local (127.0.0.1:8005) so the latency is negligible.
        await pool.query(`
            UPDATE ai_contexts 
            SET trigger_keywords = NULL,
                static_content = $1
            WHERE name = 'Frappe Whatomate Resource'
        `, [`Below is LIVE JSON data from the Frappe Whatomate API. Use this data to answer any questions about customers, orders, products, or statuses. Only use data from this JSON. Never invent data.`]);
        
        console.log("FIX 1 DONE: Removed trigger keywords + simplified prompt for Whatomate Resource.");

        // FIX 2: Check current contexts to debug
        const res = await pool.query(`SELECT name, context_type, trigger_keywords, priority FROM ai_contexts WHERE is_enabled = true AND deleted_at IS NULL ORDER BY priority DESC`);
        console.log("\nAll active contexts:");
        for (const row of res.rows) {
            console.log(`  - [${row.priority}] ${row.name} (${row.context_type}) keywords: ${JSON.stringify(row.trigger_keywords)}`);
        }

    } catch (e) {
        console.error("Error:", e);
    } finally {
        pool.end();
    }
}

run();
