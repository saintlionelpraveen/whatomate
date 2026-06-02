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
        SELECT csm.direction, csm.message
        FROM chatbot_session_messages csm
        JOIN chatbot_sessions cs ON csm.session_id = cs.id
        WHERE cs.phone_number = $1
        ORDER BY csm.created_at DESC
        LIMIT 5
    `, ['918825607244']);
    console.log("Raw PG Rows:", res.rows);
}

run().then(() => process.exit(0)).catch(console.error);
