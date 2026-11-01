-- =====================================================================================
-- Party Casinò — schema iniziale (Supabase / PostgreSQL 15+)
--
-- Principi:
--  * le fiches si muovono SOLO tramite funzioni RPC "security definer", in transazione,
--    con un registro (chip_ledger) append-only: ogni saldo è ricostruibile;
--  * i client hanno solo SELECT (filtrata da RLS); INSERT/UPDATE/DELETE sono revocati;
--  * i token di ingresso NFC/QR e i pass personali non sono mai leggibili da altri utenti;
--  * le regole replicano src/core/rules.ts (stessi messaggi d'errore).
-- =====================================================================================

create schema if not exists internal;
revoke all on schema internal from public;

-- ------------------------------------------------------------------------------ tabelle

create table public.app_settings (
  id int primary key default 1 check (id = 1),
  daily_bonus_base int not null default 100 check (daily_bonus_base >= 0),
  starting_chips int not null default 1000 check (starting_chips >= 0),
  wheel numeric[] not null default '{1,1.5,1,2,1,3,1.5,5}',
  streak_bonus_pct int not null default 10 check (streak_bonus_pct >= 0),
  max_streak int not null default 7 check (max_streak >= 1),
  join_token_ttl_seconds int not null default 120 check (join_token_ttl_seconds >= 0),
  allow_qr_fallback boolean not null default true,
  timezone text not null default 'Europe/Rome'
);
insert into public.app_settings default values;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_.]{3,20}$'),
  display_name text not null check (char_length(display_name) between 1 and 30),
  avatar text not null default '🎲' check (char_length(avatar) <= 8),
  color text not null default '#d4af37',
  bio text not null default '' check (char_length(bio) <= 160),
  role text not null default 'player' check (role in ('player', 'game_master', 'staff')),
  chips bigint not null default 0 check (chips >= 0),
  banned boolean not null default false,
  last_bonus_date date,
  bonus_streak int not null default 0,
  created_at timestamptz not null default now()
);

create table public.player_passes (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  token text not null unique
);

create table public.games (
  id text primary key check (id ~ '^[a-z0-9_]{2,30}$'),
  name text not null check (char_length(name) between 1 and 40),
  mode text not null check (mode in ('chips', 'lives', 'points')),
  room text not null check (room in ('casino', 'arcade')),
  icon text not null default '🎲',
  description text not null default '',
  min_participants int not null check (min_participants >= 2),
  max_participants int not null,
  default_lives int not null default 0,
  target_points int not null default 0,
  master_plays_default boolean not null default false,
  allow_teams boolean not null default false,
  allow_late_join boolean not null default false,
  outcomes jsonb not null default '[]',
  allow_custom_delta boolean not null default false,
  enabled boolean not null default true,
  sort int not null default 100,
  check (max_participants >= min_participants)
);

create table public.gm_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  motivation text not null check (char_length(motivation) between 10 and 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note text not null default '',
  reviewed_by uuid,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  constraint gm_requests_user_fk foreign key (user_id) references public.profiles (id) on delete cascade,
  constraint gm_requests_reviewer_fk foreign key (reviewed_by) references public.profiles (id) on delete set null
);
create unique index gm_requests_one_pending on public.gm_requests (user_id) where status = 'pending';

create table public.game_tables (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  game_id text not null references public.games (id),
  master_id uuid not null,
  status text not null default 'lobby' check (status in ('lobby', 'playing', 'closed', 'cancelled')),
  settlement text not null default 'live' check (settlement in ('live', 'on_close')),
  master_plays boolean not null default false,
  starting_lives int not null default 0,
  target_points int not null default 0,
  min_bet int not null default 0 check (min_bet >= 0),
  max_bet int not null default 0 check (max_bet >= 0),
  use_teams boolean not null default false,
  round_count int not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  closed_at timestamptz,
  constraint game_tables_master_fk foreign key (master_id) references public.profiles (id)
);
create unique index game_tables_active_code on public.game_tables (code) where status in ('lobby', 'playing');
create index game_tables_status on public.game_tables (status, created_at desc);

create table public.table_join_tokens (
  table_id uuid not null references public.game_tables (id) on delete cascade,
  kind text not null check (kind in ('nfc', 'static', 'qr')),
  token text not null,
  expires_at timestamptz,
  primary key (table_id, kind)
);

create table public.table_participants (
  table_id uuid not null references public.game_tables (id) on delete cascade,
  user_id uuid not null,
  is_master boolean not null default false,
  is_playing boolean not null default true,
  joined_via text not null check (joined_via in ('nfc_table', 'nfc_pass', 'qr', 'code', 'master')),
  lives int not null default 0,
  score int not null default 0,
  team text check (team in ('A', 'B')),
  pending_delta bigint not null default 0,
  net_delta bigint not null default 0,
  eliminated_at timestamptz,
  elimination_order int,
  placement int,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (table_id, user_id),
  constraint table_participants_user_fk foreign key (user_id) references public.profiles (id) on delete cascade
);
create index table_participants_user on public.table_participants (user_id);

create table public.rounds (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.game_tables (id) on delete cascade,
  number int not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  effects jsonb not null,
  undone boolean not null default false,
  unique (table_id, number)
);

