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
        // Add trigger keywords to DevSparks so it only activates when relevant
        const keywords = JSON.stringify(["devsparks", "devspark", "aws event", "bangalore event", "devparks"]);
        await pool.query(`
            UPDATE ai_contexts 
            SET trigger_keywords = $1
            WHERE name LIKE '%DevSparks%'
        `, [keywords]);
        
        console.log("DONE: Added trigger keywords to DevSparks context so it only activates when mentioned.");

        // Verify all contexts
        const res = await pool.query(`SELECT name, context_type, trigger_keywords, priority FROM ai_contexts WHERE is_enabled = true AND deleted_at IS NULL ORDER BY priority DESC`);
        console.log("\nAll active contexts after fix:");
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
