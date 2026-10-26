-- Item 9.7: reference library — a manual can cover more than one vehicle.
--
-- documents.vehicle_id stays the vehicle a document is filed under; NULL now
-- means General (all vehicles), e.g. a scan-tool manual. This table lists the
-- other vehicles a reference document also covers (Joe, 10/25). A vehicle's
-- documents = filed under it + also covering it + General.
--
-- Family permissions like the other link tables: everyone reads, adds and
-- removes links (links stay member-deletable); changes go to the change log.
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS document_vehicles (
  document_id uuid        NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  vehicle_id  uuid        NOT NULL REFERENCES vehicles(id)  ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, vehicle_id)
);
CREATE INDEX IF NOT EXISTS document_vehicles_vehicle_idx ON document_vehicles (vehicle_id);

ALTER TABLE document_vehicles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fam read"   ON document_vehicles;
DROP POLICY IF EXISTS "fam insert" ON document_vehicles;
DROP POLICY IF EXISTS "fam delete" ON document_vehicles;
CREATE POLICY "fam read"   ON document_vehicles FOR SELECT TO authenticated USING (true);
CREATE POLICY "fam insert" ON document_vehicles FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "fam delete" ON document_vehicles FOR DELETE TO authenticated USING (true);

DROP TRIGGER IF EXISTS trg_audit ON document_vehicles;
CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON document_vehicles
  FOR EACH ROW EXECUTE FUNCTION audit_row();

COMMENT ON TABLE document_vehicles IS
  'Item 9.7: other vehicles a reference document also covers. documents.vehicle_id NULL = General (all vehicles).';
