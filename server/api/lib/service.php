<?php
// Operazioni di dominio. Porting di src/data/local/LocalBackend.ts: stesse regole e messaggi.
// Ogni metodo che modifica dati va chiamato dentro db_tx() (vedi index.php).
declare(strict_types=1);

require_once __DIR__ . '/rules.php';

const ACTIVE_STATUSES = ['lobby', 'playing'];

final class Service
{
    private PDO $db;
    private ?string $uid;
    private int $nowMs;

    public function __construct(PDO $db, ?string $uid, int $nowMs)
    {
        $this->db = $db;
        $this->uid = $uid;
        $this->nowMs = $nowMs;
    }

    // ------------------------------------------------------------------ helper

    private function iso(int $offsetMs = 0): string
    {
        return now_iso($this->nowMs + $offsetMs);
    }

    private function settingsRow(): array
    {
        $s = db_one($this->db, 'SELECT * FROM settings WHERE id = 1');
        $s['wheel'] = json_decode($s['wheel'], true) ?: [1];
        return $s;
    }

    public function settings(): array
    {
        $s = $this->settingsRow();
        return [
            'dailyBonusBase' => (int) $s['daily_bonus_base'],
            'startingChips' => (int) $s['starting_chips'],
            'wheel' => array_map(fn ($m) => $m + 0, $s['wheel']),
            'streakBonusPct' => (int) $s['streak_bonus_pct'],
            'maxStreak' => (int) $s['max_streak'],
            'joinTokenTtlSeconds' => (int) $s['join_token_ttl_seconds'],
            'allowManualCode' => (bool) $s['allow_manual_code'],
            'timezone' => $s['timezone'],
        ];
    }

    public function currentUserId(): ?string
    {
        return $this->uid;
    }

    private function user(string $id): array
    {
        $u = db_one($this->db, 'SELECT * FROM users WHERE id = ?', [$id]);
        if (!$u) fail('not_found', 'Utente non trovato.', 404);
        return $u;
    }

    public function me(bool $requireActive = true): array
    {
        $u = $this->uid ? db_one($this->db, 'SELECT * FROM users WHERE id = ?', [$this->uid]) : null;
        if (!$u) fail('auth', 'Devi accedere per continuare.', 401);
        if ($requireActive && (int) $u['banned'] === 1) fail('banned', 'Il tuo account è sospeso. Contatta lo staff.', 403);
        return $u;
    }

    private function staff(): array
    {
        $u = $this->me();
        if ($u['role'] !== 'staff') fail('forbidden', 'Operazione riservata allo staff.', 403);
        return $u;
    }

    private function tableRow(string $id): array
    {
        $t = db_one($this->db, 'SELECT * FROM game_tables WHERE id = ?', [$id]);
        if (!$t) fail('not_found', 'Tavolo non trovato.', 404);
        return $t;
    }

    private function gameRow(string $id): array
    {
        $g = db_one($this->db, 'SELECT * FROM games WHERE id = ?', [$id]);
        if (!$g) fail('not_found', 'Gioco non trovato.', 404);
        $g['outcomes'] = json_decode($g['outcomes'], true) ?: [];
        return $g;
    }

    private function participantRows(string $tableId): array
    {
        return db_all($this->db, 'SELECT * FROM participants WHERE table_id = ? ORDER BY is_master DESC, joined_at', [$tableId]);
    }

    private function participantRow(string $tableId, string $userId): ?array
    {
        return db_one($this->db, 'SELECT * FROM participants WHERE table_id = ? AND user_id = ?', [$tableId, $userId]);
    }

    /** @return array{0: array, 1: array, 2: array} [attore, tavolo, gioco] */
    private function requireMaster(string $tableId): array
    {
        $actor = $this->me();
        $table = $this->tableRow($tableId);
        if ($table['master_id'] !== $actor['id'] && $actor['role'] !== 'staff') {
            fail('forbidden', 'Solo il game master del tavolo può farlo.', 403);
        }
        return [$actor, $table, $this->gameRow($table['game_id'])];
    }

