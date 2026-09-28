-- Atomic job lock acquisition via RPC to eliminate TOCTOU race condition
create or replace function acquire_job_lock(
  p_key text,
  p_now text,
  p_stale_cutoff text
) returns boolean
language plpgsql
as $$
declare
  v_current jsonb;
begin
  -- Try to get current lock state with FOR UPDATE to prevent concurrent reads
  select value into v_current
    from settings
    where key = p_key
    for update skip locked;

  -- No row or not found (skip locked) → insert new lock
  if not found then
    insert into settings (key, value)
      values (p_key, jsonb_build_object('locked', true, 'at', p_now))
      on conflict (key) do nothing;
    -- If insert succeeded, we got the lock
    return found;
  end if;

  -- Row exists: check if unlocked or stale
  if (v_current->>'locked')::boolean = false
     or v_current->>'at' < p_stale_cutoff then
    update settings
      set value = jsonb_build_object('locked', true, 'at', p_now)
      where key = p_key;
    return true;
  end if;

  -- Lock is active and not stale
  return false;
end;
$$;
