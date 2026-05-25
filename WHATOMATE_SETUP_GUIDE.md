# WhatoMate: Complete Setup & Configuration Guide

This guide walks you through the complete process of setting up WhatoMate, from creating your Meta WhatsApp App to configuring your AI chatbot and running campaigns.

---

## 1. Meta WhatsApp Cloud API Setup
To send and receive WhatsApp messages, you need to create an app in the Meta Developer portal.

### Steps:
1. Go to [Meta for Developers](https://developers.facebook.com/) and log in.
2. Click **Create App** > Select **Other** > Select **Business**.
3. Name your app (e.g., "WhatoMate CRM").
4. Once created, scroll down to **WhatsApp** and click **Set Up**.
5. You will be provided with a **Test Phone Number** and a **Temporary Access Token**.
6. **Save these credentials**, you will need them later:
   - `WHATSAPP_TOKEN` (The Access Token)
   - `WHATSAPP_PHONE_ID` (The Phone Number ID)

---

## 2. Webhook Configuration (Receiving Messages)
To make your bot reply to user messages, Meta needs a URL to send incoming messages to.

### Steps:
1. **Start ngrok** to expose your local Node.js middleware to the internet:
   ```bash
   ngrok http 8080
   ```
2. Copy the `https://...ngrok-free.dev` URL.
3. In your Meta Developer Dashboard, go to **WhatsApp > Configuration**.
4. Click **Edit Webhook**.
5. **Callback URL**: Enter `https://your-ngrok-url.ngrok-free.dev/api/webhook`
6. **Verify Token**: Enter your custom verification token (e.g., `6d70c8fbb27078d0...` from your `.env` file).
7. Click **Verify and Save**.
8. Under **Webhook fields**, click **Manage** and subscribe to `messages`.

---

## 3. WhatoMate Environment Setup
Your project has two main parts: The Go CRM Dashboard (Port 3000) and the Node.js Middleware (Port 8080).

### Updating `.env` (Node.js Middleware)
Edit the `.env` file in your working directory with the details from Meta:
```env
PORT=8080
WHATSAPP_TOKEN=your_meta_access_token
WHATSAPP_PHONE_ID=your_meta_phone_number_id
WHATSAPP_VERIFY_TOKEN=your_custom_verify_token

# AI Keys
GOOGLE_API_KEY=your_gemini_api_key
OPENAI_API_KEY=your_openai_api_key

# Database Connection (To read AI Contexts)
DB_HOST=127.0.0.1
DB_PORT=5433
POSTGRES_USER=whatomate
POSTGRES_PASSWORD=whatomate
POSTGRES_DB=whatomate
```

---

## 4. AI Chatbot Configuration
WhatoMate uses a hybrid chatbot. It checks for exact keywords first, and if nothing matches, it forwards the question to the AI (Gemini or OpenAI).

### Configuring the AI Brain
1. Open your WhatoMate CRM Dashboard (`http://localhost:3000`).
2. Go to **Settings > Chatbot Settings**.
3. **Select Provider**: Choose `Google` (Gemini) or `OpenAI` (ChatGPT).
4. **System Prompt**: Define the personality (e.g., *"You are a helpful assistant for Dress Shop Chennai..."*).
5. **AI Contexts (Knowledge Base)**: 
   - Add contexts like "Product FAQ", "Return Policy", etc.
   - The AI will automatically read this data and use it to answer user questions correctly.
   - *Note: Our middleware is configured to automatically fallback to OpenAI if Google Gemini is overloaded!*

---

## 5. Setting up Hardcoded Flows (Menus & Buttons)
Sometimes you don't want AI; you want exact buttons and menus.

1. Open `src/services/flowService.js`.
2. Look for the `handleIncomingMessage` function.
3. You can define exact keyword triggers here:
   ```javascript
   if (lowerText === 'pricing') {
       const reply = "💰 *Our Pricing* ...";
       await whatomateService.sendOutgoingMessage(whatomateContactId, reply);
       return;
   }
   ```
4. You can also trigger interactive buttons using the built-in `whatsappService.sendInteractiveButtons` method.

---

## 6. WhatsApp Templates & Campaigns
To send proactive messages (campaigns or blasts) to users outside the 24-hour customer service window, you MUST use pre-approved Message Templates.

### Creating Templates
1. Go to **WhatsApp Manager** > **Account Tools** > **Message Templates**.
2. Click **Create Template**.
3. Choose a category (Marketing, Utility, Authentication).
4. Write your message. You can include variables like `{{1}}` for names.
5. Submit for approval (usually takes a few minutes to a few hours).

### Running a Campaign in WhatoMate
1. Once your template is approved by Meta, sync it in the WhatoMate Dashboard under the **Templates** tab.
2. Go to the **Campaigns** tab.
3. Select your audience (Contacts).
4. Choose the approved Template.
5. Map any variables (e.g., mapping `{{1}}` to the contact's First Name).
6. Click **Send Campaign**. WhatoMate will bulk dispatch the approved template to all selected contacts.

---

## 🚀 Summary Checklist for Production
- [ ] Meta App is live and `messages` webhook is subscribed.
- [ ] Ngrok (or a real domain like Nginx/Cloudflare) is pointing to your Node.js port `8080`.
- [ ] `.env` has valid API keys for Meta, Google/OpenAI, and Database.
- [ ] Node.js middleware is running via PM2 (`npx pm2 start src/server.js --name whatomate`).
- [ ] WhatoMate Docker container is running (`docker compose up -d`).
- [ ] Chatbot settings and AI Contexts are saved in the Dashboard.

You are now fully set up to run WhatoMate! 🎉
