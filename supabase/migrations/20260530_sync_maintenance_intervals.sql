-- Sync interval_months and interval_miles from spreadsheet to maintenance_schedule
-- These are manufacturer-recommended intervals derived from original research

UPDATE maintenance_schedule ms
SET interval_months = 12, interval_miles = 10000
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = 'The Rover'
  AND ms.service_item = 'Engine Oil & Filter';

UPDATE maintenance_schedule ms
SET interval_months = 6, interval_miles = 7500
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = 'The Rover'
  AND ms.service_item = 'Tire Rotation';

UPDATE maintenance_schedule ms
SET interval_months = 24, interval_miles = 30000
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = 'The Rover'
  AND ms.service_item = 'Air Filter (Engine)';

UPDATE maintenance_schedule ms
SET interval_months = 12, interval_miles = 15000
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = 'The Rover'
  AND ms.service_item = 'Cabin Air Filter';

UPDATE maintenance_schedule ms
SET interval_months = NULL, interval_miles = 60000
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = 'The Rover'
  AND ms.service_item = 'Spark Plugs (Iridium)';

UPDATE maintenance_schedule ms
SET interval_months = 24, interval_miles = 100000
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = 'The Rover'
  AND ms.service_item = 'Brake Fluid Flush';

UPDATE maintenance_schedule ms
SET interval_months = 36, interval_miles = 45000
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = 'The Rover'
  AND ms.service_item = 'Transfer Case Fluid';

UPDATE maintenance_schedule ms
SET interval_months = 36, interval_miles = 45000
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = 'The Rover'
  AND ms.service_item = 'Differential Fluid (F&R)';

UPDATE maintenance_schedule ms
SET interval_months = 60, interval_miles = NULL
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = 'The Rover'
  AND ms.service_item = 'Coolant Flush';

UPDATE maintenance_schedule ms
SET interval_months = NULL, interval_miles = 60000
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = 'The Rover'
  AND ms.service_item = 'Transmission Fluid';

UPDATE maintenance_schedule ms
SET interval_months = 36, interval_miles = NULL
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = 'The Rover'
  AND ms.service_item = 'Battery';

UPDATE maintenance_schedule ms
SET interval_months = 12, interval_miles = NULL
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = 'The Rover'
  AND ms.service_item = 'VA Safety Inspection';

UPDATE maintenance_schedule ms
SET interval_months = 24, interval_miles = NULL
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = 'The Rover'
  AND ms.service_item = 'VA Emissions Inspection';

UPDATE maintenance_schedule ms
SET interval_months = 12, interval_miles = 7500
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = 'Gandalf'
  AND ms.service_item = 'Engine Oil & Filter';

UPDATE maintenance_schedule ms
SET interval_months = 6, interval_miles = 7500
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = 'Gandalf'
  AND ms.service_item = 'Tire Rotation';

UPDATE maintenance_schedule ms
SET interval_months = 24, interval_miles = 30000
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = 'Gandalf'
  AND ms.service_item = 'Air Filter (Engine)';

UPDATE maintenance_schedule ms
SET interval_months = 12, interval_miles = 15000
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = 'Gandalf'
  AND ms.service_item = 'Cabin Air Filter';

UPDATE maintenance_schedule ms
SET interval_months = NULL, interval_miles = 100000
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = 'Gandalf'
  AND ms.service_item = 'Spark Plugs (Iridium)';

UPDATE maintenance_schedule ms
SET interval_months = 24, interval_miles = NULL
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = 'Gandalf'
  AND ms.service_item = 'Brake Fluid Flush';

UPDATE maintenance_schedule ms
SET interval_months = 12, interval_miles = NULL
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = 'Gandalf'
  AND ms.service_item = 'Front Control Arms';

UPDATE maintenance_schedule ms
SET interval_months = NULL, interval_miles = 50000
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = 'Gandalf'
  AND ms.service_item = 'Shock Absorbers';

UPDATE maintenance_schedule ms
SET interval_months = 60, interval_miles = 150000
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = 'Gandalf'
  AND ms.service_item = 'Coolant Flush';

UPDATE maintenance_schedule ms
SET interval_months = NULL, interval_miles = 45000
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = 'Gandalf'
  AND ms.service_item = 'Transmission Fluid';

