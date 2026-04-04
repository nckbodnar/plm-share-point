const { Pool } = require('pg');
const b = require('bcryptjs');
const pool = new Pool({ connectionString: 'postgresql://plm_user:plm_password@postgres:5432/plm_sharepoint' });
pool.query("SELECT length(password_hash) as len, password_hash FROM users WHERE email='admin@example.com'")
  .then(async r => {
    const row = r.rows[0];
    console.log('hash length:', row.len);
    console.log('hash:', row.password_hash);
    const match = await b.compare('Admin1234!', row.password_hash);
    console.log('bcrypt match:', match);
    process.exit(0);
  }).catch(e => { console.error(e); process.exit(1); });