    /** Unico punto in cui cambia un saldo: aggiorna e registra nel libro mastro. */
    private function ledger(string $userId, int $delta, string $kind, string $note, ?string $tableId, ?string $by): int
    {
        $u = $this->user($userId);
        $balance = (int) $u['chips'] + $delta;
        if ($balance < 0) fail('chips', $u['display_name'] . ' non ha abbastanza fiches.');
        db_exec($this->db, 'UPDATE users SET chips = ? WHERE id = ?', [$balance, $userId]);
        db_exec($this->db, 'INSERT INTO ledger (user_id, delta, balance_after, kind, table_id, note, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [$userId, $delta, $balance, $kind, $tableId, $note, $by, $this->iso()]);
        return $balance;
    }

    private function audit(?string $actorId, string $action, string $target, array $details = []): void
    {
        db_exec($this->db, 'INSERT INTO audit (actor_id, action, target, details, created_at) VALUES (?, ?, ?, ?, ?)', [
            $actorId, $action, $target, json_encode((object) $details, JSON_UNESCAPED_UNICODE), $this->iso(),
        ]);
    }

    private function activeTableOf(string $userId): ?array
    {
        return db_one($this->db, "SELECT t.* FROM participants p JOIN game_tables t ON t.id = p.table_id
            WHERE p.user_id = ? AND p.left_at IS NULL AND t.status IN ('lobby', 'playing') LIMIT 1", [$userId]);
    }

    // ------------------------------------------------------------------ formati di uscita (come src/core/types.ts)

    public static function lite(array $u): array
    {
        return [
            'id' => $u['id'],
            'username' => $u['username'],
            'displayName' => $u['display_name'],
            'avatar' => $u['avatar'],
            'color' => $u['color'],
            'role' => $u['role'],
            'chips' => (int) $u['chips'],
        ];
    }

    public static function profile(array $u): array
    {
        return self::lite($u) + [
            'bio' => $u['bio'],
            'banned' => (bool) $u['banned'],
            'createdAt' => $u['created_at'],
            'lastBonusDate' => $u['last_bonus_date'],
            'bonusStreak' => (int) $u['bonus_streak'],
        ];
    }

    private static function gameOut(array $g): array
    {
        $outcomes = is_array($g['outcomes']) ? $g['outcomes'] : (json_decode($g['outcomes'], true) ?: []);
        return [
            'id' => $g['id'],
            'name' => $g['name'],
            'mode' => $g['mode'],
            'room' => $g['room'],
            'icon' => $g['icon'],
            'description' => $g['description'],
            'minParticipants' => (int) $g['min_participants'],
            'maxParticipants' => (int) $g['max_participants'],
            'defaultLives' => (int) $g['default_lives'],
            'targetPoints' => (int) $g['target_points'],
            'masterPlaysDefault' => (bool) $g['master_plays_default'],
            'allowTeams' => (bool) $g['allow_teams'],
            'allowLateJoin' => (bool) $g['allow_late_join'],
            'outcomes' => array_map(fn ($o) => ['key' => (string) $o['key'], 'label' => (string) $o['label'], 'mult' => $o['mult'] + 0], $outcomes),
            'allowCustomDelta' => (bool) $g['allow_custom_delta'],
            'enabled' => (bool) $g['enabled'],
            'sort' => (int) $g['sort'],
        ];
    }

    private static function tableOut(array $t): array
    {
        return [
            'id' => $t['id'],
            'code' => $t['code'],
            'name' => $t['name'],
            'gameId' => $t['game_id'],
            'masterId' => $t['master_id'],
            'status' => $t['status'],
            'settlement' => $t['settlement'],
            'masterPlays' => (bool) $t['master_plays'],
            'startingLives' => (int) $t['starting_lives'],
            'targetPoints' => (int) $t['target_points'],
            'minBet' => (int) $t['min_bet'],
            'maxBet' => (int) $t['max_bet'],
            'useTeams' => (bool) $t['use_teams'],
            'roundCount' => (int) $t['round_count'],
            'createdAt' => $t['created_at'],
            'startedAt' => $t['started_at'],
            'closedAt' => $t['closed_at'],
        ];
    }

    private function participantOut(array $p): array
    {
        return [
            'tableId' => $p['table_id'],
            'userId' => $p['user_id'],
            'isMaster' => (bool) $p['is_master'],
            'isPlaying' => (bool) $p['is_playing'],
            'joinedVia' => $p['joined_via'],
            'lives' => (int) $p['lives'],
            'score' => (int) $p['score'],
            'team' => $p['team'],
            'pendingDelta' => (int) $p['pending_delta'],
            'netDelta' => (int) $p['net_delta'],
            'eliminatedAt' => $p['eliminated_at'],
            'eliminationOrder' => $p['elimination_order'] === null ? null : (int) $p['elimination_order'],
            'placement' => $p['placement'] === null ? null : (int) $p['placement'],
            'joinedAt' => $p['joined_at'],
            'leftAt' => $p['left_at'],
            'profile' => self::lite($this->user($p['user_id'])),
        ];
    }

    private function summaryOut(array $t): array
    {
        return [
            'table' => self::tableOut($t),
            'game' => self::gameOut($this->gameRow($t['game_id'])),
            'master' => self::lite($this->user($t['master_id'])),
            'participantCount' => (int) db_value($this->db, 'SELECT COUNT(*) FROM participants WHERE table_id = ? AND left_at IS NULL', [$t['id']]),
        ];
    }

    public static function ledgerOut(array $l): array
    {
        return [
            'id' => (string) $l['id'],
            'userId' => $l['user_id'],
            'delta' => (int) $l['delta'],
            'balanceAfter' => (int) $l['balance_after'],
            'kind' => $l['kind'],
            'tableId' => $l['table_id'],
            'note' => $l['note'],
            'createdBy' => $l['created_by'],
            'createdAt' => $l['created_at'],
        ];
    }

    private function gmRequestOut(array $r): array
    {
        return [
            'id' => $r['id'],
            'userId' => $r['user_id'],
            'motivation' => $r['motivation'],
            'status' => $r['status'],
            'reviewNote' => $r['review_note'],
            'reviewedBy' => $r['reviewed_by'],
            'createdAt' => $r['created_at'],
            'reviewedAt' => $r['reviewed_at'],
            'profile' => self::lite($this->user($r['user_id'])),
        ];
    }

    // ------------------------------------------------------------------ account

    public function register(string $username, string $displayName, string $password, string $avatar = '🎲', string $color = '#d4af37'): array
    {
        $username = normalize_username($username);
        if (!is_valid_username($username)) fail('username', 'Username: 3-20 caratteri tra lettere minuscole, numeri, _ e .');
        if (strlen($password) < 6) fail('password', 'La password deve avere almeno 6 caratteri.');
        if (db_value($this->db, 'SELECT 1 FROM users WHERE username = ?', [$username])) fail('username', 'Username già in uso.');
        $display = trim($displayName) !== '' ? mb_substr(trim($displayName), 0, 30) : $username;
        $first = (int) db_value($this->db, 'SELECT COUNT(*) FROM users') === 0;
        $id = uuid4();
        do {
            $pass = gen_token(20);
        } while (db_value($this->db, 'SELECT 1 FROM users WHERE pass_token = ?', [$pass]));
        db_exec($this->db, 'INSERT INTO users (id, username, password_hash, display_name, avatar, color, role, pass_token, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
            $id, $username, password_hash($password, PASSWORD_DEFAULT), $display, $avatar, $color,
            $first ? 'staff' : 'player', $pass, $this->iso(),
        ]);
        $this->ledger($id, (int) $this->settingsRow()['starting_chips'], 'signup', 'Fiches di benvenuto', null, null);
        $this->audit($id, 'signup', $username, $first ? ['note' => 'primo utente: staff'] : []);
        return $this->user($id);
    }

    public function verifyLogin(string $identifier, string $password): array
    {
        $u = db_one($this->db, 'SELECT * FROM users WHERE username = ?', [normalize_username($identifier)]);
        if (!$u || !password_verify($password, $u['password_hash'])) fail('auth', 'Credenziali non valide.', 401);
        if (password_needs_rehash($u['password_hash'], PASSWORD_DEFAULT)) {
            db_exec($this->db, 'UPDATE users SET password_hash = ? WHERE id = ?', [password_hash($password, PASSWORD_DEFAULT), $u['id']]);
        }
        return $u;
    }

    public function changePassword(string $current, string $next): void
    {
        $me = $this->me(false);
        if (!password_verify($current, $me['password_hash'])) fail('auth', 'La password attuale non è corretta.');
        if (strlen($next) < 6) fail('password', 'La password deve avere almeno 6 caratteri.');
        db_exec($this->db, 'UPDATE users SET password_hash = ? WHERE id = ?', [password_hash($next, PASSWORD_DEFAULT), $me['id']]);
        $this->audit($me['id'], 'password_change', $me['username']);
    }

    // ------------------------------------------------------------------ profili e statistiche

    public function getProfile(string $id): array
    {
        $this->me(false);
        return self::profile($this->user($id));
    }

    public function findByUsername(string $username): ?array
    {
        $this->me(false);
        $u = db_one($this->db, 'SELECT * FROM users WHERE username = ?', [normalize_username($username)]);
        return $u ? self::profile($u) : null;
    }

    public function updateMyProfile(array $in): array
    {
        $me = $this->me(false);
        if (array_key_exists('displayName', $in)) {
            $name = trim((string) $in['displayName']);
            if (mb_strlen($name) < 1 || mb_strlen($name) > 30) fail('name', 'Il nome deve avere tra 1 e 30 caratteri.');
            db_exec($this->db, 'UPDATE users SET display_name = ? WHERE id = ?', [$name, $me['id']]);
        }
        if (array_key_exists('avatar', $in)) db_exec($this->db, 'UPDATE users SET avatar = ? WHERE id = ?', [mb_substr((string) $in['avatar'], 0, 8), $me['id']]);
        if (array_key_exists('color', $in)) {
            $color = (string) $in['color'];
            if (!preg_match('/^#[0-9a-fA-F]{6}$/', $color)) fail('color', 'Colore non valido.');
            db_exec($this->db, 'UPDATE users SET color = ? WHERE id = ?', [$color, $me['id']]);
        }
        if (array_key_exists('bio', $in)) db_exec($this->db, 'UPDATE users SET bio = ? WHERE id = ?', [mb_substr((string) $in['bio'], 0, 160), $me['id']]);
        return self::profile($this->user($me['id']));
    }

    public function stats(string $userId): array
    {
        $this->me(false);
        $rows = db_all($this->db, "SELECT p.*, t.name AS table_name, t.game_id, t.closed_at, t.created_at AS table_created, g.mode
            FROM participants p JOIN game_tables t ON t.id = p.table_id JOIN games g ON g.id = t.game_id
            WHERE p.user_id = ? AND t.status = 'closed'", [$userId]);
        $s = [
            'userId' => $userId, 'gamesPlayed' => 0, 'wins' => 0, 'chipsWon' => 0, 'chipsLost' => 0, 'biggestWin' => 0,
            'tablesMastered' => 0, 'winsByMode' => ['chips' => 0, 'lives' => 0, 'points' => 0], 'byGame' => [], 'recent' => [],
        ];
        $byGame = [];
        foreach ($rows as $p) {
            $playing = (int) $p['is_playing'] === 1;
            $net = (int) $p['net_delta'];
            $placement = $p['placement'] === null ? null : (int) $p['placement'];
            if ((int) $p['is_master'] === 1) $s['tablesMastered']++;
            $won = $playing && is_win($p['mode'], $placement, $net);
            if ($playing) {
                $s['gamesPlayed']++;
                if ($won) {
                    $s['wins']++;
                    $s['winsByMode'][$p['mode']]++;
                }
                if ($net > 0) $s['chipsWon'] += $net;
                if ($net < 0) $s['chipsLost'] += -$net;
                $s['biggestWin'] = max($s['biggestWin'], $net);
                $g = $byGame[$p['game_id']] ?? ['gameId' => $p['game_id'], 'played' => 0, 'wins' => 0, 'net' => 0];
                $g['played']++;
                if ($won) $g['wins']++;
                $g['net'] += $net;
                $byGame[$p['game_id']] = $g;
            }
            $s['recent'][] = [
                'tableId' => $p['table_id'], 'tableName' => $p['table_name'], 'gameId' => $p['game_id'], 'mode' => $p['mode'],
                'closedAt' => $p['closed_at'] ?? $p['table_created'], 'placement' => $placement, 'netDelta' => $net,
                'wasMaster' => (int) $p['is_master'] === 1 && !$playing, 'won' => $won,
            ];
        }
        $s['byGame'] = array_values($byGame);
        usort($s['byGame'], fn ($a, $b) => $b['played'] <=> $a['played']);
        usort($s['recent'], fn ($a, $b) => strcmp($b['closedAt'], $a['closedAt']));
        $s['recent'] = array_slice($s['recent'], 0, 12);
        return $s;
    }

    public function leaderboard(string $kind): array
    {
        $this->me(false);
        $agg = "SELECT p.user_id,
              SUM(CASE WHEN p.is_playing = 1 THEN 1 ELSE 0 END) AS games,
              SUM(CASE WHEN p.is_playing = 1 AND p.placement = 1 AND (g.mode <> 'chips' OR p.net_delta > 0) THEN 1 ELSE 0 END) AS wins
            FROM participants p JOIN game_tables t ON t.id = p.table_id AND t.status = 'closed' JOIN games g ON g.id = t.game_id
            GROUP BY p.user_id";
        $valueExpr = $kind === 'wins' ? 'COALESCE(a.wins, 0)' : ($kind === 'games' ? 'COALESCE(a.games, 0)' : 'u.chips');
        $rows = db_all($this->db, "SELECT u.*, $valueExpr AS value FROM users u LEFT JOIN ($agg) a ON a.user_id = u.id
            WHERE u.banned = 0 ORDER BY value DESC, u.username LIMIT 50");
        return array_map(fn ($r) => ['profile' => self::lite($r), 'value' => (int) $r['value']], $rows);
    }

    public function myLedger(int $limit): array
    {
        $me = $this->me(false);
        $rows = db_all($this->db, 'SELECT * FROM ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?', [$me['id'], max(1, min($limit, 200))]);
        return array_map([self::class, 'ledgerOut'], $rows);
    }

    // ------------------------------------------------------------------ bonus e pass

    public function claimDailyBonus(): array
    {
        $me = $this->me();
        $s = $this->settingsRow();
        $today = day_in_timezone(intdiv($this->nowMs, 1000), $s['timezone']);
        $segment = random_int(0, max(0, count($s['wheel']) - 1));
        $bonus = compute_daily_bonus($s, $me['last_bonus_date'], (int) $me['bonus_streak'], $today, $segment);
        if (!$bonus) fail('bonus', 'Hai già ritirato il bonus di oggi. Torna domani!');
        db_exec($this->db, 'UPDATE users SET last_bonus_date = ?, bonus_streak = ? WHERE id = ?', [$today, $bonus['streak'], $me['id']]);
        $label = rtrim(rtrim(number_format($bonus['multiplier'], 2, '.', ''), '0'), '.');
        $balance = $this->ledger($me['id'], $bonus['amount'], 'daily_bonus', "Bonus giornaliero x$label (serie {$bonus['streak']})", null, null);
        return $bonus + ['balance' => $balance];
    }

    public function myPass(): string
    {
        return $this->me(false)['pass_token'];
    }

    public function rotateMyPass(): string
    {
        $me = $this->me(false);
        $tok = gen_token(20);
        db_exec($this->db, 'UPDATE users SET pass_token = ? WHERE id = ?', [$tok, $me['id']]);
        $this->audit($me['id'], 'pass_rotate', $me['username']);
        return $tok;
    }

    // ------------------------------------------------------------------ richieste GM

    public function requestGameMaster(string $motivation): array
    {
        $me = $this->me();
        if ($me['role'] !== 'player') fail('gm', 'Sei già autorizzato a condurre tavoli.');
        if (db_value($this->db, "SELECT 1 FROM gm_requests WHERE user_id = ? AND status = 'pending'", [$me['id']])) {
            fail('gm', 'Hai già una richiesta in attesa.');
        }
        $text = trim($motivation);
        if (mb_strlen($text) < 10) fail('gm', 'Scrivi almeno due righe di motivazione (10 caratteri).');
        $id = uuid4();
        db_exec($this->db, 'INSERT INTO gm_requests (id, user_id, motivation, created_at) VALUES (?, ?, ?, ?)', [$id, $me['id'], mb_substr($text, 0, 500), $this->iso()]);
        $this->audit($me['id'], 'gm_request', $me['username']);
        return $this->gmRequestOut(db_one($this->db, 'SELECT * FROM gm_requests WHERE id = ?', [$id]));
    }

    public function myGmRequest(): ?array
    {
        $me = $this->me(false);
        $r = db_one($this->db, 'SELECT * FROM gm_requests WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1', [$me['id']]);
        return $r ? $this->gmRequestOut($r) : null;
    }

    // ------------------------------------------------------------------ tavoli: lettura

    public function listGames(): array
    {
        $this->me(false);
        return array_map(fn ($g) => self::gameOut($g), db_all($this->db, 'SELECT * FROM games ORDER BY sort, id'));
    }

    public function listActiveTables(): array
    {
        $this->me(false);
        $rows = db_all($this->db, "SELECT * FROM game_tables WHERE status IN ('lobby', 'playing') ORDER BY created_at DESC");
        return array_map(fn ($t) => $this->summaryOut($t), $rows);
    }

    public function myActiveTableId(): ?string
    {
        if (!$this->uid) return null;
        $t = $this->activeTableOf($this->uid);
        return $t ? $t['id'] : null;
    }

    public function getTable(string $id): array
    {
        $this->me(false);
        $t = $this->tableRow($id);
        $rounds = db_all($this->db, 'SELECT * FROM rounds WHERE table_id = ? ORDER BY number DESC LIMIT 60', [$id]);
        return [
            'table' => self::tableOut($t),
            'game' => self::gameOut($this->gameRow($t['game_id'])),
            'master' => self::lite($this->user($t['master_id'])),
            'participants' => array_map(fn ($p) => $this->participantOut($p), $this->participantRows($id)),
            'rounds' => array_map(fn ($r) => [
                'id' => $r['id'], 'tableId' => $r['table_id'], 'number' => (int) $r['number'], 'createdAt' => $r['created_at'],
                'createdBy' => $r['created_by'], 'effects' => json_decode($r['effects'], true) ?: [], 'undone' => (bool) $r['undone'],
            ], $rounds),
        ];
    }

    // ------------------------------------------------------------------ tavoli: operazioni

    public function createTable(array $in): string
    {
        $actor = $this->me();
        if (!can_open_tables($actor['role'])) fail('forbidden', 'Solo i game master autorizzati dallo staff possono aprire un tavolo.', 403);
        $busy = $this->activeTableOf($actor['id']);
        if ($busy) fail('busy', 'Sei già al tavolo "' . $busy['name'] . '". Chiudilo o lascialo prima di aprirne un altro.');
        $game = $this->gameRow(in_str($in, 'gameId'));
        if ((int) $game['enabled'] !== 1) fail('game', 'Questo gioco è disattivato dallo staff.');
        $minBet = in_int($in, 'minBet', 0);
        $maxBet = in_int($in, 'maxBet', 0);
        $lives = in_int($in, 'startingLives', 0);
        $target = in_int($in, 'targetPoints', 0);
        if ($minBet < 0 || $maxBet < 0) fail('bet', 'Limiti di puntata non validi.');
        if ($maxBet > 0 && $maxBet < $minBet) fail('bet', 'La puntata massima deve superare la minima.');
        if ($game['mode'] === 'lives' && ($lives < 1 || $lives > 20)) fail('lives', 'Le vite iniziali devono essere tra 1 e 20.');
        if ($game['mode'] === 'points' && $target < 1) fail('points', 'Imposta un punteggio obiettivo.');
        do {
            $code = gen_table_code();
        } while (db_value($this->db, "SELECT 1 FROM game_tables WHERE code = ? AND status IN ('lobby', 'playing')", [$code]));
        $name = mb_substr(trim(in_str($in, 'name', '')), 0, 40);
        if ($name === '') $name = mb_substr($game['name'] . ' · ' . $actor['display_name'], 0, 40);
        $isChips = $game['mode'] === 'chips';
        $settlement = $isChips && in_str($in, 'settlement', 'live') === 'on_close' ? 'on_close' : 'live';
        $masterPlays = $isChips ? 0 : (in_bool($in, 'masterPlays', true) ? 1 : 0);
        $id = uuid4();
        db_exec($this->db, 'INSERT INTO game_tables (id, code, name, game_id, master_id, settlement, master_plays, starting_lives,
            target_points, min_bet, max_bet, use_teams, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
            $id, $code, $name, $game['id'], $actor['id'], $settlement, $masterPlays,
            $game['mode'] === 'lives' ? $lives : 0, $game['mode'] === 'points' ? $target : 0,
            $isChips ? $minBet : 0, $isChips ? $maxBet : 0, ((int) $game['allow_teams'] === 1 && in_bool($in, 'useTeams')) ? 1 : 0,
            $this->iso(),
        ]);
        db_exec($this->db, 'INSERT INTO participants (table_id, user_id, is_master, is_playing, joined_via, lives, joined_at) VALUES (?, ?, 1, ?, ?, ?, ?)', [
            $id, $actor['id'], $masterPlays, 'master', $game['mode'] === 'lives' ? $lives : 0, $this->iso(),
        ]);
        $this->audit($actor['id'], 'table_open', $code, ['game' => $game['id'], 'name' => $name]);
        return $id;
    }

    private function addParticipant(array $table, array $user, string $via): void
    {
        if ((int) $user['banned'] === 1) fail('banned', $user['display_name'] . ' è sospeso e non può giocare.');
        $existing = $this->participantRow($table['id'], $user['id']);
        if ($existing && $existing['left_at'] === null) return;
        if ($existing) fail('left', $user['display_name'] . ' ha già lasciato questo tavolo.');
        $busy = $this->activeTableOf($user['id']);
        if ($busy) fail('busy', $user['display_name'] . ' è già seduto al tavolo "' . $busy['name'] . '".');
        $err = can_join($this->gameRow($table['game_id']), $table, $this->participantRows($table['id']));
        if ($err) fail('join', $err);
        db_exec($this->db, 'INSERT INTO participants (table_id, user_id, is_master, is_playing, joined_via, lives, joined_at) VALUES (?, ?, 0, 1, ?, ?, ?)', [
            $table['id'], $user['id'], $via, (int) $table['starting_lives'], $this->iso(),
        ]);
    }

    public function issueJoinToken(string $tableId, string $kind): array
    {
        [, $table] = $this->requireMaster($tableId);
        if (!in_array($table['status'], ACTIVE_STATUSES, true)) fail('status', 'Il tavolo è chiuso.');
        if (!in_array($kind, ['nfc', 'static', 'qr'], true)) fail('kind', 'Tipo di codice non valido.');
        $s = $this->settingsRow();
        if ($kind === 'qr' && (int) $s['allow_manual_code'] !== 1) fail('qr', 'Lo staff ha disattivato l’ingresso con codice: usa l’NFC.');
        $ttl = (int) $s['join_token_ttl_seconds'];
        $token = $kind === 'qr' ? gen_pin() : gen_token(16);
        $expires = ($kind === 'static' || $ttl <= 0) ? null : $this->iso($ttl * 1000);
        db_exec($this->db, 'INSERT OR REPLACE INTO join_tokens (table_id, kind, token, expires_at) VALUES (?, ?, ?, ?)', [$tableId, $kind, $token, $expires]);
        return ['token' => $token, 'kind' => $kind, 'expiresAt' => $expires];
    }

    public function joinWithToken(string $code, string $token, string $via): string
    {
        $me = $this->me();
        $table = db_one($this->db, "SELECT * FROM game_tables WHERE code = ? AND status IN ('lobby', 'playing')", [strtoupper(trim($code))]);
        if (!$table) fail('not_found', 'Tavolo non trovato o già chiuso.', 404);
        $match = db_one($this->db, 'SELECT * FROM join_tokens WHERE table_id = ? AND token = ? AND (expires_at IS NULL OR expires_at > ?)', [
            $table['id'], trim($token), $this->iso(),
        ]);
        if (!$match) fail('token', 'Codice scaduto o non valido: chiedi al master il codice aggiornato o riavvicina il telefono.');
        if ($match['kind'] === 'qr' && (int) $this->settingsRow()['allow_manual_code'] !== 1) fail('qr', 'Ingresso con codice disattivato.');
        if (!in_array($via, ['nfc_table', 'qr', 'code'], true)) $via = 'code';
        $this->addParticipant($table, $me, $via);
        $this->audit($me['id'], 'table_join', $table['code'], ['via' => $via]);
        return $table['id'];
    }

    public function addPlayerByPass(string $tableId, string $passToken): array
    {
        [$actor, $table] = $this->requireMaster($tableId);
        $user = db_one($this->db, 'SELECT * FROM users WHERE pass_token = ?', [trim($passToken)]);
        if (!$user) fail('pass', 'Pass non riconosciuto.');
        $this->addParticipant($table, $user, 'nfc_pass');
        $this->audit($actor['id'], 'table_add_pass', $table['code'], ['user' => $user['username']]);
        return self::lite($user);
    }

    private function settlePending(array $table, string $userId, ?string $by): void
    {
        $p = $this->participantRow($table['id'], $userId);
        $pending = (int) ($p['pending_delta'] ?? 0);
        if ($pending === 0) return;
        $u = $this->user($userId);
        $delta = max($pending, -(int) $u['chips']);
        if ($delta !== 0) $this->ledger($userId, $delta, 'table_settlement', $table['name'] . ' · chiusura conto', $table['id'], $by);
        db_exec($this->db, 'UPDATE participants SET pending_delta = 0 WHERE table_id = ? AND user_id = ?', [$table['id'], $userId]);
    }

    private function removeParticipant(array $table, array $game, string $userId, string $by): void
    {
        $p = $this->participantRow($table['id'], $userId);
        if (!$p || $p['left_at'] !== null) fail('participant', 'Il giocatore non è al tavolo.');
        if ((int) $p['is_master'] === 1) fail('master', 'Il game master non può lasciare il tavolo: chiudilo.');
        if ($table['status'] === 'lobby') {
            db_exec($this->db, 'DELETE FROM participants WHERE table_id = ? AND user_id = ?', [$table['id'], $userId]);
            return;
        }
        if ($table['status'] !== 'playing') fail('status', 'Il tavolo è chiuso.');
        $this->settlePending($table, $userId, $by);
        if ($game['mode'] === 'lives' && (int) $p['lives'] > 0) {
            db_exec($this->db, 'UPDATE participants SET lives = 0, eliminated_at = ?, elimination_order = ? WHERE table_id = ? AND user_id = ?', [
                $this->iso(), (int) $table['round_count'], $table['id'], $userId,
            ]);
        }
        db_exec($this->db, 'UPDATE participants SET left_at = ? WHERE table_id = ? AND user_id = ?', [$this->iso(), $table['id'], $userId]);
    }

    public function leaveTable(string $tableId): void
    {
        $me = $this->me();
        $table = $this->tableRow($tableId);
        $this->removeParticipant($table, $this->gameRow($table['game_id']), $me['id'], $me['id']);
    }

    public function kick(string $tableId, string $userId): void
    {
        [$actor, $table, $game] = $this->requireMaster($tableId);
        $this->removeParticipant($table, $game, $userId, $actor['id']);
    }

    public function setTeam(string $tableId, string $userId, ?string $team): void
    {
        [, $table] = $this->requireMaster($tableId);
        if ($table['status'] !== 'lobby') fail('status', 'Le squadre si decidono prima di iniziare.');
        if ((int) $table['use_teams'] !== 1) fail('team', 'Questo tavolo non prevede squadre.');
        if ($team !== null && $team !== 'A' && $team !== 'B') fail('team', 'Squadra non valida.');
        if (!$this->participantRow($tableId, $userId)) fail('participant', 'Giocatore non presente.');
        db_exec($this->db, 'UPDATE participants SET team = ? WHERE table_id = ? AND user_id = ?', [$team, $tableId, $userId]);
    }

    public function startTable(string $tableId): void
    {
        [$actor, $table, $game] = $this->requireMaster($tableId);
        if ($table['status'] !== 'lobby') fail('status', 'Il tavolo è già avviato o chiuso.');
        $err = validate_start($game, $table, $this->participantRows($tableId));
        if ($err) fail('start', $err);
        db_exec($this->db, "UPDATE game_tables SET status = 'playing', started_at = ? WHERE id = ?", [$this->iso(), $tableId]);
        db_exec($this->db, 'UPDATE participants SET lives = ?, score = 0 WHERE table_id = ?', [(int) $table['starting_lives'], $tableId]);
        $this->audit($actor['id'], 'table_start', $table['code']);
    }

    private function requirePlaying(array $table, array $game, string $mode): void
    {
        if ($table['status'] !== 'playing') fail('status', 'Il tavolo non è in gioco.');
        if ($game['mode'] !== $mode) fail('mode', 'Operazione non valida per questo gioco.');
    }

    private function playingParticipant(array $table, string $userId): array
    {
        $p = $this->participantRow($table['id'], $userId);
        if (!$p || $p['left_at'] !== null || (int) $p['is_playing'] !== 1) fail('participant', 'Giocatore non presente al tavolo.');
        return $p;
    }

    private function pushRound(array $table, string $by, array $effects): void
    {
        if (!$effects) fail('round', 'Nessuna variazione da registrare.');
        $n = (int) $table['round_count'] + 1;
        db_exec($this->db, 'UPDATE game_tables SET round_count = ? WHERE id = ?', [$n, $table['id']]);
        db_exec($this->db, 'INSERT INTO rounds (id, table_id, number, created_by, created_at, effects) VALUES (?, ?, ?, ?, ?, ?)', [
            uuid4(), $table['id'], $n, $by, $this->iso(), json_encode(array_values($effects), JSON_UNESCAPED_UNICODE),
        ]);
    }

    public function recordChipsRound(string $tableId, array $entries): void
    {
        [$actor, $table, $game] = $this->requireMaster($tableId);
        $this->requirePlaying($table, $game, 'chips');
        $seen = [];
        $effects = [];
        foreach ($entries as $e) {
            if (!is_array($e)) fail('round', 'Mano non valida.');
            $uid = in_str($e, 'userId');
            if (isset($seen[$uid])) fail('round', 'Ogni giocatore può comparire una sola volta per mano.');
            $seen[$uid] = true;
            $p = $this->playingParticipant($table, $uid);
            $u = $this->user($uid);
            $bet = in_int($e, 'bet', 0);
            $outcomeKey = isset($e['outcomeKey']) ? (string) $e['outcomeKey'] : '';
            if ($outcomeKey !== '') {
                $outcome = null;
                foreach ($game['outcomes'] as $o) if ((string) $o['key'] === $outcomeKey) $outcome = $o;
                if (!$outcome) fail('outcome', 'Esito non valido.');
                $betErr = validate_bet($table, $bet);
                if ($betErr) fail('bet', $u['display_name'] . ': ' . $betErr);
                $delta = chip_delta($bet, (float) $outcome['mult']);
                $outcomeOut = (string) $outcome['key'];
            } else {
                if ((int) $game['allow_custom_delta'] !== 1) fail('outcome', 'Seleziona un esito.');
                if (!array_key_exists('customDelta', $e)) fail('outcome', 'Importo non valido.');
                $delta = in_int($e, 'customDelta');
                $outcomeOut = 'custom';
            }
            $available = (int) $u['chips'] + ($table['settlement'] === 'on_close' ? (int) $p['pending_delta'] : 0);
            if ($delta < 0 && $available + $delta < 0) {
                fail('chips', $u['display_name'] . ' non ha abbastanza fiches (disponibili ' . $available . ').');
            }
            if ($table['settlement'] === 'live') {
                if ($delta !== 0) $this->ledger($uid, $delta, 'table_round', $table['name'] . ' · mano ' . ((int) $table['round_count'] + 1), $tableId, $actor['id']);
            } else {
                db_exec($this->db, 'UPDATE participants SET pending_delta = pending_delta + ? WHERE table_id = ? AND user_id = ?', [$delta, $tableId, $uid]);
            }
            db_exec($this->db, 'UPDATE participants SET net_delta = net_delta + ? WHERE table_id = ? AND user_id = ?', [$delta, $tableId, $uid]);
            $effects[] = ['userId' => $uid, 'chips' => $delta, 'bet' => $bet, 'outcome' => $outcomeOut];
        }
        $this->pushRound($table, $actor['id'], $effects);
    }

    public function recordLivesRound(string $tableId, array $changes): void
    {
        [$actor, $table, $game] = $this->requireMaster($tableId);
        $this->requirePlaying($table, $game, 'lives');
        $roundNo = (int) $table['round_count'] + 1;
        $seen = [];
        $effects = [];
        foreach ($changes as $c) {
            if (!is_array($c)) fail('round', 'Variazione non valida.');
            $delta = in_int($c, 'delta', 0);
            if ($delta === 0) continue;
            $uid = in_str($c, 'userId');
            if (isset($seen[$uid])) fail('round', 'Giocatore duplicato.');
            $seen[$uid] = true;
            $p = $this->playingParticipant($table, $uid);
            $before = (int) $p['lives'];
            $after = max(0, min(99, $before + $delta));
            if ($after === $before) continue;
            $eff = ['userId' => $uid, 'lives' => $after - $before];
            if ($after === 0 && $before > 0) {
                db_exec($this->db, 'UPDATE participants SET eliminated_at = ?, elimination_order = ? WHERE table_id = ? AND user_id = ?', [$this->iso(), $roundNo, $tableId, $uid]);
                $eff['eliminated'] = true;
            }
            if ($before === 0 && $after > 0) {
                $eff['prevOrder'] = $p['elimination_order'] === null ? null : (int) $p['elimination_order'];
                db_exec($this->db, 'UPDATE participants SET eliminated_at = NULL, elimination_order = NULL WHERE table_id = ? AND user_id = ?', [$tableId, $uid]);
            }
            db_exec($this->db, 'UPDATE participants SET lives = ? WHERE table_id = ? AND user_id = ?', [$after, $tableId, $uid]);
            $effects[] = $eff;
        }
        $this->pushRound($table, $actor['id'], $effects);
    }

    public function recordPointsRound(string $tableId, array $changes): void
    {
        [$actor, $table, $game] = $this->requireMaster($tableId);
        $this->requirePlaying($table, $game, 'points');
        $effects = [];
        foreach ($changes as $c) {
            if (!is_array($c)) fail('round', 'Variazione non valida.');
            $points = in_int($c, 'points', 0);
            if ($points === 0) continue;
            if ((int) $table['use_teams'] === 1) {
                $team = (string) ($c['team'] ?? '');
                if ($team !== 'A' && $team !== 'B') fail('team', 'Indica la squadra.');
                $targets = db_all($this->db, 'SELECT * FROM participants WHERE table_id = ? AND is_playing = 1 AND left_at IS NULL AND team = ?', [$tableId, $team]);
            } else {
                if (empty($c['userId'])) fail('round', 'Indica il giocatore.');
                $targets = [$this->playingParticipant($table, (string) $c['userId'])];
            }
            foreach ($targets as $p) {
                if (isset($effects[$p['user_id']])) fail('round', 'Giocatore duplicato.');
                db_exec($this->db, 'UPDATE participants SET score = score + ? WHERE table_id = ? AND user_id = ?', [$points, $tableId, $p['user_id']]);
                $effects[$p['user_id']] = ['userId' => $p['user_id'], 'points' => $points];
            }
        }
        $this->pushRound($table, $actor['id'], $effects);
    }

    public function undoLastRound(string $tableId): void
    {
        [$actor, $table] = $this->requireMaster($tableId);
        if ($table['status'] !== 'playing') fail('status', 'Il tavolo non è in gioco.');
        $last = db_one($this->db, 'SELECT * FROM rounds WHERE table_id = ? AND undone = 0 ORDER BY number DESC LIMIT 1', [$tableId]);
        if (!$last) fail('undo', 'Nessuna mano da annullare.');
        foreach (json_decode($last['effects'], true) ?: [] as $e) {
            $uid = $e['userId'];
            $p = $this->participantRow($tableId, $uid);
            if (!$p) continue;
            $chips = (int) ($e['chips'] ?? 0);
            if ($chips !== 0) {
                if ($table['settlement'] === 'live') {
                    $delta = max(-$chips, -(int) $this->user($uid)['chips']);
                    if ($delta !== 0) $this->ledger($uid, $delta, 'undo', $table['name'] . ' · annullata mano ' . $last['number'], $tableId, $actor['id']);
                } else {
                    db_exec($this->db, 'UPDATE participants SET pending_delta = pending_delta - ? WHERE table_id = ? AND user_id = ?', [$chips, $tableId, $uid]);
                }
                db_exec($this->db, 'UPDATE participants SET net_delta = net_delta - ? WHERE table_id = ? AND user_id = ?', [$chips, $tableId, $uid]);
            }
            $lives = (int) ($e['lives'] ?? 0);
            if ($lives !== 0) {
                $newLives = max(0, (int) $p['lives'] - $lives);
                db_exec($this->db, 'UPDATE participants SET lives = ? WHERE table_id = ? AND user_id = ?', [$newLives, $tableId, $uid]);
                if (!empty($e['eliminated'])) {
                    db_exec($this->db, 'UPDATE participants SET eliminated_at = NULL, elimination_order = NULL WHERE table_id = ? AND user_id = ?', [$tableId, $uid]);
                }
                if (array_key_exists('prevOrder', $e) && $newLives === 0) {
                    db_exec($this->db, 'UPDATE participants SET elimination_order = ?, eliminated_at = ? WHERE table_id = ? AND user_id = ?', [$e['prevOrder'], $this->iso(), $tableId, $uid]);
                }
            }
            $points = (int) ($e['points'] ?? 0);
            if ($points !== 0) db_exec($this->db, 'UPDATE participants SET score = score - ? WHERE table_id = ? AND user_id = ?', [$points, $tableId, $uid]);
        }
        db_exec($this->db, 'UPDATE rounds SET undone = 1 WHERE id = ?', [$last['id']]);
    }

    public function closeTable(string $tableId): void
    {
        [$actor, $table, $game] = $this->requireMaster($tableId);
        if (!in_array($table['status'], ACTIVE_STATUSES, true)) fail('status', 'Il tavolo è già chiuso.');
        if ($table['status'] === 'lobby') {
            db_exec($this->db, "UPDATE game_tables SET status = 'cancelled', closed_at = ? WHERE id = ?", [$this->iso(), $tableId]);
            return;
        }
        foreach ($this->participantRows($tableId) as $p) $this->settlePending($table, $p['user_id'], $actor['id']);
        $placements = compute_placements($game['mode'], $this->participantRows($tableId));
        foreach ($this->participantRows($tableId) as $p) {
            db_exec($this->db, 'UPDATE participants SET placement = ? WHERE table_id = ? AND user_id = ?', [$placements[$p['user_id']] ?? null, $tableId, $p['user_id']]);
        }
        db_exec($this->db, "UPDATE game_tables SET status = 'closed', closed_at = ? WHERE id = ?", [$this->iso(), $tableId]);
        db_exec($this->db, 'DELETE FROM join_tokens WHERE table_id = ?', [$tableId]);
        $this->audit($actor['id'], 'table_close', $table['code'], ['rounds' => (int) $table['round_count']]);
    }

    public function cancelTable(string $tableId): void
    {
        [$actor, $table] = $this->requireMaster($tableId);
        if (!in_array($table['status'], ACTIVE_STATUSES, true)) fail('status', 'Il tavolo è già chiuso.');
        $played = db_value($this->db, 'SELECT 1 FROM rounds WHERE table_id = ? AND undone = 0', [$tableId]);
        if ($played && $actor['role'] !== 'staff') {
            fail('cancel', 'Ci sono mani registrate: chiudi il tavolo oppure chiedi allo staff di annullarlo.');
        }
        db_exec($this->db, 'UPDATE participants SET pending_delta = 0 WHERE table_id = ?', [$tableId]);
        db_exec($this->db, "UPDATE game_tables SET status = 'cancelled', closed_at = ? WHERE id = ?", [$this->iso(), $tableId]);
        db_exec($this->db, 'DELETE FROM join_tokens WHERE table_id = ?', [$tableId]);
        $this->audit($actor['id'], 'table_cancel', $table['code']);
    }

    // ------------------------------------------------------------------ amministrazione

    public function adminOverview(): array
    {
        $this->staff();
        $tz = $this->settingsRow()['timezone'];
        $today = day_in_timezone(intdiv($this->nowMs, 1000), $tz);
        $tablesToday = 0;
        foreach (db_all($this->db, 'SELECT created_at FROM game_tables ORDER BY created_at DESC LIMIT 500') as $t) {
            if (day_in_timezone(strtotime($t['created_at']), $tz) === $today) $tablesToday++;
        }
        return [
            'users' => (int) db_value($this->db, 'SELECT COUNT(*) FROM users'),
            'activeTables' => (int) db_value($this->db, "SELECT COUNT(*) FROM game_tables WHERE status IN ('lobby', 'playing')"),
            'chipsInCirculation' => (int) db_value($this->db, 'SELECT COALESCE(SUM(chips), 0) FROM users'),
            'pendingGmRequests' => (int) db_value($this->db, "SELECT COUNT(*) FROM gm_requests WHERE status = 'pending'"),
            'tablesToday' => $tablesToday,
            'bannedUsers' => (int) db_value($this->db, 'SELECT COUNT(*) FROM users WHERE banned = 1'),
        ];
    }

    public function adminListUsers(string $q): array
    {
        $this->staff();
        $q = trim(strtolower($q));
        $rows = $q === ''
            ? db_all($this->db, 'SELECT * FROM users ORDER BY username LIMIT 500')
            : db_all($this->db, 'SELECT * FROM users WHERE username LIKE ? OR LOWER(display_name) LIKE ? ORDER BY username LIMIT 500', ["%$q%", "%$q%"]);
        return array_map([self::class, 'profile'], $rows);
    }

    public function adminSetRole(string $userId, string $role): void
    {
        $actor = $this->staff();
        if (!in_array($role, ['player', 'game_master', 'staff'], true)) fail('role', 'Ruolo non valido.');
        if ($userId === $actor['id'] && $role !== 'staff') fail('self', 'Non puoi rimuovere il tuo ruolo staff.');
        $u = $this->user($userId);
        db_exec($this->db, 'UPDATE users SET role = ? WHERE id = ?', [$role, $userId]);
        $this->audit($actor['id'], 'set_role', $u['username'], ['from' => $u['role'], 'to' => $role]);
    }

    public function adminSetBanned(string $userId, bool $banned): void
    {
        $actor = $this->staff();
        if ($userId === $actor['id']) fail('self', 'Non puoi sospendere te stesso.');
        $u = $this->user($userId);
        db_exec($this->db, 'UPDATE users SET banned = ? WHERE id = ?', [$banned ? 1 : 0, $userId]);
        $this->audit($actor['id'], $banned ? 'ban' : 'unban', $u['username']);
    }

    public function adminAdjustChips(string $userId, int $delta, string $reason): void
    {
        $actor = $this->staff();
        if ($delta === 0) fail('delta', 'Importo non valido.');
        $reason = trim($reason);
        if (mb_strlen($reason) < 3) fail('reason', 'Indica il motivo della rettifica.');
        $u = $this->user($userId);
        $this->ledger($userId, $delta, 'admin_adjust', $reason, null, $actor['id']);
        $this->audit($actor['id'], 'adjust_chips', $u['username'], ['delta' => $delta, 'reason' => $reason]);
    }

    public function adminUserPass(string $userId): string
    {
        $actor = $this->staff();
        $u = $this->user($userId);
        $this->audit($actor['id'], 'pass_read', $u['username']);
        return $u['pass_token'];
    }

    public function adminListGmRequests(?string $status): array
    {
        $this->staff();
        $rows = $status
            ? db_all($this->db, 'SELECT * FROM gm_requests WHERE status = ? ORDER BY created_at DESC LIMIT 200', [$status])
            : db_all($this->db, 'SELECT * FROM gm_requests ORDER BY created_at DESC LIMIT 200');
        return array_map(fn ($r) => $this->gmRequestOut($r), $rows);
    }

    public function adminReviewGmRequest(string $id, bool $approve, string $note): void
    {
        $actor = $this->staff();
        $r = db_one($this->db, 'SELECT * FROM gm_requests WHERE id = ?', [$id]);
        if (!$r) fail('not_found', 'Richiesta non trovata.', 404);
        if ($r['status'] !== 'pending') fail('status', 'Richiesta già gestita.');
        db_exec($this->db, 'UPDATE gm_requests SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?', [
            $approve ? 'approved' : 'rejected', trim($note), $actor['id'], $this->iso(), $id,
        ]);
        $u = $this->user($r['user_id']);
        if ($approve && $u['role'] === 'player') db_exec($this->db, "UPDATE users SET role = 'game_master' WHERE id = ?", [$u['id']]);
        $this->audit($actor['id'], $approve ? 'gm_approve' : 'gm_reject', $u['username'], ['note' => trim($note)]);
    }

    public function adminListTables(?array $statuses): array
    {
        $this->staff();
        if ($statuses) {
            $statuses = array_values(array_intersect($statuses, ['lobby', 'playing', 'closed', 'cancelled']));
            $ph = implode(',', array_fill(0, max(1, count($statuses)), '?'));
            $rows = db_all($this->db, "SELECT * FROM game_tables WHERE status IN ($ph) ORDER BY created_at DESC LIMIT 100", $statuses ?: ['none']);
        } else {
            $rows = db_all($this->db, 'SELECT * FROM game_tables ORDER BY created_at DESC LIMIT 100');
        }
        return array_map(fn ($t) => $this->summaryOut($t), $rows);
    }

    public function adminUpsertGame(array $g): void
    {
        $actor = $this->staff();
        $id = in_str($g, 'id');
        if (!preg_match('/^[a-z0-9_]{2,30}$/', $id)) fail('game', 'ID gioco non valido (minuscole, numeri, _).');
        $min = in_int($g, 'minParticipants');
        $max = in_int($g, 'maxParticipants');
        if ($min < 2) fail('game', 'Minimo 2 partecipanti.');
        if ($max < $min) fail('game', 'Il massimo deve essere ≥ al minimo.');
        $name = trim(in_str($g, 'name'));
        if ($name === '') fail('game', 'Nome obbligatorio.');
        $mode = in_str($g, 'mode');
        if (!in_array($mode, ['chips', 'lives', 'points'], true)) fail('game', 'Modalità non valida.');
        $room = $mode === 'chips' ? 'casino' : (in_str($g, 'room', 'arcade') === 'casino' ? 'casino' : 'arcade');
        $outcomes = [];
        foreach (($g['outcomes'] ?? []) as $o) {
            if (!is_array($o) || !isset($o['key'], $o['label'], $o['mult']) || !is_numeric($o['mult'])) fail('game', 'Esito non valido.');
            $outcomes[] = ['key' => (string) $o['key'], 'label' => mb_substr((string) $o['label'], 0, 40), 'mult' => $o['mult'] + 0];
        }
        $existed = (bool) db_value($this->db, 'SELECT 1 FROM games WHERE id = ?', [$id]);
        db_exec($this->db, 'INSERT OR REPLACE INTO games (id, name, mode, room, icon, description, min_participants, max_participants,
            default_lives, target_points, master_plays_default, allow_teams, allow_late_join, outcomes, allow_custom_delta, enabled, sort)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
            $id, mb_substr($name, 0, 40), $mode, $room, mb_substr(in_str($g, 'icon', '🎲'), 0, 4), mb_substr(in_str($g, 'description', ''), 0, 600),
            $min, $max, in_int($g, 'defaultLives', 0), in_int($g, 'targetPoints', 0),
            in_bool($g, 'masterPlaysDefault') ? 1 : 0, in_bool($g, 'allowTeams') ? 1 : 0, in_bool($g, 'allowLateJoin') ? 1 : 0,
            json_encode($outcomes, JSON_UNESCAPED_UNICODE), in_bool($g, 'allowCustomDelta') ? 1 : 0, in_bool($g, 'enabled', true) ? 1 : 0,
            in_int($g, 'sort', 100),
        ]);
        $this->audit($actor['id'], $existed ? 'game_update' : 'game_create', $id);
    }

