-- Create new Idlistack flow with production-ready graph
-- This replaces the old broken flow

INSERT INTO chatbot_flows (
    id, created_at, updated_at, organization_id, whats_app_account,
    name, is_enabled, description, trigger_keywords, initial_message,
    completion_message, cancel_keywords, graph
) VALUES (
    gen_random_uuid(),
    NOW(), NOW(),
    'd97804d7-adb6-4538-b792-4b574c4b1615',
    'Tech4Good Community',
    'Idlistack',
    true,
    'Interactive Idlistack discovery flow - open-source platform for nonprofits',
    '["idlistack", "opensource", "open source", "open-source", "idli"]'::jsonb,
    E'\U0001F64F Namaste! Welcome to *Idlistack* \u2014 the open-source platform built for changemakers.',
    E'\U0001F64F Thank you for exploring Idlistack! We''d love to hear from you.\n\n\U0001F4AC *Get in touch with us!*\nWhether you need help choosing the right tool, want to join our beta community, or just want to say hi \u2014 we''re here for you!\n\n\U0001F310 Visit us: https://idlistack.com\n\U0001F4F8 Instagram: @tech4goodcommunity\n\U0001F4BC LinkedIn: Tech4Good Community\n\U0001F4D8 Facebook: Tech4Goodx\n\n_Open-source made effortless. Hosting made affordable._\n_Because changemakers deserve Tech That Gives a Damn_ \u2764\uFE0F',
    '["cancel", "stop", "exit", "quit"]'::jsonb,
    '{
        "version": 2,
        "entry_node": "__start__",
        "nodes": [
            {
                "id": "__start__",
                "type": "start",
                "label": "Start",
                "config": {},
                "position": {"x": 340, "y": 80}
            },
            {
                "id": "node_intro",
                "type": "buttons",
                "label": "About Idlistack",
                "config": {
                    "body": "Idlistack - Open-source made effortless. Hosting made affordable.\n\nWe are a crew of 16 wildly driven change engineers who reimagine what tech can do for nonprofits. We provide stable, smart, and sustainable open-source tools so changemakers can focus on what matters most - making real impact.\n\nBecause changemakers deserve Tech That Gives a Damn!",
                    "buttons": [
                        {"id": "btn_explore_more", "type": "reply", "title": "Explore More"}
                    ]
                },
                "position": {"x": 340, "y": 220}
            },
            {
                "id": "node_explore",
                "type": "buttons",
                "label": "Explore Options",
                "config": {
                    "body": "Great choice! What would you like to explore?\n\nWe offer a curated stack of open-source tools and managed hosting services tailored for nonprofits and social enterprises.",
                    "buttons": [
                        {"id": "btn_services", "type": "reply", "title": "Services"},
                        {"id": "btn_apps", "type": "reply", "title": "Apps"},
                        {"id": "btn_join_beta", "type": "reply", "title": "Join Beta"}
                    ]
                },
                "position": {"x": 340, "y": 400}
            },
            {
                "id": "node_services",
                "type": "list",
                "label": "Our Services",
                "config": {
                    "body": "Idlistack Services\n\nWe help nonprofits and changemakers with end-to-end open-source technology support. Pick the service you are interested in:",
                    "button_text": "View Services",
                    "sections": [
                        {
                            "title": "Core Services",
                            "rows": [
                                {"id": "svc_hosting", "title": "Managed Hosting", "description": "Affordable hosting for open-source tools"},
                                {"id": "svc_setup", "title": "Setup & Deployment", "description": "We set up and configure tools for you"},
                                {"id": "svc_support", "title": "Ongoing Support", "description": "Continuous maintenance and support"},
                                {"id": "svc_training", "title": "Training & Onboarding", "description": "Help your team adopt new tools"},
                                {"id": "svc_custom", "title": "Custom Solutions", "description": "Tailored tech solutions for your needs"}
                            ]
                        }
                    ]
                },
                "position": {"x": 140, "y": 580}
            },
            {
                "id": "node_apps",
                "type": "list",
                "label": "Our Apps",
                "config": {
                    "body": "Idlistack Apps & Tools\n\nHere are the open-source applications we support and host. Tap any to learn more:",
                    "button_text": "View Apps",
                    "sections": [
                        {
                            "title": "Available Apps",
                            "rows": [
                                {"id": "app_fms", "title": "FMS", "description": "Fundraising Management System by T4GC"},
                                {"id": "app_wordpress", "title": "WordPress", "description": "Open-source CMS for websites and stories"},
                                {"id": "app_ghost", "title": "Ghost", "description": "Modern publishing and newsletters platform"},
                                {"id": "app_mattermost", "title": "Mattermost", "description": "Secure team messaging and collaboration"},
                                {"id": "app_listmonk", "title": "Listmonk", "description": "Email newsletter and campaign manager"},
                                {"id": "app_upcoming", "title": "Upcoming Tools", "description": "More idlis coming soon!"}
                            ]
                        }
                    ]
                },
                "position": {"x": 540, "y": 580}
            },
            {
                "id": "node_join_beta",
                "type": "cta_url",
                "label": "Join Beta",
                "config": {
                    "body": "Join the Idlistack Beta Community!\n\nBe among the first to access our open-source tools and get priority support from our team.\n\nTap below to sign up:",
                    "button_text": "Join Beta",
                    "url": "https://joinus.idlistack.com/beta"
                },
                "position": {"x": 340, "y": 580}
            },
            {
                "id": "node_service_detail",
                "type": "buttons",
                "label": "Service Info",
                "config": {
                    "body": "Thanks for your interest!\n\nOur team will love to discuss how we can help your organization with this service.\n\nWould you like to explore more or get in touch with us?",
                    "buttons": [
                        {"id": "btn_back_explore", "type": "reply", "title": "Back to Menu"},
                        {"id": "btn_get_in_touch", "type": "reply", "title": "Get In Touch"}
                    ]
                },
                "position": {"x": 140, "y": 750}
            },
            {
                "id": "node_app_fms",
                "type": "buttons",
                "label": "FMS Detail",
                "config": {
                    "body": "Fundraising Management System (FMS)\n\nDeveloped in-house by Tech4Good Community, FMS makes fundraising simpler, operations smoother, and impact real.\n\nDonor management\nCampaign tracking\nAutomated receipts\nImpact reporting",
                    "buttons": [
                        {"id": "btn_back_apps", "type": "reply", "title": "Back to Apps"},
                        {"id": "btn_get_in_touch", "type": "reply", "title": "Get In Touch"}
                    ]
                },
                "position": {"x": 540, "y": 750}
            },
            {
                "id": "node_app_wordpress",
                "type": "buttons",
                "label": "WordPress Detail",
                "config": {
                    "body": "WordPress\n\nBuild and manage anything from full-scale websites to impact stories with WordPress, the worlds most popular open-source CMS.\n\nEasy content management\nThousands of plugins\nSEO-friendly\nManaged hosting by Idlistack",
                    "buttons": [
                        {"id": "btn_back_apps", "type": "reply", "title": "Back to Apps"},
                        {"id": "btn_get_in_touch", "type": "reply", "title": "Get In Touch"}
                    ]
                },
                "position": {"x": 740, "y": 750}
            },
            {
                "id": "node_app_ghost",
                "type": "buttons",
                "label": "Ghost Detail",
                "config": {
                    "body": "Ghost\n\nCreate fast, modern websites and publish content effortlessly with Ghost - built for publishing, newsletters, and memberships.\n\nBeautiful editor\nBuilt-in newsletter\nMember subscriptions\nLightning fast",
                    "buttons": [
                        {"id": "btn_back_apps", "type": "reply", "title": "Back to Apps"},
                        {"id": "btn_get_in_touch", "type": "reply", "title": "Get In Touch"}
                    ]
                },
                "position": {"x": 940, "y": 750}
            },
            {
                "id": "node_app_mattermost",
                "type": "buttons",
                "label": "Mattermost Detail",
                "config": {
                    "body": "Mattermost\n\nEnable secure team communication and workflow coordination - an open-source alternative for messaging, task collaboration, and internal operations.\n\nPrivate messaging\nChannels and threads\nFile sharing\nSelf-hosted and secure",
                    "buttons": [
                        {"id": "btn_back_apps", "type": "reply", "title": "Back to Apps"},
                        {"id": "btn_get_in_touch", "type": "reply", "title": "Get In Touch"}
                    ]
                },
                "position": {"x": 1140, "y": 750}
            },
            {
                "id": "node_app_listmonk",
                "type": "buttons",
                "label": "Listmonk Detail",
                "config": {
                    "body": "Listmonk\n\nRun scalable email newsletters and campaigns with Listmonk - a high-performance, self-hosted platform for managing subscribers and bulk email delivery.\n\nSubscriber management\nBulk email campaigns\nAnalytics dashboard\nTemplate builder",
                    "buttons": [
                        {"id": "btn_back_apps", "type": "reply", "title": "Back to Apps"},
                        {"id": "btn_get_in_touch", "type": "reply", "title": "Get In Touch"}
                    ]
                },
                "position": {"x": 1340, "y": 750}
            },
            {
                "id": "node_app_upcoming",
                "type": "buttons",
                "label": "Upcoming Tools",
                "config": {
                    "body": "Upcoming Tools\n\nMore idlis will be stacked here soon!\n\nWe are constantly evaluating and adding new open-source tools that can benefit nonprofits and social enterprises.\n\nHave suggestions? We would love to hear them!",
                    "buttons": [
                        {"id": "btn_back_apps", "type": "reply", "title": "Back to Apps"},
                        {"id": "btn_get_in_touch", "type": "reply", "title": "Get In Touch"}
                    ]
                },
                "position": {"x": 1540, "y": 750}
            },
            {
                "id": "__end__",
                "type": "end",
                "label": "End",
                "config": {},
                "position": {"x": 340, "y": 950}
            }
        ],
        "edges": [
            {"from": "__start__", "to": "node_intro", "condition": "default"},
            {"from": "node_intro", "to": "node_explore", "condition": "button:btn_explore_more"},
            {"from": "node_explore", "to": "node_services", "condition": "button:btn_services"},
            {"from": "node_explore", "to": "node_apps", "condition": "button:btn_apps"},
            {"from": "node_explore", "to": "node_join_beta", "condition": "button:btn_join_beta"},
            {"from": "node_services", "to": "node_service_detail", "condition": "default"},
            {"from": "node_service_detail", "to": "node_explore", "condition": "button:btn_back_explore"},
            {"from": "node_service_detail", "to": "__end__", "condition": "button:btn_get_in_touch"},
            {"from": "node_apps", "to": "node_app_fms", "condition": "list:app_fms"},
            {"from": "node_apps", "to": "node_app_wordpress", "condition": "list:app_wordpress"},
            {"from": "node_apps", "to": "node_app_ghost", "condition": "list:app_ghost"},
            {"from": "node_apps", "to": "node_app_mattermost", "condition": "list:app_mattermost"},
            {"from": "node_apps", "to": "node_app_listmonk", "condition": "list:app_listmonk"},
            {"from": "node_apps", "to": "node_app_upcoming", "condition": "list:app_upcoming"},
            {"from": "node_app_fms", "to": "node_apps", "condition": "button:btn_back_apps"},
            {"from": "node_app_fms", "to": "__end__", "condition": "button:btn_get_in_touch"},
            {"from": "node_app_wordpress", "to": "node_apps", "condition": "button:btn_back_apps"},
            {"from": "node_app_wordpress", "to": "__end__", "condition": "button:btn_get_in_touch"},
            {"from": "node_app_ghost", "to": "node_apps", "condition": "button:btn_back_apps"},
            {"from": "node_app_ghost", "to": "__end__", "condition": "button:btn_get_in_touch"},
            {"from": "node_app_mattermost", "to": "node_apps", "condition": "button:btn_back_apps"},
            {"from": "node_app_mattermost", "to": "__end__", "condition": "button:btn_get_in_touch"},
            {"from": "node_app_listmonk", "to": "node_apps", "condition": "button:btn_back_apps"},
            {"from": "node_app_listmonk", "to": "__end__", "condition": "button:btn_get_in_touch"},
            {"from": "node_app_upcoming", "to": "node_apps", "condition": "button:btn_back_apps"},
            {"from": "node_app_upcoming", "to": "__end__", "condition": "button:btn_get_in_touch"},
            {"from": "node_join_beta", "to": "__end__", "condition": "default"}
        ]
    }'::jsonb
) RETURNING id, name;
