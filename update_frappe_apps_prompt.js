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
        const newStaticContent = "This API fetch provides detailed JSON data about all installed Frappe/ERPNext apps on the server. When the user asks about the apps, you MUST read the ENTIRE JSON and provide ALL details available for each app. Do not skip any information. You must explicitly list the Title, Description, Branch, and Version for every single app found in the JSON data.";

        await pool.query(`
            UPDATE ai_contexts 
            SET static_content = $1
            WHERE name = 'Frappe Installed Apps'
        `, [newStaticContent]);
        
        console.log("Successfully updated Frappe Installed Apps prompt to include all details.");
    } catch (e) {
        console.error("Error:", e);
    } finally {
        pool.end();
    }
}

run();
