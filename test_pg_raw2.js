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
    const res = await pool.query(`
        SELECT DISTINCT direction
        FROM chatbot_session_messages
    `);
    console.log("Distinct Directions:", res.rows);
}

run().then(() => process.exit(0)).catch(console.error);
