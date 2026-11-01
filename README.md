# 🎰 Party Casinò

**Web app** per le serate di gioco tra amici, pensata per girare su un hosting condiviso economico come **Aruba Hosting Linux Basic**: niente database da comprare, i dati stanno in un file **SQLite** gestito da una piccola API **PHP**.

- Su **Android** (Chrome) si entra ai tavoli con l'**NFC**: si avvicina il telefono all'adesivo NFC del tavolo, oppure il master legge il braccialetto NFC del giocatore.
- Su **iPhone** si entra con il **codice manuale** (codice tavolo + PIN dettato dal master) o inquadrando il QR.
- Si gioca con **fiches virtuali** (blackjack & co.), **vite** (31, picozzo…) o **punti** (scopa, briscola… anche a coppie).
- Ogni giocatore ha un **profilo pubblico** con statistiche; i **game master** sono autorizzati dallo staff; c'è un **pannello admin** completo.

> Le fiches sono virtuali e non hanno valore economico: non si comprano e non si convertono.

📄 Ricerca e motivazioni delle scelte (NFC per piattaforma, hosting, design casinò/sala giochi): [`docs/RICERCA.md`](docs/RICERCA.md).

## Come funziona l'ingresso ai tavoli

| Chi | Come entra | Requisiti |
|---|---|---|
| Giocatore **Android** | Pulsante *Entra → Leggi l'adesivo NFC del tavolo* e avvicina il telefono all'adesivo | Chrome per Android, sito in **https**, NFC attivo |
| Giocatore **iPhone** | *Entra* → inserisce **codice tavolo + PIN** mostrati sul telefono del master, oppure inquadra il **QR** con la fotocamera | nessuno |
| Giocatore con **braccialetto pass** (Android o iPhone) | Il master (Android) avvicina il braccialetto al proprio telefono e lo fa sedere | braccialetto/adesivo NFC scritto dall'app |
| iPhone XS o successivo, extra | Toccando l'adesivo del tavolo compare una notifica che apre il link in Safari e fa sedere | iPhone sbloccato |

Cose da sapere, perché sono limiti del browser e non dell'app:

- **Dal browser due telefoni non si "leggono" tra loro**: serve sempre un tag NFC (adesivo del tavolo o braccialetto). Il master **scrive** l'adesivo con il suo Android direttamente dall'app.
- **Su iPhone il browser non può usare l'NFC** (Safari non supporta Web NFC), quindi niente lettura dall'app né scrittura di braccialetti. I braccialetti per chi ha iPhone li scrive lo staff dal pannello admin con un telefono Android.
- Il **PIN** si rinnova da solo (ogni 2 minuti, configurabile). L'adesivo del tavolo vale finché il tavolo resta aperto. Lo staff può disattivare il codice manuale per imporre l'NFC, ma così gli iPhone possono entrare solo con il braccialetto.
- Gli aggiornamenti tra telefoni arrivano con un **controllo ogni 2 secondi** al tavolo (6 secondi nelle altre pagine), perché l'hosting condiviso non offre WebSocket.

## Funzionalità

