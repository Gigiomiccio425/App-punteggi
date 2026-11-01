<?php
// Router per il server integrato di PHP (solo sviluppo/test): emula le regole di .htaccess.
// Uso: php -S localhost:8000 -t <cartella> server/dev-router.php
$root = $_SERVER['DOCUMENT_ROOT'];
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/';
if (preg_match('#^/api(/|$)#', $path)) {
    require $root . '/api/index.php';
    return true;
}
if (preg_match('#\.(sqlite|php)$#', $path) || str_contains($path, '/api/data') || str_contains($path, '/api/lib')) {
    http_response_code(403);
    return true;
}
if ($path !== '/' && is_file($root . $path)) return false; // file statico
$index = $root . '/index.html';
if (is_file($index)) {
    header('Content-Type: text/html; charset=utf-8');
    readfile($index);
} else {
    http_response_code(404);
    echo 'index.html non trovato: esegui npm run build';
}
return true;
