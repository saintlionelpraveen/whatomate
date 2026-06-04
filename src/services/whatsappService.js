const axios = require('axios');
const config = require('../config');

class WhatsAppService {
    constructor() {
        this.token = config.WHATSAPP_TOKEN;
        this.phoneId = config.WHATSAPP_PHONE_ID;
        this.baseUrl = `https://graph.facebook.com/v18.0/${this.phoneId}/messages`;
    }

    async sendTextMessage(to, text) {
        try {
            await axios.post(
                this.baseUrl,
                {
                    messaging_product: 'whatsapp',
                    recipient_type: 'individual',
                    to: to,
                    type: 'text',
                    text: { preview_url: false, body: text }
                },
                {
                    headers: {
                        Authorization: `Bearer ${this.token}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            console.log(`✅ Message sent to ${to}`);
        } catch (error) {
            console.error(`❌ Failed to send message to ${to}:`, error.response?.data || error.message);
        }
    }

    async sendInteractiveButtons(to, header, body, footer, buttons) {
        try {
            const formattedButtons = buttons.map((btn) => ({
                type: "reply",
                reply: {
                    id: btn.id,
                    title: btn.title,
                },
            }));

            await axios.post(
                this.baseUrl,
                {
                    messaging_product: "whatsapp",
                    recipient_type: "individual",
                    to: to,
                    type: "interactive",
                    interactive: {
                        type: "button",
                        header: { type: "text", text: header },
                        body: { text: body },
                        footer: { text: footer },
                        action: { buttons: formattedButtons },
                    },
                },
                {
                    headers: {
                        Authorization: `Bearer ${this.token}`,
                        "Content-Type": "application/json",
                    },
                }
            );
            console.log(`✅ Interactive menu sent to ${to}`);
        } catch (error) {
            console.error(`❌ Failed to send menu to ${to}:`, error.response?.data || error.message);
        }
    }

    async sendTemplateMessage(to, templateName, languageCode = 'en_US') {
        try {
            await axios.post(
                this.baseUrl,
                {
                    messaging_product: 'whatsapp',
                    recipient_type: 'individual',
                    to: to,
                    type: 'template',
                    template: {
                        name: templateName,
                        language: { code: languageCode }
                    }
                },
                {
                    headers: {
                        Authorization: `Bearer ${this.token}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            console.log(`✅ Template ${templateName} sent to ${to}`);
        } catch (error) {
            console.error(`❌ Failed to send template ${templateName} to ${to}:`, error.response?.data || error.message);
        }
    }
}

module.exports = new WhatsAppService();
