-- Test di integrazione della migrazione: simula più utenti tramite auth.uid().
\set ON_ERROR_STOP 1
\pset pager off
\set QUIET 1

create schema tests;
grant usage on schema tests to authenticated;

create function tests.act_as(p_username text) returns text language plpgsql as $$
declare uid uuid;
begin
  select id into uid from public.profiles where username = p_username;
  if uid is null then raise exception 'utente % inesistente', p_username; end if;
  perform set_config('request.jwt.claim.sub', uid::text, false);
  return p_username;
end $$;

create function tests.uid(p_username text) returns uuid language sql stable as $$
  select id from public.profiles where username = p_username
$$;

create function tests.eq(p_actual text, p_expected text, p_label text) returns text language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FALLITO [%]: atteso %, ottenuto %', p_label, p_expected, p_actual;
  end if;
  raise notice 'ok - %', p_label;
  return 'ok';
end $$;

create function tests.expect_error(p_sql text, p_pattern text, p_label text default null) returns text language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm ilike '%' || p_pattern || '%' then
      raise notice 'ok - errore atteso (%): %', coalesce(p_label, p_pattern), sqlerrm;
      return 'ok';
    end if;
    raise exception 'FALLITO [%]: errore inatteso: %', coalesce(p_label, p_pattern), sqlerrm;
  end;
  raise exception 'FALLITO [%]: nessun errore per: %', coalesce(p_label, p_pattern), p_sql;
end $$;

grant execute on all functions in schema tests to authenticated;

-- ----------------------------------------------------------------- utenti (trigger handle_new_user)
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000001', 'admin@test.it', '{"username":"admin","display_name":"Admin"}'),
  ('00000000-0000-0000-0000-000000000002', 'gm@test.it', '{"username":"mazziere","display_name":"Il Mazziere"}'),
  ('00000000-0000-0000-0000-000000000003', 'luca@test.it', '{"username":"luca"}'),
  ('00000000-0000-0000-0000-000000000004', 'giulia@test.it', '{"username":"giulia"}'),
  ('00000000-0000-0000-0000-000000000005', 'marco@test.it', '{"username":"marco"}'),
  ('00000000-0000-0000-0000-000000000006', 'Strano.Nome+x@test.it', '{}');
update public.profiles set role = 'staff' where username = 'admin';

select tests.eq((select count(*) from public.profiles)::text, '6', 'profili creati dal trigger');
select tests.eq((select username from public.profiles where id = '00000000-0000-0000-0000-000000000006'), 'strano.nomex', 'username derivato dall''email');
select tests.eq((select count(*) from public.chip_ledger where kind = 'signup')::text, '6', 'fiches di benvenuto a registro');

set role authenticated;

-- ----------------------------------------------------------------- ruoli e richieste GM
select tests.act_as('luca');
select tests.eq((select chips from public.profiles where username = 'luca')::text, '1000', 'saldo iniziale');
select tests.expect_error($$select public.create_table('blackjack','','live',false,0,0,0,0,false)$$, 'game master', 'player non apre tavoli');
select tests.eq((select count(*) from public.player_passes)::text, '1', 'vedo solo il mio pass');
select public.request_game_master('Vorrei fare il croupier alle feste');
select tests.expect_error($$select public.request_game_master('Ancora una richiesta')$$, 'attesa');
select tests.expect_error($$select public.admin_overview()$$, 'staff');

select tests.act_as('admin');
select public.admin_set_role(tests.uid('mazziere'), 'game_master');
select public.admin_review_gm_request((select id from public.gm_requests where status = 'pending'), true, 'ok');
select tests.eq((select role from public.profiles where username = 'luca'), 'game_master', 'richiesta approvata');
select public.admin_set_role(tests.uid('luca'), 'player');
select tests.expect_error(format('select public.admin_set_banned(%L, true)', tests.uid('admin')), 'te stesso');

-- ----------------------------------------------------------------- blackjack live
select tests.act_as('mazziere');
select public.create_table('blackjack', 'Tavolo SQL', 'live', false, 0, 0, 10, 0, false) as tid \gset
select code from public.game_tables where id = :'tid' \gset
select public.issue_join_token(:'tid', 'nfc') ->> 'token' as tok \gset
select tests.eq((select count(*) from public.table_join_tokens)::text, '0', 'token di ingresso illeggibili dai client');

select tests.act_as('luca');
select tests.expect_error(format('select public.join_with_token(%L, %L, %L)', :'code', 'sbagliato', 'nfc_table'), 'non valido');
select public.join_with_token(:'code', :'tok', 'nfc_table');
select tests.act_as('giulia');
select public.get_my_pass() as gpass \gset