UPDATE maintenance_schedule ms
SET interval_months = NULL, interval_miles = 45000
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = 'Gandalf'
  AND ms.service_item = 'Transfer Case Fluid';

UPDATE maintenance_schedule ms
SET interval_months = 36, interval_miles = NULL
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = 'Gandalf'
  AND ms.service_item = 'Battery';

UPDATE maintenance_schedule ms
SET interval_months = 12, interval_miles = NULL
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = 'Gandalf'
  AND ms.service_item = 'VA Safety Inspection';

UPDATE maintenance_schedule ms
SET interval_months = 24, interval_miles = NULL
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = 'Gandalf'
  AND ms.service_item = 'VA Emissions Inspection';

UPDATE maintenance_schedule ms
SET interval_months = 6, interval_miles = 5000
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = '04 Suburban'
  AND ms.service_item = 'Engine Oil & Filter';

UPDATE maintenance_schedule ms
SET interval_months = 6, interval_miles = 5000
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = '04 Suburban'
  AND ms.service_item = 'Tire Rotation';

UPDATE maintenance_schedule ms
SET interval_months = 24, interval_miles = 30000
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = '04 Suburban'
  AND ms.service_item = 'Air Filter (Engine)';

UPDATE maintenance_schedule ms
SET interval_months = NULL, interval_miles = 30000
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = '04 Suburban'
  AND ms.service_item = 'Spark Plugs';

UPDATE maintenance_schedule ms
SET interval_months = 60, interval_miles = NULL
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = '04 Suburban'
  AND ms.service_item = 'Coolant Flush';

UPDATE maintenance_schedule ms
SET interval_months = NULL, interval_miles = 30000
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = '04 Suburban'
  AND ms.service_item = 'Transmission Fluid';

UPDATE maintenance_schedule ms
SET interval_months = 36, interval_miles = NULL
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = '04 Suburban'
  AND ms.service_item = 'Battery';

UPDATE maintenance_schedule ms
SET interval_months = 12, interval_miles = NULL
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = '04 Suburban'
  AND ms.service_item = 'VA Safety Inspection';

UPDATE maintenance_schedule ms
SET interval_months = 24, interval_miles = NULL
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = '04 Suburban'
  AND ms.service_item = 'VA Emissions Inspection (OVERDUE)';

UPDATE maintenance_schedule ms
SET interval_months = 6, interval_miles = 5000
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = 'Betsy'
  AND ms.service_item = 'Engine Oil & Filter';

UPDATE maintenance_schedule ms
SET interval_months = 6, interval_miles = 5000
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = 'Betsy'
  AND ms.service_item = 'Tire Rotation';

UPDATE maintenance_schedule ms
SET interval_months = 24, interval_miles = 30000
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = 'Betsy'
  AND ms.service_item = 'Air Filter (Engine)';

UPDATE maintenance_schedule ms
SET interval_months = 12, interval_miles = 15000
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = 'Betsy'
  AND ms.service_item = 'Cabin Air Filter';

UPDATE maintenance_schedule ms
SET interval_months = NULL, interval_miles = 30000
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = 'Betsy'
  AND ms.service_item = 'Spark Plugs';

UPDATE maintenance_schedule ms
SET interval_months = NULL, interval_miles = 60000
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = 'Betsy'
  AND ms.service_item = 'Serpentine Belt';

UPDATE maintenance_schedule ms
SET interval_months = 60, interval_miles = 60000
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = 'Betsy'
  AND ms.service_item = 'Coolant Flush';

UPDATE maintenance_schedule ms
SET interval_months = 24, interval_miles = NULL
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = 'Betsy'
  AND ms.service_item = 'Brake Fluid Flush';

UPDATE maintenance_schedule ms
SET interval_months = 36, interval_miles = NULL
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = 'Betsy'
  AND ms.service_item = 'Battery';

UPDATE maintenance_schedule ms
SET interval_months = 12, interval_miles = NULL
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = 'Betsy'
  AND ms.service_item = 'VA Safety Inspection';

UPDATE maintenance_schedule ms
SET interval_months = 24, interval_miles = NULL
FROM vehicles v
WHERE ms.vehicle_id = v.id
  AND v.name = 'Betsy'
  AND ms.service_item = 'VA Emissions Inspection';
