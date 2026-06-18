DO $$ 
DECLARE
    org_id uuid;
BEGIN
    -- Get the first organization to assign these rules to
    SELECT id INTO org_id FROM organizations LIMIT 1;
    
    IF org_id IS NULL THEN
        RETURN;
    END IF;

    -- Delete old rules we are about to create (idempotency)
    DELETE FROM keyword_rules WHERE name IN ('Explore Tools Menu', 'Tool Select Ghost', 'Tool Select FMS', 'Tool Select Mattermost', 'Tool Select Listmonk', 'Tool Select WhatoMate');

    -- Insert 'Explore Tools Menu'
    INSERT INTO keyword_rules (
        organization_id, whats_app_account, name, is_enabled, priority, keywords, match_type, case_sensitive, response_type, response_content
    ) VALUES (
        org_id, '', 'Explore Tools Menu', true, 100, 
        '["explore", "explore the tools", "btn_explore"]'::jsonb, 
        'contains', false, 'interactive_list', 
        '{
            "header": "🛠️ Explore IdliStack",
            "body": "IdliStack is the open-source cloud platform by Tech4Good Community — making powerful tech affordable for changemakers like you!\n\nTap below to browse our tools 👇",
            "footer": "Powered by IdliStack",
            "button_text": "Browse Tools",
            "sections": [
                {
                    "title": "IdliStack Tools",
                    "rows": [
                        {"id": "tool_ghost", "title": "👻 Ghost", "description": "Modern publishing platform for newsletters & blogs"},
                        {"id": "tool_fms", "title": "📊 FMS", "description": "Frappe Management System for business operations"},
                        {"id": "tool_mattermost", "title": "💬 Mattermost", "description": "Secure team messaging & collaboration"},
                        {"id": "tool_listmonk", "title": "📧 Listmonk", "description": "Self-hosted newsletter & mailing list manager"},
                        {"id": "tool_whatomate", "title": "🤖 WhatoMate", "description": "WhatsApp CRM & chatbot automation"}
                    ]
                }
            ]
        }'::jsonb
    );

    -- Insert 'Tool Select Ghost'
    INSERT INTO keyword_rules (
        organization_id, whats_app_account, name, is_enabled, priority, keywords, match_type, case_sensitive, response_type, response_content
    ) VALUES (
        org_id, '', 'Tool Select Ghost', true, 100, 
        '["tool_ghost"]'::jsonb, 
        'exact', false, 'cta_url', 
        '{
            "header": "👻 Ghost",
            "body": "*Ghost* — Modern publishing platform for newsletters & blogs\n\nTap the button below to learn more about Ghost on IdliStack! 🚀",
            "footer": "Powered by IdliStack",
            "button_text": "Visit Ghost",
            "url": "https://idlistack.com/ghost/"
        }'::jsonb
    );

    -- Insert 'Tool Select FMS'
    INSERT INTO keyword_rules (
        organization_id, whats_app_account, name, is_enabled, priority, keywords, match_type, case_sensitive, response_type, response_content
    ) VALUES (
        org_id, '', 'Tool Select FMS', true, 100, 
        '["tool_fms"]'::jsonb, 
        'exact', false, 'cta_url', 
        '{
            "header": "📊 FMS",
            "body": "*FMS* — Frappe Management System for business operations\n\nTap the button below to learn more about FMS on IdliStack! 🚀",
            "footer": "Powered by IdliStack",
            "button_text": "Visit FMS",
            "url": "https://idlistack.com/fms/"
        }'::jsonb
    );

    -- Insert 'Tool Select Mattermost'
    INSERT INTO keyword_rules (
        organization_id, whats_app_account, name, is_enabled, priority, keywords, match_type, case_sensitive, response_type, response_content
    ) VALUES (
        org_id, '', 'Tool Select Mattermost', true, 100, 
        '["tool_mattermost"]'::jsonb, 
        'exact', false, 'cta_url', 
        '{
            "header": "💬 Mattermost",
            "body": "*Mattermost* — Secure team messaging & collaboration\n\nTap the button below to learn more about Mattermost on IdliStack! 🚀",
            "footer": "Powered by IdliStack",
            "button_text": "Visit Mattermost",
            "url": "https://idlistack.com/mattermost/"
        }'::jsonb
    );

    -- Insert 'Tool Select Listmonk'
    INSERT INTO keyword_rules (
        organization_id, whats_app_account, name, is_enabled, priority, keywords, match_type, case_sensitive, response_type, response_content
    ) VALUES (
        org_id, '', 'Tool Select Listmonk', true, 100, 
        '["tool_listmonk"]'::jsonb, 
        'exact', false, 'cta_url', 
        '{
            "header": "📧 Listmonk",
            "body": "*Listmonk* — Self-hosted newsletter & mailing list manager\n\nTap the button below to learn more about Listmonk on IdliStack! 🚀",
            "footer": "Powered by IdliStack",
            "button_text": "Visit Listmonk",
            "url": "https://idlistack.com/listmonk/"
        }'::jsonb
    );

    -- Insert 'Tool Select WhatoMate'
    INSERT INTO keyword_rules (
        organization_id, whats_app_account, name, is_enabled, priority, keywords, match_type, case_sensitive, response_type, response_content
    ) VALUES (
        org_id, '', 'Tool Select WhatoMate', true, 100, 
        '["tool_whatomate"]'::jsonb, 
        'exact', false, 'cta_url', 
        '{
            "header": "🤖 WhatoMate",
            "body": "*WhatoMate* — WhatsApp CRM & chatbot automation\n\nTap the button below to learn more about WhatoMate on IdliStack! 🚀",
            "footer": "Powered by IdliStack",
            "button_text": "Visit WhatoMate",
            "url": "https://idlistack.com/whatomate/"
        }'::jsonb
    );
END $$;