| Area | Cosa c'è |
|---|---|
| **Account** | registrazione con username e password (il **primo iscritto diventa staff**), profilo pubblico (avatar, colore, bio), saldo, livello, medaglie, statistiche per gioco, ultime partite, cambio password |
| **Bonus giornaliero** | ruota della fortuna (esito deciso dal server), serie di giorni consecutivi con bonus crescente |
| **Game master** | i giocatori chiedono l'autorizzazione con una motivazione; lo staff approva o rifiuta |
| **Tavoli** | minimo 3 partecipanti master incluso (2 per i giochi di coppia), stati *in attesa → in gioco → chiuso*, un tavolo alla volta per giocatore |
| **Fiches** | Blackjack, Sette e mezzo, Roulette, Baccarat, Poker: il master registra puntata ed esito di ogni mano. Le fiches si aggiornano **a ogni mano** o **alla chiusura** del tavolo, a scelta |
| **Vite** | Trentuno, Picozzo, Cucù, gioco libero: il master toglie e ridà vite, gli eliminati vanno in fondo alla classifica |
| **Punti** | Scopa, Briscola, Tressette, Burraco, anche a coppie |
| **Correzioni** | annulla ultima mano, allontana giocatore, annulla tavolo |
| **Classifica** | per fiches, vittorie e partite |
| **Admin (staff)** | panoramica; richieste GM; utenti (ruoli, sospensioni, rettifiche fiches motivate, **scrittura del braccialetto pass**); tavoli (chiusura/annullo forzati); catalogo giochi (modifica e creazione); impostazioni (bonus, ruota, fiches iniziali, durata PIN, codice manuale on/off, fuso orario); registro movimenti e registro azioni |
| **Sicurezza** | password con `password_hash`, sessione in cookie HttpOnly, protezione CSRF, blocco dopo 10 accessi falliti in 15 minuti, ogni movimento di fiches in transazione con registro contabile, database non scaricabile (`.htaccess`) |
| **Design** | casinò (panno verde, oro Art Déco, lampadine marquee, fiches) e sala giochi (neon, cuori pixel, tabellone LED); pioggia di fiches, suoni, vibrazione su Android, opzione "riduci animazioni" |

## Pubblicare su Aruba Hosting Linux Basic

**Cosa serve**: hosting Linux con PHP 8.0 o successivo (Aruba Basic offre PHP 8.0–8.5), certificato SSL attivo (incluso nel piano Basic) e un client FTP (es. FileZilla). Non serve il database MySQL.