create table public.chip_ledger (
  id bigserial primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  delta bigint not null,
  balance_after bigint not null,
  kind text not null check (kind in ('signup', 'daily_bonus', 'table_round', 'table_settlement', 'admin_adjust', 'undo')),
  table_id uuid references public.game_tables (id) on delete set null,
  note text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index chip_ledger_user on public.chip_ledger (user_id, id desc);

create table public.audit_log (
  id bigserial primary key,
  actor_id uuid,
  action text not null,
  target text not null default '',
  details jsonb not null default '{}',
  created_at timestamptz not null default now(),
  constraint audit_log_actor_fk foreign key (actor_id) references public.profiles (id) on delete set null
);

-- ------------------------------------------------------------------------------ seed giochi

insert into public.games
  (id, name, mode, room, icon, description, min_participants, max_participants, default_lives, target_points,
   master_plays_default, allow_teams, allow_late_join, outcomes, allow_custom_delta, sort)
values
  ('blackjack', 'Blackjack', 'chips', 'casino', '🂡',
   'Il master è il banco. A ogni mano registra puntata ed esito di ogni giocatore: le fiches si muovono in automatico.',
   3, 8, 0, 0, false, false, true,
   '[{"key":"lose","label":"Persa","mult":-1},{"key":"push","label":"Pari","mult":0},{"key":"win","label":"Vinta","mult":1},{"key":"blackjack","label":"Blackjack 3:2","mult":1.5},{"key":"double_win","label":"Raddoppio vinto","mult":2},{"key":"double_lose","label":"Raddoppio perso","mult":-2},{"key":"surrender","label":"Resa","mult":-0.5}]',
   true, 10),
  ('sette_e_mezzo', 'Sette e mezzo', 'chips', 'casino', '7½',
   'Classico natalizio: il master tiene il banco, chi sballa paga. Il sette e mezzo reale paga doppio.',
   3, 10, 0, 0, false, false, true,
   '[{"key":"lose","label":"Persa","mult":-1},{"key":"win","label":"Vinta","mult":1},{"key":"reale","label":"Sette e mezzo reale","mult":2}]',
   true, 20),
  ('roulette', 'Roulette', 'chips', 'casino', '🎡',
   'Il croupier registra la puntata e il tipo di vincita di ciascun giocatore.',
   3, 12, 0, 0, false, false, true,
   '[{"key":"lose","label":"Persa","mult":-1},{"key":"simple","label":"Chance semplice 1:1","mult":1},{"key":"dozen","label":"Dozzina/Colonna 2:1","mult":2},{"key":"six","label":"Sestina 5:1","mult":5},{"key":"split","label":"Cavallo 17:1","mult":17},{"key":"straight","label":"Pieno 35:1","mult":35}]',
   true, 30),
  ('baccarat', 'Baccarat', 'chips', 'casino', '♦',
   'Punto, Banco o Pareggio: il master registra le puntate e gli esiti.',
   3, 8, 0, 0, false, false, true,
   '[{"key":"lose","label":"Persa","mult":-1},{"key":"player","label":"Punto 1:1","mult":1},{"key":"banker","label":"Banco 0,95:1","mult":0.95},{"key":"tie","label":"Pareggio 8:1","mult":8}]',
   true, 40),
  ('poker', 'Poker (cash game)', 'chips', 'casino', '♠',
   'Il master fa da dealer e registra il risultato netto di ogni giocatore a fine mano (la somma dovrebbe essere zero).',
   3, 10, 0, 0, false, false, true, '[]', true, 50),
  ('trentuno', 'Trentuno (31)', 'lives', 'arcade', '31',
   'Ognuno parte con 3 vite. A ogni smazzata chi ha il punteggio più basso perde una vita; chi bussa e perde ne perde due se la casa lo prevede. Vince l’ultimo in vita.',
   3, 9, 3, 0, true, false, false, '[]', false, 110),
  ('picozzo', 'Picozzo', 'lives', 'arcade', '⛏',
   'Gioco popolare a vite con regole della casa: il master tiene la tabella e toglie le vite a chi perde la mano. Vince l’ultimo rimasto.',
   3, 10, 3, 0, true, false, false, '[]', false, 120),
  ('cucu', 'Cucù', 'lives', 'arcade', '🐦',
   'Una carta a testa, si scambia o si tiene: chi resta con la carta più bassa perde una vita.',
   3, 20, 3, 0, true, false, false, '[]', false, 130),
  ('vite_libero', 'Gioco libero a vite', 'lives', 'arcade', '♥',
   'Qualsiasi gioco a eliminazione: scegli quante vite e il master le gestisce.',
   3, 20, 5, 0, true, false, false, '[]', false, 190),
  ('scopa', 'Scopa', 'points', 'arcade', '🧹',
   'In due o a coppie (2 contro 2). Si segnano scope, carte, denari, settebello e primiera fino a 11.',
   2, 4, 0, 11, true, true, false, '[]', false, 210),
  ('briscola', 'Briscola', 'points', 'arcade', '🃏',
   'In due o a coppie. Ogni mano vinta vale 1 punto: si gioca al meglio delle 3 (2 punti).',
   2, 4, 0, 2, true, true, false, '[]', false, 220),
  ('tressette', 'Tressette', 'points', 'arcade', '3️⃣',
   'A coppie o in due: si segnano i punti di ogni mano fino a 21.',
   2, 4, 0, 21, true, true, false, '[]', false, 230),
  ('burraco', 'Burraco', 'points', 'arcade', '🀄',
   'In due o a coppie: si sommano i punti delle smazzate fino a 2005.',
   2, 4, 0, 2005, true, true, false, '[]', false, 240);

-- ------------------------------------------------------------------------------ helper interni

create or replace function internal.fail(p_code text, p_message text)
returns void language plpgsql as $$
begin
  raise exception using errcode = 'P0001', message = p_message, hint = p_code;
end $$;

-- stringa casuale da un alfabeto, usando l'entropia di gen_random_uuid() (CSPRNG del server)
create or replace function internal.rand_string(p_len int, p_alphabet text)
returns text language plpgsql volatile as $$
declare
  b bytea;
  result text := '';
  i int := 0;
  n int := length(p_alphabet);
begin
  while length(result) < p_len loop
    if i % 16 = 0 then b := uuid_send(gen_random_uuid()); end if;
    if (i % 16) not in (6, 8) then -- byte di versione/variante: non casuali
      result := result || substr(p_alphabet, (get_byte(b, i % 16) % n) + 1, 1);
    end if;
    i := i + 1;
  end loop;
  return result;
end $$;

create or replace function internal.new_token(p_len int default 20)
returns text language sql volatile as $$
  select internal.rand_string(p_len, 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789');
$$;

create or replace function internal.me(p_require_active boolean default true)
returns public.profiles language plpgsql as $$
declare p public.profiles;
begin
  select * into p from public.profiles where id = auth.uid();
  if not found then perform internal.fail('auth', 'Devi accedere per continuare.'); end if;
  if p_require_active and p.banned then
    perform internal.fail('banned', 'Il tuo account è sospeso. Contatta lo staff.');
  end if;
  return p;
end $$;

create or replace function internal.require_staff()
returns public.profiles language plpgsql as $$
declare p public.profiles;
begin
  p := internal.me();
  if p.role <> 'staff' then perform internal.fail('forbidden', 'Operazione riservata allo staff.'); end if;
  return p;
end $$;

create or replace function internal.lock_table_as_master(p_table uuid)
returns public.game_tables language plpgsql as $$
declare
  t public.game_tables;
  me public.profiles;
begin
  me := internal.me();
  select * into t from public.game_tables where id = p_table for update;
  if not found then perform internal.fail('not_found', 'Tavolo non trovato.'); end if;
  if t.master_id <> me.id and me.role <> 'staff' then
    perform internal.fail('forbidden', 'Solo il game master del tavolo può farlo.');
  end if;
  return t;
end $$;

create or replace function internal.audit(p_actor uuid, p_action text, p_target text, p_details jsonb default '{}')
returns void language sql as $$
  insert into public.audit_log (actor_id, action, target, details) values (p_actor, p_action, coalesce(p_target, ''), coalesce(p_details, '{}'));
$$;

-- unico punto in cui cambia un saldo
create or replace function internal.apply_ledger(
  p_user uuid, p_delta bigint, p_kind text, p_note text, p_table uuid, p_by uuid
) returns bigint language plpgsql as $$
declare
  cur bigint;
  nm text;
begin
  select chips, display_name into cur, nm from public.profiles where id = p_user for update;
  if not found then perform internal.fail('not_found', 'Utente non trovato.'); end if;
  if cur + p_delta < 0 then perform internal.fail('chips', nm || ' non ha abbastanza fiches.'); end if;
  update public.profiles set chips = cur + p_delta where id = p_user;
  insert into public.chip_ledger (user_id, delta, balance_after, kind, table_id, note, created_by)
  values (p_user, p_delta, cur + p_delta, p_kind, p_table, coalesce(p_note, ''), p_by);
  return cur + p_delta;
end $$;

create or replace function internal.active_table_of(p_user uuid)
returns public.game_tables language sql stable as $$
  select gt.* from public.table_participants tp
  join public.game_tables gt on gt.id = tp.table_id
  where tp.user_id = p_user and tp.left_at is null and gt.status in ('lobby', 'playing')
  limit 1;
$$;

create or replace function internal.add_participant(t public.game_tables, p_user uuid, p_via text)
returns void language plpgsql as $$
declare
  u public.profiles;
  ex public.table_participants;
  g public.games;
  busy public.game_tables;
  cnt int;
begin
  perform pg_advisory_xact_lock(hashtext('user-seat:' || p_user::text));
  select * into u from public.profiles where id = p_user;
  if not found then perform internal.fail('not_found', 'Utente non trovato.'); end if;
  if u.banned then perform internal.fail('banned', u.display_name || ' è sospeso e non può giocare.'); end if;
  select * into ex from public.table_participants where table_id = t.id and user_id = p_user;
  if found then
    if ex.left_at is null then return; end if;
    perform internal.fail('left', u.display_name || ' ha già lasciato questo tavolo.');
  end if;
  busy := internal.active_table_of(p_user);
  if busy.id is not null then
    perform internal.fail('busy', format('%s è già seduto al tavolo "%s".', u.display_name, busy.name));
  end if;
  select * into g from public.games where id = t.game_id;
  if t.status in ('closed', 'cancelled') then perform internal.fail('join', 'Il tavolo è chiuso.'); end if;
  if t.status = 'playing' and not g.allow_late_join then perform internal.fail('join', 'La partita è già iniziata.'); end if;
  select count(*) into cnt from public.table_participants where table_id = t.id and left_at is null;
  if cnt >= g.max_participants then perform internal.fail('join', 'Il tavolo è al completo.'); end if;
  insert into public.table_participants (table_id, user_id, is_master, is_playing, joined_via, lives)
  values (t.id, p_user, false, true, p_via, t.starting_lives);
end $$;

create or replace function internal.push_round(t public.game_tables, p_by uuid, p_effects jsonb)
returns void language plpgsql as $$
declare n int;
begin
  if p_effects is null or jsonb_array_length(p_effects) = 0 then
    perform internal.fail('round', 'Nessuna variazione da registrare.');
  end if;
  update public.game_tables set round_count = round_count + 1 where id = t.id returning round_count into n;
  insert into public.rounds (table_id, number, created_by, effects) values (t.id, n, p_by, p_effects);
end $$;

create or replace function internal.settle_pending(t public.game_tables, p_user uuid, p_by uuid)
returns void language plpgsql as $$
declare
  pend bigint;
  cur bigint;
  d bigint;
begin
  select pending_delta into pend from public.table_participants where table_id = t.id and user_id = p_user for update;
  if pend is null or pend = 0 then return; end if;
  select chips into cur from public.profiles where id = p_user for update;
  d := greatest(pend, -cur);
  if d <> 0 then
    perform internal.apply_ledger(p_user, d, 'table_settlement', t.name || ' · chiusura conto', t.id, p_by);
  end if;
  update public.table_participants set pending_delta = 0 where table_id = t.id and user_id = p_user;
end $$;

create or replace function internal.remove_participant(t public.game_tables, p_user uuid, p_by uuid)
returns void language plpgsql as $$
declare
  p public.table_participants;
  g public.games;
begin
  select * into p from public.table_participants where table_id = t.id and user_id = p_user for update;
  if not found or p.left_at is not null then perform internal.fail('participant', 'Il giocatore non è al tavolo.'); end if;
  if p.is_master then perform internal.fail('master', 'Il game master non può lasciare il tavolo: chiudilo.'); end if;
  if t.status = 'lobby' then
    delete from public.table_participants where table_id = t.id and user_id = p_user;
    return;
  end if;
  if t.status <> 'playing' then perform internal.fail('status', 'Il tavolo è chiuso.'); end if;
  perform internal.settle_pending(t, p_user, p_by);
  select * into g from public.games where id = t.game_id;
  if g.mode = 'lives' and p.lives > 0 then
    update public.table_participants
      set lives = 0, eliminated_at = now(), elimination_order = t.round_count
      where table_id = t.id and user_id = p_user;
  end if;
  update public.table_participants set left_at = now() where table_id = t.id and user_id = p_user;
end $$;

create or replace function internal.lite(p public.profiles)
returns jsonb language sql immutable as $$
  select jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name, 'avatar', p.avatar,
                            'color', p.color, 'role', p.role, 'chips', p.chips);
$$;

-- ------------------------------------------------------------------------------ registrazione

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, internal, pg_temp as $$
declare
  uname text;
  dname text;
  s public.app_settings;
begin
  uname := lower(coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1), 'giocatore'));
  uname := left(regexp_replace(uname, '[^a-z0-9_.]', '', 'g'), 20);
  if length(uname) < 3 then uname := uname || internal.rand_string(5, 'abcdefghijkmnpqrstuvwxyz23456789'); end if;
  if exists (select 1 from public.profiles where username = uname) then
    uname := left(uname, 14) || internal.rand_string(6, 'abcdefghijkmnpqrstuvwxyz23456789');
  end if;
  dname := left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), uname), 30);
  select * into s from public.app_settings where id = 1;
  insert into public.profiles (id, username, display_name) values (new.id, uname, dname);
  insert into public.player_passes (user_id, token) values (new.id, internal.new_token(20));
  perform internal.apply_ledger(new.id, s.starting_chips, 'signup', 'Fiches di benvenuto', null, null);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.username_available(p_username text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select p_username ~ '^[a-z0-9_.]{3,20}$' and not exists (select 1 from public.profiles where username = p_username);
$$;

-- ------------------------------------------------------------------------------ profilo, bonus, pass

create or replace function public.update_my_profile(
  p_display_name text default null, p_avatar text default null, p_color text default null, p_bio text default null
) returns public.profiles language plpgsql security definer set search_path = public, internal, pg_temp as $$
declare me public.profiles;
begin
  me := internal.me(false);
  if p_display_name is not null and char_length(trim(p_display_name)) not between 1 and 30 then
    perform internal.fail('name', 'Il nome deve avere tra 1 e 30 caratteri.');
  end if;
  update public.profiles set
    display_name = coalesce(trim(p_display_name), display_name),
    avatar = coalesce(left(p_avatar, 8), avatar),
    color = coalesce(p_color, color),
    bio = coalesce(left(p_bio, 160), bio)
  where id = me.id
  returning * into me;
  return me;
end $$;

create or replace function public.claim_daily_bonus()
returns jsonb language plpgsql security definer set search_path = public, internal, pg_temp as $$
declare
  me public.profiles;
  s public.app_settings;
  today date;
  streak int;
  seg int;
  mult numeric;
  amount bigint;
  bal bigint;
begin
  me := internal.me();
  select * into me from public.profiles where id = me.id for update;
  select * into s from public.app_settings where id = 1;
  today := (now() at time zone s.timezone)::date;
  if me.last_bonus_date = today then
    perform internal.fail('bonus', 'Hai già ritirato il bonus di oggi. Torna domani!');
  end if;
  streak := case when me.last_bonus_date = today - 1 then least(me.bonus_streak + 1, s.max_streak) else 1 end;
  seg := floor(random() * array_length(s.wheel, 1))::int; -- 0-based
  mult := s.wheel[seg + 1];
  amount := round(s.daily_bonus_base * mult * (1 + (s.streak_bonus_pct / 100.0) * (streak - 1)));
  update public.profiles set last_bonus_date = today, bonus_streak = streak where id = me.id;
  bal := internal.apply_ledger(me.id, amount, 'daily_bonus', format('Bonus giornaliero x%s (serie %s)', mult, streak), null, null);
  return jsonb_build_object('amount', amount, 'multiplier', mult, 'segment', seg, 'streak', streak, 'balance', bal);
end $$;

create or replace function public.get_my_pass()
returns text language plpgsql security definer set search_path = public, internal, pg_temp as $$
declare me public.profiles; tok text;
begin
  me := internal.me(false);
  select token into tok from public.player_passes where user_id = me.id;
  return tok;
end $$;

create or replace function public.rotate_my_pass()
returns text language plpgsql security definer set search_path = public, internal, pg_temp as $$
declare me public.profiles; tok text := internal.new_token(20);
begin
  me := internal.me(false);
  update public.player_passes set token = tok where user_id = me.id;
  perform internal.audit(me.id, 'pass_rotate', me.username);
  return tok;
end $$;

-- ------------------------------------------------------------------------------ richieste GM

create or replace function public.request_game_master(p_motivation text)
returns public.gm_requests language plpgsql security definer set search_path = public, internal, pg_temp as $$
declare me public.profiles; r public.gm_requests;
begin
  me := internal.me();
  if me.role <> 'player' then perform internal.fail('gm', 'Sei già autorizzato a condurre tavoli.'); end if;
  if exists (select 1 from public.gm_requests where user_id = me.id and status = 'pending') then
    perform internal.fail('gm', 'Hai già una richiesta in attesa.');
  end if;
  if char_length(trim(coalesce(p_motivation, ''))) < 10 then
    perform internal.fail('gm', 'Scrivi almeno due righe di motivazione (10 caratteri).');
  end if;
  insert into public.gm_requests (user_id, motivation) values (me.id, left(trim(p_motivation), 500)) returning * into r;
  perform internal.audit(me.id, 'gm_request', me.username);
  return r;
end $$;

-- ------------------------------------------------------------------------------ tavoli

create or replace function public.create_table(
  p_game_id text, p_name text, p_settlement text, p_master_plays boolean, p_starting_lives int,
  p_target_points int, p_min_bet int, p_max_bet int, p_use_teams boolean
) returns uuid language plpgsql security definer set search_path = public, internal, pg_temp as $$
declare
  me public.profiles;
  g public.games;
  busy public.game_tables;
  t public.game_tables;
  c text;
begin
  me := internal.me();
  if me.role not in ('game_master', 'staff') then
    perform internal.fail('forbidden', 'Solo i game master autorizzati dallo staff possono aprire un tavolo.');
  end if;
  perform pg_advisory_xact_lock(hashtext('user-seat:' || me.id::text));
  busy := internal.active_table_of(me.id);
  if busy.id is not null then
    perform internal.fail('busy', format('Sei già al tavolo "%s". Chiudilo o lascialo prima di aprirne un altro.', busy.name));
  end if;
  select * into g from public.games where id = p_game_id;
  if not found then perform internal.fail('not_found', 'Gioco non trovato.'); end if;
  if not g.enabled then perform internal.fail('game', 'Questo gioco è disattivato dallo staff.'); end if;
  if coalesce(p_min_bet, 0) < 0 or coalesce(p_max_bet, 0) < 0 then perform internal.fail('bet', 'Limiti di puntata non validi.'); end if;
  if coalesce(p_max_bet, 0) > 0 and p_max_bet < coalesce(p_min_bet, 0) then
    perform internal.fail('bet', 'La puntata massima deve superare la minima.');
  end if;
  if g.mode = 'lives' and coalesce(p_starting_lives, 0) not between 1 and 20 then
    perform internal.fail('lives', 'Le vite iniziali devono essere tra 1 e 20.');
  end if;
  if g.mode = 'points' and coalesce(p_target_points, 0) < 1 then perform internal.fail('points', 'Imposta un punteggio obiettivo.'); end if;
  loop
    c := internal.rand_string(5, 'ABCDEFGHJKMNPQRSTUVWXYZ23456789');
    exit when not exists (select 1 from public.game_tables where code = c and status in ('lobby', 'playing'));
  end loop;
  insert into public.game_tables (code, name, game_id, master_id, settlement, master_plays, starting_lives, target_points,
                                  min_bet, max_bet, use_teams)
  values (
    c,
    coalesce(nullif(left(trim(p_name), 40), ''), left(g.name || ' · ' || me.display_name, 40)),
    g.id, me.id,
    case when g.mode = 'chips' then coalesce(p_settlement, 'live') else 'live' end,
    case when g.mode = 'chips' then false else coalesce(p_master_plays, true) end,
    case when g.mode = 'lives' then p_starting_lives else 0 end,
    case when g.mode = 'points' then p_target_points else 0 end,
    case when g.mode = 'chips' then coalesce(p_min_bet, 0) else 0 end,
    case when g.mode = 'chips' then coalesce(p_max_bet, 0) else 0 end,
    g.allow_teams and coalesce(p_use_teams, false)
  ) returning * into t;
  insert into public.table_participants (table_id, user_id, is_master, is_playing, joined_via, lives)
  values (t.id, me.id, true, t.master_plays, 'master', t.starting_lives);
  perform internal.audit(me.id, 'table_open', t.code, jsonb_build_object('game', g.id, 'name', t.name));
  return t.id;
end $$;

create or replace function public.issue_join_token(p_table uuid, p_kind text)
returns jsonb language plpgsql security definer set search_path = public, internal, pg_temp as $$
declare
  t public.game_tables;
  s public.app_settings;
  tok text;
  exp timestamptz;
begin
  t := internal.lock_table_as_master(p_table);
  if t.status not in ('lobby', 'playing') then perform internal.fail('status', 'Il tavolo è chiuso.'); end if;
  if p_kind not in ('nfc', 'static', 'qr') then perform internal.fail('kind', 'Tipo di token non valido.'); end if;
  select * into s from public.app_settings where id = 1;
  if p_kind = 'qr' and not s.allow_qr_fallback then
    perform internal.fail('qr', 'Lo staff ha disattivato l’ingresso con QR/PIN: usa l’NFC.');
  end if;
  tok := case when p_kind = 'qr' then internal.rand_string(6, '0123456789') else internal.new_token(16) end;
  exp := case when p_kind = 'static' or s.join_token_ttl_seconds <= 0 then null
              else now() + make_interval(secs => s.join_token_ttl_seconds) end;
  insert into public.table_join_tokens (table_id, kind, token, expires_at) values (t.id, p_kind, tok, exp)
  on conflict (table_id, kind) do update set token = excluded.token, expires_at = excluded.expires_at;
  return jsonb_build_object('token', tok, 'kind', p_kind, 'expires_at', exp);
end $$;

create or replace function public.join_with_token(p_code text, p_token text, p_via text)
returns uuid language plpgsql security definer set search_path = public, internal, pg_temp as $$
declare
  me public.profiles;
  t public.game_tables;
  k text;
  s public.app_settings;
begin
  me := internal.me();
  select * into t from public.game_tables
    where code = upper(trim(p_code)) and status in ('lobby', 'playing') for update;
  if not found then perform internal.fail('not_found', 'Tavolo non trovato o già chiuso.'); end if;
  select kind into k from public.table_join_tokens
    where table_id = t.id and token = trim(p_token) and (expires_at is null or expires_at > now());
  if k is null then
    perform internal.fail('token', 'Codice scaduto o non valido: avvicina di nuovo il telefono al tavolo.');
  end if;
  select * into s from public.app_settings where id = 1;
  if k = 'qr' and not s.allow_qr_fallback then perform internal.fail('qr', 'Ingresso con QR/PIN disattivato.'); end if;
  if p_via not in ('nfc_table', 'qr', 'code') then p_via := 'code'; end if;
  perform internal.add_participant(t, me.id, p_via);
  perform internal.audit(me.id, 'table_join', t.code, jsonb_build_object('via', p_via));
  return t.id;
end $$;

create or replace function public.add_player_by_pass(p_table uuid, p_pass text)
returns jsonb language plpgsql security definer set search_path = public, internal, pg_temp as $$
declare
  t public.game_tables;
  uid uuid;
  u public.profiles;
begin
  t := internal.lock_table_as_master(p_table);
  select user_id into uid from public.player_passes where token = trim(p_pass);
  if uid is null then perform internal.fail('pass', 'Pass non riconosciuto.'); end if;
  perform internal.add_participant(t, uid, 'nfc_pass');
  select * into u from public.profiles where id = uid;
  perform internal.audit(auth.uid(), 'table_add_pass', t.code, jsonb_build_object('user', u.username));
  return internal.lite(u);
end $$;

create or replace function public.leave_table(p_table uuid)
returns void language plpgsql security definer set search_path = public, internal, pg_temp as $$
declare me public.profiles; t public.game_tables;
begin
  me := internal.me();
  select * into t from public.game_tables where id = p_table for update;
  if not found then perform internal.fail('not_found', 'Tavolo non trovato.'); end if;
  perform internal.remove_participant(t, me.id, me.id);
end $$;

create or replace function public.kick_participant(p_table uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public, internal, pg_temp as $$
declare t public.game_tables;
begin
  t := internal.lock_table_as_master(p_table);
  perform internal.remove_participant(t, p_user, auth.uid());
end $$;

create or replace function public.set_team(p_table uuid, p_user uuid, p_team text)
returns void language plpgsql security definer set search_path = public, internal, pg_temp as $$
declare t public.game_tables;
begin
  t := internal.lock_table_as_master(p_table);
  if t.status <> 'lobby' then perform internal.fail('status', 'Le squadre si decidono prima di iniziare.'); end if;
  if not t.use_teams then perform internal.fail('team', 'Questo tavolo non prevede squadre.'); end if;
  update public.table_participants set team = p_team where table_id = t.id and user_id = p_user;
  if not found then perform internal.fail('participant', 'Giocatore non presente.'); end if;
end $$;

create or replace function public.start_table(p_table uuid)
returns void language plpgsql security definer set search_path = public, internal, pg_temp as $$
declare
  t public.game_tables;
  g public.games;
  present int;
  players int;
  team_a int;
  team_b int;
begin
  t := internal.lock_table_as_master(p_table);
  if t.status <> 'lobby' then perform internal.fail('status', 'Il tavolo è già avviato o chiuso.'); end if;
  select * into g from public.games where id = t.game_id;
  select count(*), count(*) filter (where is_playing),
         count(*) filter (where is_playing and team = 'A'), count(*) filter (where is_playing and team = 'B')
    into present, players, team_a, team_b
    from public.table_participants where table_id = t.id and left_at is null;
  if present < g.min_participants then
    perform internal.fail('start', format('Servono almeno %s partecipanti (game master incluso): ora siete in %s.', g.min_participants, present));
  end if;
  if g.mode <> 'chips' and players < 2 then perform internal.fail('start', 'Servono almeno 2 giocatori in gara.'); end if;
  if players < 1 then perform internal.fail('start', 'Nessun giocatore al tavolo.'); end if;
  if t.use_teams and (team_a = 0 or team_b = 0 or team_a + team_b <> players) then
    perform internal.fail('start', 'Assegna ogni giocatore alla squadra A o B.');
  end if;
  update public.game_tables set status = 'playing', started_at = now() where id = t.id;
  update public.table_participants set lives = t.starting_lives, score = 0 where table_id = t.id;
  perform internal.audit(auth.uid(), 'table_start', t.code);
end $$;

create or replace function public.record_chips_round(p_table uuid, p_entries jsonb)
returns void language plpgsql security definer set search_path = public, internal, pg_temp as $$
declare
  me public.profiles;
  t public.game_tables;
  g public.games;
  e jsonb;
  o jsonb;
  p public.table_participants;
  u public.profiles;
  uid uuid;
  seen uuid[] := '{}';
  bet bigint;
  delta bigint;
  outcome text;
  available bigint;
  effects jsonb := '[]';
begin
  me := internal.me();
  t := internal.lock_table_as_master(p_table);
  select * into g from public.games where id = t.game_id;
  if t.status <> 'playing' then perform internal.fail('status', 'Il tavolo non è in gioco.'); end if;
  if g.mode <> 'chips' then perform internal.fail('mode', 'Operazione non valida per questo gioco.'); end if;
  for e in select value from jsonb_array_elements(coalesce(p_entries, '[]')) loop
    uid := (e ->> 'userId')::uuid;
    if uid = any (seen) then perform internal.fail('round', 'Ogni giocatore può comparire una sola volta per mano.'); end if;
    seen := seen || uid;
    select * into p from public.table_participants where table_id = t.id and user_id = uid for update;
    if not found or p.left_at is not null or not p.is_playing then
      perform internal.fail('participant', 'Giocatore non presente al tavolo.');
    end if;
    select * into u from public.profiles where id = uid for update;
    bet := coalesce((e ->> 'bet')::bigint, 0);
    if coalesce(e ->> 'outcomeKey', '') <> '' then
      select oc.val into o from jsonb_array_elements(g.outcomes) as oc(val) where oc.val ->> 'key' = e ->> 'outcomeKey';
      if o is null then perform internal.fail('outcome', 'Esito non valido.'); end if;
      if bet <= 0 then perform internal.fail('bet', u.display_name || ': La puntata deve essere un numero intero positivo.'); end if;
      if t.min_bet > 0 and bet < t.min_bet then perform internal.fail('bet', format('%s: Puntata minima: %s.', u.display_name, t.min_bet)); end if;
      if t.max_bet > 0 and bet > t.max_bet then perform internal.fail('bet', format('%s: Puntata massima: %s.', u.display_name, t.max_bet)); end if;
      delta := floor(bet * (o ->> 'mult')::numeric);
      outcome := o ->> 'key';
    else
      if not g.allow_custom_delta then perform internal.fail('outcome', 'Seleziona un esito.'); end if;
      if e ->> 'customDelta' is null then perform internal.fail('outcome', 'Importo non valido.'); end if;
      delta := (e ->> 'customDelta')::bigint;
      outcome := 'custom';
    end if;
    available := u.chips + case when t.settlement = 'on_close' then p.pending_delta else 0 end;
    if delta < 0 and available + delta < 0 then
      perform internal.fail('chips', format('%s non ha abbastanza fiches (disponibili %s).', u.display_name, available));
    end if;
    if t.settlement = 'live' then
      if delta <> 0 then
        perform internal.apply_ledger(uid, delta, 'table_round', format('%s · mano %s', t.name, t.round_count + 1), t.id, me.id);
      end if;
    else
      update public.table_participants set pending_delta = pending_delta + delta where table_id = t.id and user_id = uid;
    end if;
    update public.table_participants set net_delta = net_delta + delta where table_id = t.id and user_id = uid;
    effects := effects || jsonb_build_array(jsonb_build_object('userId', uid, 'chips', delta, 'bet', bet, 'outcome', outcome));
  end loop;
  perform internal.push_round(t, me.id, effects);
end $$;

create or replace function public.record_lives_round(p_table uuid, p_changes jsonb)
returns void language plpgsql security definer set search_path = public, internal, pg_temp as $$
declare
  t public.game_tables;
  g public.games;
  c jsonb;
  p public.table_participants;
  uid uuid;
  d int;
  before_l int;
  after_l int;
  eff jsonb;
  effects jsonb := '[]';
  seen uuid[] := '{}';
begin
  t := internal.lock_table_as_master(p_table);
  select * into g from public.games where id = t.game_id;
  if t.status <> 'playing' then perform internal.fail('status', 'Il tavolo non è in gioco.'); end if;
  if g.mode <> 'lives' then perform internal.fail('mode', 'Operazione non valida per questo gioco.'); end if;
  for c in select value from jsonb_array_elements(coalesce(p_changes, '[]')) loop
    d := coalesce((c ->> 'delta')::int, 0);
    continue when d = 0;
    uid := (c ->> 'userId')::uuid;
    if uid = any (seen) then perform internal.fail('round', 'Giocatore duplicato.'); end if;
    seen := seen || uid;
    select * into p from public.table_participants where table_id = t.id and user_id = uid for update;
    if not found or p.left_at is not null or not p.is_playing then
      perform internal.fail('participant', 'Giocatore non presente al tavolo.');
    end if;
    before_l := p.lives;
    after_l := greatest(0, least(99, before_l + d));
    continue when after_l = before_l;
    eff := jsonb_build_object('userId', uid, 'lives', after_l - before_l);
    if after_l = 0 and before_l > 0 then
      update public.table_participants set eliminated_at = now(), elimination_order = t.round_count + 1
        where table_id = t.id and user_id = uid;
      eff := eff || '{"eliminated": true}';
    end if;
    if before_l = 0 and after_l > 0 then
      eff := eff || jsonb_build_object('prevOrder', p.elimination_order);
      update public.table_participants set eliminated_at = null, elimination_order = null
        where table_id = t.id and user_id = uid;
    end if;
    update public.table_participants set lives = after_l where table_id = t.id and user_id = uid;
    effects := effects || jsonb_build_array(eff);
  end loop;
  perform internal.push_round(t, auth.uid(), effects);
end $$;

create or replace function public.record_points_round(p_table uuid, p_changes jsonb)
returns void language plpgsql security definer set search_path = public, internal, pg_temp as $$
declare
  t public.game_tables;
  g public.games;
  c jsonb;
  pts int;
  uid uuid;
  n int;
  effects jsonb := '[]';
  seen uuid[] := '{}';
begin
  t := internal.lock_table_as_master(p_table);
  select * into g from public.games where id = t.game_id;
  if t.status <> 'playing' then perform internal.fail('status', 'Il tavolo non è in gioco.'); end if;
  if g.mode <> 'points' then perform internal.fail('mode', 'Operazione non valida per questo gioco.'); end if;
  for c in select value from jsonb_array_elements(coalesce(p_changes, '[]')) loop
    pts := coalesce((c ->> 'points')::int, 0);
    continue when pts = 0;
    if t.use_teams then
      if coalesce(c ->> 'team', '') not in ('A', 'B') then perform internal.fail('team', 'Indica la squadra.'); end if;
      for uid in select user_id from public.table_participants
                 where table_id = t.id and is_playing and left_at is null and team = c ->> 'team' loop
        if uid = any (seen) then perform internal.fail('round', 'Giocatore duplicato.'); end if;
        seen := seen || uid;
        update public.table_participants set score = score + pts where table_id = t.id and user_id = uid;
        effects := effects || jsonb_build_array(jsonb_build_object('userId', uid, 'points', pts));
      end loop;
    else
      if c ->> 'userId' is null then perform internal.fail('round', 'Indica il giocatore.'); end if;
      uid := (c ->> 'userId')::uuid;
      if uid = any (seen) then perform internal.fail('round', 'Giocatore duplicato.'); end if;
      seen := seen || uid;
      update public.table_participants set score = score + pts
        where table_id = t.id and user_id = uid and is_playing and left_at is null;
      get diagnostics n = row_count;
      if n = 0 then perform internal.fail('participant', 'Giocatore non presente al tavolo.'); end if;
      effects := effects || jsonb_build_array(jsonb_build_object('userId', uid, 'points', pts));
    end if;
  end loop;
  perform internal.push_round(t, auth.uid(), effects);
end $$;

create or replace function public.undo_last_round(p_table uuid)
returns void language plpgsql security definer set search_path = public, internal, pg_temp as $$
declare
  t public.game_tables;
  r public.rounds;
  e jsonb;
  uid uuid;
  v_chips bigint;
  cur bigint;
  d bigint;
begin
  t := internal.lock_table_as_master(p_table);
  if t.status <> 'playing' then perform internal.fail('status', 'Il tavolo non è in gioco.'); end if;
  select * into r from public.rounds where table_id = t.id and not undone order by number desc limit 1 for update;
  if not found then perform internal.fail('undo', 'Nessuna mano da annullare.'); end if;
  for e in select value from jsonb_array_elements(r.effects) loop
    uid := (e ->> 'userId')::uuid;
    v_chips := coalesce((e ->> 'chips')::bigint, 0);
    if v_chips <> 0 then
      if t.settlement = 'live' then
        select p.chips into cur from public.profiles p where id = uid for update;
        d := greatest(-v_chips, -cur);
        if d <> 0 then
          perform internal.apply_ledger(uid, d, 'undo', format('%s · annullata mano %s', t.name, r.number), t.id, auth.uid());
        end if;
      else
        update public.table_participants set pending_delta = pending_delta - v_chips where table_id = t.id and user_id = uid;
      end if;
      update public.table_participants set net_delta = net_delta - v_chips where table_id = t.id and user_id = uid;
    end if;
    if coalesce((e ->> 'lives')::int, 0) <> 0 then
      update public.table_participants set lives = greatest(0, lives - (e ->> 'lives')::int)
        where table_id = t.id and user_id = uid;
      if coalesce((e ->> 'eliminated')::boolean, false) then
        update public.table_participants set eliminated_at = null, elimination_order = null
          where table_id = t.id and user_id = uid;
      end if;
      if e ? 'prevOrder' then
        update public.table_participants set elimination_order = (e ->> 'prevOrder')::int, eliminated_at = now()
          where table_id = t.id and user_id = uid and lives = 0;
      end if;
    end if;
    if coalesce((e ->> 'points')::int, 0) <> 0 then
      update public.table_participants set score = score - (e ->> 'points')::int where table_id = t.id and user_id = uid;
    end if;
  end loop;
  update public.rounds set undone = true where id = r.id;
end $$;

create or replace function public.close_table(p_table uuid)
returns void language plpgsql security definer set search_path = public, internal, pg_temp as $$
declare
  t public.game_tables;
  g public.games;
  uid uuid;
begin
  t := internal.lock_table_as_master(p_table);
  if t.status not in ('lobby', 'playing') then perform internal.fail('status', 'Il tavolo è già chiuso.'); end if;
  if t.status = 'lobby' then
    update public.game_tables set status = 'cancelled', closed_at = now() where id = t.id;
    return;
  end if;
  select * into g from public.games where id = t.game_id;
  for uid in select user_id from public.table_participants where table_id = t.id loop
    perform internal.settle_pending(t, uid, auth.uid());
  end loop;
  with ranked as (
    select user_id,
           rank() over (order by
             case when g.mode = 'lives' then (case when lives > 0 and left_at is null then 1 else 0 end) else 0 end desc,
             case g.mode
               when 'chips' then net_delta
               when 'points' then score
               else (case when lives > 0 and left_at is null then lives else coalesce(elimination_order, 0) end)
             end desc) as pl
    from public.table_participants
    where table_id = t.id and is_playing
  )
  update public.table_participants tp set placement = ranked.pl
    from ranked where tp.table_id = t.id and tp.user_id = ranked.user_id;
  update public.game_tables set status = 'closed', closed_at = now() where id = t.id;
  delete from public.table_join_tokens where table_id = t.id;
  perform internal.audit(auth.uid(), 'table_close', t.code, jsonb_build_object('rounds', t.round_count));
end $$;

create or replace function public.cancel_table(p_table uuid)
returns void language plpgsql security definer set search_path = public, internal, pg_temp as $$
declare
  t public.game_tables;
  me public.profiles;
begin
  me := internal.me();
  t := internal.lock_table_as_master(p_table);
  if t.status not in ('lobby', 'playing') then perform internal.fail('status', 'Il tavolo è già chiuso.'); end if;
  if me.role <> 'staff' and exists (select 1 from public.rounds where table_id = t.id and not undone) then
    perform internal.fail('cancel', 'Ci sono mani registrate: chiudi il tavolo oppure chiedi allo staff di annullarlo.');
  end if;
  update public.table_participants set pending_delta = 0 where table_id = t.id;
  update public.game_tables set status = 'cancelled', closed_at = now() where id = t.id;
  delete from public.table_join_tokens where table_id = t.id;
  perform internal.audit(me.id, 'table_cancel', t.code);
end $$;

-- ------------------------------------------------------------------------------ statistiche pubbliche

create or replace function public.get_player_stats(p_user uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with parts as (
    select tp.*, gt.game_id, gt.name as table_name, gt.closed_at, g.mode
    from public.table_participants tp
    join public.game_tables gt on gt.id = tp.table_id
    join public.games g on g.id = gt.game_id
    where tp.user_id = p_user and gt.status = 'closed'
  ),
  scored as (
    select *, (is_playing and placement = 1 and (mode <> 'chips' or net_delta > 0)) as won from parts
  )
  select jsonb_build_object(
    'userId', p_user,
    'gamesPlayed', count(*) filter (where is_playing),
    'wins', count(*) filter (where won),
    'chipsWon', coalesce(sum(net_delta) filter (where is_playing and net_delta > 0), 0),
    'chipsLost', coalesce(-sum(net_delta) filter (where is_playing and net_delta < 0), 0),
    'biggestWin', greatest(0, coalesce(max(net_delta) filter (where is_playing), 0)),
    'tablesMastered', count(*) filter (where is_master),
    'winsByMode', jsonb_build_object(
      'chips', count(*) filter (where won and mode = 'chips'),
      'lives', count(*) filter (where won and mode = 'lives'),
      'points', count(*) filter (where won and mode = 'points')),
    'byGame', coalesce((
      select jsonb_agg(jsonb_build_object('gameId', game_id, 'played', played, 'wins', wins, 'net', net) order by played desc)
      from (select game_id, count(*) as played, count(*) filter (where won) as wins, sum(net_delta) as net
            from scored where is_playing group by game_id) x), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object(
        'tableId', table_id, 'tableName', table_name, 'gameId', game_id, 'mode', mode, 'closedAt', closed_at,
        'placement', placement, 'netDelta', net_delta, 'wasMaster', is_master and not is_playing, 'won', won)
        order by closed_at desc)
      from (select * from scored order by closed_at desc limit 12) r), '[]'::jsonb)
  )
  from scored;
$$;

create or replace function public.leaderboard(p_kind text, p_limit int default 50)
returns table (id uuid, username text, display_name text, avatar text, color text, role text, chips bigint, value bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  with agg as (
    select tp.user_id,
           count(*) filter (where tp.is_playing) as games,
           count(*) filter (where tp.is_playing and tp.placement = 1 and (g.mode <> 'chips' or tp.net_delta > 0)) as wins
    from public.table_participants tp
    join public.game_tables gt on gt.id = tp.table_id and gt.status = 'closed'
    join public.games g on g.id = gt.game_id
    group by tp.user_id
  )
  select p.id, p.username, p.display_name, p.avatar, p.color, p.role, p.chips,
         case p_kind when 'wins' then coalesce(a.wins, 0) when 'games' then coalesce(a.games, 0) else p.chips end as value
  from public.profiles p left join agg a on a.user_id = p.id
  where not p.banned
  order by value desc, p.username
  limit least(coalesce(p_limit, 50), 200);
$$;

-- ------------------------------------------------------------------------------ amministrazione

create or replace function public.admin_overview()
returns jsonb language plpgsql stable security definer set search_path = public, internal, pg_temp as $$
declare s public.app_settings;
begin
  perform internal.require_staff();
  select * into s from public.app_settings where id = 1;
  return jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'activeTables', (select count(*) from public.game_tables where status in ('lobby', 'playing')),
    'chipsInCirculation', (select coalesce(sum(chips), 0) from public.profiles),
    'pendingGmRequests', (select count(*) from public.gm_requests where status = 'pending'),
    'tablesToday', (select count(*) from public.game_tables
                    where (created_at at time zone s.timezone)::date = (now() at time zone s.timezone)::date),
    'bannedUsers', (select count(*) from public.profiles where banned)
  );
end $$;

create or replace function public.admin_set_role(p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public, internal, pg_temp as $$
declare me public.profiles; old_role text; uname text;
begin
  me := internal.require_staff();
  if p_user = me.id and p_role <> 'staff' then perform internal.fail('self', 'Non puoi rimuovere il tuo ruolo staff.'); end if;
  select role, username into old_role, uname from public.profiles where id = p_user for update;
  if not found then perform internal.fail('not_found', 'Utente non trovato.'); end if;
  update public.profiles set role = p_role where id = p_user;
  perform internal.audit(me.id, 'set_role', uname, jsonb_build_object('from', old_role, 'to', p_role));
end $$;

create or replace function public.admin_set_banned(p_user uuid, p_banned boolean)
returns void language plpgsql security definer set search_path = public, internal, pg_temp as $$
declare me public.profiles; uname text;
begin
  me := internal.require_staff();
  if p_user = me.id then perform internal.fail('self', 'Non puoi sospendere te stesso.'); end if;
  update public.profiles set banned = p_banned where id = p_user returning username into uname;
  if uname is null then perform internal.fail('not_found', 'Utente non trovato.'); end if;
  perform internal.audit(me.id, case when p_banned then 'ban' else 'unban' end, uname);
end $$;

create or replace function public.admin_adjust_chips(p_user uuid, p_delta bigint, p_reason text)
returns bigint language plpgsql security definer set search_path = public, internal, pg_temp as $$
declare me public.profiles; bal bigint; uname text;
begin
  me := internal.require_staff();
  if coalesce(p_delta, 0) = 0 then perform internal.fail('delta', 'Importo non valido.'); end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then perform internal.fail('reason', 'Indica il motivo della rettifica.'); end if;
  bal := internal.apply_ledger(p_user, p_delta, 'admin_adjust', trim(p_reason), null, me.id);
  select username into uname from public.profiles where id = p_user;
  perform internal.audit(me.id, 'adjust_chips', uname, jsonb_build_object('delta', p_delta, 'reason', trim(p_reason)));
  return bal;
end $$;

create or replace function public.admin_review_gm_request(p_request uuid, p_approve boolean, p_note text default '')
returns void language plpgsql security definer set search_path = public, internal, pg_temp as $$
declare me public.profiles; r public.gm_requests; uname text;
begin
  me := internal.require_staff();
  select * into r from public.gm_requests where id = p_request for update;
  if not found then perform internal.fail('not_found', 'Richiesta non trovata.'); end if;
  if r.status <> 'pending' then perform internal.fail('status', 'Richiesta già gestita.'); end if;
  update public.gm_requests set
    status = case when p_approve then 'approved' else 'rejected' end,
    review_note = trim(coalesce(p_note, '')), reviewed_by = me.id, reviewed_at = now()
  where id = r.id;
  if p_approve then
    update public.profiles set role = 'game_master' where id = r.user_id and role = 'player';
  end if;
  select username into uname from public.profiles where id = r.user_id;
  perform internal.audit(me.id, case when p_approve then 'gm_approve' else 'gm_reject' end, uname,
                         jsonb_build_object('note', trim(coalesce(p_note, ''))));
end $$;

create or replace function public.admin_upsert_game(p_game jsonb)
returns void language plpgsql security definer set search_path = public, internal, pg_temp as $$
declare me public.profiles; existed boolean;
begin
  me := internal.require_staff();
  existed := exists (select 1 from public.games where id = p_game ->> 'id');
  insert into public.games (id, name, mode, room, icon, description, min_participants, max_participants, default_lives,
                            target_points, master_plays_default, allow_teams, allow_late_join, outcomes,
                            allow_custom_delta, enabled, sort)
  values (
    p_game ->> 'id', p_game ->> 'name', p_game ->> 'mode', p_game ->> 'room', coalesce(p_game ->> 'icon', '🎲'),
    coalesce(p_game ->> 'description', ''), (p_game ->> 'minParticipants')::int, (p_game ->> 'maxParticipants')::int,
    coalesce((p_game ->> 'defaultLives')::int, 0), coalesce((p_game ->> 'targetPoints')::int, 0),
    coalesce((p_game ->> 'masterPlaysDefault')::boolean, false), coalesce((p_game ->> 'allowTeams')::boolean, false),
    coalesce((p_game ->> 'allowLateJoin')::boolean, false), coalesce(p_game -> 'outcomes', '[]'),
    coalesce((p_game ->> 'allowCustomDelta')::boolean, false), coalesce((p_game ->> 'enabled')::boolean, true),
    coalesce((p_game ->> 'sort')::int, 100)
  )
  on conflict (id) do update set
    name = excluded.name, mode = excluded.mode, room = excluded.room, icon = excluded.icon,
    description = excluded.description, min_participants = excluded.min_participants,
    max_participants = excluded.max_participants, default_lives = excluded.default_lives,
    target_points = excluded.target_points, master_plays_default = excluded.master_plays_default,
    allow_teams = excluded.allow_teams, allow_late_join = excluded.allow_late_join, outcomes = excluded.outcomes,
    allow_custom_delta = excluded.allow_custom_delta, enabled = excluded.enabled, sort = excluded.sort;
  perform internal.audit(me.id, case when existed then 'game_update' else 'game_create' end, p_game ->> 'id');
end $$;

create or replace function public.admin_update_settings(p_patch jsonb)
returns public.app_settings language plpgsql security definer set search_path = public, internal, pg_temp as $$
declare me public.profiles; s public.app_settings;
begin
  me := internal.require_staff();
  update public.app_settings set
    daily_bonus_base = coalesce((p_patch ->> 'dailyBonusBase')::int, daily_bonus_base),
    starting_chips = coalesce((p_patch ->> 'startingChips')::int, starting_chips),
    wheel = coalesce((select array_agg(x::numeric) from jsonb_array_elements_text(p_patch -> 'wheel') x), wheel),
    streak_bonus_pct = coalesce((p_patch ->> 'streakBonusPct')::int, streak_bonus_pct),
    max_streak = coalesce((p_patch ->> 'maxStreak')::int, max_streak),
    join_token_ttl_seconds = coalesce((p_patch ->> 'joinTokenTtlSeconds')::int, join_token_ttl_seconds),
    allow_qr_fallback = coalesce((p_patch ->> 'allowQrFallback')::boolean, allow_qr_fallback),
    timezone = coalesce(p_patch ->> 'timezone', timezone)
  where id = 1
  returning * into s;
  if array_length(s.wheel, 1) is null or exists (select 1 from unnest(s.wheel) m where m <= 0) then
    perform internal.fail('settings', 'Spicchi della ruota non validi.');
  end if;
  perform internal.audit(me.id, 'settings_update', 'settings', p_patch);
  return s;
end $$;

-- ------------------------------------------------------------------------------ RLS

alter table public.app_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.player_passes enable row level security;
alter table public.games enable row level security;
alter table public.gm_requests enable row level security;
alter table public.game_tables enable row level security;
alter table public.table_join_tokens enable row level security;
alter table public.table_participants enable row level security;
alter table public.rounds enable row level security;
alter table public.chip_ledger enable row level security;
alter table public.audit_log enable row level security;

create or replace function internal.is_staff()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'staff' and not banned);
$$;
grant usage on schema internal to authenticated;
grant execute on function internal.is_staff() to authenticated;

create policy "impostazioni leggibili" on public.app_settings for select to authenticated using (true);
create policy "profili pubblici" on public.profiles for select to authenticated using (true);
create policy "solo il proprio pass" on public.player_passes for select to authenticated using (user_id = auth.uid());
create policy "catalogo giochi" on public.games for select to authenticated using (true);
create policy "proprie richieste o staff" on public.gm_requests for select to authenticated
  using (user_id = auth.uid() or internal.is_staff());
create policy "tavoli pubblici" on public.game_tables for select to authenticated using (true);
-- table_join_tokens: nessuna policy => illeggibile dai client (si ottengono solo da issue_join_token)
create policy "partecipanti pubblici" on public.table_participants for select to authenticated using (true);
create policy "mani pubbliche" on public.rounds for select to authenticated using (true);
create policy "proprio registro o staff" on public.chip_ledger for select to authenticated
  using (user_id = auth.uid() or internal.is_staff());
create policy "audit solo staff" on public.audit_log for select to authenticated using (internal.is_staff());

-- I client possono solo leggere: ogni scrittura passa dalle funzioni RPC.
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
revoke all on all tables in schema public from anon;
grant select on all tables in schema public to authenticated;
revoke all on all sequences in schema public from anon, authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.handle_new_user() from authenticated;
grant execute on function public.username_available(text) to anon;
revoke execute on all functions in schema internal from public;
grant execute on function internal.is_staff() to authenticated;

-- ------------------------------------------------------------------------------ Realtime

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.game_tables, public.table_participants, public.rounds;
  end if;
end $$;
