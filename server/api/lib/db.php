<?php
// Database SQLite: connessione, schema (creato/aggiornato automaticamente), transazioni.
declare(strict_types=1);

require_once __DIR__ . '/catalog.php';

const SCHEMA_VERSION = 1;

function db_path(array $config): string
{
    $dir = getenv('PC_DATA_DIR') ?: ($config['data_dir'] ?? (dirname(__DIR__) . '/data'));
    if (!is_dir($dir) && !@mkdir($dir, 0775, true)) {
        fail('server', 'Impossibile creare la cartella dati: controlla i permessi di api/data.', 500);
    }
    return rtrim($dir, '/') . '/party-casino.sqlite';
}

function db_connect(array $config): PDO
{
    if (!extension_loaded('pdo_sqlite')) {
        fail('server', 'Estensione PHP pdo_sqlite non disponibile: attivala dal pannello dell’hosting.', 500);
    }
    $path = db_path($config);
    $isNew = !file_exists($path);
    $pdo = new PDO('sqlite:' . $path, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_TIMEOUT => 10,
    ]);
    $pdo->exec('PRAGMA foreign_keys = ON');
    $pdo->exec('PRAGMA busy_timeout = 10000');
    // journal "DELETE" (predefinito): il più sicuro su hosting condiviso (WAL richiede memoria condivisa locale)
    if ($isNew) @chmod($path, 0660);
    db_migrate($pdo);
    return $pdo;
}

/** Esegue $fn in una transazione con lock in scrittura immediato; incrementa la versione dei dati. */
function db_tx(PDO $pdo, callable $fn)
{
    $pdo->exec('BEGIN IMMEDIATE');
    try {
        $result = $fn();
        $pdo->exec("UPDATE meta SET v = CAST(v AS INTEGER) + 1 WHERE k = 'data_version'");
        $pdo->exec('COMMIT');
        return $result;
    } catch (Throwable $e) {
        $pdo->exec('ROLLBACK');
        throw $e;
    }
}

function db_one(PDO $pdo, string $sql, array $params = []): ?array
{
    $st = $pdo->prepare($sql);
    $st->execute($params);
    $row = $st->fetch();
    return $row === false ? null : $row;
}

function db_all(PDO $pdo, string $sql, array $params = []): array
{
    $st = $pdo->prepare($sql);
    $st->execute($params);
    return $st->fetchAll();
}

function db_exec(PDO $pdo, string $sql, array $params = []): int
{
    $st = $pdo->prepare($sql);
    $st->execute($params);
    return $st->rowCount();
}

function db_value(PDO $pdo, string $sql, array $params = [])
{
    $st = $pdo->prepare($sql);
    $st->execute($params);
    $v = $st->fetchColumn();
    return $v === false ? null : $v;
}

function db_migrate(PDO $pdo): void
{
    $pdo->exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
    $current = (int) (db_value($pdo, "SELECT v FROM meta WHERE k = 'schema_version'") ?? 0);
    if ($current >= SCHEMA_VERSION) return;

    $pdo->exec('BEGIN IMMEDIATE');
    try {
        $current = (int) (db_value($pdo, "SELECT v FROM meta WHERE k = 'schema_version'") ?? 0);
        if ($current < 1) {
            $pdo->exec(<<<'SQL'
CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  daily_bonus_base INTEGER NOT NULL DEFAULT 100,
  starting_chips INTEGER NOT NULL DEFAULT 1000,
  wheel TEXT NOT NULL DEFAULT '[1,1.5,1,2,1,3,1.5,5]',
  streak_bonus_pct INTEGER NOT NULL DEFAULT 10,
  max_streak INTEGER NOT NULL DEFAULT 7,
  join_token_ttl_seconds INTEGER NOT NULL DEFAULT 120,
  allow_manual_code INTEGER NOT NULL DEFAULT 1,
  timezone TEXT NOT NULL DEFAULT 'Europe/Rome'
);
INSERT INTO settings (id) VALUES (1);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar TEXT NOT NULL DEFAULT '🎲',
  color TEXT NOT NULL DEFAULT '#d4af37',
  bio TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'game_master', 'staff')),
  chips INTEGER NOT NULL DEFAULT 0 CHECK (chips >= 0),
  banned INTEGER NOT NULL DEFAULT 0,
  last_bonus_date TEXT,
  bonus_streak INTEGER NOT NULL DEFAULT 0,
  pass_token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE games (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('chips', 'lives', 'points')),
  room TEXT NOT NULL CHECK (room IN ('casino', 'arcade')),
  icon TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  min_participants INTEGER NOT NULL,
  max_participants INTEGER NOT NULL,
  default_lives INTEGER NOT NULL DEFAULT 0,
  target_points INTEGER NOT NULL DEFAULT 0,
  master_plays_default INTEGER NOT NULL DEFAULT 0,
  allow_teams INTEGER NOT NULL DEFAULT 0,
  allow_late_join INTEGER NOT NULL DEFAULT 0,
  outcomes TEXT NOT NULL DEFAULT '[]',
  allow_custom_delta INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE gm_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  motivation TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  review_note TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);

