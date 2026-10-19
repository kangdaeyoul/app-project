// Never let regression tests connect to an operator's deployment database.
// Persistence suites explicitly provision their own isolated temporary databases.
process.env.MATERIAL_STORAGE = 'memory';
delete process.env.MATERIAL_DATABASE_URL;
delete process.env.MATERIAL_SQLITE_PATH;
process.env.MATERIAL_SEED_SAMPLES = 'false';
process.env.DEMO_LOGIN_ENABLED = 'true';

// Hermetic tests must never contact an operator's Supabase project.
for (const name of ['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_ANON_KEY','AUTH_MODE','AUTH_SITE_URL']) delete process.env[name];
