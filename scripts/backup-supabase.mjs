import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const projectRef = process.env.SUPABASE_PROJECT_REF || 'nfekasqbzwjelrwyxqmv';
const token = process.env.SUPABASE_ACCESS_TOKEN;
const tables = ['rated_items', 'track_scores', 'media_links', 'admin_users'];
const outDir = path.resolve('db', 'snapshots');

if (!token) {
  console.error(
    'Missing SUPABASE_ACCESS_TOKEN. Generate a Supabase access token and run:' +
      '\n  PowerShell: $env:SUPABASE_ACCESS_TOKEN="sbp_..."; npm run backup:supabase' +
      '\n  bash/zsh:   SUPABASE_ACCESS_TOKEN=sbp_... npm run backup:supabase'
  );
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);

async function query(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase Management API returned ${response.status}: ${body}`);
  }

  return JSON.parse(body);
}

await mkdir(outDir, { recursive: true });

for (const table of tables) {
  const sql = `select coalesce(json_agg(row_to_json(t)), '[]'::json) as data from (select * from ${table}) t;`;
  const result = await query(sql);
  const data = result?.[0]?.data ?? [];
  const file = path.join(outDir, `${stamp}-${table}.json`);
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  console.log(`Saved ${table}: ${data.length} rows -> ${file}`);
}
