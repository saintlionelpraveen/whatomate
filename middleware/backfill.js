const { Pool } = require('pg');
const pgPool = new Pool({
    host: '127.0.0.1',
    port: 5433,
    user: 'whatomate',
    password: 'whatomate',
    database: 'whatomate'
});

async function run() {
    const subs = await pgPool.query(`SELECT * FROM whatsapp_flow_submissions`);
    for (const sub of subs.rows) {
        const phone = sub.phone_number;
        const time = sub.created_at;
        
        // Find closest chatbot session
        const sessionRes = await pgPool.query(`
            SELECT id, session_data FROM chatbot_sessions 
            WHERE phone_number = $1 AND ABS(EXTRACT(EPOCH FROM (created_at - $2))) < 60
            LIMIT 1
        `, [phone, time]);
        
        if (sessionRes.rows.length > 0) {
            const session = sessionRes.rows[0];
            let data = typeof session.session_data === 'string' ? JSON.parse(session.session_data) : session.session_data;
            const payload = typeof sub.response_data === 'string' ? JSON.parse(sub.response_data) : sub.response_data;
            
            data = { ...data, ...payload };
            await pgPool.query(`UPDATE chatbot_sessions SET session_data = $1 WHERE id = $2`, [JSON.stringify(data), session.id]);
            console.log(`Updated session for ${phone}`);
        }
    }
    console.log("Done");
    process.exit(0);
}
run();
