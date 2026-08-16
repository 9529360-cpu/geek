-- 极客付费订阅体系 D1 建表
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',          -- active / disabled
  quota_chars INTEGER NOT NULL DEFAULT 20000,     -- 剩余免费翻译字符额度（注册赠送）
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  plan TEXT NOT NULL,                              -- monthly / quarterly / yearly
  starts_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',           -- active / expired
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  plan TEXT NOT NULL,
  amount INTEGER NOT NULL,                         -- 美元整数
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'pending',          -- pending / paid / cancelled
  pay_method TEXT NOT NULL DEFAULT 'manual',       -- manual / usdt
  amount_cents INTEGER,                            -- USDT 唯一金额（分，如 2537 = $25.37，识别订单用）
  tx_id TEXT,                                      -- 链上交易哈希（USDT 到账后记录）
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_subs_user ON subs(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- 运营配置（客服联系方式、公告等）
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 管理操作日志（谁做了什么）
CREATE TABLE IF NOT EXISTS admin_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,              -- confirm_order / adjust_chars / disable / enable / cancel_order / update_settings
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_admin_logs_created ON admin_logs(created_at);

-- 接口速率限制（防刷：注册/登录）
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT PRIMARY KEY,           -- "reg:1.2.3.4" / "login:1.2.3.4"
  count INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 管理后台登录失败记录（防爆破）
CREATE TABLE IF NOT EXISTS admin_login_attempts (
  ip TEXT PRIMARY KEY,
  fails INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT
);
