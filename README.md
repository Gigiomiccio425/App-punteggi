# 🎰 Party Casinò

App per le serate di gioco tra amici, **iOS, Android e web**: si entra ai tavoli **avvicinando i telefoni (NFC)**, si gioca con **fiches virtuali**, **vite** o **punti**, e ogni giocatore ha un profilo con statistiche pubbliche. Stile da casinò e sala giochi.

> Le fiches sono virtuali e non hanno valore economico: non si comprano e non si convertono.

📄 **Perché questa architettura?** Ricerca completa (web vs nativo, NFC per piattaforma, design) in [`docs/RICERCA.md`](docs/RICERCA.md).

## Funzionalità

| Area | Cosa c'è |
|---|---|
| **Account** | registrazione, profilo pubblico (avatar, colore, bio), saldo fiches, livello, medaglie, statistiche per gioco, ultime partite |
| **Bonus giornaliero** | ruota della fortuna (esito deciso dal server), serie di giorni consecutivi con bonus crescente |
| **Game master** | i giocatori chiedono l'autorizzazione, lo staff approva o rifiuta; solo i GM (e lo staff) aprono tavoli |
| **Tavoli** | minimo 3 partecipanti master incluso (2 per scopa e giochi di coppia), stato *in attesa → in gioco → chiuso* |
| **Ingresso NFC** | telefono-a-telefono (Android HCE), lettura del pass giocatore (braccialetto/adesivo o Android), adesivo NFC del tavolo, QR/PIN di riserva disattivabile |
| **Giochi a fiches** | Blackjack, Sette e mezzo, Roulette, Baccarat, Poker. Il master registra puntata ed esito di ogni mano; le fiches si aggiornano **a ogni mano** o **alla chiusura** del tavolo |
| **Giochi a vite** | Trentuno, Picozzo, Cucù, gioco libero. Il master tiene la tabella; ognuno vede in grande la propria situazione e quella degli altri nel tabellone |
| **Giochi a punti** | Scopa, Briscola, Tressette, Burraco, anche **a coppie** |
| **Correzioni** | annulla ultima mano, allontana giocatore, annulla tavolo |
| **Classifica** | per fiches, vittorie e partite, con podio |
| **Admin (staff)** | panoramica, richieste GM, utenti (ruoli, sospensioni, rettifiche fiches motivate), tavoli (chiusura/annullo forzati), catalogo giochi (modifica e creazione), impostazioni (bonus, ruota, fiches iniziali, scadenza codici, QR on/off), registro movimenti e audit |
| **Design** | casinò (panno verde, oro Art Déco, lampadine a inseguimento, fiches) e sala giochi (neon, cuori pixel, tabellone LED); pioggia di fiches, suoni, vibrazione, "riduci animazioni" |

## Avvio rapido (modalità demo)

Non serve nessun server: senza configurazione l'app parte in **modalità demo** e salva i dati nel browser.

```bash
npm install
```

```bash
npm run dev
```

Apri http://localhost:5173 e accedi con uno degli account dimostrativi (password `demo`): `admin` (staff), `mazziere` (game master), `luca`, `giulia`, `marco`, `sofia`, `ale`.

**Simulare più telefoni.** Apri l'app in più schede dello stesso browser con account diversi. L'NFC è simulato tra le schede: nella scheda del master apri un tavolo (modalità 📲 *Telefono*, cioè trasmissione); nella scheda del giocatore premi *Entra → Tocca e avvicina il telefono*. Funziona anche al contrario: il giocatore attiva *Emetti il mio pass* e il master usa *Leggi pass*.

## Architettura

```
React 19 + TypeScript + Vite  ──►  web/PWA + pannello admin
        │ Capacitor 8           ──►  app iOS (Core NFC) e Android (NFC + HCE)
        ▼
Backend (interfaccia unica src/data/backend.ts)
 ├─ LocalBackend    → demo nel browser (localStorage + BroadcastChannel)
 └─ SupabaseBackend → PostgreSQL + RLS + funzioni RPC transazionali + Realtime
```

