# Ricerca: piattaforma, NFC, hosting e design

*Novembre 2026: documento di analisi a supporto delle scelte del progetto.*

## 1. Decisione finale

**Web app pubblicata su Aruba Hosting Linux Basic, con API PHP e database SQLite.** Niente app da store e niente database MySQL.

| Dispositivo | Come si entra ai tavoli |
|---|---|
| **Android** (Chrome) | **Web NFC**: legge l'adesivo NFC del tavolo; il master può anche leggere il braccialetto del giocatore e scrivere adesivi e braccialetti |
| **iPhone** | **codice manuale** (codice tavolo + PIN) o QR. Bonus: gli iPhone XS e successivi, toccando l'adesivo, aprono il link del tavolo in Safari |

Questa scelta rispetta i vincoli richiesti: un solo sito su un hosting economico, nessun database a pagamento, l'NFC dove il browser lo consente.

**Cosa si perde rispetto a un'app nativa** (vedi §3): due telefoni **non si possono leggere tra loro** dal browser, quindi l'NFC passa sempre da un **tag** (adesivo del tavolo o braccialetto); inoltre l'iPhone non usa l'NFC dentro l'app. Un'eventuale app nativa per Android (o Capacitor) potrebbe aggiungere in futuro il telefono-a-telefono, riusando la stessa API PHP.

## 2. Cosa serve davvero dall'NFC

| Operazione | Esempio | Possibile dal browser? |
|---|---|---|
| **Leggere** un tag | il giocatore avvicina il telefono all'adesivo del tavolo; il master legge il braccialetto | ✅ solo Chrome per Android |
| **Scrivere** un tag | il master scrive l'adesivo; il giocatore (o lo staff) scrive il braccialetto pass | ✅ solo Chrome per Android |
| **Emulare** un tag (il telefono "fa da tag") | telefono-a-telefono | ❌ nessun browser; solo app native Android (HCE) |

## 3. Supporto per piattaforma

