const projectRef = process.env.SUPABASE_PROJECT_REF || 'nfekasqbzwjelrwyxqmv';
const token = process.env.SUPABASE_ACCESS_TOKEN;
const expectedEmails = (process.env.EXPECTED_ADMIN_EMAILS || '')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

if (!token) {
  console.error(
    'Missing SUPABASE_ACCESS_TOKEN. Generate a Supabase access token and run:' +
      '\n  PowerShell: $env:SUPABASE_ACCESS_TOKEN="sbp_..."; npm run audit:admins' +
      '\n  bash/zsh:   SUPABASE_ACCESS_TOKEN=sbp_... npm run audit:admins'
  );
  process.exit(1);
}

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

const sql = `
  select
    au.user_id::text,
    lower(au.email) as admin_email,
    lower(u.email) as auth_email,
    au.created_at
  from public.admin_users au
  left join auth.users u on u.id = au.user_id
  order by au.created_at asc;
`;

const admins = await query(sql);
console.table(admins);

const emails = admins.map((admin) => admin.admin_email).filter(Boolean);
const missingAuthUsers = admins.filter((admin) => !admin.auth_email);
const unexpected = expectedEmails.length
  ? emails.filter((email) => !expectedEmails.includes(email))
  : [];
const missing = expectedEmails.filter((email) => !emails.includes(email));

if (missingAuthUsers.length) {
  console.error('Admins without matching auth.users account:');
  console.error(missingAuthUsers.map((admin) => `${admin.admin_email} (${admin.user_id})`).join('\n'));
  process.exitCode = 1;
}

if (unexpected.length || missing.length) {
  if (unexpected.length) console.error(`Unexpected admin emails: ${unexpected.join(', ')}`);
  if (missing.length) console.error(`Missing expected admin emails: ${missing.join(', ')}`);
  process.exitCode = 1;
}

if (!process.exitCode) {
  const suffix = expectedEmails.length ? ' and match EXPECTED_ADMIN_EMAILS' : '';
  console.log(`Admin audit passed: ${admins.length} admin(s)${suffix}.`);
}
