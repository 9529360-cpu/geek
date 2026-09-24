-- 极客付费订阅体系 D1 建表
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_no TEXT NOT NULL UNIQUE,                 -- 公开客服账号号：GK- + 16 随机字节的 32 位小写 hex
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',          -- active / disabled
  quota_chars INTEGER NOT NULL DEFAULT 20000,     -- 剩余免费翻译字符额度（注册赠送）
  token_version INTEGER NOT NULL DEFAULT 0,       -- 改密时递增，使旧登录会话立即失效
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
  status TEXT NOT NULL DEFAULT 'pending',          -- pending / processing / paid / cancelled / expired
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

-- 翻译请求幂等与服务端计费记录；不保存聊天正文或译文。
CREATE TABLE IF NOT EXISTS translation_usage (
  request_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  reserved_chars INTEGER NOT NULL,
  target_chars INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'reserved',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  lease_expires_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_translation_usage_user_created ON translation_usage(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_translation_usage_lease ON translation_usage(lease_expires_at);
CREATE TRIGGER IF NOT EXISTS trg_translation_usage_reservation_lease
AFTER INSERT ON translation_usage
WHEN NEW.lease_expires_at IS NULL
  AND (NEW.status = 'reserved' OR NEW.status LIKE 'reserved:%')
BEGIN
  UPDATE translation_usage
  SET lease_expires_at = datetime('now', '+2 minutes')
  WHERE request_id = NEW.request_id
    AND lease_expires_at IS NULL;
END;

-- 忘记密码：仅保存一次性 Token 的 SHA-256，不保存明文链接。
CREATE TABLE IF NOT EXISTS password_reset_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested',
  token_hash TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  used_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_password_resets_status_created ON password_reset_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_reset_requests(token_hash);


-- Managed migration ledger fixture for the exact post-005 / pre-006 state.
-- This is local validation data only; production remains read-only during plan.
CREATE TABLE IF NOT EXISTS geek_d1_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO geek_d1_migrations (name, applied_at)
VALUES ('005-translation-reservation-lease.sql', '2026-09-24 00:00:00');
