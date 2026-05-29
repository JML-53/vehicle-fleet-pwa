-- Fix incorrect impl_notes on item 8 (was describing filter chips, not document linking)
UPDATE roadmap_items SET
  impl_notes = 'Not yet implemented. This item requires a junction table (e.g. document_links) '
            || 'to associate an existing document with a service_record, pending_work item, or '
            || 'maintenance_schedule entry without duplicating the document row. '
            || 'UI would need a "Link existing document" picker on each of those forms.'
WHERE item_number = '8' AND group_name = 'enhancement';

-- Answer Q-1
UPDATE roadmap_items SET
  status     = 'new',
  impl_notes = 'Answer: No — not currently. The maintenance_due_soon view computes next due dates '
            || 'from last_done_date and last_done_mileage on the maintenance_schedule table, but '
            || 'logging a service_record does not automatically update those fields. '
            || 'Auto-fulfillment would require matching service_item text (or a foreign key) '
            || 'between service_records and maintenance_schedule, then updating last_done_date '
            || 'and last_done_mileage on save. This could be built as a Supabase trigger or '
            || 'handled client-side when saving a service record.'
WHERE item_number = 'Q-1' AND group_name = 'question';
