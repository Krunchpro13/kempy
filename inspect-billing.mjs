// TEMP read-only billing inspector. Delete after use. No secrets printed.
import dotenv from 'dotenv';
dotenv.config();
import { initDb, query } from './src/services/db.js';
initDb();
await query('SELECT 1');
const { rows } = await query(
  `SELECT id, email, subscription_status, plan, current_period_end,
          stripe_customer_id IS NOT NULL AS has_customer,
          stripe_subscription_id IS NOT NULL AS has_subscription, updated_at
     FROM users WHERE LOWER(email)=LOWER('kaypro98@gmail.com') LIMIT 1`
);
console.log(rows.length ? JSON.stringify(rows[0], null, 2) : 'user not found');
process.exit(0);
