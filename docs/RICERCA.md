# Ricerca: piattaforma, NFC e design

*Novembre 2026: documento di analisi a supporto delle scelte del progetto.*

## 1. Sintesi e raccomandazione

**Una web app da sola non basta.** Il requisito centrale è l'NFC tra telefoni, e il web non lo copre:

- su **iPhone** nessun browser supporta Web NFC (Safari ha posizione ufficiale *contraria* e su iOS tutti i browser usano WebKit);
- anche dove Web NFC esiste (**Chrome per Android**) si possono solo leggere e scrivere tag: **non si può "fare da tag"**, cioè emulare, che è ciò che serve per il telefono-a-telefono.

**Scelta consigliata e implementata: app ibrida con Capacitor e backend Supabase.**
Un solo codice React/TypeScript produce:

1. l'**app iOS** e l'**app Android** (store), con NFC nativo tramite plugin;
2. la **web app/PWA**, utile per Android/Chrome (Web NFC) e per chi non installa l'app;
3. il **pannello admin**, che è la stessa web app (sezione `/admin`).

Per il telefono-a-telefono l'app usa la **Host Card Emulation (HCE) di Android**: il telefono si comporta come un tag NFC che contiene il link del tavolo o del pass del giocatore. iPhone non può emulare (vedi §3), quindi l'app offre altre tre modalità che funzionano su tutte le combinazioni: adesivo NFC sul tavolo, braccialetto/pass personale letto dal master, QR/PIN di riserva (disattivabile dallo staff).

## 2. Cosa serve davvero dall'NFC

| Operazione | Esempio nell'app |
|---|---|
| **Leggere** un tag (o un telefono che emula un tag) | il giocatore avvicina il telefono al tavolo/al master |
| **Scrivere** un tag | il master scrive l'adesivo del tavolo; il giocatore scrive il proprio braccialetto pass |
| **Emulare** un tag (HCE) | il telefono del master "trasmette" il tavolo; un Android trasmette il pass del giocatore |

Il telefono-a-telefono richiede sempre che **uno legga e l'altro emuli**. La vecchia modalità peer-to-peer (Android Beam) non è più disponibile sugli Android recenti, e il plugin NFC la espone solo come funzione legacy.

## 3. Supporto per piattaforma

| | Leggere | Scrivere | Emulare (fare da tag) |
|---|---|---|---|
| **Web, Chrome Android** | ✅ Web NFC (HTTPS, gesto utente) | ✅ | ❌ fuori dallo scope di Web NFC (solo NDEF, niente HCE né P2P) |
| **Web, iPhone** (Safari e qualsiasi browser iOS) | ❌ (solo la lettura *in background* di tag con URL, che apre il link) | ❌ | ❌ |
| **App nativa Android** | ✅ | ✅ | ✅ HCE, con app in primo piano e schermo sbloccato |
| **App nativa iOS** | ✅ Core NFC (iPhone 7+); lettura in background su iPhone XS+ | ✅ | ⚠️ solo con l'**entitlement HCE** di Apple: riservato a sviluppatori *stabiliti nello SEE*, iscritti come organizzazione, con accordi legali per il caso d'uso (pagamenti, chiavi, biglietti, "device-to-device" con permessi regolatori). **Non praticabile** per un'app da festa. |

Due dettagli utili emersi dalla ricerca:

- **Lettura in background su iPhone**: un tag con un record NDEF di tipo URL viene letto anche senza aprire l'app. Se l'URL è un *Universal Link* si apre l'app, altrimenti **Safari**. Quindi un iPhone **senza app** può entrare a un tavolo toccando l'adesivo: si apre la web app. Per questo tutti i tag contengono un URL `https://…/j/CODICE/TOKEN`.
- **iPhone legge un Android in HCE**: Core NFC legge un telefono Android che emula un tag NFC Forum Type 4 con l'AID NDEF standard `D2760000850101`, come se fosse un tag normale.

### Matrice telefono-a-telefono

| Chi emette ↓ / chi legge → | Android (app) | iPhone (app o web) |
|---|---|---|
| **Android (app, HCE)** | ✅ | ✅ |
| **iPhone** | ❌ | ❌ |
| **Adesivo/braccialetto NFC** | ✅ | ✅ (anche senza app) |

