<?php
// Catalogo iniziale dei giochi: copia di src/core/games.ts (tests/api.test.ts verifica che coincidano).
declare(strict_types=1);

function default_games(): array
{
    return [
        ['defaultLives' => 0, 'targetPoints' => 0, 'allowTeams' => false, 'allowLateJoin' => true, 'outcomes' => [
            ['key' => 'lose', 'label' => 'Persa', 'mult' => -1],
            ['key' => 'push', 'label' => 'Pari', 'mult' => 0],
            ['key' => 'win', 'label' => 'Vinta', 'mult' => 1],
            ['key' => 'blackjack', 'label' => 'Blackjack 3:2', 'mult' => 1.5],
            ['key' => 'double_win', 'label' => 'Raddoppio vinto', 'mult' => 2],
            ['key' => 'double_lose', 'label' => 'Raddoppio perso', 'mult' => -2],
            ['key' => 'surrender', 'label' => 'Resa', 'mult' => -0.5],
        ], 'allowCustomDelta' => true, 'id' => 'blackjack', 'name' => 'Blackjack', 'mode' => 'chips', 'room' => 'casino', 'icon' => '🂡', 'description' => 'Il master è il banco. A ogni mano registra puntata ed esito di ogni giocatore: le fiches si muovono in automatico.', 'minParticipants' => 3, 'maxParticipants' => 8, 'masterPlaysDefault' => false, 'sort' => 10],
        ['defaultLives' => 0, 'targetPoints' => 0, 'allowTeams' => false, 'allowLateJoin' => true, 'outcomes' => [
            ['key' => 'lose', 'label' => 'Persa', 'mult' => -1],
            ['key' => 'win', 'label' => 'Vinta', 'mult' => 1],
            ['key' => 'reale', 'label' => 'Sette e mezzo reale', 'mult' => 2],
        ], 'allowCustomDelta' => true, 'id' => 'sette_e_mezzo', 'name' => 'Sette e mezzo', 'mode' => 'chips', 'room' => 'casino', 'icon' => '7½', 'description' => 'Classico natalizio: il master tiene il banco, chi sballa paga. Il sette e mezzo reale paga doppio.', 'minParticipants' => 3, 'maxParticipants' => 10, 'masterPlaysDefault' => false, 'sort' => 20],
        ['defaultLives' => 0, 'targetPoints' => 0, 'allowTeams' => false, 'allowLateJoin' => true, 'outcomes' => [
            ['key' => 'lose', 'label' => 'Persa', 'mult' => -1],
            ['key' => 'simple', 'label' => 'Chance semplice 1:1', 'mult' => 1],
            ['key' => 'dozen', 'label' => 'Dozzina/Colonna 2:1', 'mult' => 2],
            ['key' => 'six', 'label' => 'Sestina 5:1', 'mult' => 5],
            ['key' => 'split', 'label' => 'Cavallo 17:1', 'mult' => 17],
            ['key' => 'straight', 'label' => 'Pieno 35:1', 'mult' => 35],
        ], 'allowCustomDelta' => true, 'id' => 'roulette', 'name' => 'Roulette', 'mode' => 'chips', 'room' => 'casino', 'icon' => '🎡', 'description' => 'Il croupier registra la puntata e il tipo di vincita di ciascun giocatore.', 'minParticipants' => 3, 'maxParticipants' => 12, 'masterPlaysDefault' => false, 'sort' => 30],
        ['defaultLives' => 0, 'targetPoints' => 0, 'allowTeams' => false, 'allowLateJoin' => true, 'outcomes' => [
            ['key' => 'lose', 'label' => 'Persa', 'mult' => -1],
            ['key' => 'player', 'label' => 'Punto 1:1', 'mult' => 1],
            ['key' => 'banker', 'label' => 'Banco 0,95:1', 'mult' => 0.95],
            ['key' => 'tie', 'label' => 'Pareggio 8:1', 'mult' => 8],
        ], 'allowCustomDelta' => true, 'id' => 'baccarat', 'name' => 'Baccarat', 'mode' => 'chips', 'room' => 'casino', 'icon' => '♦', 'description' => 'Punto, Banco o Pareggio: il master registra le puntate e gli esiti.', 'minParticipants' => 3, 'maxParticipants' => 8, 'masterPlaysDefault' => false, 'sort' => 40],
        ['defaultLives' => 0, 'targetPoints' => 0, 'allowTeams' => false, 'allowLateJoin' => true, 'outcomes' => [], 'allowCustomDelta' => true, 'id' => 'poker', 'name' => 'Poker (cash game)', 'mode' => 'chips', 'room' => 'casino', 'icon' => '♠', 'description' => 'Il master fa da dealer e registra il risultato netto di ogni giocatore a fine mano (la somma dovrebbe essere zero).', 'minParticipants' => 3, 'maxParticipants' => 10, 'masterPlaysDefault' => false, 'sort' => 50],
        ['defaultLives' => 3, 'targetPoints' => 0, 'allowTeams' => false, 'allowLateJoin' => false, 'outcomes' => [], 'allowCustomDelta' => false, 'id' => 'trentuno', 'name' => 'Trentuno (31)', 'mode' => 'lives', 'room' => 'arcade', 'icon' => '31', 'description' => 'Ognuno parte con 3 vite. A ogni smazzata chi ha il punteggio più basso perde una vita; chi bussa e perde ne perde due se la casa lo prevede. Vince l’ultimo in vita.', 'minParticipants' => 3, 'maxParticipants' => 9, 'masterPlaysDefault' => true, 'sort' => 110],
        ['defaultLives' => 3, 'targetPoints' => 0, 'allowTeams' => false, 'allowLateJoin' => false, 'outcomes' => [], 'allowCustomDelta' => false, 'id' => 'picozzo', 'name' => 'Picozzo', 'mode' => 'lives', 'room' => 'arcade', 'icon' => '⛏', 'description' => 'Gioco popolare a vite con regole della casa: il master tiene la tabella e toglie le vite a chi perde la mano. Vince l’ultimo rimasto.', 'minParticipants' => 3, 'maxParticipants' => 10, 'masterPlaysDefault' => true, 'sort' => 120],
        ['defaultLives' => 3, 'targetPoints' => 0, 'allowTeams' => false, 'allowLateJoin' => false, 'outcomes' => [], 'allowCustomDelta' => false, 'id' => 'cucu', 'name' => 'Cucù', 'mode' => 'lives', 'room' => 'arcade', 'icon' => '🐦', 'description' => 'Una carta a testa, si scambia o si tiene: chi resta con la carta più bassa perde una vita.', 'minParticipants' => 3, 'maxParticipants' => 20, 'masterPlaysDefault' => true, 'sort' => 130],
        ['defaultLives' => 5, 'targetPoints' => 0, 'allowTeams' => false, 'allowLateJoin' => false, 'outcomes' => [], 'allowCustomDelta' => false, 'id' => 'vite_libero', 'name' => 'Gioco libero a vite', 'mode' => 'lives', 'room' => 'arcade', 'icon' => '♥', 'description' => 'Qualsiasi gioco a eliminazione: scegli quante vite e il master le gestisce.', 'minParticipants' => 3, 'maxParticipants' => 20, 'masterPlaysDefault' => true, 'sort' => 190],
        ['defaultLives' => 0, 'targetPoints' => 11, 'allowTeams' => true, 'allowLateJoin' => false, 'outcomes' => [], 'allowCustomDelta' => false, 'id' => 'scopa', 'name' => 'Scopa', 'mode' => 'points', 'room' => 'arcade', 'icon' => '🧹', 'description' => 'In due o a coppie (2 contro 2). Si segnano scope, carte, denari, settebello e primiera fino a 11.', 'minParticipants' => 2, 'maxParticipants' => 4, 'masterPlaysDefault' => true, 'sort' => 210],
        ['defaultLives' => 0, 'targetPoints' => 2, 'allowTeams' => true, 'allowLateJoin' => false, 'outcomes' => [], 'allowCustomDelta' => false, 'id' => 'briscola', 'name' => 'Briscola', 'mode' => 'points', 'room' => 'arcade', 'icon' => '🃏', 'description' => 'In due o a coppie. Ogni mano vinta vale 1 punto: si gioca al meglio delle 3 (2 punti).', 'minParticipants' => 2, 'maxParticipants' => 4, 'masterPlaysDefault' => true, 'sort' => 220],
        ['defaultLives' => 0, 'targetPoints' => 21, 'allowTeams' => true, 'allowLateJoin' => false, 'outcomes' => [], 'allowCustomDelta' => false, 'id' => 'tressette', 'name' => 'Tressette', 'mode' => 'points', 'room' => 'arcade', 'icon' => '3️⃣', 'description' => 'A coppie o in due: si segnano i punti di ogni mano fino a 21.', 'minParticipants' => 2, 'maxParticipants' => 4, 'masterPlaysDefault' => true, 'sort' => 230],
        ['defaultLives' => 0, 'targetPoints' => 2005, 'allowTeams' => true, 'allowLateJoin' => false, 'outcomes' => [], 'allowCustomDelta' => false, 'id' => 'burraco', 'name' => 'Burraco', 'mode' => 'points', 'room' => 'arcade', 'icon' => '🀄', 'description' => 'In due o a coppie: si sommano i punti delle smazzate fino a 2005.', 'minParticipants' => 2, 'maxParticipants' => 4, 'masterPlaysDefault' => true, 'sort' => 240],
    ];
}
