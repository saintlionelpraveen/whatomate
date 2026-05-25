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
                text = messageObj.interactive.button_reply.title;
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
                await crmService.saveMessage(fromPhone, 'bot', reply);
                await whatomateService.sendOutgoingMessage(whatomateContactId, reply);
                return;
            }

            if (lowerText === 'contact' || lowerText === 'support') {
                const reply = "📞 *Contact Us*\n\nYou can reach us at:\n📧 prasana@tech4goodcommunity.com\n\nWe're happy to help! 😊";
                await crmService.saveMessage(fromPhone, 'bot', reply);
                await whatomateService.sendOutgoingMessage(whatomateContactId, reply);
                return;
            }

            if (lowerText === 'products' || lowerText === 'product' || lowerText === 'shop' || lowerText === 'catalog' || lowerText === 'catalogue') {
                const reply = "🛍️ *Our Products*\n\nWe have a wide range of products available! Here are our popular categories:\n\n👗 *Dresses* — Casual, formal & party wear\n👕 *Tops & Shirts* — Trendy styles for every occasion\n👖 *Bottoms* — Jeans, trousers & skirts\n🎀 *Accessories* — Bags, jewelry & more\n\nWould you like to know more about any specific category? Just type the name! 😊\n\nReply *Pricing* for rates or *Menu* for more options.";
                await crmService.saveMessage(fromPhone, 'bot', reply);
                await whatomateService.sendOutgoingMessage(whatomateContactId, reply);
                return;
            }

            if (lowerText === 'purchase' || lowerText === 'buy' || lowerText === 'order') {
                await this.sendPurchaseMenu(fromPhone, whatomateContactId);
                return;
            }

            // 3. Fallback to AI (Google Gemini / OpenAI)
            // Fetch last 5 messages for context
            console.log(`🤖 No keyword match for "${text}", falling back to AI...`);
            const history = await crmService.getRecentMessages(fromPhone, 5);
            const aiReply = await openaiService.generateReply(text, history);

            // Save to DB and let WhatoMate CRM trigger the actual dispatch 
            await crmService.saveMessage(fromPhone, 'bot', aiReply);
            await whatomateService.sendOutgoingMessage(whatomateContactId, aiReply);

        } catch (error) {
            console.error("❌ FlowService Error:", error);
            // Send a friendly fallback message so the user never sees silence
            try {
                const fallback = "I'm sorry, something went wrong on my end. Please try again or type *Menu* for options! 🙏";
                await whatomateService.sendOutgoingMessage(whatomateContactId, fallback);
            } catch (e) {
                console.error("❌ FlowService: Even fallback failed:", e.message);
            }
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