**Come l'app copre tutti i casi** (pannello "Fai entrare i giocatori" del master):

1. 📲 **Telefono**: il master Android trasmette il tavolo, i giocatori avvicinano il telefono. Il codice si rinnova ogni 2 minuti (configurabile).
2. 🎫 **Leggi pass**: il master (anche iPhone) legge il pass del giocatore: un braccialetto/adesivo scritto dall'app o il telefono Android del giocatore in modalità "Emetti il mio pass".
3. 🏷️ **Adesivo**: il master scrive un adesivo NFC (NTAG213/215/216) e lo attacca al tavolo.
4. 🔳 **QR/PIN**: ripiego senza NFC; lo staff può disattivarlo per imporre l'NFC.

## 4. Opzioni di sviluppo a confronto

| | A. Web/PWA pura | B. Nativo (Swift + Kotlin) | C. React Native (Expo dev build) | D. Flutter | **E. Capacitor + React** |
|---|---|---|---|---|---|
| NFC su iPhone | ❌ | ✅ | ✅ `react-native-nfc-manager` | ✅ `nfc_manager` | ✅ `@capgo/capacitor-nfc` |
| NFC su Android | ✅ solo Chrome | ✅ | ✅ | ✅ | ✅ (+ Web NFC dal browser) |
| Emulazione (telefono→telefono) | ❌ | ✅ Android | ✅ Android (`react-native-hce`) | ✅ Android (`nfc_host_card_emulation`) | ✅ Android (plugin HCE incluso nel repo) |
| Admin web | ✅ | ❌ progetto separato | ⚠️ separato o RN Web | ⚠️ Flutter Web, poco adatto | ✅ stesso codice |
| Codebase | 1 | 2 + web | 1 + web | 1 + web | **1** |
| Animazioni stile casinò | ✅ CSS | ✅ | ✅ | ✅✅ | ✅ CSS/SVG |
| Costo e tempi | bassi | alti | medi | medi | **bassi** |
| Note | scartata come soluzione unica, resta come canale secondario | massimo controllo, doppio lavoro | niente Expo Go: serve una build di sviluppo | Dart, ecosistema NFC frammentato | WebView adeguata per UI a schede/form/animazioni |

**Perché E.** L'interfaccia dell'app è fatta di liste, form, tabelloni e animazioni: il web la rende bene e senza duplicazioni. La parte NFC è piccola e isolata (`src/nfc/`) e sotto c'è codice nativo vero: Core NFC su iOS, NfcAdapter/HCE su Android. Il plugin di lettura/scrittura `@capgo/capacitor-nfc` è open source (MPL-2.0). L'alternativa Capawesome NFC (con HCE Android) richiede invece un abbonamento "Insiders". Per questo l'emulazione è implementata in un piccolo plugin locale (`android/app/src/main/java/.../NdefHceService.java`).

## 5. Backend: Supabase o Firebase

Le fiches sono un **registro contabile**: servono transazioni, vincoli e controlli lato server. Con **Supabase (PostgreSQL)**:

- ogni movimento passa da una **funzione RPC transazionale** che valida chi la chiama (master del tavolo, staff…) e scrive un registro append-only (`chip_ledger`): ogni saldo è ricostruibile;
- **Row Level Security**: i client possono solo leggere, e i token NFC e i pass non sono mai leggibili da altri;
- **Realtime** aggiorna tavolo, vite e punteggi su tutti i telefoni.

Firebase offre una sincronizzazione client più matura (offline), ma per garanzie equivalenti sulle scritture servirebbero Cloud Functions e regole complesse.

## 6. Sicurezza e anti-imbroglio (implementato)

- I game master sono **autorizzati dallo staff** (richiesta motivata, approvazione o rifiuto, audit).
- Codici di ingresso **a rotazione** (scadenza configurabile), codice statico separato per gli adesivi, PIN separato e disattivabile.
- **Un tavolo alla volta** per giocatore; si entra a partita iniziata solo nei giochi che lo consentono.
- Le fiches si muovono solo via RPC; i controlli sui saldi impediscono puntate oltre le disponibilità, anche nella modalità "a chiusura".
- **Annulla ultima mano** tracciato nel registro; rettifiche dello staff sempre motivate; **audit log** di tutte le azioni sensibili.

## 7. Aspetti legali (indicazioni, non consulenza legale)