    public function adminUpdateSettings(array $patch): array
    {
        $actor = $this->staff();
        $s = $this->settingsRow();
        $next = [
            'daily_bonus_base' => array_key_exists('dailyBonusBase', $patch) ? in_int($patch, 'dailyBonusBase') : (int) $s['daily_bonus_base'],
            'starting_chips' => array_key_exists('startingChips', $patch) ? in_int($patch, 'startingChips') : (int) $s['starting_chips'],
            'wheel' => $patch['wheel'] ?? $s['wheel'],
            'streak_bonus_pct' => array_key_exists('streakBonusPct', $patch) ? in_int($patch, 'streakBonusPct') : (int) $s['streak_bonus_pct'],
            'max_streak' => array_key_exists('maxStreak', $patch) ? in_int($patch, 'maxStreak') : (int) $s['max_streak'],
            'join_token_ttl_seconds' => array_key_exists('joinTokenTtlSeconds', $patch) ? in_int($patch, 'joinTokenTtlSeconds') : (int) $s['join_token_ttl_seconds'],
            'allow_manual_code' => array_key_exists('allowManualCode', $patch) ? (in_bool($patch, 'allowManualCode') ? 1 : 0) : (int) $s['allow_manual_code'],
            'timezone' => array_key_exists('timezone', $patch) ? (string) $patch['timezone'] : $s['timezone'],
        ];
        if ($next['daily_bonus_base'] < 0 || $next['starting_chips'] < 0 || $next['streak_bonus_pct'] < 0 || $next['join_token_ttl_seconds'] < 0) {
            fail('settings', 'Valori non validi.');
        }
        if (!is_array($next['wheel']) || !$next['wheel']) fail('settings', 'Spicchi della ruota non validi.');
        foreach ($next['wheel'] as $m) if (!is_numeric($m) || $m <= 0) fail('settings', 'Spicchi della ruota non validi.');
        if ($next['max_streak'] < 1) fail('settings', 'La serie massima deve essere almeno 1.');
        if (!in_array($next['timezone'], DateTimeZone::listIdentifiers(), true)) fail('settings', 'Fuso orario non valido.');
        db_exec($this->db, 'UPDATE settings SET daily_bonus_base = ?, starting_chips = ?, wheel = ?, streak_bonus_pct = ?, max_streak = ?,
            join_token_ttl_seconds = ?, allow_manual_code = ?, timezone = ? WHERE id = 1', [
            $next['daily_bonus_base'], $next['starting_chips'], json_encode(array_map(fn ($m) => $m + 0, array_values($next['wheel']))),
            $next['streak_bonus_pct'], $next['max_streak'], $next['join_token_ttl_seconds'], $next['allow_manual_code'], $next['timezone'],
        ]);
        $this->audit($actor['id'], 'settings_update', 'settings', $patch);
        return $this->settings();
    }

    public function adminLedger(?string $userId, int $limit): array
    {
        $this->staff();
        $limit = max(1, min($limit, 500));
        $rows = $userId
            ? db_all($this->db, 'SELECT * FROM ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?', [$userId, $limit])
            : db_all($this->db, 'SELECT * FROM ledger ORDER BY id DESC LIMIT ?', [$limit]);
        return array_map([self::class, 'ledgerOut'], $rows);
    }

    public function adminAudit(int $limit): array
    {
        $this->staff();
        $rows = db_all($this->db, 'SELECT a.*, u.username AS actor_name FROM audit a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.id DESC LIMIT ?', [max(1, min($limit, 500))]);
        return array_map(fn ($a) => [
            'id' => (string) $a['id'],
            'actorId' => $a['actor_id'],
            'actorName' => $a['actor_id'] ? ($a['actor_name'] ?? '?') : 'sistema',
            'action' => $a['action'],
            'target' => $a['target'],
            'details' => json_decode($a['details'], true) ?: (object) [],
            'createdAt' => $a['created_at'],
        ], $rows);
    }
}
