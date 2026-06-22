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

    async sendInteractiveList(to, header, body, footer, buttonText, sections) {
        try {
            await axios.post(
                this.baseUrl,
                {
                    messaging_product: 'whatsapp',
                    recipient_type: 'individual',
                    to: to,
                    type: 'interactive',
                    interactive: {
                        type: 'list',
                        header: { type: 'text', text: header },
                        body: { text: body },
                        footer: { text: footer },
                        action: {
                            button: buttonText,
                            sections: sections,
                        },
                    },
                },
                {
                    headers: {
                        Authorization: `Bearer ${this.token}`,
                        'Content-Type': 'application/json',
                    },
                }
            );
            console.log(`✅ Interactive list sent to ${to}`);
        } catch (error) {
            console.error(`❌ Failed to send list to ${to}:`, error.response?.data || error.message);
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

    /**
     * Trigger a native WhatsApp Flow (like "IDLISTACK Onboarding").
     * @returns {boolean} true if the flow was sent successfully, false on failure.
     */
    async sendFlowMessage(to, header, body, footer, flowId, flowToken = "UNIQUE_TOKEN", flowCta = "Open Flow", flowScreen = "SCREEN_A") {
        try {
            // Build interactive object — only include header/footer if non-empty
            // WhatsApp API rejects empty header.text or footer.text (min length 1)
            const interactive = {
                type: "flow",
                body: { text: body || "Tap below to continue" },
                action: {
                    name: "flow",
                    parameters: {
                        flow_message_version: "3",
                        flow_token: flowToken,
                        flow_id: flowId,
                        flow_cta: flowCta || "Open Flow",
                        flow_action: "navigate",
                        flow_action_payload: {
                            screen: flowScreen // Starting screen of your flow
                        }
                    }
                }
            };

            if (header && header.trim()) {
                interactive.header = { type: "text", text: header };
            }
            if (footer && footer.trim()) {
                interactive.footer = { text: footer };
            }

            await axios.post(
                this.baseUrl,
                {
                    messaging_product: "whatsapp",
                    recipient_type: "individual",
                    to: to,
                    type: "interactive",
                    interactive
                },
                {
                    headers: {
                        Authorization: `Bearer ${this.token}`,
                        "Content-Type": "application/json",
                    }
                }
            );
            console.log(`✅ WhatsApp Flow (${flowId}) sent to ${to}`);
            return true;
        } catch (error) {
            console.error(`❌ Failed to send flow to ${to}:`, error.response?.data || error.message);
            return false;
        }
    }

    /**
     * Send a media message (image, video, document/pdf, audio) to a WhatsApp number.
     * @param {string} to - The recipient phone number
     * @param {string} mediaType - 'image', 'video', 'document', or 'audio'
     * @param {string} mediaUrl - A publicly accessible URL to the media file
     * @param {string} [caption] - Optional caption for image, video, or document
     * @param {string} [filename] - Optional filename, specifically useful for documents/PDFs
     */
    async sendMediaMessage(to, mediaType, mediaUrl, caption = '', filename = '') {
        const allowedTypes = ['image', 'video', 'document', 'audio'];
        if (!allowedTypes.includes(mediaType)) {
            console.error(`❌ Invalid mediaType: ${mediaType}. Allowed: ${allowedTypes.join(', ')}`);
            return false;
        }

        const mediaObject = { link: mediaUrl };
        if (caption) mediaObject.caption = caption;
        if (mediaType === 'document' && filename) mediaObject.filename = filename;

        const payload = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: to,
            type: mediaType,
            [mediaType]: mediaObject
        };

        try {
            await axios.post(this.baseUrl, payload, {
                headers: {
                    Authorization: `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                }
            });
            console.log(`✅ ${mediaType} sent to ${to} (URL: ${mediaUrl})`);
            return true;
        } catch (error) {
            console.error(`❌ Failed to send ${mediaType} to ${to}:`, error.response?.data || error.message);
            return false;
        }
    }

    /**
     * Send an interactive CTA URL button that opens a webpage when tapped.
     * @param {string} to - Recipient phone number
     * @param {string} header - Header text
     * @param {string} body - Body text
     * @param {string} footer - Footer text
     * @param {string} buttonText - Text displayed on the button (max 20 chars)
     * @param {string} url - The URL to open when the button is tapped
     */
    async sendCTAUrlButton(to, header, body, footer, buttonText, url) {
        try {
            await axios.post(
                this.baseUrl,
                {
                    messaging_product: 'whatsapp',
                    recipient_type: 'individual',
                    to: to,
                    type: 'interactive',
                    interactive: {
                        type: 'cta_url',
                        header: { type: 'text', text: header },
                        body: { text: body },
                        footer: { text: footer },
                        action: {
                            name: 'cta_url',
                            parameters: {
                                display_text: buttonText,
                                url: url
                            }
                        }
                    }
                },
                {
                    headers: {
                        Authorization: `Bearer ${this.token}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            console.log(`✅ CTA URL button sent to ${to}: ${url}`);
            return true;
        } catch (error) {
            console.error(`❌ Failed to send CTA URL to ${to}:`, error.response?.data || error.message);
            return false;
        }
    }
}

module.exports = new WhatsAppService();