- **Fiches puramente virtuali**: niente acquisto, niente conversione, niente premi in denaro o beni. Così l'app resta un segnapunti/gioco sociale e non un gioco con vincite (in Italia regolato da ADM). Il disclaimer è visibile in login e in sala.
- **Store**: Google Play limita i contenuti di "gioco d'azzardo simulato" e richiede classificazioni d'età adeguate; anche l'App Store prevede una classificazione per il gioco simulato. Prima della pubblicazione vanno verificate le policy aggiornate.
- **GDPR**: i profili e le statistiche sono pubblici. Servono informativa, base giuridica, possibilità di cancellare l'account (la cancellazione di `auth.users` elimina il profilo a cascata) e minimizzazione dei dati (l'email non è mai esposta).

## 8. Ricerca di design: casinò e sala giochi

### Cosa dicono le fonti

- **Colori**: l'oro comunica lusso, premio e jackpot; il verde il panno dei tavoli e la conferma; il rosso energia e azione; fondi scuri con accenti oro per l'effetto "lounge". Alcuni designer avvertono di usare il colore per guidare il comportamento, non solo per decorare.
- **Materiali**: texture di feltro e velluto per il realismo.
- **Tipografia**: i saldi e le informazioni critiche devono essere leggibili (dimensione, peso, contrasto) prima che decorativi; gerarchia coerente.
- **Animazioni**: vanno usate per vittorie, bonus e feedback, **senza bloccare il flusso** ed evitando il disordine visivo.
- **Insegne di Las Vegas** (Neon Museum): lampadine *a inseguimento* lungo i bordi, animazioni a circuiti lampeggianti, starburst anni '50, scritte in corsivo al neon, colori sovrapposti, contorni luminosi, icone animate (dadi, carte). Lettering ispirato agli anni '20 (Art Déco).
- **Sala giochi/arcade**: palette neon (magenta e ciano), font pixel/bitmap, scanline o griglie, pulsanti "bombati", micro-animazioni.
- **"Juice"** (Jonasson e Purho, GDC 2012): flash, tremolio, testo fluttuante, suoni e particelle rendono vivo un gioco, ma con misura. Le fonti consigliano un'opzione per **ridurre le animazioni** (accessibilità).

### Come è stato applicato nell'app

| Ricerca | Implementazione |
|---|---|
| Due anime: casinò e sala giochi | I giochi **a fiches** sono "Casinò" (panno verde, oro, rosso). I giochi **a vite/punti** sono "Sala giochi" (neon magenta/ciano su griglia viola) |
| Lampadine a inseguimento | componente `Marquee` (logo, bonus giornaliero) e luci sul bordo della ruota |
| Neon tremolante | logo "Party" in Monoton con flicker; titoli della sala giochi |
| Oro Art Déco | titoli in Cinzel con gradiente oro e angoli déco sui pannelli in feltro |
| Feltro/velluto | pannelli verdi con texture di rumore SVG e doppio bordo oro |
| Fiches | pulsanti-fiche con colori per taglio (5 rosso, 10 blu, 25 verde, 100 nero, 500 viola, 1000 giallo) |
| Icone animate | ruota della fortuna del bonus (esito deciso dal server), podio, corona che oscilla |
| Arcade | cuori pixel per le vite (si "spezzano" quando se ne perde una), tabellone LED in Press Start 2P, "GAME OVER" al neon |
| Juice moderato | pioggia di fiches/coriandoli sulle vittorie, numero che vola (+150), suoni sintetizzati WebAudio, vibrazione su app; mai bloccanti |
| Accessibilità | "Riduci animazioni" nel profilo + rispetto di `prefers-reduced-motion`; contrasti alti; target touch ≥ 44px |
| Gioco responsabile | disclaimer "fiches senza valore", nessun acquisto |

## 9. Giochi

