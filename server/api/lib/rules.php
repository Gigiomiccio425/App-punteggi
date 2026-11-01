<?php
// Regole pure: porting fedele di src/core/rules.ts (stessi messaggi d'errore).
declare(strict_types=1);

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const TOKEN_ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function random_string(int $len, string $alphabet): string
{
    $out = '';
    $max = strlen($alphabet) - 1;
    for ($i = 0; $i < $len; $i++) $out .= $alphabet[random_int(0, $max)];
    return $out;
}

function gen_table_code(): string { return random_string(5, CODE_ALPHABET); }
function gen_token(int $len = 20): string { return random_string($len, TOKEN_ALPHABET); }
function gen_pin(): string { return random_string(6, '0123456789'); }

function can_open_tables(string $role): bool
{
    return $role === 'game_master' || $role === 'staff';
}

/** Variazione di fiches per puntata ed esito; arrotondamento a favore del banco. */
function chip_delta(int $bet, float $mult): int
{
    return (int) floor(round($bet * $mult * 1e6) / 1e6);
}

function validate_bet(array $table, int $bet): ?string
{
    if ($bet <= 0) return 'La puntata deve essere un numero intero positivo.';
    if ($table['min_bet'] > 0 && $bet < $table['min_bet']) return 'Puntata minima: ' . $table['min_bet'] . '.';
    if ($table['max_bet'] > 0 && $bet > $table['max_bet']) return 'Puntata massima: ' . $table['max_bet'] . '.';
    return null;
}

/** $participants: righe di participants (snake_case). */
function validate_start(array $game, array $table, array $participants): ?string
{
    $present = array_values(array_filter($participants, fn ($p) => $p['left_at'] === null));
    if (count($present) < $game['min_participants']) {
        return 'Servono almeno ' . $game['min_participants'] . ' partecipanti (game master incluso): ora siete in ' . count($present) . '.';
    }
    $players = array_values(array_filter($present, fn ($p) => (int) $p['is_playing'] === 1));
    if ($game['mode'] !== 'chips' && count($players) < 2) return 'Servono almeno 2 giocatori in gara.';
    if (count($players) < 1) return 'Nessun giocatore al tavolo.';
    if ((int) $table['use_teams'] === 1) {
        $a = count(array_filter($players, fn ($p) => $p['team'] === 'A'));
        $b = count(array_filter($players, fn ($p) => $p['team'] === 'B'));
        if ($a === 0 || $b === 0 || $a + $b !== count($players)) return 'Assegna ogni giocatore alla squadra A o B.';
    }
    return null;
}

function can_join(array $game, array $table, array $participants): ?string
{
    if ($table['status'] === 'closed' || $table['status'] === 'cancelled') return 'Il tavolo è chiuso.';
    if ($table['status'] === 'playing' && (int) $game['allow_late_join'] !== 1) return 'La partita è già iniziata.';
    $present = count(array_filter($participants, fn ($p) => $p['left_at'] === null));
    if ($present >= $game['max_participants']) return 'Il tavolo è al completo.';
    return null;
}

/** Piazzamenti finali: userId => posizione (pari merito condivisi), solo per chi gioca. */
function compute_placements(string $mode, array $participants): array
{
    $players = array_values(array_filter($participants, fn ($p) => (int) $p['is_playing'] === 1));
    $key = function (array $p) use ($mode): array {
        if ($mode === 'chips') return [(int) $p['net_delta']];
        if ($mode === 'points') return [(int) $p['score']];
        $alive = ((int) $p['lives'] > 0 && $p['left_at'] === null) ? 1 : 0;
        return [$alive, $alive ? (int) $p['lives'] : (int) ($p['elimination_order'] ?? 0)];
    };
    usort($players, function ($a, $b) use ($key) {
        $ka = $key($a);
        $kb = $key($b);
        for ($i = 0; $i < count($ka); $i++) if ($ka[$i] !== $kb[$i]) return $kb[$i] <=> $ka[$i];
        return 0;
    });
    $result = [];
    foreach ($players as $i => $p) {
        if ($i > 0 && $key($players[$i - 1]) === $key($p)) {
            $result[$p['user_id']] = $result[$players[$i - 1]['user_id']];
        } else {
            $result[$p['user_id']] = $i + 1;
        }
    }
    return $result;
}

function is_win(string $mode, ?int $placement, int $netDelta): bool
{
    if ($placement !== 1) return false;
    return $mode !== 'chips' || $netDelta > 0;
}

function day_in_timezone(int $ts, string $tz): string
{
    $d = new DateTime('@' . $ts);
    $d->setTimezone(new DateTimeZone($tz));
    return $d->format('Y-m-d');
}

function previous_day(string $day): string
{
    $d = new DateTime($day . ' 12:00:00', new DateTimeZone('UTC'));
    $d->modify('-1 day');
    return $d->format('Y-m-d');
}

/** null se il bonus di oggi è già stato ritirato. */
function compute_daily_bonus(array $settings, ?string $lastDate, int $streak, string $today, int $segment): ?array
{
    if ($lastDate === $today) return null;
    $newStreak = $lastDate === previous_day($today) ? min($streak + 1, (int) $settings['max_streak']) : 1;
    $wheel = $settings['wheel'];
    $mult = (float) $wheel[$segment];
    $factor = 1 + ((int) $settings['streak_bonus_pct'] / 100) * ($newStreak - 1);
    return [
        'amount' => (int) round((int) $settings['daily_bonus_base'] * $mult * $factor),
        'multiplier' => $mult + 0,
        'segment' => $segment,
        'streak' => $newStreak,
    ];
}

function is_valid_username(string $u): bool
{
    return (bool) preg_match('/^[a-z0-9_.]{3,20}$/', $u);
}

function normalize_username(string $u): string
{
    return ltrim(strtolower(trim($u)), '@');
}
