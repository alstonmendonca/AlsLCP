-- Auto-expire tenant subscriptions that have passed their expiry date.
-- Called via `SELECT expire_due_tenant_subscriptions(p_tenant_id)` from edge functions.

CREATE OR REPLACE FUNCTION public.expire_due_tenant_subscriptions(p_tenant_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.tenant_subscriptions
    SET
        status = 'expired',
        updated_at = now()
    WHERE tenant_id = p_tenant_id
      AND status IN ('active', 'trial', 'past_due')
      AND expires_at IS NOT NULL
      AND expires_at < now()
      AND (grace_until IS NULL OR grace_until < now());
END;
$$;
