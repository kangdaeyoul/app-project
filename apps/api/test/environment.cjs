// Never let regression tests connect to an operator's deployment database.
// Persistence suites explicitly provision their own isolated temporary databases.
process.env.MATERIAL_STORAGE = 'memory';
delete process.env.MATERIAL_DATABASE_URL;
delete process.env.MATERIAL_SQLITE_PATH;
process.env.MATERIAL_SEED_SAMPLES = 'false';
process.env.DEMO_LOGIN_ENABLED = 'true';
