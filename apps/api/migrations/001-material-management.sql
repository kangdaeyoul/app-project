-- Additive only. Never alters or removes existing application tables.
CREATE SCHEMA IF NOT EXISTS material_management;
CREATE TABLE IF NOT EXISTS material_management.catalogs (
  company_id text PRIMARY KEY,
  auxiliary jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS material_management.materials (
  company_id text NOT NULL REFERENCES material_management.catalogs(company_id),
  id text NOT NULL,
  material_code text NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY(company_id,id), UNIQUE(company_id,material_code)
);
CREATE TABLE IF NOT EXISTS material_management.price_history (
  company_id text NOT NULL,
  id text NOT NULL,
  material_id text NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY(company_id,id),
  FOREIGN KEY(company_id,material_id) REFERENCES material_management.materials(company_id,id)
);
CREATE TABLE IF NOT EXISTS material_management.import_jobs (
  company_id text NOT NULL REFERENCES material_management.catalogs(company_id),
  id text NOT NULL,
  status text NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY(company_id,id)
);
CREATE INDEX IF NOT EXISTS material_history_material ON material_management.price_history(company_id,material_id);
CREATE INDEX IF NOT EXISTS material_jobs_status ON material_management.import_jobs(company_id,status);
