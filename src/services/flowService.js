const whatsappService = require('./whatsappService');
const openaiService = require('./openaiService');
const crmService = require('./crmService');
const whatomateService = require('./whatomateService');

class FlowService {
    async handleIncomingMessage(fromPhone, messageObj, user, whatomateContactId = null) {
        try {
            // Only handle text messages for now. Ignore statuses, images, etc.
            if (messageObj.type !== 'text' && messageObj.type !== 'interactive') {
                await whatsappService.sendTextMessage(fromPhone, "Sorry, I can only understand text messages right now. 📷❌");
                return;
            }

            let text = "";
            if (messageObj.type === 'text') {
                text = messageObj.text.body;
            } else if (messageObj.type === 'interactive') {
                text = messageObj.interactive?.button_reply?.title
                    || messageObj.interactive?.list_reply?.title
                    || '';
            }

            const lowerText = text.toLowerCase().trim();
            console.log(`📩 Received from ${fromPhone}: ${text}`);

            // 1. Save user message to CRM context
            await crmService.saveMessage(fromPhone, 'user', text);

            // 2. Check for Keyword Flows
            if (lowerText === 'menu' || lowerText === 'help') {
                await this.sendMenu(fromPhone, whatomateContactId);
                return;
            }

            if (lowerText === 'pricing' || lowerText === 'price' || lowerText === 'prices') {
                const reply = "💰 *Our Pricing*\n\nWe offer competitive prices! Here are some highlights:\n\n• Basic items start from ₹299\n• Premium collection from ₹999\n• Custom orders available on request\n\nReply *Menu* to see other options or just ask me about any specific product! 🛍️";
                await this._sendAndSync(fromPhone, reply, whatomateContactId);
                return;
            }

            if (lowerText === 'contact' || lowerText === 'support') {
                const reply = "📞 *Contact Us*\n\nYou can reach us at:\n📧 prasana@tech4goodcommunity.com\n\nWe're happy to help! 😊";
                await this._sendAndSync(fromPhone, reply, whatomateContactId);
                return;
            }

            if (lowerText === 'products' || lowerText === 'product' || lowerText === 'shop' || lowerText === 'catalog' || lowerText === 'catalogue') {
                const reply = "🛍️ *Our Products*\n\nWe have a wide range of products available! Here are our popular categories:\n\n👗 *Dresses* — Casual, formal & party wear\n👕 *Tops & Shirts* — Trendy styles for every occasion\n👖 *Bottoms* — Jeans, trousers & skirts\n🎀 *Accessories* — Bags, jewelry & more\n\nWould you like to know more about any specific category? Just type the name! 😊\n\nReply *Pricing* for rates or *Menu* for more options.";
                await this._sendAndSync(fromPhone, reply, whatomateContactId);
                return;
            }

            if (lowerText === 'purchase' || lowerText === 'buy' || lowerText === 'order') {
                await this.sendPurchaseMenu(fromPhone, whatomateContactId);
                return;
            }

            // 3. Fallback to AI (Google Gemini / OpenAI)
            // Fetch local history as a fallback; the AI service will prefer PG history
            console.log(`🤖 No keyword match for "${text}", falling back to AI...`);
            const history = await crmService.getRecentMessages(fromPhone, 5);
            const aiReply = await openaiService.generateReply(text, history, fromPhone);

            // Send to user via WhatsApp + sync to CRM
            await this._sendAndSync(fromPhone, aiReply, whatomateContactId);

        } catch (error) {
            console.error("❌ FlowService Error:", error);
            // Send a friendly fallback message so the user never sees silence
            try {
                const fallback = "I'm sorry, something went wrong on my end. Please try again or type *Menu* for options! 🙏";
                await whatsappService.sendTextMessage(fromPhone, fallback);
                await whatomateService.sendOutgoingMessage(whatomateContactId, fallback);
            } catch (e) {
                console.error("❌ FlowService: Even fallback failed:", e.message);
            }
        }
    }

    /**
     * Send a reply to the user via WhatsApp AND sync to both CRM databases.
     * This is the single point where all outgoing messages are dispatched.
     */
    async _sendAndSync(toPhone, message, whatomateContactId) {
        // 1. Send via WhatsApp Cloud API (the actual delivery to user)
        await whatsappService.sendTextMessage(toPhone, message);

        // 2. Save to local SQLite CRM for conversation context
        await crmService.saveMessage(toPhone, 'bot', message);

        // 3. Sync to WhatoMate PostgreSQL CRM (for dashboard visibility)
        if (whatomateContactId) {
            await whatomateService.sendOutgoingMessage(whatomateContactId, message);
        }
    }

    async sendMenu(to, whatomateContactId = null) {
        const header = "Welcome to Dress Shop! 👗";
        const body = "Please choose an option below:";
        const footer = "Powered by Tech4Good Community";
        const buttons = [
            { id: "btn_products", title: "Products" },
            { id: "btn_pricing", title: "Pricing" },
            { id: "btn_purchase", title: "Purchase" }
        ];

        await whatsappService.sendInteractiveButtons(to, header, body, footer, buttons);
        await crmService.saveMessage(to, 'bot', 'Sent Interactive Menu');
    }

    async sendPurchaseMenu(to, whatomateContactId = null) {
        const header = "Ready to Shop? 🛍️";
        const body = "What kind of dress are you looking for today?";
        const footer = "Select a category to see options";
        const buttons = [
            { id: "cat_casual", title: "Casual Wear" },
            { id: "cat_formal", title: "Formal Wear" },
            { id: "cat_party", title: "Party Wear" }
        ];

        await whatsappService.sendInteractiveButtons(to, header, body, footer, buttons);
        await crmService.saveMessage(to, 'bot', 'Sent Purchase Menu');
        
        const reply = "I've sent you some categories to choose from! Once you select one, I'll show you our bestsellers. 👗✨";
        await whatomateService.sendOutgoingMessage(whatomateContactId, reply);
    }
}

module.exports = new FlowService();
