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
        const newStaticContent = "This API fetch provides detailed JSON data about installed Frappe/ERPNext apps. Because there are dozens of sub-apps (like 'India Payroll' variants), you MUST NOT list every single app. Instead, summarize the response: Pick the top 5-7 core apps (such as Frappe Framework, ERPNext, HRMS, CRM, Bench Manager) and provide their FULL details (Title, Description, Branch, Version). Then, add a final sentence summarizing that there are many other regional/minor apps installed (e.g., 'along with 50+ localized payroll apps'). Keep the WhatsApp message readable and concise.";

        await pool.query(`
            UPDATE ai_contexts 
            SET static_content = $1
            WHERE name = 'Frappe Installed Apps'
        `, [newStaticContent]);
        
        console.log("Successfully updated Frappe Installed Apps prompt to summarize.");
    } catch (e) {
        console.error("Error:", e);
    } finally {
        pool.end();
    }
}

run();