| Cartella | Contenuto |
|---|---|
| `src/core/` | modello di dominio, regole pure (esiti, piazzamenti, bonus, livelli), catalogo giochi |
| `src/data/` | interfaccia backend, implementazione demo e Supabase |
| `src/nfc/` | astrazione NFC: nativo (`@capgo/capacitor-nfc` + plugin HCE), Web NFC, simulatore; formato NDEF/URL |
| `src/ui/` | design system: marquee, fiches, cuori pixel, ruota, effetti, pannelli NFC |
| `src/screens/` | sala, entra, apri tavolo, tavolo (console del master e vista giocatore), classifica, profili, giochi, admin |
| `supabase/migrations/` | schema, RLS, RPC (le stesse regole di `src/core/rules.ts`) |
| `supabase/tests/` | test d'integrazione SQL su un PostgreSQL temporaneo |
| `android/`, `ios/` | progetti nativi Capacitor (HCE Android, entitlement NFC iOS) |

### Formato NFC

I tag, i telefoni in emulazione e i QR contengono un **URL https** (record NDEF URI):

- tavolo: `https://DOMINIO/j/CODICE/TOKEN`
- pass giocatore: `https://DOMINIO/p/TOKEN`

Così un iPhone **senza app** che tocca un adesivo apre la web app, e con l'app installata il link apre l'app (Universal/App Links). Il token del telefono del master scade dopo `joinTokenTtlSeconds` (default 120 s) e si rinnova da solo. Il token dell'adesivo vale finché il tavolo è aperto. Nessun token è leggibile dagli altri client.

## Produzione con Supabase

1. Crea un progetto su [supabase.com](https://supabase.com) e applica la migrazione (SQL Editor oppure CLI):
   ```bash
   supabase db push
   ```
   oppure incolla `supabase/migrations/20261101000000_init.sql` nell'SQL Editor.
2. Copia `.env.example` in `.env` e compila `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` e `VITE_PUBLIC_URL` (il dominio dove pubblichi la web app).
3. Registrati dall'app, poi promuovi il primo account staff dall'SQL Editor:
   ```sql
   update public.profiles set role = 'staff' where username = 'il_tuo_username';
   ```
4. Pubblica la web app (`npm run build` → cartella `dist/`) su un hosting HTTPS (Vercel, Netlify, Cloudflare Pages…) con *fallback SPA* su `index.html`.

## App native (iOS e Android)

```bash
npm run cap:android
```

```bash
npm run cap:ios
```

Questi comandi compilano la web app, sincronizzano i progetti nativi e aprono Android Studio / Xcode.

**Android**: il plugin di emulazione è in `android/app/src/main/java/club/partycasino/app/` (`NdefHceService` emula un tag NFC Forum Type 4 con AID `D2760000850101`, `NfcHcePlugin` lo accende e spegne). Per gli App Links sostituisci `party.example.com` in `AndroidManifest.xml` e pubblica `public/.well-known/assetlinks.json` con l'impronta SHA-256 del tuo certificato.

**iOS**: le capability *NFC Tag Reading* e *Associated Domains* sono in `ios/App/App/App.entitlements`. Sostituisci il dominio, abilita le capability sull'App ID nel portale Apple Developer e pubblica `public/.well-known/apple-app-site-association` con il tuo Team ID. iPhone legge e scrive tag e legge i telefoni Android in emulazione, ma **non può emulare** (vedi ricerca §3).

**Hardware consigliato**: adesivi o braccialetti NFC NTAG213/215/216 per i tavoli e per i pass dei giocatori (utili soprattutto con gli iPhone).

## Test

```bash
npm test
```

Esegue i test unitari delle regole, del backend demo (flussi completi multi-utente) e della codifica NDEF.

```bash
npm run test:sql
```

Applica la migrazione su un PostgreSQL temporaneo (con stub minimi di `auth`) ed esegue 50 verifiche: permessi, RLS, token, mani, vite, coppie, bonus, admin, coerenza registro/saldi.

```bash
npm run typecheck
```

## Stato e limiti noti

- Verificati in questo repository: test unitari, test SQL su PostgreSQL 16, build, flusso end-to-end nel browser con più "telefoni" simulati (Playwright).
- Il **plugin HCE Android** compila contro le API Android 35, ma va provato su dispositivi reali. Anche le **build native** (Android Studio/Xcode) non sono state eseguite qui.
- `SupabaseBackend` usa le stesse RPC testate in SQL, ma non è stato provato contro un progetto Supabase reale (va verificato soprattutto il Realtime).
- Regole del **Picozzo**: non sono state trovate fonti; è configurato come gioco a vite con regole della casa, modificabili dallo staff.
- Prima di pubblicare sugli store: verificare le policy su "gioco simulato" e la classificazione d'età, e preparare l'informativa privacy (profili pubblici).
