-- Fix workspace_id inconsistency: alert_rules, alert_events, title_patterns
-- used 00000000-0000-0000-0000-000000000000 instead of 000...001
-- Safe: runs only if tables exist (DO block with exception handling)

do $$
begin
  -- Update existing rows
  update alert_rules set workspace_id = '00000000-0000-0000-0000-000000000001'
    where workspace_id = '00000000-0000-0000-0000-000000000000';

  update alert_events set workspace_id = '00000000-0000-0000-0000-000000000001'
    where workspace_id = '00000000-0000-0000-0000-000000000000';

  update title_patterns set workspace_id = '00000000-0000-0000-0000-000000000001'
    where workspace_id = '00000000-0000-0000-0000-000000000000';

  -- Change column defaults
  alter table alert_rules alter column workspace_id set default '00000000-0000-0000-0000-000000000001';
  alter table alert_events alter column workspace_id set default '00000000-0000-0000-0000-000000000001';
  alter table title_patterns alter column workspace_id set default '00000000-0000-0000-0000-000000000001';

  -- Recreate RLS policies with correct workspace_id
  drop policy if exists "workspace_alert_rules" on alert_rules;
  create policy "workspace_alert_rules" on alert_rules
    for all using (workspace_id = '00000000-0000-0000-0000-000000000001');

  drop policy if exists "workspace_alert_events" on alert_events;
  create policy "workspace_alert_events" on alert_events
    for all using (workspace_id = '00000000-0000-0000-0000-000000000001');

  drop policy if exists "workspace_title_patterns" on title_patterns;
  create policy "workspace_title_patterns" on title_patterns
    for all using (workspace_id = '00000000-0000-0000-0000-000000000001');

exception when undefined_table then
  raise notice 'Tables not yet created — skipping workspace_id fix (will be handled by 00009/00010 on next push)';
end;
$$;