1. **Crea il pacchetto** sul tuo computer (serve [Node.js](https://nodejs.org) 20+):
   ```bash
   npm install
   ```
   ```bash
   npm run build
   ```
   Si crea la cartella `dist/` con il sito, la cartella `api/` (PHP) e il file `.htaccess`.
2. **Carica via FTP tutto il contenuto di `dist/`** nella cartella principale del sito, compresi i file nascosti (`.htaccess`, `api/data/.htaccess`). In FileZilla attiva *Server → Forza visualizzazione file nascosti*.
3. **Verifica l'hosting** aprendo `https://www.tuodominio.it/api/health`. Deve rispondere con `"pdoSqlite": true`, `"dataDirWritable": true` e `"https": true`.
   - `pdoSqlite: false` → attiva l'estensione **pdo_sqlite** nel pannello PHP di Aruba o chiedi all'assistenza;
   - `dataDirWritable: false` → con l'FTP dai alla cartella `api/data` i permessi di scrittura (755 o 775);
   - `https: false` → apri il sito con `https://`; se serve, togli il `#` alle righe "HTTPS" in `.htaccess`.
4. **Registrati subito**: il primo account creato diventa **staff**. Da lì approvi i game master e gestisci tutto dal pannello ★ Staff.

**Aggiornamenti**: rifai `npm run build` e ricarica i file, **senza toccare `api/data/`** (lì c'è il database `party-casino.sqlite`). **Backup**: scarica periodicamente quel file via FTP.

**Sottocartella** (es. `tuodominio.it/party/`): crea il pacchetto con `VITE_BASE=/party/ npm run build` e copia `api/config.sample.php` in `api/config.php` impostando `'cookie_path' => '/party/'`.

**URL negli adesivi e nei QR**: di default si usa l'indirizzo da cui è aperto il sito. Per fissarlo, crea `.env.production.local` con `VITE_PUBLIC_URL=https://www.tuodominio.it` (vedi `.env.example`).

**Hardware consigliato**: adesivi o braccialetti NFC **NTAG213/215/216** (economici e compatibili con Android e iPhone), uno per tavolo più uno per giocatore se si usano i pass.

## Provarlo sul computer

**Demo senza server** (dati nel browser, NFC simulato):

```bash
npm run dev
```

Apri http://localhost:5173 e usa gli account dimostrativi (password `demo`): `admin` (staff), `mazziere` (game master), `luca`, `giulia`, `marco`, `sofia`, `ale`. Per simulare più telefoni apri più schede con account diversi. Il master *scrive* l'adesivo virtuale del tavolo; il giocatore, da *Entra → Leggi l'adesivo NFC*, lo tocca nell'elenco degli adesivi virtuali.

**Con l'API PHP vera** (serve PHP 8 con pdo_sqlite), in due terminali:

```bash
npm run dev:api
```

```bash
npm run dev:server
```

Per provare il pacchetto finale come su Aruba, compila con `npm run build` e poi:

```bash
npm run preview:aruba
```

Il sito è su http://127.0.0.1:8080 e il database finisce nella cartella `.data/`.

## Architettura

```
Browser (React 19 + TypeScript + Vite) ──fetch JSON + cookie di sessione──► /api/*.php (PHP 8)
   │  Web NFC (Chrome Android)                                                     │
   │  polling /api/version ogni 2-6 s                                              ▼
   └─ modalità demo: LocalBackend (localStorage)                   api/data/party-casino.sqlite
```

| Cartella | Contenuto |
|---|---|
| `src/core/` | modello di dominio, regole pure (esiti, piazzamenti, bonus, livelli), catalogo giochi |
| `src/data/` | interfaccia unica `Backend`, `ApiBackend` (produzione) e `LocalBackend` (demo) |
| `src/nfc/` | Web NFC, simulatore per la demo, formato degli URL negli adesivi/QR |
| `src/ui/`, `src/styles/` | design system casinò/sala giochi, ruota, effetti, pannelli NFC |
| `src/screens/` | sala, entra, apri tavolo, tavolo (console del master e vista giocatore), classifica, profili, giochi, admin |
| `server/api/` | API PHP: `index.php` (rotte), `lib/service.php` (regole e operazioni), `lib/db.php` (schema SQLite creato automaticamente) |
| `server/.htaccess` | riscritture per API e rotte dell'app, protezione dei file |
| `scripts/package-aruba.mjs` | assembla `dist/` pronto per l'FTP |
| `tests/api.test.ts` | test d'integrazione sul vero server PHP + SQLite |

Le regole di gioco sono scritte due volte, in TypeScript per la demo e in PHP per il server, con gli stessi messaggi. Il catalogo giochi PHP è una copia di quello TypeScript: i test verificano che i due cataloghi coincidano e che il server applichi le regole.

**Formato dei link** negli adesivi NFC e nei QR: tavolo `https://DOMINIO/j/CODICE/TOKEN`, braccialetto pass `https://DOMINIO/p/TOKEN`.

## Test

```bash
npm test
```

I test sono 29:

- **regole di gioco**;
- **backend demo**: flussi completi con più utenti;
- **API PHP reale**: un server `php -S` con un database SQLite temporaneo. Coprono registrazione e accesso, CSRF, richieste GM, blackjack con adesivo e braccialetto, saldo alla chiusura, vite con PIN, scadenza dei codici, bonus, coppie, admin, coerenza registro/saldi, blocco dei tentativi e aggiornamento via polling.

```bash
npm run typecheck
```

## Stato e limiti noti

- **Verificato in questo repository**:
  - test unitari e d'integrazione PHP + SQLite (PHP 8.3);
  - build del pacchetto per Aruba;
  - flusso nel browser sul pacchetto servito da PHP: approvazione del GM, apertura del tavolo, iPhone che entra con il codice, ingresso dal link del QR, mano registrata con aggiornamento via polling, chiusura;
  - demo con adesivo NFC simulato.
- **Non verificato**:
  - il deploy su un vero account Aruba: `.htaccess`, permessi della cartella `api/data`, presenza di **pdo_sqlite**. Per controllare c'è `api/health`;
  - la lettura e scrittura NFC su un vero telefono Android: Web NFC non si può provare nel browser automatico usato per i test;
  - la compatibilità con PHP 8.0: il codice evita le funzioni successive alla 8.0, ma è stato eseguito solo su PHP 8.3.
- SQLite è adatto a una festa (decine di giocatori). Le scritture sono brevi e serializzate e il database usa il journal classico, il più sicuro su hosting condiviso.
- **Picozzo**: non sono state trovate fonti sulle regole; è un gioco a vite con regole della casa, modificabili dallo staff.
- Prima di rendere il sito pubblico: informativa privacy (i profili sono pubblici) e, se serve, un modo per cancellare gli account (oggi lo staff può sospenderli).