| | Leggere | Scrivere | Emulare (telefono-a-telefono) |
|---|---|---|---|
| **Web, Chrome Android** | ✅ Web NFC (HTTPS, permesso dell'utente, pagina in primo piano) | ✅ | ❌ fuori dallo scope di Web NFC (solo NDEF, niente HCE né peer-to-peer) |
| **Web, iPhone** (Safari e qualsiasi browser iOS, tutti WebKit) | ❌ (Safari ha posizione ufficiale contraria a Web NFC) | ❌ | ❌ |
| iPhone, lettura **in background** del sistema | ✅ iPhone XS+: un tag con URL mostra una notifica che apre il link (Safari se non c'è un'app) | — | — |
| App nativa Android | ✅ | ✅ | ✅ HCE |
| App nativa iOS | ✅ Core NFC | ✅ | ⚠️ solo con l'entitlement HCE di Apple: sviluppatori stabiliti nello SEE, organizzazione, accordi legali per il caso d'uso. Non praticabile per un'app da festa |

### Come l'app copre tutte le combinazioni

| Giocatore ↓ / Master → | Master Android | Master iPhone |
|---|---|---|
| **Android** | adesivo NFC del tavolo, braccialetto, o codice | codice/QR; adesivo NFC se scritto prima con un Android |
| **iPhone** | codice/QR, oppure braccialetto letto dal master | codice/QR |
| **iPhone XS+ con adesivo sul tavolo** | tocca l'adesivo → notifica → link → seduto | idem |

Il PIN dura 2 minuti (configurabile) e si rinnova da solo, così non si può riusare una foto del codice. L'adesivo del tavolo vale finché il tavolo è aperto. Lo staff può disattivare il codice manuale per imporre l'NFC.

## 4. Opzioni valutate

| | A. **Web/PWA su hosting condiviso** ✅ scelta | B. App nativa (Swift + Kotlin) | C. React Native / Flutter | D. Capacitor (web + guscio nativo) |
|---|---|---|---|---|
| NFC Android | ✅ Web NFC (tag) | ✅ anche telefono-a-telefono | ✅ anche telefono-a-telefono | ✅ anche telefono-a-telefono |
| NFC iPhone | ❌ → codice/QR | ✅ lettura/scrittura tag | ✅ | ✅ |
| Store, account sviluppatore, revisioni | non servono | servono (Apple e Google) | servono | servono |
| Hosting | Aruba Linux Basic, già pronto | serve comunque un backend | idem | idem |
| Costo e tempi | **minimi** | alti | medi | medi |
| Aggiornamenti | caricamento via FTP, immediati | tramite store | tramite store | tramite store |

La versione precedente del progetto usava D (Capacitor + Supabase). La scelta di A riduce costi e complessità; il codice resta pronto per aggiungere D in futuro, perché l'interfaccia `Backend` è unica.

## 5. Hosting: Aruba Hosting Linux Basic

Cosa offre il piano, secondo la pagina ufficiale di Aruba:

- **PHP 8.0–8.5**, `.htaccess` e `mod_rewrite` supportati;
- **certificato SSL DV incluso e preinstallato**: fondamentale, perché Web NFC funziona solo in **https**;
- spazio web e traffico "illimitati";
- **MySQL non incluso** (opzionale a pagamento);
- **niente SSH** (solo FTP), quindi niente comandi da terminale sul server.

Come è stato adattato il progetto:

- **SQLite via PDO**: il database è un file (`api/data/party-casino.sqlite`) creato e aggiornato **automaticamente** alla prima richiesta, senza installazione e senza SSH. La cartella è protetta da `.htaccess`. Il supporto di **pdo_sqlite** non risulta dalla documentazione pubblica di Aruba: va verificato con `https://tuodominio/api/health` e, se manca, attivato dal pannello PHP o chiesto all'assistenza.
- **Concorrenza**: ogni operazione che scrive usa una transazione `BEGIN IMMEDIATE` con attesa automatica. Si usa il journal classico invece di WAL, perché WAL richiede memoria condivisa locale, non garantita su hosting condiviso. Per una festa (decine di persone, scritture brevi) è più che sufficiente.
- **Niente WebSocket** su hosting condiviso: gli aggiornamenti arrivano con un **polling** leggerissimo su `/api/version`, un numero che cresce a ogni modifica. Controllo ogni 2 s al tavolo, 6 s altrove, 20 s con la scheda in background; solo se il numero cambia si ricaricano i dati.
- **Sicurezza**: password con `password_hash`, sessione PHP in cookie HttpOnly/SameSite, intestazione anti-CSRF obbligatoria sulle scritture, blocco dopo 10 accessi falliti in 15 minuti, nessun token di ingresso o pass leggibile da altri utenti, registro contabile di ogni movimento di fiches e audit delle azioni dello staff.

## 6. Anti-imbroglio

- I game master sono **autorizzati dallo staff** (richiesta motivata, approvazione o rifiuto, audit).
- PIN a rotazione e adesivo invalidabile riscrivendolo; braccialetto pass rigenerabile se perso.
- **Un tavolo alla volta** per giocatore; si entra a partita iniziata solo nei giochi che lo consentono.
- Il server controlla saldi, puntate minime e massime ed esiti: il client non può inventare fiches.
- **Annulla ultima mano** tracciato; rettifiche dello staff sempre motivate e registrate.

## 7. Aspetti legali (indicazioni, non consulenza legale)

- **Fiches puramente virtuali**: niente acquisto, conversione o premi in denaro o beni. Così l'app resta un segnapunti/gioco sociale e non un gioco con vincite (in Italia regolato da ADM). Il disclaimer è visibile in login e in sala.
- **GDPR**: profili e statistiche sono pubblici agli utenti registrati. Servono informativa privacy, minimizzazione dei dati (si chiedono solo username e nome visualizzato, niente email) e una procedura per cancellare gli account su richiesta.
- Non essendoci app negli store, non si applicano le policy di Google Play e App Store sul "gioco simulato".

## 8. Ricerca di design: casinò e sala giochi

### Cosa dicono le fonti

- **Colori**: l'oro comunica lusso, premio e jackpot; il verde il panno dei tavoli e la conferma; il rosso energia e azione; fondi scuri con accenti oro per l'effetto "lounge".
- **Materiali**: texture di feltro e velluto per il realismo.
- **Tipografia**: saldi e informazioni critiche prima di tutto leggibili (dimensione, peso, contrasto), gerarchia coerente.
- **Animazioni**: per vittorie, bonus e feedback, **mai bloccanti**, senza disordine visivo.
- **Insegne di Las Vegas** (Neon Museum): lampadine *a inseguimento*, circuiti lampeggianti, starburst anni '50, scritte al neon, contorni luminosi, icone animate; lettering Art Déco.
- **Sala giochi/arcade**: neon magenta e ciano, font pixel, griglie e scanline, pulsanti "bombati", micro-animazioni.
- **"Juice"** (Jonasson e Purho, GDC 2012): flash, testo fluttuante, suoni e particelle, ma con misura e con un'opzione per **ridurre le animazioni**.

### Come è stato applicato

| Ricerca | Implementazione |
|---|---|
| Due anime | giochi **a fiches** = "Casinò" (panno verde, oro, rosso); giochi **a vite/punti** = "Sala giochi" (neon su griglia viola) |
| Lampadine a inseguimento | componente `Marquee` (logo, bonus) e luci sul bordo della ruota |
| Neon tremolante | logo "Party" (Monoton) e titoli della sala giochi |
| Oro Art Déco | titoli Cinzel con gradiente oro, angoli déco sui pannelli in feltro |
| Fiches | pulsanti-fiche con colori per taglio (5 rosso, 10 blu, 25 verde, 100 nero, 500 viola, 1000 giallo) |
| Icone animate | ruota della fortuna del bonus (esito deciso dal server), podio, corona |
| Arcade | cuori pixel che si spezzano, tabellone LED Press Start 2P, codice e PIN in stile display |
| Juice moderato | pioggia di fiches/coriandoli, numero che vola (+150), suoni WebAudio, vibrazione su Android |
| Accessibilità | "Riduci animazioni" + `prefers-reduced-motion`, contrasti alti, pulsanti ≥ 44 px |

## 9. Giochi

- **Fiches (Casinò)**: Blackjack, Sette e mezzo, Roulette, Baccarat, Poker. Il master è il banco e registra puntata ed esito (arrotondati a favore del banco) o un importo libero. Minimo 3 partecipanti, master incluso.
- **Vite (Sala giochi)**: Trentuno (3 vite di default; chi ha il punteggio più basso perde una vita, vince l'ultimo in vita), Picozzo, Cucù, gioco libero. Minimo 3, master incluso. Ognuno vede in grande la propria situazione e nel tabellone quella degli altri.
- **Punti, anche a coppie**: Scopa (11), Briscola (al meglio delle 3), Tressette (21), Burraco (2005). Minimo 2.
- **Picozzo**: nessuna fonte trovata sulle regole (probabilmente una variante locale): è configurato come gioco a vite "con regole della casa", modificabile dallo staff.

## Fonti

- Aruba Hosting Linux (piani, PHP, SSL, MySQL opzionale, SSH solo Advanced): [hosting.aruba.it/en/web-hosting/linux](https://hosting.aruba.it/en/web-hosting/linux) · [whtop: Aruba Linux Basic](https://www.whtop.com/plans/aruba.it/39680)
- SQLite su hosting condiviso (verifica pdo_sqlite): [WPPOOL: abilitare pdo_sqlite](https://wppool.dev/docs/how-to-enable-the-pdo-sqlite-extension-in-your-servers-php-configuration) · [hosting.com: SQLite](https://kb.hosting.com/docs/do-you-support-sqlite)
- Web NFC: [caniuse](https://caniuse.com/webnfc) · [web-features explorer](https://web-platform-dx.github.io/web-features-explorer/features/web-nfc) · [Chrome Developers: Web NFC](https://developer.chrome.com/docs/capabilities/nfc?hl=zh-cn)
- iPhone, lettura in background: [Apple: Adding support for background tag reading](https://developer.apple.com/documentation/corenfc/adding-support-for-background-tag-reading.md)
- iOS HCE (perché non è praticabile): [Apple Developer: HCE-based contactless NFC transactions](https://developer.apple.com/support/hce-transactions-in-apps)
- App native e NFC (alternative valutate): [Capgo capacitor-nfc](https://capgo.app/docs/plugins/nfc) · [Capawesome NFC](https://capawesome.io/plugins/nfc) · [react-native-nfc-manager](https://www.github.com/revtel/react-native-nfc-manager) · [nfc_host_card_emulation](https://pub.dev/packages/nfc_host_card_emulation/install)
- Design casinò: [Colour schemes for casino sites](https://wbcomdesigns.com/colour-schemes-and-visual-appeal/) · [The Art of Slot Design](https://thedesigninspiration.com/news/?p=40387) · [Casino UI design trends](https://www.eventible.com/learning/?p=15793) · [The science of casino interior design](https://amazingarchitecture.com/articles/the-science-of-casino-interior-design)
- Insegne di Las Vegas: [Neon Museum: 8 designs and animations](https://neonmuseum.org/news/8-of-the-most-popular-designs-and-animations-on-vintage-neon-signs/)
- Arcade e "juice": [iGaming e arcade](https://www.oldschoolgamermagazine.com/how-igaming-has-successfully-emulated-the-feel-of-old-school-arcades) · [Synthwave/Outrun](https://trends.daisyui.com/trend/synthwave-outrun/) · [Juice: flash, shake, floating text](https://eastondev.com/blog/en/posts/dev/20260521-game-feedback-feel/)
- Trentuno: [Thirty-one (Wikipedia)](https://www.wikipedia.org/wiki/Trente-un) · [Come si gioca a 31](https://areasosta.com/faq/come-si-gioca-a-31)
