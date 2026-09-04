# Ordeli database notes

This project is built against the **existing Supabase schema** supplied by the project owner.

## Important correction

The authoritative order event column is:

- `orders.event_id`

There is **no `orders.selected_event_id` column** in the current database.
The application and future migrations must not introduce references to `selected_event_id` unless the database model is deliberately redesigned later.

## Existing schema used by the application

The current schema already contains:

- sellers
- production_members
- products
- production_stages
- qr_codes
- customers
- events
- orders
- order_items
- stage_logs
- payments
- order_event_history
- event_change_logs
- reviews
- sms_update_drafts
- offline_qr_reservations
- offline_order_syncs

The current `order_items` model already contains `workflow_snapshot`, which is the key historical snapshot required when product workflows change.

The current `orders` model already separates the event reference (`event_id`) from item production state and payment records; we should preserve that direction rather than adding a second competing event field.

## Migration policy

Future SQL should prefer:

1. additive migrations,
2. `IF NOT EXISTS` / defensive catalog checks where practical,
3. explicit seller ownership checks,
4. idempotent functions for offline sync,
5. no destructive schema changes until existing data has been migrated deliberately.
