ALTER TABLE "paystack_webhook_inbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "paystack_webhook_inbox" FORCE ROW LEVEL SECURITY;
CREATE POLICY "platform_webhook_transaction" ON "paystack_webhook_inbox"
  USING (current_setting('app.paystack_webhook_inbox', true) = 'on'
    AND COALESCE(current_setting('app.current_school_id', true), '') = '')
  WITH CHECK (current_setting('app.paystack_webhook_inbox', true) = 'on'
    AND COALESCE(current_setting('app.current_school_id', true), '') = '');
REVOKE TRUNCATE ON "paystack_webhook_inbox" FROM app_user;