select tests.act_as('mazziere');
select tests.expect_error(format('select public.start_table(%L)', :'tid'), 'almeno 3');
select public.add_player_by_pass(:'tid', :'gpass') ->> 'username' as added \gset
select tests.eq(:'added', 'giulia', 'giocatore aggiunto leggendo il pass');
select public.start_table(:'tid');
select public.record_chips_round(:'tid', jsonb_build_array(
  jsonb_build_object('userId', tests.uid('luca'), 'bet', 100, 'outcomeKey', 'blackjack'),
  jsonb_build_object('userId', tests.uid('giulia'), 'bet', 40, 'outcomeKey', 'lose')));
select tests.eq((select chips from public.profiles where username = 'luca')::text, '1150', 'blackjack paga 3:2');
select tests.eq((select chips from public.profiles where username = 'giulia')::text, '960', 'puntata persa');
select tests.expect_error(format($f$select public.record_chips_round(%L, jsonb_build_array(jsonb_build_object('userId', tests.uid('luca'), 'bet', 5, 'outcomeKey', 'win')))$f$, :'tid'), 'minima');
select tests.expect_error(format($f$select public.record_chips_round(%L, jsonb_build_array(jsonb_build_object('userId', tests.uid('giulia'), 'bet', 100000, 'outcomeKey', 'lose')))$f$, :'tid'), 'abbastanza');
select public.undo_last_round(:'tid');
select tests.eq((select chips from public.profiles where username = 'luca')::text, '1000', 'annullo mano: luca');
select tests.eq((select chips from public.profiles where username = 'giulia')::text, '1000', 'annullo mano: giulia');
select public.record_chips_round(:'tid', jsonb_build_array(
  jsonb_build_object('userId', tests.uid('luca'), 'bet', 25, 'outcomeKey', 'surrender'),
  jsonb_build_object('userId', tests.uid('giulia'), 'bet', 30, 'outcomeKey', 'win')));
select tests.eq((select chips from public.profiles where username = 'luca')::text, '987', 'resa arrotondata a favore del banco');

select tests.act_as('luca');
select tests.expect_error(format('select public.close_table(%L)', :'tid'), 'game master', 'il giocatore non chiude il tavolo');
select tests.expect_error($$insert into public.chip_ledger (user_id, delta, balance_after, kind) values (auth.uid(), 1, 1, 'signup')$$, 'permission denied');
select tests.expect_error($$update public.profiles set chips = 99999 where id = auth.uid()$$, 'permission denied');
select tests.eq((select count(*) from public.chip_ledger where user_id <> auth.uid())::text, '0', 'vedo solo il mio registro');
select tests.eq((select count(*) from public.audit_log)::text, '0', 'audit invisibile ai giocatori');
select tests.expect_error(format('select public.create_table(%L,%L,%L,false,0,0,0,0,false)', 'blackjack', '', 'live'), 'game master');

select tests.act_as('mazziere');
select public.close_table(:'tid');
select tests.eq((select placement from public.table_participants where table_id = :'tid' and user_id = tests.uid('giulia'))::text, '1', 'giulia prima');
select tests.eq((public.get_player_stats(tests.uid('giulia')) ->> 'wins'), '1', 'statistiche: vittorie');
select tests.eq((public.get_player_stats(tests.uid('luca')) ->> 'chipsLost'), '13', 'statistiche: fiches perse');

-- ----------------------------------------------------------------- blackjack a chiusura
select public.create_table('blackjack', '', 'on_close', false, 0, 0, 0, 0, false) as tid2 \gset
select tests.act_as('marco');
select public.get_my_pass() as mpass \gset
select tests.act_as('luca');
select public.get_my_pass() as lpass \gset
select tests.act_as('mazziere');
select public.add_player_by_pass(:'tid2', :'mpass');
select public.add_player_by_pass(:'tid2', :'lpass');
select public.start_table(:'tid2');
select public.record_chips_round(:'tid2', jsonb_build_array(jsonb_build_object('userId', tests.uid('marco'), 'bet', 100, 'outcomeKey', 'lose')));
select tests.eq((select chips from public.profiles where username = 'marco')::text, '1000', 'on_close: saldo invariato');
select tests.eq((select pending_delta from public.table_participants where table_id = :'tid2' and user_id = tests.uid('marco'))::text, '-100', 'on_close: maturato');
select public.close_table(:'tid2');
select tests.eq((select chips from public.profiles where username = 'marco')::text, '900', 'on_close: applicato alla chiusura');

-- ----------------------------------------------------------------- trentuno a vite
select public.create_table('trentuno', '', 'live', true, 2, 0, 0, 0, false) as tid3 \gset
select code from public.game_tables where id = :'tid3' \gset
select public.issue_join_token(:'tid3', 'qr') ->> 'token' as pin \gset
select tests.act_as('luca');
select public.join_with_token(:'code', :'pin', 'qr');
select tests.act_as('giulia');
select public.join_with_token(:'code', :'pin', 'qr');
select tests.act_as('admin');
select public.create_table('scopa', '', 'live', true, 0, 11, 0, 0, true) as tid4 \gset
select public.issue_join_token(:'tid4', 'nfc') ->> 'token' as tok4 \gset
select code as code4 from public.game_tables where id = :'tid4' \gset
select tests.act_as('luca');
select tests.expect_error(format('select public.join_with_token(%L, %L, %L)', :'code4', :'tok4', 'nfc_table'), 'già seduto');

