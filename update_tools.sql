DO $$ 
DECLARE
    org_id uuid;
    explore_id uuid;
    current_content jsonb;
    new_content jsonb;
BEGIN
    -- Get the active organization where we put the rules earlier
    SELECT id INTO org_id FROM organizations LIMIT 1;
    -- Wait, the user was on 'e516605d-1444-444c-82d8-9c61b5b41c87' but there might be multiple organizations. Let's just find the rule directly.
    SELECT id, response_content INTO explore_id, current_content FROM keyword_rules WHERE name = 'Explore Tools Menu' LIMIT 1;

    IF explore_id IS NOT NULL THEN
        -- Add WordPress and Upcoming Tools to the sections->0->rows array
        new_content := jsonb_set(
            current_content, 
            '{sections,0,rows}', 
            (current_content->'sections'->0->'rows') || 
            '[
                {"id": "tool_wordpress", "title": "🌐 WordPress", "description": "Open-source Content Management System"},
                {"id": "tool_upcoming", "title": "🚀 Upcoming Tools", "description": "See what we are building next"}
            ]'::jsonb
        );

        UPDATE keyword_rules SET response_content = new_content WHERE id = explore_id;
    END IF;

    -- Ensure 'Tool Select Listmonk' URL is updated (user mentioned https://idlistack.com/list-monk)
    UPDATE keyword_rules 
    SET response_content = jsonb_set(response_content, '{url}', '"https://idlistack.com/list-monk"'::jsonb)
    WHERE name = 'Tool Select Listmonk';

    -- Insert 'Tool Select WordPress' if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM keyword_rules WHERE name = 'Tool Select WordPress') THEN
        INSERT INTO keyword_rules (
            organization_id, whats_app_account, name, is_enabled, priority, keywords, match_type, case_sensitive, response_type, response_content
        ) VALUES (
            (SELECT organization_id FROM keyword_rules WHERE name = 'Explore Tools Menu' LIMIT 1),
            '', 'Tool Select WordPress', true, 100, 
            '["tool_wordpress"]'::jsonb, 
            'exact', false, 'cta_url', 
            '{
                "header": "🌐 WordPress",
                "body": "*WordPress* — Build and manage anything from full-scale websites to impact stories.\n\nTap the button below to learn more about WordPress on IdliStack! 🚀",
                "footer": "Powered by IdliStack",
                "button_text": "Visit WordPress",
                "url": "https://idlistack.com/wordpress"
            }'::jsonb
        );
    END IF;

    -- Insert 'Tool Select Upcoming' if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM keyword_rules WHERE name = 'Tool Select Upcoming') THEN
        INSERT INTO keyword_rules (
            organization_id, whats_app_account, name, is_enabled, priority, keywords, match_type, case_sensitive, response_type, response_content
        ) VALUES (
            (SELECT organization_id FROM keyword_rules WHERE name = 'Explore Tools Menu' LIMIT 1),
            '', 'Tool Select Upcoming', true, 100, 
            '["tool_upcoming"]'::jsonb, 
            'exact', false, 'cta_url', 
            '{
                "header": "🚀 Upcoming Tools",
                "body": "*Upcoming Tools* — We are constantly adding new open-source tools to IdliStack.\n\nTap the button below to see what is coming next! 🚀",
                "footer": "Powered by IdliStack",
                "button_text": "View Upcoming",
                "url": "https://idlistack.com/upcomming-tools/"
            }'::jsonb
        );
    END IF;

END $$;
