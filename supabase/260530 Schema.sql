## Table `diagnostic_codes`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `vehicle_id` | `uuid` |  |
| `service_record_id` | `uuid` |  Nullable |
| `code` | `text` |  |
| `description` | `text` |  Nullable |
| `pulled_date` | `date` |  Nullable |
| `cleared_date` | `date` |  Nullable |
| `resolution` | `text` |  Nullable |
| `tool_used` | `text` |  Nullable |
| `notes` | `text` |  Nullable |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

## Table `documents`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `vehicle_id` | `uuid` |  Nullable |
| `service_record_id` | `uuid` |  Nullable |
| `document_type` | `document_type` |  |
| `filename` | `text` |  |
| `storage_path` | `text` |  |
| `mime_type` | `text` |  Nullable |
| `file_size_bytes` | `int8` |  Nullable |
| `document_date` | `date` |  Nullable |
| `description` | `text` |  Nullable |
| `source` | `record_source` |  |
| `email_thread_id` | `text` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `email_scan_log`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `scan_date` | `timestamptz` |  |
| `email_account` | `text` |  |
| `threads_found` | `int4` |  |
| `records_created` | `int4` |  |
| `status` | `scan_status` |  |
| `notes` | `text` |  Nullable |

## Table `inspections`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `vehicle_id` | `uuid` |  |
| `shop_id` | `uuid` |  Nullable |
| `inspection_type` | `inspection_type` |  |
| `inspection_date` | `date` |  |
| `expiry_date` | `date` |  Nullable |
| `result` | `inspection_result` |  Nullable |
| `report_number` | `text` |  Nullable |
| `document_id` | `uuid` |  Nullable |
| `notes` | `text` |  Nullable |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

## Table `known_specs`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `vehicle_id` | `uuid` |  |
| `spec_category` | `text` |  |
| `spec_name` | `text` |  |
| `spec_value` | `text` |  |
| `units` | `text` |  Nullable |
| `notes` | `text` |  Nullable |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

## Table `maintenance_schedule`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `vehicle_id` | `uuid` |  |
| `service_item` | `text` |  |
| `interval_months` | `int4` |  Nullable |
| `interval_miles` | `int4` |  Nullable |
| `last_done_date` | `date` |  Nullable |
| `last_done_mileage_id` | `uuid` |  Nullable |
| `knowledge_status` | `knowledge_status` |  |
| `baseline_date` | `date` |  Nullable |
| `baseline_basis` | `text` |  Nullable |
| `priority` | `maintenance_priority` |  |
| `notes` | `text` |  Nullable |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |
| `last_done_mileage` | `int4` |  Nullable |
| `last_done_service_record_id` | `uuid` |  Nullable |

## Table `mileage_log`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `vehicle_id` | `uuid` |  |
| `recorded_date` | `date` |  |
| `mileage` | `int4` |  |
| `source` | `mileage_source` |  |
| `service_visit_id` | `uuid` |  Nullable |
| `inspection_id` | `uuid` |  Nullable |
| `document_id` | `uuid` |  Nullable |
| `notes` | `text` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `modifications`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `vehicle_id` | `uuid` |  |
| `shop_id` | `uuid` |  Nullable |
| `mod_date` | `date` |  Nullable |
| `category` | `mod_category` |  |
| `description` | `text` |  |
| `manufacturer` | `text` |  Nullable |
| `part_number` | `text` |  Nullable |
| `vendor` | `text` |  Nullable |
| `order_number` | `text` |  Nullable |
| `install_type` | `mod_install_type` |  |
| `cost` | `numeric` |  Nullable |
| `notes` | `text` |  Nullable |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

