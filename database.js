const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");

const dataDir = path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });
const databasePath = process.env.DATABASE_PATH ? path.resolve(process.env.DATABASE_PATH) : path.join(dataDir, "platform.sqlite");
fs.mkdirSync(path.dirname(databasePath), { recursive:true });
const db = new DatabaseSync(databasePath);

db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    country TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    status TEXT NOT NULL DEFAULT 'active'
      CHECK(status IN ('active','suspended','closed')),
    email_verified_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    ip_address TEXT,
    user_agent TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    requested_ip TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS email_verification_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK(purpose IN ('registration','login')),
    code_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    requested_ip TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    recipient_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general'
      CHECK(category IN ('general','account','payment','investment','vehicle','security')),
    created_by TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notification_reads (
    notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at TEXT NOT NULL,
    PRIMARY KEY(notification_id,user_id)
  );

  CREATE TABLE IF NOT EXISTS wallets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    currency TEXT NOT NULL DEFAULT 'USD',
    available_cents INTEGER NOT NULL DEFAULT 0 CHECK(available_cents >= 0),
    pending_cents INTEGER NOT NULL DEFAULT 0 CHECK(pending_cents >= 0),
    version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS wallet_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    type TEXT NOT NULL CHECK(type IN ('deposit','withdrawal','investment','refund','adjustment')),
    direction TEXT NOT NULL CHECK(direction IN ('credit','debit')),
    amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
    fee_cents INTEGER NOT NULL DEFAULT 0 CHECK(fee_cents >= 0),
    currency TEXT NOT NULL,
    method TEXT,
    reference TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('pending','processing','confirmed','rejected','cancelled')),
    metadata_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS investment_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    nav_cents INTEGER NOT NULL CHECK(nav_cents > 0),
    minimum_cents INTEGER NOT NULL CHECK(minimum_cents > 0),
    projected_return_bps INTEGER NOT NULL DEFAULT 0,
    management_fee_bps INTEGER NOT NULL DEFAULT 0,
    risk_level TEXT NOT NULL CHECK(risk_level IN ('Low','Medium','High')),
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
    description TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS investment_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    plan_id INTEGER NOT NULL REFERENCES investment_plans(id) ON DELETE RESTRICT,
    amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
    fee_cents INTEGER NOT NULL DEFAULT 0,
    units_micros INTEGER NOT NULL CHECK(units_micros > 0),
    duration_days INTEGER NOT NULL DEFAULT 30 CHECK(duration_days IN (7,30,90)),
    status TEXT NOT NULL DEFAULT 'placed'
      CHECK(status IN ('placed','processing','approved','rejected','cancelled','completed')),
    wallet_transaction_id INTEGER REFERENCES wallet_transactions(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS holdings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    plan_id INTEGER NOT NULL REFERENCES investment_plans(id) ON DELETE RESTRICT,
    units_micros INTEGER NOT NULL DEFAULT 0,
    cost_basis_cents INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, plan_id)
  );

  CREATE TABLE IF NOT EXISTS vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    year INTEGER NOT NULL,
    make TEXT NOT NULL,
    model TEXT NOT NULL,
    price_cents INTEGER NOT NULL CHECK(price_cents > 0),
    mileage INTEGER NOT NULL DEFAULT 0,
    color TEXT,
    image_path TEXT,
    status TEXT NOT NULL DEFAULT 'available'
      CHECK(status IN ('available','reserved','financing','sold','delivered','archived')),
    featured INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stock_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    symbol TEXT NOT NULL,
    shares_micros INTEGER NOT NULL CHECK(shares_micros > 0),
    execution_price_cents INTEGER NOT NULL CHECK(execution_price_cents > 0),
    principal_cents INTEGER NOT NULL CHECK(principal_cents > 0),
    fee_cents INTEGER NOT NULL DEFAULT 0,
    annual_roi_bps INTEGER NOT NULL DEFAULT 7000,
    duration_days INTEGER NOT NULL DEFAULT 30 CHECK(duration_days IN (7,30,90)),
    status TEXT NOT NULL DEFAULT 'placed'
      CHECK(status IN ('placed','processing','approved','rejected','cancelled','completed')),
    wallet_transaction_id INTEGER REFERENCES wallet_transactions(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_type TEXT NOT NULL,
    actor_id TEXT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    details_json TEXT,
    ip_address TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS platform_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS referrals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    referrer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    referred_user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
    referral_code TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','successful','rejected')),
    investment_status TEXT NOT NULL DEFAULT 'not_qualified' CHECK(investment_status IN ('not_qualified','qualified')),
    qualifying_investment_cents INTEGER NOT NULL DEFAULT 0,
    commission_cents INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    qualified_at TEXT,
    UNIQUE(referrer_user_id,referred_user_id)
  );

  CREATE TABLE IF NOT EXISTS affiliates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    affiliate_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'inactive' CHECK(status IN ('inactive','active','suspended')),
    activated_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS affiliate_withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
    method TEXT NOT NULL,
    destination TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','paid')),
    admin_note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS fraud_flags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    details_json TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','reviewed','dismissed')),
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
  CREATE INDEX IF NOT EXISTS idx_email_verification_user ON email_verification_codes(user_id,purpose,created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_reset_tokens(token_hash);
  CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_user_id,created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user ON wallet_transactions(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_investment_orders_user ON investment_orders(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_stock_orders_user ON stock_orders(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_affiliate_withdrawals_user ON affiliate_withdrawals(user_id, created_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_one_welcome_bonus_per_user ON wallet_transactions(user_id,reference) WHERE reference='Welcome Investment Bonus';
`);

const ensureColumn=(table,column,declaration)=>{
  if(!db.prepare(`PRAGMA table_info(${table})`).all().some(item=>item.name===column)){
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
  }
};
ensureColumn("investment_orders","duration_days","INTEGER NOT NULL DEFAULT 30 CHECK(duration_days IN (7,30,90))");
ensureColumn("investment_orders","term_days","INTEGER");
ensureColumn("investment_plans","maximum_cents","INTEGER");
ensureColumn("investment_plans","daily_return_bps","INTEGER NOT NULL DEFAULT 0");
ensureColumn("investment_plans","duration_days","INTEGER NOT NULL DEFAULT 30");
ensureColumn("stock_orders","duration_days","INTEGER NOT NULL DEFAULT 30 CHECK(duration_days IN (7,30,90))");
ensureColumn("users","first_name","TEXT");
ensureColumn("users","last_name","TEXT");
ensureColumn("users","phone","TEXT");
ensureColumn("users","referral_code","TEXT");
ensureColumn("users","registration_ip","TEXT");
ensureColumn("users","login_code_hash","TEXT");
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code) WHERE referral_code IS NOT NULL");

const settingDefaults = {
  welcome_bonus_cents:"0",
  affiliate_membership_fee_cents:"5000",
  referral_commission_bps:"1000",
  referral_qualifying_investment_cents:"10000",
  referrals_enabled:"1",
  affiliate_program_enabled:"1"
};
const insertSetting=db.prepare("INSERT OR IGNORE INTO platform_settings (key,value,updated_at) VALUES (?,?,?)");
for(const [key,value] of Object.entries(settingDefaults))insertSetting.run(key,value,new Date().toISOString());
db.prepare("UPDATE platform_settings SET value='0',updated_at=? WHERE key='welcome_bonus_cents'").run(new Date().toISOString());
if(!db.prepare("SELECT 1 FROM platform_settings WHERE key='welcome_bonus_removed_v1'").get()){
  const bonuses=db.prepare("SELECT user_id,wallet_id,SUM(amount_cents) AS amount_cents FROM wallet_transactions WHERE reference='Welcome Investment Bonus' GROUP BY user_id,wallet_id").all();
  const timestamp=new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try{
    for(const bonus of bonuses)db.prepare("UPDATE wallets SET available_cents=max(0,available_cents-?),version=version+1,updated_at=? WHERE id=?").run(bonus.amount_cents,timestamp,bonus.wallet_id);
    db.prepare("DELETE FROM wallet_transactions WHERE reference='Welcome Investment Bonus'").run();
    db.prepare("INSERT INTO platform_settings (key,value,updated_at) VALUES ('welcome_bonus_removed_v1','1',?)").run(timestamp);
    db.exec("COMMIT");
  }catch(error){db.exec("ROLLBACK");throw error}
}
db.prepare("UPDATE users SET referral_code='REF-' || printf('%06d',id) WHERE referral_code IS NULL").run();
db.prepare("INSERT OR IGNORE INTO affiliates (user_id,affiliate_id,status,created_at,updated_at) SELECT id,'AFF-' || public_id,'inactive',created_at,updated_at FROM users").run();

db.prepare("UPDATE stock_orders SET annual_roi_bps=7000 WHERE annual_roi_bps<>7000").run();

const count = db.prepare("SELECT COUNT(*) AS count FROM investment_plans").get().count;
if (count === 0) {
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO investment_plans
      (public_id,name,category,nav_cents,minimum_cents,projected_return_bps,management_fee_bps,risk_level,status,description,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const plans = [
    ["PLAN-TESLA-GROWTH","Tesla Growth Fund","Tesla-Focused",3550,10000,923,85,"High","active","Tesla-focused growth portfolio."],
    ["PLAN-SUSTAINABLE","Sustainable Energy ETF","ESG",1875,5000,480,65,"Medium","active","Diversified sustainable-energy exposure."],
    ["PLAN-GLOBAL-GROWTH","Global Growth Fund","Growth",1980,40000,640,75,"Medium","active","Global growth companies and themes."]
  ];
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const plan of plans) insert.run(...plan, now, now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

const stagedPlans = [
  ["PLAN-BEGINNER-1A","Beginner Plan","Beginner",10000,10000,699900,500,1,500,0,"Low","active","A one-day entry plan for new investors."],
  ["PLAN-BEGINNER-1B","Beginner Plan","Beginner",10000,10000,699900,500,1,500,0,"Low","active","A second one-day entry option with the same limits."],
  ["PLAN-GOLD-3","Gold Plan","Gold",10000,700000,2999900,600,3,1800,0,"Medium","active","Three-day Gold investment term."],
  ["PLAN-GOLD-7","Gold Plan","Gold",10000,700000,2499900,750,7,5250,0,"Medium","active","Seven-day Gold investment term."],
  ["PLAN-PLATINUM-14","Platinum Plan","Platinum",10000,2500000,9999900,1000,14,14000,0,"High","active","Fourteen-day Platinum investment term."],
  ["PLAN-PLATINUM-5","Platinum Plan","Platinum",10000,3000000,9999900,700,5,3500,0,"High","active","Five-day Platinum investment term."],
  ["PLAN-DIAMOND-30","Diamond Plan","Diamond",10000,10000000,50000000,1250,30,37500,0,"High","active","Thirty-day Diamond investment term."],
  ["PLAN-DIAMOND-7","Diamond Plan","Diamond",10000,10000000,50000000,800,7,5600,0,"High","active","Seven-day Diamond investment term."]
];
db.exec("BEGIN IMMEDIATE");
try {
  db.prepare("UPDATE investment_plans SET status='inactive'").run();
  const upsertPlan = db.prepare(`
    INSERT INTO investment_plans
      (public_id,name,category,nav_cents,minimum_cents,maximum_cents,daily_return_bps,duration_days,projected_return_bps,management_fee_bps,risk_level,status,description,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(public_id) DO UPDATE SET
      name=excluded.name,
      category=excluded.category,
      nav_cents=excluded.nav_cents,
      minimum_cents=excluded.minimum_cents,
      maximum_cents=excluded.maximum_cents,
      daily_return_bps=excluded.daily_return_bps,
      duration_days=excluded.duration_days,
      projected_return_bps=excluded.projected_return_bps,
      management_fee_bps=excluded.management_fee_bps,
      risk_level=excluded.risk_level,
      status=excluded.status,
      description=excluded.description,
      updated_at=excluded.updated_at
  `);
  const timestamp = new Date().toISOString();
  for (const plan of stagedPlans) upsertPlan.run(...plan,timestamp,timestamp);
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}

const vehicleCount = db.prepare("SELECT COUNT(*) AS count FROM vehicles").get().count;
if (vehicleCount === 0) {
  const timestamp = new Date().toISOString();
  const insert = db.prepare("INSERT INTO vehicles (public_id,title,year,make,model,price_cents,mileage,color,image_path,status,featured,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'available',1,?,?)");
  const vehicles = [
    ["VEH-MODEL-Y","2026 Model Y Long Range",2026,"Tesla","Model Y Long Range",5299000,18,"Ultra Red","images/Homepage-Promo-Meet-Model-Y-Desktop.avif"],
    ["VEH-CYBERTRUCK","2026 Cybertruck AWD",2026,"Tesla","Cybertruck AWD",9999000,12,"Stainless Steel","images/Cybertruck-Terrain-Badge-Desktop-NA-SA-APAC.avif"],
    ["VEH-MODEL-3","2025 Model 3 Performance",2025,"Tesla","Model 3 Performance",5499000,85,"Pearl White","images/tesla-hero.jpg"]
  ];
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const vehicle of vehicles) insert.run(...vehicle,timestamp,timestamp);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

module.exports = db;
