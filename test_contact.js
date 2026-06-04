const axios = require('axios');
const config = require('./src/config');
async function run() {
    const url = `${config.WHATOMATE_API_URL}/contacts`;
    const payload = { phone_number: '918825607244', name: 'Test User' };
    
    try {
        const res = await axios.post(url, payload, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': config.WHATOMATE_API_KEY,
                'X-API-Key': config.WHATOMATE_API_KEY
            }
        });
        console.log("SUCCESS:", res.status, res.data);
    } catch (e) {
        console.error("ERROR:", e.response?.status, e.response?.data || e.message);
    }
}
run();
