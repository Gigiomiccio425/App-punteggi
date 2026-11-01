<?php
// Party Casinò — API REST (PHP 8.0+ e SQLite). Unico punto di ingresso: /api/*
declare(strict_types=1);

require_once __DIR__ . '/lib/http.php';
require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/auth.php';
require_once __DIR__ . '/lib/service.php';

$config = is_file(__DIR__ . '/config.php') ? (require __DIR__ . '/config.php') : [];
if (!is_array($config)) $config = [];

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$uriPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$path = preg_replace('#^.*?/api(?=/|$)#', '', $uriPath);
$path = '/' . trim((string) $path, '/');

// Ora corrente (nei test automatici può essere simulata, mai in produzione).
$nowMs = (int) floor(microtime(true) * 1000);
if (getenv('PC_TESTING') === '1' && isset($_SERVER['HTTP_X_TEST_NOW']) && ctype_digit($_SERVER['HTTP_X_TEST_NOW'])) {
    $nowMs = (int) $_SERVER['HTTP_X_TEST_NOW'];
}

try {
    // Diagnostica per verificare l'hosting (non richiede database né login).
    if ($method === 'GET' && $path === '/health') {
        $dir = getenv('PC_DATA_DIR') ?: ($config['data_dir'] ?? __DIR__ . '/data');
        json_out(200, ['data' => [
            'php' => PHP_VERSION,
            'phpOk' => version_compare(PHP_VERSION, '8.0.0', '>='),
            'pdoSqlite' => extension_loaded('pdo_sqlite'),
            'mbstring' => extension_loaded('mbstring'),
            'dataDirWritable' => is_dir($dir) ? is_writable($dir) : is_writable(dirname($dir)),
            'https' => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https'),
        ]]);
        exit;
    }

    if ($method === 'POST' && ($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'party-casino') {
        fail('csrf', 'Richiesta non autorizzata.', 403);
    }

    $db = db_connect($config);

    if ($method === 'GET' && $path === '/version') {
        json_out(200, ['data' => ['v' => (int) db_value($db, "SELECT v FROM meta WHERE k = 'data_version'")]]);
        exit;
    }

    session_boot($config);
    $uid = session_user_id();
    if ($method === 'GET') session_write_close(); // le letture non bloccano le altre richieste della sessione
    $svc = new Service($db, $uid, $nowMs);
    $in = $method === 'POST' ? read_json_body() : $_GET;
    $tx = fn (callable $fn) => db_tx($db, $fn);

    // Sessione scaduta o utente eliminato: si riparte da anonimo.
    if ($uid !== null && !db_value($db, 'SELECT 1 FROM users WHERE id = ?', [$uid])) {
        if (session_status() === PHP_SESSION_ACTIVE) session_logout();
        $uid = null;
        $svc = new Service($db, null, $nowMs);
    }

    $routes = [
        // --- account
        ['GET', '#^/auth/me$#', fn () => $uid ? Service::profile(db_one($db, 'SELECT * FROM users WHERE id = ?', [$uid])) : null],
        ['POST', '#^/auth/register$#', function () use ($tx, $svc, $in) {
            $u = $tx(fn () => $svc->register(in_str($in, 'username'), in_str($in, 'displayName', ''), in_str($in, 'password')));
            session_login($u['id']);
            return Service::profile($u);
        }],
        ['POST', '#^/auth/login$#', function () use ($db, $svc, $in, $nowMs) {
            $sec = intdiv($nowMs, 1000);
            login_throttle_check($db, $sec);
            try {
                $u = $svc->verifyLogin(in_str($in, 'identifier'), in_str($in, 'password'));
            } catch (AppError $e) {
                login_throttle_fail($db, $sec);
                throw $e;
            }
            session_login($u['id']);
            return Service::profile($u);
        }],
        ['POST', '#^/auth/logout$#', function () {
            session_logout();
            return null;
        }],
        ['POST', '#^/auth/password$#', fn () => $tx(fn () => $svc->changePassword(in_str($in, 'current'), in_str($in, 'next')))],

        // --- profili, statistiche, classifica
        ['GET', '#^/profiles/by-username/([a-z0-9_.@]+)$#i', fn ($m) => $svc->findByUsername($m[1])],
        ['GET', '#^/profiles/([0-9a-f-]{36})$#', fn ($m) => $svc->getProfile($m[1])],
        ['POST', '#^/me/profile$#', fn () => $tx(fn () => $svc->updateMyProfile($in))],
        ['GET', '#^/stats/([0-9a-f-]{36})$#', fn ($m) => $svc->stats($m[1])],
        ['GET', '#^/leaderboard$#', fn () => $svc->leaderboard((string) ($in['kind'] ?? 'chips'))],
        ['GET', '#^/me/ledger$#', fn () => $svc->myLedger((int) ($in['limit'] ?? 30))],

        // --- bonus, impostazioni, pass, richieste GM
        ['GET', '#^/settings$#', function () use ($svc) {
            $svc->me(false);
            return $svc->settings();
        }],
        ['POST', '#^/me/bonus$#', fn () => $tx(fn () => $svc->claimDailyBonus())],
        ['GET', '#^/me/pass$#', fn () => $svc->myPass()],
        ['POST', '#^/me/pass/rotate$#', fn () => $tx(fn () => $svc->rotateMyPass())],
        ['POST', '#^/gm-requests$#', fn () => $tx(fn () => $svc->requestGameMaster(in_str($in, 'motivation')))],
        ['GET', '#^/me/gm-request$#', fn () => $svc->myGmRequest()],

        // --- giochi e tavoli
        ['GET', '#^/games$#', fn () => $svc->listGames()],
        ['GET', '#^/tables/active$#', fn () => $svc->listActiveTables()],
        ['GET', '#^/me/active-table$#', fn () => $svc->myActiveTableId()],
        ['GET', '#^/tables/([0-9a-f-]{36})$#', fn ($m) => $svc->getTable($m[1])],
        ['POST', '#^/tables$#', fn () => $tx(fn () => $svc->createTable($in))],
        ['POST', '#^/tables/([0-9a-f-]{36})/token$#', fn ($m) => $tx(fn () => $svc->issueJoinToken($m[1], in_str($in, 'kind')))],
        ['POST', '#^/join$#', fn () => $tx(fn () => $svc->joinWithToken(in_str($in, 'code'), in_str($in, 'token'), in_str($in, 'via', 'code')))],
        ['POST', '#^/tables/([0-9a-f-]{36})/add-pass$#', fn ($m) => $tx(fn () => $svc->addPlayerByPass($m[1], in_str($in, 'pass')))],
        ['POST', '#^/tables/([0-9a-f-]{36})/leave$#', fn ($m) => $tx(fn () => $svc->leaveTable($m[1]))],
        ['POST', '#^/tables/([0-9a-f-]{36})/kick$#', fn ($m) => $tx(fn () => $svc->kick($m[1], in_str($in, 'userId')))],
        ['POST', '#^/tables/([0-9a-f-]{36})/team$#', fn ($m) => $tx(fn () => $svc->setTeam($m[1], in_str($in, 'userId'), isset($in['team']) ? (string) $in['team'] : null))],
        ['POST', '#^/tables/([0-9a-f-]{36})/start$#', fn ($m) => $tx(fn () => $svc->startTable($m[1]))],
        ['POST', '#^/tables/([0-9a-f-]{36})/rounds/chips$#', fn ($m) => $tx(fn () => $svc->recordChipsRound($m[1], (array) ($in['entries'] ?? [])))],
        ['POST', '#^/tables/([0-9a-f-]{36})/rounds/lives$#', fn ($m) => $tx(fn () => $svc->recordLivesRound($m[1], (array) ($in['changes'] ?? [])))],
        ['POST', '#^/tables/([0-9a-f-]{36})/rounds/points$#', fn ($m) => $tx(fn () => $svc->recordPointsRound($m[1], (array) ($in['changes'] ?? [])))],
        ['POST', '#^/tables/([0-9a-f-]{36})/undo$#', fn ($m) => $tx(fn () => $svc->undoLastRound($m[1]))],
        ['POST', '#^/tables/([0-9a-f-]{36})/close$#', fn ($m) => $tx(fn () => $svc->closeTable($m[1]))],
        ['POST', '#^/tables/([0-9a-f-]{36})/cancel$#', fn ($m) => $tx(fn () => $svc->cancelTable($m[1]))],

        // --- amministrazione
        ['GET', '#^/admin/overview$#', fn () => $svc->adminOverview()],
        ['GET', '#^/admin/users$#', fn () => $svc->adminListUsers((string) ($in['q'] ?? ''))],
        ['POST', '#^/admin/users/([0-9a-f-]{36})/role$#', fn ($m) => $tx(fn () => $svc->adminSetRole($m[1], in_str($in, 'role')))],
        ['POST', '#^/admin/users/([0-9a-f-]{36})/ban$#', fn ($m) => $tx(fn () => $svc->adminSetBanned($m[1], in_bool($in, 'banned')))],
        ['POST', '#^/admin/users/([0-9a-f-]{36})/chips$#', fn ($m) => $tx(fn () => $svc->adminAdjustChips($m[1], in_int($in, 'delta'), in_str($in, 'reason')))],
        ['POST', '#^/admin/users/([0-9a-f-]{36})/pass$#', fn ($m) => $tx(fn () => $svc->adminUserPass($m[1]))],
        ['GET', '#^/admin/gm-requests$#', fn () => $svc->adminListGmRequests(isset($in['status']) && $in['status'] !== '' ? (string) $in['status'] : null)],
        ['POST', '#^/admin/gm-requests/([0-9a-f-]{36})/review$#', fn ($m) => $tx(fn () => $svc->adminReviewGmRequest($m[1], in_bool($in, 'approve'), in_str($in, 'note', '')))],
        ['GET', '#^/admin/tables$#', fn () => $svc->adminListTables(isset($in['status']) && $in['status'] !== '' ? explode(',', (string) $in['status']) : null)],
        ['POST', '#^/admin/games$#', fn () => $tx(fn () => $svc->adminUpsertGame((array) ($in['game'] ?? [])))],
        ['POST', '#^/admin/settings$#', fn () => $tx(fn () => $svc->adminUpdateSettings((array) ($in['patch'] ?? [])))],
        ['GET', '#^/admin/ledger$#', fn () => $svc->adminLedger(isset($in['userId']) && $in['userId'] !== '' ? (string) $in['userId'] : null, (int) ($in['limit'] ?? 100))],
        ['GET', '#^/admin/audit$#', fn () => $svc->adminAudit((int) ($in['limit'] ?? 100))],
    ];

    foreach ($routes as [$m, $re, $handler]) {
        if ($m === $method && preg_match($re, $path, $match)) {
            $result = $handler($match);
            json_out(200, ['data' => $result]);
            exit;
        }
    }
    fail('not_found', 'Endpoint inesistente.', 404);
} catch (AppError $e) {
    json_out($e->status, ['error' => ['code' => $e->appCode, 'message' => $e->getMessage()]]);
} catch (Throwable $e) {
    error_log('[party-casino] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    json_out(500, ['error' => ['code' => 'server', 'message' => 'Errore del server, riprova tra poco.']]);
}