- **Fiches (Casinò)**: Blackjack, Sette e mezzo, Roulette, Baccarat, Poker (cash game). Il master è il banco e registra puntata ed esito (con moltiplicatori arrotondati a favore del banco) oppure un importo libero. Minimo 3 partecipanti, master incluso.
- **Vite (Sala giochi)**: Trentuno (3 vite di default; chi ha il punteggio più basso perde una vita, vince l'ultimo in vita), Picozzo, Cucù, Gioco libero a vite. Minimo 3 partecipanti, master incluso. Il master tiene la tabella e tutti vedono le vite degli altri, ma in primo piano c'è la propria situazione.
- **Punti, anche a coppie**: Scopa (11), Briscola (al meglio delle 3), Tressette (21), Burraco (2005). Minimo 2 partecipanti.
- **Picozzo**: la ricerca non ha trovato fonti sulle regole (probabilmente è una variante locale). È configurato come gioco a vite con "regole della casa": lo staff può modificarne descrizione, vite e limiti dal pannello admin, oppure creare altri giochi.

## Fonti

- Web NFC, supporto browser: [caniuse](https://caniuse.com/webnfc) · [web-features explorer](https://web-platform-dx.github.io/web-features-explorer/features/web-nfc) · [Chrome Developers: Web NFC](https://developer.chrome.com/docs/capabilities/nfc?hl=zh-cn)
- iOS HCE (SEE, entitlement, casi d'uso): [Apple Developer: HCE-based contactless NFC transactions](https://developer.apple.com/support/hce-transactions-in-apps) · [MacRumors: NFC su iPhone](https://www.macrumors.com/guide/apple-nfc-chip-ios-18-1)
- iPhone, lettura in background e Universal Link: [Apple: Adding support for background tag reading](https://developer.apple.com/documentation/corenfc/adding-support-for-background-tag-reading.md)
- Android HCE letto da iPhone (Type 4, AID D2760000850101): [mob_nfc](https://hex.pm/packages/mob_nfc/0.1.0/files/lib/mob_nfc.ex) · [Stack Overflow](https://kaweah.freedombox.rocks/kiwix/stackoverflow.com_en_all_2023-11/questions/60778501/android-hce-with-ndef-format-and-use-ios-corenfc-reader-app-to-read-it) · [NFCAndroid](https://p.codekk.com/detail/64d9eb500c2d5a3fbe2aa966)
- Plugin: [Capgo capacitor-nfc](https://capgo.app/docs/plugins/nfc) · [Capawesome NFC](https://capawesome.io/plugins/nfc) · [capacitor-hce-plugin-int](https://npmjs.com/package/capacitor-hce-plugin-int) · [react-native-nfc-manager](https://www.github.com/revtel/react-native-nfc-manager) · [react-native-nfc-sdk](https://app.unpkg.com/react-native-nfc-sdk@0.3.4-beta/files/README.md) · [nfc_host_card_emulation](https://pub.dev/packages/nfc_host_card_emulation/install) · [nfc_pro_manager](https://pub.dev/documentation/nfc_pro_manager/latest/)
- Backend: [Bytebase: Supabase vs Firebase](https://www.bytebase.com/blog/supabase-vs-firebase.md)
- Policy store: [Google Play: Real-money gambling, games and contests](https://support.google.com/googleplay/android-developer/answer/9877032)
- Design casinò: [Colour schemes for casino sites](https://wbcomdesigns.com/colour-schemes-and-visual-appeal/) · [The Art of Slot Design](https://thedesigninspiration.com/news/?p=40387) · [Casino UI design trends](https://www.eventible.com/learning/?p=15793) · [The science of casino interior design](https://amazingarchitecture.com/articles/the-science-of-casino-interior-design)
- Insegne di Las Vegas: [Neon Museum: 8 designs and animations](https://neonmuseum.org/news/8-of-the-most-popular-designs-and-animations-on-vintage-neon-signs/) · [Neon Museum: LED vs vintage neon](https://neonmuseum.org/news/what-todays-led-signs-borrow-from-vintage-neon/)
- Arcade e "juice": [iGaming e arcade](https://www.oldschoolgamermagazine.com/how-igaming-has-successfully-emulated-the-feel-of-old-school-arcades) · [Synthwave/Outrun](https://trends.daisyui.com/trend/synthwave-outrun/) · [Juice: flash, shake, floating text](https://eastondev.com/blog/en/posts/dev/20260521-game-feedback-feel/) · [Making a juicy game](https://rpgplayground.com/research-making-a-juicy-game/)
- Trentuno: [Thirty-one (Wikipedia)](https://www.wikipedia.org/wiki/Trente-un) · [Come si gioca a 31](https://areasosta.com/faq/come-si-gioca-a-31)
