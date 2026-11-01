<?php
// Utilità HTTP: risposte JSON, errori applicativi, lettura input.
declare(strict_types=1);

final class AppError extends Exception
{
    public string $appCode;
    public int $status;

    public function __construct(string $appCode, string $message, int $status = 400)
    {
        parent::__construct($message);
        $this->appCode = $appCode;
        $this->status = $status;
    }
}

function fail(string $code, string $message, int $status = 400): void
{
    throw new AppError($code, $message, $status);
}

function json_out(int $status, array $payload): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

function read_json_body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') return [];
    $data = json_decode($raw, true);
    if (!is_array($data)) fail('bad_request', 'Richiesta non valida.');
    return $data;
}

/** Valore stringa obbligatorio/facoltativo da un array di input. */
function in_str(array $in, string $key, ?string $default = null): string
{
    $v = $in[$key] ?? $default;
    if ($v === null) fail('bad_request', "Campo mancante: $key");
    if (!is_string($v) && !is_int($v)) fail('bad_request', "Campo non valido: $key");
    return (string) $v;
}

function in_int(array $in, string $key, ?int $default = null): int
{
    $v = $in[$key] ?? $default;
    if ($v === null) fail('bad_request', "Campo mancante: $key");
    if (is_string($v) && preg_match('/^-?\d+$/', $v)) $v = (int) $v;
    if (is_float($v) && floor($v) === $v) $v = (int) $v;
    if (!is_int($v)) fail('bad_request', "Il campo $key deve essere un numero intero.");
    return $v;
}

function in_bool(array $in, string $key, bool $default = false): bool
{
    $v = $in[$key] ?? $default;
    return $v === true || $v === 1 || $v === '1' || $v === 'true';
}

function now_iso(?int $ms = null): string
{
    $ms = $ms ?? (int) floor(microtime(true) * 1000);
    return gmdate('Y-m-d\TH:i:s', intdiv($ms, 1000)) . sprintf('.%03dZ', $ms % 1000);
}

function uuid4(): string
{
    $b = random_bytes(16);
    $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
    $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
    $h = bin2hex($b);
    return substr($h, 0, 8) . '-' . substr($h, 8, 4) . '-' . substr($h, 12, 4) . '-' . substr($h, 16, 4) . '-' . substr($h, 20);
}

// Ripieghi se l'hosting non ha l'estensione mbstring (normalmente presente).
if (!function_exists('mb_substr')) {
    function mb_substr(string $s, int $start, ?int $length = null): string
    {
        preg_match_all('/./us', $s, $m);
        return implode('', array_slice($m[0], $start, $length));
    }
}
if (!function_exists('mb_strlen')) {
    function mb_strlen(string $s): int
    {
        return (int) preg_match_all('/./us', $s);
    }
}