select tests.act_as('mazziere');
select public.start_table(:'tid3');
select public.record_lives_round(:'tid3', jsonb_build_array(jsonb_build_object('userId', tests.uid('luca'), 'delta', -2)));
select tests.eq((select elimination_order from public.table_participants where table_id = :'tid3' and user_id = tests.uid('luca'))::text, '1', 'eliminato al round 1');
select public.undo_last_round(:'tid3');
select tests.eq((select lives::text || '/' || coalesce(elimination_order::text, '-') from public.table_participants where table_id = :'tid3' and user_id = tests.uid('luca')), '2/-', 'annullo eliminazione');
select public.record_lives_round(:'tid3', jsonb_build_array(jsonb_build_object('userId', tests.uid('luca'), 'delta', -2)));
select public.record_lives_round(:'tid3', jsonb_build_array(jsonb_build_object('userId', tests.uid('mazziere'), 'delta', -5)));
select public.close_table(:'tid3');
select tests.eq((select string_agg(p.username || ':' || tp.placement, ',' order by tp.placement)
                 from public.table_participants tp join public.profiles p on p.id = tp.user_id where tp.table_id = :'tid3'),
                'giulia:1,mazziere:2,luca:3', 'classifica a vite');

-- ----------------------------------------------------------------- scopa a coppie
select tests.act_as('mazziere');
select public.get_my_pass() as gmpass \gset
select tests.act_as('admin');
select public.add_player_by_pass(:'tid4', :'gmpass');
select public.add_player_by_pass(:'tid4', :'lpass');
select public.add_player_by_pass(:'tid4', :'gpass');
select tests.expect_error(format('select public.start_table(%L)', :'tid4'), 'squadra');
select public.set_team(:'tid4', tests.uid('admin'), 'A');
select public.set_team(:'tid4', tests.uid('mazziere'), 'A');
select public.set_team(:'tid4', tests.uid('luca'), 'B');
select public.set_team(:'tid4', tests.uid('giulia'), 'B');
select public.start_table(:'tid4');
select public.record_points_round(:'tid4', '[{"team":"A","points":7},{"team":"B","points":4}]');
select tests.eq((select score from public.table_participants where table_id = :'tid4' and user_id = tests.uid('mazziere'))::text, '7', 'punti alla squadra A');
select public.record_points_round(:'tid4', '[{"team":"B","points":8}]');
select public.close_table(:'tid4');
select tests.eq((select placement from public.table_participants where table_id = :'tid4' and user_id = tests.uid('giulia'))::text, '1', 'vince la squadra B');

-- ----------------------------------------------------------------- bonus giornaliero e admin
select tests.act_as('marco');
select (public.claim_daily_bonus() ->> 'streak') as streak \gset
select tests.eq(:'streak', '1', 'bonus: prima serie');
select tests.expect_error($$select public.claim_daily_bonus()$$, 'già ritirato');

select tests.act_as('admin');
select public.admin_adjust_chips(tests.uid('marco'), 500, 'Premio torneo');
select tests.expect_error(format('select public.admin_adjust_chips(%L, -1000000, %L)', tests.uid('marco'), 'errore'), 'abbastanza');
select tests.eq((select action from public.audit_log order by id desc limit 1), 'adjust_chips', 'audit rettifica');
select tests.eq((public.admin_overview() ->> 'users'), '6', 'overview utenti');
select public.admin_update_settings('{"dailyBonusBase": 250, "wheel": [1, 2, 10], "allowQrFallback": false}');
select tests.eq((select daily_bonus_base::text || ' ' || array_length(wheel, 1) from public.app_settings), '250 3', 'impostazioni aggiornate');
select tests.expect_error($$select public.admin_update_settings('{"wheel": [1, 0]}')$$, 'ruota');
select public.admin_upsert_game('{"id":"tombola","name":"Tombola","mode":"points","room":"arcade","minParticipants":2,"maxParticipants":30,"targetPoints":5}');
select tests.eq((select name from public.games where id = 'tombola'), 'Tombola', 'nuovo gioco creato');
select tests.eq((select username from public.leaderboard('wins', 1)), 'giulia', 'classifica vittorie');

reset role;
select tests.eq((select sum(delta)::text from public.chip_ledger), (select sum(chips)::text from public.profiles), 'registro = somma saldi');
\o
\echo 'TUTTI I TEST SQL SUPERATI'
