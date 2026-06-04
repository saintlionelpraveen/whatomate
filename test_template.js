const axios = require('axios');
const config = require('./src/config');
async function run() {
    const contactId = '45bfb2ca-b0d8-4173-8abd-27e4cefbee9f'; // The contact ID from my previous curl test
    const url = `${config.WHATOMATE_API_URL}/contacts/${contactId}/messages`;
    
    const payload = {
        whatsapp_account: config.WHATSAPP_ACCOUNT_NAME,
        type: 'template',
        template: {
            name: 'hello_world',
            language: { code: 'en_US' }
        }
    };
    
    try {
        const res = await axios.post(url, payload, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': config.WHATOMATE_API_KEY,
                'X-API-Key': config.WHATOMATE_API_KEY
            }
        });
        console.log("SUCCESS:", res.data);
    } catch (e) {
        console.error("ERROR:", e.response?.data || e.message);
    }
}
run();
