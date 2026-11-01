<?php
// Sessioni PHP (cookie HttpOnly, SameSite) e limitazione dei tentativi di accesso.
declare(strict_types=1);

function session_boot(array $config): void
{
    if (session_status() === PHP_SESSION_ACTIVE) return;
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    session_name('PCSESS');
    session_set_cookie_params([
        'lifetime' => 60 * 60 * 24 * 30,
        'path' => $config['cookie_path'] ?? '/',
        'secure' => $secure,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    ini_set('session.use_strict_mode', '1');
    ini_set('session.gc_maxlifetime', (string) (60 * 60 * 24 * 30));
    session_start();
}

function session_user_id(): ?string
{
    $id = $_SESSION['uid'] ?? null;
    return is_string($id) ? $id : null;
}

function session_login(string $uid): void
{
    session_regenerate_id(true);
    $_SESSION['uid'] = $uid;
}

function session_logout(): void
{
    $_SESSION = [];
    if (session_status() === PHP_SESSION_ACTIVE) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', ['expires' => time() - 3600, 'path' => $p['path'], 'secure' => $p['secure'], 'httponly' => true, 'samesite' => 'Lax']);
        session_destroy();
    }
}

function client_ip(): string
{
    return (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
}

/** Massimo 10 tentativi falliti ogni 15 minuti per indirizzo IP. */
function login_throttle_check(PDO $db, int $nowSec): void
{
    db_exec($db, 'DELETE FROM login_attempts WHERE at < ?', [$nowSec - 900]);
    $n = (int) db_value($db, 'SELECT COUNT(*) FROM login_attempts WHERE ip = ?', [client_ip()]);
    if ($n >= 10) fail('throttle', 'Troppi tentativi di accesso: riprova tra qualche minuto.', 429);
}

function login_throttle_fail(PDO $db, int $nowSec): void
{
    db_exec($db, 'INSERT INTO login_attempts (ip, at) VALUES (?, ?)', [client_ip(), $nowSec]);
}
