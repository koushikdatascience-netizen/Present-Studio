# Direct invitation sending

Studio uses one shared SMTP account and one Meta Cloud API account configured on the server. No credentials are returned to browsers. Existing saved email templates remain available. Meta templates can be submitted from Studio and selected after approval; the composer currently supports positional body-text variables, static text headers/footers, and static supported buttons. Media headers, named parameters, and dynamic buttons are intentionally excluded from this text invitation composer.

## Environment setup

Populate the SMTP_* and WHATSAPP_* entries in .env.example in the production server environment. Use a supported WHATSAPP_API_VERSION from the Meta application configuration (vXX.X format). Use a long-lived system-user access token with the required messaging and business-management permissions. SMTP requires STARTTLS on port 587 or SMTP_SSL=true on port 465. Do not set both TLS mechanisms off. SMTP_FROM_EMAIL should be an authorized sender with the provider's domain authentication configured.

The production Compose backend must pass these variables through. The environment mapping is included in deploy/migration/compose.vps.yml; apply the same mapping to /srv/snapkey-studio/compose.vps.yml during deployment. Adding values to .env.vps alone does not inject new unmapped variables. Recreate the backend during an empty-meeting deployment window to load environment changes. No database data migration is needed: new outbox tables are created by Base.metadata.create_all at startup.

## Meta webhook

Callback: https://connect.snapkeystudio.com/api/invitations/whatsapp/webhook

Set the verification token to WHATSAPP_WEBHOOK_VERIFY_TOKEN in Meta and subscribe to messages status events. META_APP_SECRET verifies the X-Hub-Signature-256 header. Account and phone number IDs are checked before processing status updates. Never expose the token or app secret in frontend files.

## Sending and recovery

1. Open a meeting's Email or WhatsApp invitation dialog.
2. Type or paste comma-separated recipients (up to 100). Backend validation normalizes and deduplicates addresses/numbers.
3. Choose a saved email template or approved Meta template. WhatsApp variable mappings can be saved on the current device; use {{meeting_title}}, {{meeting_date}}, {{meeting_time}}, {{audience_link}}, {{access_code}}, and {{owner_name}} to populate changing meeting values.
4. Review the preview and confirm recipient consent. Click Send invitations and confirm the count.
5. Delivery history polls while the dialog is open. Email accepted means SMTP acceptance, not inbox delivery. WhatsApp delivery/read confirmation depends on signed webhooks. Read receipts may be unavailable for some recipients.

The outbox survives restart. One single-process worker sends individual messages off the event loop, with bounded provider timeouts and a default per-owner limit of 500 recipients/day. Run the existing production configuration with one Uvicorn worker. A provider connection failure or interruption is marked unknown; check provider records before manually arranging a resend. Confirmed failures have an explicit Retry action; accepted messages cannot be retried through this action. Do not clear unknown status and resend automatically. Configure both SMTP and Meta before queueing sends; configuration endpoints show readiness without revealing secrets.

A separate email bounce/delivery webhook is not included because SMTP alone does not provide inbox delivery tracking. Scheduling invitations for a future date is not implemented by this outbox.

Before production use, configure credentials, send one test invitation to an owned email/WhatsApp number, confirm signed WhatsApp callbacks, and verify sender identity and provider limits. These operations must be initiated by an authorized user; automated tests use mocked providers and never send real messages.