CREATE TABLE game_tables (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  game_id TEXT NOT NULL REFERENCES games (id),
  master_id TEXT NOT NULL REFERENCES users (id),
  status TEXT NOT NULL DEFAULT 'lobby' CHECK (status IN ('lobby', 'playing', 'closed', 'cancelled')),
  settlement TEXT NOT NULL DEFAULT 'live' CHECK (settlement IN ('live', 'on_close')),
  master_plays INTEGER NOT NULL DEFAULT 0,
  starting_lives INTEGER NOT NULL DEFAULT 0,
  target_points INTEGER NOT NULL DEFAULT 0,
  min_bet INTEGER NOT NULL DEFAULT 0,
  max_bet INTEGER NOT NULL DEFAULT 0,
  use_teams INTEGER NOT NULL DEFAULT 0,
  round_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  started_at TEXT,
  closed_at TEXT
);
CREATE INDEX game_tables_status ON game_tables (status, created_at);

CREATE TABLE join_tokens (
  table_id TEXT NOT NULL REFERENCES game_tables (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('nfc', 'static', 'qr')),
  token TEXT NOT NULL,
  expires_at TEXT,
  PRIMARY KEY (table_id, kind)
);

CREATE TABLE participants (
  table_id TEXT NOT NULL REFERENCES game_tables (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  is_master INTEGER NOT NULL DEFAULT 0,
  is_playing INTEGER NOT NULL DEFAULT 1,
  joined_via TEXT NOT NULL,
  lives INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,
  team TEXT CHECK (team IN ('A', 'B')),
  pending_delta INTEGER NOT NULL DEFAULT 0,
  net_delta INTEGER NOT NULL DEFAULT 0,
  eliminated_at TEXT,
  elimination_order INTEGER,
  placement INTEGER,
  joined_at TEXT NOT NULL,
  left_at TEXT,
  PRIMARY KEY (table_id, user_id)
);
CREATE INDEX participants_user ON participants (user_id);

CREATE TABLE rounds (
  id TEXT PRIMARY KEY,
  table_id TEXT NOT NULL REFERENCES game_tables (id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL,
  effects TEXT NOT NULL,
  undone INTEGER NOT NULL DEFAULT 0,
  UNIQUE (table_id, number)
);

CREATE TABLE ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  kind TEXT NOT NULL,
  table_id TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX ledger_user ON ledger (user_id, id);

CREATE TABLE audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT,
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE login_attempts (
  ip TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX login_attempts_ip ON login_attempts (ip, at);
SQL);
            $ins = $pdo->prepare('INSERT INTO games (id, name, mode, room, icon, description, min_participants, max_participants,
                default_lives, target_points, master_plays_default, allow_teams, allow_late_join, outcomes, allow_custom_delta, enabled, sort)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)');
            foreach (default_games() as $g) {
                $ins->execute([
                    $g['id'], $g['name'], $g['mode'], $g['room'], $g['icon'], $g['description'],
                    $g['minParticipants'], $g['maxParticipants'], $g['defaultLives'], $g['targetPoints'],
                    $g['masterPlaysDefault'] ? 1 : 0, $g['allowTeams'] ? 1 : 0, $g['allowLateJoin'] ? 1 : 0,
                    json_encode($g['outcomes'], JSON_UNESCAPED_UNICODE), $g['allowCustomDelta'] ? 1 : 0, $g['sort'],
                ]);
            }
            $pdo->exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('data_version', '1')");
        }
        $pdo->exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('schema_version', '" . SCHEMA_VERSION . "')");
        $pdo->exec('COMMIT');
    } catch (Throwable $e) {
        $pdo->exec('ROLLBACK');
        throw $e;
    }
}