## Table `parts`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `service_record_id` | `uuid` |  |
| `part_name` | `text` |  |
| `part_number` | `text` |  Nullable |
| `manufacturer` | `text` |  Nullable |
| `vendor` | `text` |  Nullable |
| `order_number` | `text` |  Nullable |
| `quantity` | `numeric` |  |
| `unit_cost` | `numeric` |  Nullable |
| `total_cost` | `numeric` |  Nullable |
| `notes` | `text` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `pending_work`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `vehicle_id` | `uuid` |  |
| `priority` | `pending_priority` |  |
| `title` | `text` |  |
| `description` | `text` |  Nullable |
| `estimated_cost` | `text` |  Nullable |
| `identified_date` | `date` |  Nullable |
| `identified_by` | `text` |  Nullable |
| `status` | `pending_status` |  |
| `completed_date` | `date` |  Nullable |
| `resolved_by_record_id` | `uuid` |  Nullable |
| `notes` | `text` |  Nullable |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

## Table `profiles`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `display_name` | `text` |  |
| `email` | `text` |  |
| `role` | `user_role` |  |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

## Table `registrations`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `vehicle_id` | `uuid` |  |
| `plate` | `text` |  |
| `state` | `text` |  |
| `registration_date` | `date` |  Nullable |
| `expiry_date` | `date` |  Nullable |
| `is_current` | `bool` |  |
| `document_id` | `uuid` |  Nullable |
| `notes` | `text` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `roadmap_items`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `parent_id` | `uuid` |  Nullable |
| `group_name` | `roadmap_group` |  |
| `status` | `roadmap_status` |  |
| `item_number` | `text` |  Nullable |
| `title` | `text` |  |
| `description` | `text` |  Nullable |
| `date_requested` | `date` |  Nullable |
| `date_completed` | `date` |  Nullable |
| `impl_notes` | `text` |  Nullable |
| `feedback` | `text` |  Nullable |
| `sort_order` | `int4` |  |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |
| `priority` | `text` |  |

## Table `service_records`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `vehicle_id` | `uuid` |  |
| `visit_id` | `uuid` |  Nullable |
| `service_date` | `date` |  |
| `category` | `service_category` |  |
| `title` | `text` |  |
| `description` | `text` |  Nullable |
| `labor_cost` | `numeric` |  Nullable |
| `parts_cost` | `numeric` |  Nullable |
| `total_cost` | `numeric` |  Nullable |
| `source` | `record_source` |  |
| `notes` | `text` |  Nullable |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

## Table `service_visits`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `vehicle_id` | `uuid` |  |
| `shop_id` | `uuid` |  Nullable |
| `visit_date` | `date` |  |
| `work_order` | `text` |  Nullable |
| `invoice_number` | `text` |  Nullable |
| `technician` | `text` |  Nullable |
| `total_cost` | `numeric` |  Nullable |
| `visit_type` | `visit_type` |  |
| `notes` | `text` |  Nullable |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |
| `source_document_id` | `uuid` |  Nullable |

## Table `shops`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `name` | `text` |  |
| `address` | `text` |  Nullable |
| `city` | `text` |  Nullable |
| `state` | `text` |  Nullable |
| `zip` | `text` |  Nullable |
| `phone` | `text` |  Nullable |
| `website` | `text` |  Nullable |
| `primary_technician` | `text` |  Nullable |
| `is_self` | `bool` |  |
| `notes` | `text` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `vehicle_notes`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `vehicle_id` | `uuid` |  |
| `note_date` | `date` |  |
| `category` | `note_category` |  |
| `note_text` | `text` |  |
| `created_by` | `text` |  Nullable |
| `document_id` | `uuid` |  Nullable |
| `is_pinned` | `bool` |  |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

## Table `vehicles`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `name` | `text` |  Nullable |
| `primary_driver` | `text` |  Nullable |
| `year` | `int4` |  |
| `make` | `text` |  |
| `model` | `text` |  |
| `trim` | `text` |  Nullable |
| `vin` | `text` |  Nullable Unique |
| `current_plate` | `text` |  Nullable |
| `title_number` | `text` |  Nullable |
| `status` | `vehicle_status` |  |
| `engine_size` | `text` |  Nullable |
| `cylinders` | `int4` |  Nullable |
| `fuel_type` | `fuel_type` |  |
| `color` | `text` |  Nullable |
| `notes` | `text` |  Nullable |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

