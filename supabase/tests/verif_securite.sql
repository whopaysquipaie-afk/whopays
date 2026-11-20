-- =====================================================================
-- Qui paie ? / Who pays? — security tests (brief dev §5.7)
--
-- Run in the Supabase SQL editor (as postgres) AFTER all the migrations (001 to 006; seeds optional).
-- Prints one line per test: "OK - ..." or "ÉCHEC - ...", as NOTICE messages and as the result
-- grid of the final SELECT.
--
-- Leaves NO data behind, twice over:
--  * everything the tests write happens inside a PL/pgSQL sub-transaction that is rolled back
--    on purpose at the end of the DO block (only the result lines survive, in a temp table);
--  * the whole script runs in a transaction that ends with ROLLBACK.
-- If your SQL client only shows the output of the last statement, look at the NOTICE
-- messages, or run the script without the last line (ROLLBACK): nothing persists anyway.
--
-- Fake members are created directly in auth.users (e-mails @exemple.invalid), then
-- impersonated exactly like PostgREST does: role anon / authenticated + request.jwt.claims.
-- =====================================================================

begin;

create temp table wp_resultats (
  n     serial primary key,
  ligne text not null
) on commit drop;

-- Switches the current role and the JWT claims read by auth.uid().
-- p_role null = back to the session role (postgres) with no claims.
create function pg_temp.wp_jouer(p_role text, p_uid uuid default null)
returns void
language plpgsql
as $f$
begin
  if p_role is null then
    reset role;
    perform set_config('request.jwt.claims', '', true);
  else
    perform set_config('request.jwt.claims',
                       json_build_object('sub', p_uid, 'role', p_role)::text, true);
    perform set_config('role', p_role, true);
  end if;
end;
$f$;

-- Formats a result line.
create function pg_temp.wp_ligne(p_ok boolean, p_libelle text, p_obtenu text default null)
returns text
language sql
as $f$
  select case when coalesce(p_ok, false) then 'OK - ' || p_libelle
              else 'ÉCHEC - ' || p_libelle || coalesce(' (obtenu : ' || p_obtenu || ')', '') end;
$f$;

-- Default privileges (002) remove EXECUTE from PUBLIC: give these two test helpers back to everyone.
grant execute on function pg_temp.wp_jouer(text, uuid) to public;
grant execute on function pg_temp.wp_ligne(boolean, text, text) to public;

do $test$
declare
  v_res      text[] := '{}';
  v_ok       boolean;
  v_hint     text;
  v_etat     text;
  v_txt      text;
  v_t        text;
  v_attendu  text;
  v_j        jsonb;
  v_i        integer;
  v_k        integer;
  v_role     text;
  v_ids      uuid[] := '{}';
  v_cibles   uuid[];
  v_suffixe  text := replace(gen_random_uuid()::text, '-', '');
  -- fake members
  v_riche    uuid := gen_random_uuid();
  v_partant  uuid := gen_random_uuid();
  v_pauvre   uuid := gen_random_uuid();
  v_pauvre2  uuid := gen_random_uuid();
  v_pauvre3  uuid := gen_random_uuid();
  v_pauvre4  uuid := gen_random_uuid();
  v_pauvre5  uuid := gen_random_uuid();
  v_bloque   uuid := gen_random_uuid();
  v_anonyme  uuid := gen_random_uuid();
  v_code_p   text;
  -- content
  v_pb_publie   uuid;
  v_pb_recu     uuid;
  v_pb_masque   uuid;
  v_pb_riche    uuid;
  v_pb_test     uuid;
  v_com_visible uuid;
  v_com_masque  uuid;
  v_com_autre   uuid;
  v_msg_riche   uuid;
  v_msg_pauvre  uuid;
  v_msg_cible   uuid;
  -- direct table access
  v_tables   text[] := array['profiles', 'problems', 'reactions', 'comments', 'club_messages',
                             'reports', 'verifications', 'mots_interdits', 'reglages', 'mots_sensibles',
                             'moderateurs'];
  v_colonnes text[] := array['pseudo', 'titre', 'type', 'texte', 'texte',
                             'cible_type', 'verifie_le', 'mot', 'valeur', 'mot',
                             'user_id'];
  v_pb_auto     uuid;
  v_pb_sensible uuid;
  v_pb_premod   uuid;
  -- moderators (006)
  v_modo        uuid := gen_random_uuid();
  v_auteur      uuid := gen_random_uuid();
  v_mod_fns     text[];
  v_pb_m_pub    uuid;
  v_pb_m_recu   uuid;
  v_com_m       uuid;
begin
  begin  -- sub-transaction: rolled back on purpose at the end (P0999)

    -- =================================================================
    -- Setup (as postgres)
    -- =================================================================
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at,
                            raw_app_meta_data, raw_user_meta_data, is_anonymous)
    select '00000000-0000-0000-0000-000000000000'::uuid, u.id, 'authenticated', 'authenticated',
           case when u.anonyme then null else u.nom || '-' || v_suffixe || '@exemple.invalid' end,
           '', case when u.anonyme then null else now() end, now(), now(),
           '{}'::jsonb, '{}'::jsonb, u.anonyme
    from (values
      (v_riche,   'riche',   false),
      (v_partant, 'partant', false),
      (v_pauvre,  'pauvre',  false),
      (v_pauvre2, 'pauvre2', false),
      (v_pauvre3, 'pauvre3', false),
      (v_pauvre4, 'pauvre4', false),
      (v_pauvre5, 'pauvre5', false),
      (v_bloque,  'bloque',  false),
      (v_anonyme, 'anonyme', true)
    ) as u(id, nom, anonyme);

    -- Banned words used below (the seed may not have been run)
    insert into public.mots_interdits (mot)
    values ('connard'), ('encule'), ('ta gueule'), ('pd')
    on conflict (mot) do nothing;
    -- Sensitive words used below, and automatic publication on (005; restored by the final rollback)
    insert into public.mots_sensibles (mot)
    values ('chimio'), ('a la rue'), ('harcelement'), ('viol')
    on conflict (mot) do nothing;
    insert into public.reglages (cle, valeur) values ('publication_auto', 'true'::jsonb)
    on conflict (cle) do update set valeur = excluded.valeur;

    -- Profiles, created through creer_profil (as each member)
    perform pg_temp.wp_jouer('authenticated', v_riche);
    perform public.creer_profil('riche', 'Riche de test', 'riche-' || v_suffixe || '@exemple.invalid');
    perform pg_temp.wp_jouer('authenticated', v_partant);
    perform public.creer_profil('riche', 'Riche partant', 'partant-' || v_suffixe || '@exemple.invalid');
    perform pg_temp.wp_jouer('authenticated', v_pauvre);
    v_j := public.creer_profil('pauvre', 'Pauvre de test', 'pauvre-' || v_suffixe || '@exemple.invalid', true);
    v_code_p := v_j ->> 'code_partage';
    perform pg_temp.wp_jouer('authenticated', v_pauvre2);
    perform public.creer_profil('pauvre', 'Pauvre deux', 'pauvre2-' || v_suffixe || '@exemple.invalid');
    perform pg_temp.wp_jouer('authenticated', v_pauvre3);
    perform public.creer_profil('pauvre', 'Pauvre trois', 'pauvre3-' || v_suffixe || '@exemple.invalid');
    perform pg_temp.wp_jouer('authenticated', v_pauvre4);
    perform public.creer_profil('pauvre', 'Pauvre quatre', 'pauvre4-' || v_suffixe || '@exemple.invalid');
    perform pg_temp.wp_jouer('authenticated', v_pauvre5);
    perform public.creer_profil('pauvre', 'Pauvre cinq', 'PAUVRE5-' || v_suffixe || '@exemple.invalid', false, lower(v_code_p));
    perform pg_temp.wp_jouer('authenticated', v_bloque);
    perform public.creer_profil('pauvre', 'Pauvre bloque', 'bloque-' || v_suffixe || '@exemple.invalid');

    v_res := v_res || pg_temp.wp_ligne(v_code_p ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$',
      'creer_profil renvoie un code de partage de 8 caractères', v_code_p);

    -- Problems: P submits 3, R submits 1 (published at once, except v_pb_recu: sensitive word -> 'recu')
    perform pg_temp.wp_jouer('authenticated', v_pauvre);
    v_pb_publie := (public.soumettre_probleme('factures', 'Ma facture de test',
                    'Un texte de test, assez long pour passer.', 120) ->> 'id')::uuid;
    v_pb_recu   := (public.soumettre_probleme('reve', 'Mon rêve non publié',
                    'Ma mère commence sa chimio : ce problème attend la modération.', null) ->> 'id')::uuid;
    v_pb_masque := (public.soumettre_probleme('patron', 'Mon patron masqué',
                    'Ce problème est publié puis masqué.', 300) ->> 'id')::uuid;
    perform pg_temp.wp_jouer('authenticated', v_riche);
    v_pb_riche  := (public.soumettre_probleme('projet', 'Le projet du riche',
                    'Un projet de riche, publié pour les tests.', 5000) ->> 'id')::uuid;

    -- Moderation (as postgres, with the 004 helpers)
    perform pg_temp.wp_jouer(null);
    perform public.moderer_probleme(v_pb_publie, 'publie');
    perform public.moderer_probleme(v_pb_masque, 'publie');
    perform public.masquer_contenu('probleme', v_pb_masque, true);
    perform public.moderer_probleme(v_pb_riche, 'publie');
    perform public.bloquer_membre(v_bloque, true);

    -- Comments on P's published problem
    perform pg_temp.wp_jouer('authenticated', v_riche);
    v_com_visible := (public.commenter(v_pb_publie, 'Courage, on y croit !') ->> 'id')::uuid;
    perform pg_temp.wp_jouer('authenticated', v_pauvre2);
    v_com_masque := (public.commenter(v_pb_publie, 'Texte secret masqué') ->> 'id')::uuid;
    perform pg_temp.wp_jouer('authenticated', v_pauvre3);
    v_com_autre := (public.commenter(v_pb_publie, 'Un commentaire de pauvre trois') ->> 'id')::uuid;
    perform pg_temp.wp_jouer(null);
    perform public.masquer_contenu('commentaire', v_com_masque, true);

    -- Club messages
    perform pg_temp.wp_jouer('authenticated', v_riche);
    v_msg_riche := (public.envoyer_message_club('Secret du club des riches') ->> 'id')::uuid;
    perform pg_temp.wp_jouer('authenticated', v_pauvre);
    v_msg_pauvre := (public.envoyer_message_club('Secret du club des pauvres') ->> 'id')::uuid;
    perform pg_temp.wp_jouer('authenticated', v_pauvre2);
    v_msg_cible := (public.envoyer_message_club('Message de pauvre deux, à signaler') ->> 'id')::uuid;
    perform pg_temp.wp_jouer(null);

    -- =================================================================
    -- 1. anon and authenticated cannot read or write any table directly
    -- =================================================================
    foreach v_role in array array['anon', 'authenticated'] loop
      perform pg_temp.wp_jouer(v_role, case when v_role = 'authenticated' then v_pauvre end);
      for v_i in 1 .. array_length(v_tables, 1) loop
        v_txt := '';
        begin
          execute format('select 1 from public.%I limit 1', v_tables[v_i]);
          v_txt := v_txt || ' select';
        exception when insufficient_privilege then null;
                  when others then v_txt := v_txt || ' select';
        end;
        begin
          execute format('insert into public.%I default values', v_tables[v_i]);
          v_txt := v_txt || ' insert';
        exception when insufficient_privilege then null;
                  when others then v_txt := v_txt || ' insert';
        end;
        begin
          execute format('update public.%I set %I = %I where false', v_tables[v_i], v_colonnes[v_i], v_colonnes[v_i]);
          v_txt := v_txt || ' update';
        exception when insufficient_privilege then null;
                  when others then v_txt := v_txt || ' update';
        end;
        begin
          execute format('delete from public.%I where false', v_tables[v_i]);
          v_txt := v_txt || ' delete';
        exception when insufficient_privilege then null;
                  when others then v_txt := v_txt || ' delete';
        end;
        v_res := v_res || pg_temp.wp_ligne(v_txt = '',
          format('%s ne lit ni n''écrit directement dans public.%s', v_role, v_tables[v_i]),
          'autorisé :' || v_txt);
      end loop;
    end loop;
    perform pg_temp.wp_jouer(null);

    -- =================================================================
    -- 2. Function privileges: members' functions closed to anon,
    --    moderation functions / views / internal helpers closed to everyone
    -- =================================================================
    perform pg_temp.wp_jouer('anon');
    foreach v_t in array array[
      format('select public.creer_profil(%L, %L, %L)', 'pauvre', 'Intrus', 'intrus@exemple.invalid'),
      format('select public.commenter(%L::uuid, %L)', v_pb_publie, 'Bonjour'),
      format('select public.reagir(%L::uuid, %L)', v_pb_publie, 'rire'),
      format('select public.soumettre_probleme(%L, %L, %L)', 'reve', 'Titre intrus', 'Un texte intrus assez long'),
      format('select public.signaler(%L, %L::uuid)', 'probleme', v_pb_publie),
      'select public.get_club_messages()',
      format('select public.envoyer_message_club(%L)', 'Bonjour'),
      'select public.get_mon_espace()',
      'select public.supprimer_mon_compte()',
      'select public.supprimer_utilisateur_anonyme()',
      'select * from public.moderation_a_relire',
      format('select public.moderer_probleme(%L::uuid, %L)', v_pb_recu, 'publie')
    ] loop
      begin
        execute v_t;
        v_hint := 'exécuté';
      exception when insufficient_privilege then v_hint := null;
                when others then v_hint := 'erreur ' || sqlstate;
      end;
      v_res := v_res || pg_temp.wp_ligne(v_hint is null, 'anon ne peut pas exécuter : ' || v_t, v_hint);
    end loop;

    perform pg_temp.wp_jouer('authenticated', v_pauvre);
    foreach v_t in array array[
      format('select public.moderer_probleme(%L::uuid, %L)', v_pb_recu, 'publie'),
      format('select public.masquer_contenu(%L, %L::uuid, false)', 'probleme', v_pb_masque),
      format('select public.bloquer_membre(%L::uuid, false)', v_bloque),
      format('select public.verifier_milliardaire(%L::uuid)', v_pauvre),
      'select public.purger_anciens_refus()',
      'select * from public.moderation_a_relire',
      'select * from public.moderation_masques',
      'select * from public.moderation_signalements_24h',
      'select * from public.moderation_signaleurs_24h',
      'select * from public.moderation_newsletter',
      format('select public.wp_raison_filtre(%L)', 'test'),
      format('select public.wp_texte_valide(%L, 1, 10, %L, false)', 'test', 'Test'),
      'select public.wp_exiger_membre(false)',
      'select public.wp_exiger_moderateur()'
    ] loop
      begin
        execute v_t;
        v_hint := 'exécuté';
      exception when insufficient_privilege then v_hint := null;
                when others then v_hint := 'erreur ' || sqlstate;
      end;
      v_res := v_res || pg_temp.wp_ligne(v_hint is null, 'un membre ne peut pas exécuter : ' || v_t, v_hint);
    end loop;
    perform pg_temp.wp_jouer(null);

    -- =================================================================
    -- 3. Public functions never return an e-mail or a user id
    -- =================================================================
    foreach v_role in array array['anon', 'authenticated'] loop
      perform pg_temp.wp_jouer(v_role, case when v_role = 'authenticated' then v_riche end);
      v_txt := public.get_compteurs()::text
            || public.get_chiffres()::text
            || public.get_problemes_publics(null, 48, null)::text
            || public.get_problemes_publics('factures', 48, null)::text
            || coalesce(public.get_probleme_public(v_pb_publie)::text, '')
            || public.get_commentaires(v_pb_publie, null)::text;
      v_res := v_res || pg_temp.wp_ligne(
        position(v_suffixe in v_txt) = 0 and v_txt !~ '"(email|user_id|invite_par)"',
        format('les fonctions publiques ne renvoient ni e-mail ni identifiant de membre (%s)', v_role));
    end loop;
    perform pg_temp.wp_jouer(null);

    -- =================================================================
    -- 4. Public functions never return an unpublished or masked problem
    -- =================================================================
    perform pg_temp.wp_jouer('anon');
    v_txt := public.get_problemes_publics(null, 48, null)::text;
    v_res := v_res || pg_temp.wp_ligne(
      position(v_pb_recu::text in v_txt) = 0 and position(v_pb_masque::text in v_txt) = 0
        and position(v_pb_publie::text in v_txt) > 0,
      'le mur ne montre ni problème reçu (non publié) ni problème masqué');
    v_res := v_res || pg_temp.wp_ligne(public.get_probleme_public(v_pb_recu) is null,
      'get_probleme_public ne renvoie pas un problème non publié');
    v_res := v_res || pg_temp.wp_ligne(public.get_probleme_public(v_pb_masque) is null,
      'get_probleme_public ne renvoie pas un problème masqué');
    v_j := public.get_probleme_public(v_pb_publie);
    v_res := v_res || pg_temp.wp_ligne(v_j is not null and v_j ->> 'pseudo' = 'Pauvre de test'
                                       and v_j ->> 'camp' = 'pauvre',
      'get_probleme_public renvoie un problème publié (pseudo et camp de l''auteur)', v_j::text);
    v_res := v_res || pg_temp.wp_ligne(public.get_commentaires(v_pb_recu, null) = '[]'::jsonb
                                       and public.get_commentaires(v_pb_masque, null) = '[]'::jsonb,
      'get_commentaires ne renvoie rien pour un problème non publié ou masqué');
    for v_k in 1 .. 30 loop
      v_ids := v_ids || public.get_probleme_hasard();
    end loop;
    perform pg_temp.wp_jouer(null);
    v_res := v_res || pg_temp.wp_ligne(
      not exists (select 1 from public.problems p
                  where p.id = any (v_ids) and (p.statut <> 'publie' or p.masque))
      and array_position(v_ids, null) is null,
      'get_probleme_hasard ne tire que des problèmes publiés et visibles (30 tirages)');

    -- A member cannot react to / comment on an unpublished or masked problem
    perform pg_temp.wp_jouer('authenticated', v_pauvre2);
    begin
      perform public.commenter(v_pb_recu, 'Je commente en douce');
      v_hint := '(aucune erreur)';
    exception when others then
      get stacked diagnostics v_hint = pg_exception_hint;
    end;
    v_res := v_res || pg_temp.wp_ligne(v_hint = 'introuvable',
      'un membre ne peut pas commenter un problème non publié', v_hint);
    begin
      perform public.reagir(v_pb_masque, 'rire');
      v_hint := '(aucune erreur)';
    exception when others then
      get stacked diagnostics v_hint = pg_exception_hint;
    end;
    v_res := v_res || pg_temp.wp_ligne(v_hint = 'introuvable',
      'un membre ne peut pas réagir à un problème masqué', v_hint);
    perform pg_temp.wp_jouer(null);

    -- =================================================================
    -- 5. A masked comment is listed without its text
    -- =================================================================
    perform pg_temp.wp_jouer('anon');
    v_txt := public.get_commentaires(v_pb_publie, null)::text;
    select e into v_j
    from jsonb_array_elements(public.get_commentaires(v_pb_publie, null)) as e
    where e ->> 'id' = v_com_masque::text;
    perform pg_temp.wp_jouer(null);
    v_res := v_res || pg_temp.wp_ligne(
      v_j is not null and v_j -> 'texte' = 'null'::jsonb and (v_j ->> 'masque')::boolean
        and position('Texte secret' in v_txt) = 0,
      'un commentaire masqué est renvoyé sans son texte (texte null, masque true)', v_j::text);

    -- =================================================================
    -- 6. Clubs are sealed: a poor member cannot read the rich club, and vice versa
    -- =================================================================
    perform pg_temp.wp_jouer('authenticated', v_pauvre);
    v_txt := public.get_club_messages()::text || public.get_club_messages(now() - interval '1 day')::text;
    v_res := v_res || pg_temp.wp_ligne(
      position('Secret du club des riches' in v_txt) = 0 and position('Secret du club des pauvres' in v_txt) > 0,
      'un pauvre ne lit pas le club des riches');
    begin
      perform public.signaler('message', v_msg_riche);
      v_hint := '(aucune erreur)';
    exception when others then
      get stacked diagnostics v_hint = pg_exception_hint;
    end;
    v_res := v_res || pg_temp.wp_ligne(v_hint = 'introuvable',
      'un pauvre ne peut pas signaler (ni deviner) un message du club des riches', v_hint);
    perform pg_temp.wp_jouer('authenticated', v_riche);
    v_txt := public.get_club_messages()::text || public.get_club_messages(now() - interval '1 day')::text;
    v_res := v_res || pg_temp.wp_ligne(
      position('Secret du club des pauvres' in v_txt) = 0 and position('Secret du club des riches' in v_txt) > 0,
      'un riche ne lit pas le club des pauvres');
    perform pg_temp.wp_jouer(null);

    -- =================================================================
    -- 7. Publication (005): immediate unless sensitive or pre-moderation;
    --    a member can never choose the status
    -- =================================================================
    -- 7a. Clean problem, automatic publication on -> 'publie', visible at once
    perform pg_temp.wp_jouer('authenticated', v_pauvre2);
    v_j := public.soumettre_probleme('quotidien', 'Mon grille-pain me juge',
                                     'Il brûle tout, sauf mes factures.', 50);
    v_pb_auto := (v_j ->> 'id')::uuid;
    v_ok := v_j ->> 'statut' = 'publie' and public.get_probleme_public(v_pb_auto) ->> 'titre' = 'Mon grille-pain me juge';
    perform pg_temp.wp_jouer('anon');
    v_ok := v_ok and position(v_pb_auto::text in public.get_problemes_publics(null, 48, null)::text) > 0;
    perform pg_temp.wp_jouer(null);
    v_res := v_res || pg_temp.wp_ligne(
      v_ok and exists (select 1 from public.problems p where p.id = v_pb_auto and p.statut = 'publie' and not p.est_exemple),
      'publication immédiate : un problème sans mot sensible est publié et visible tout de suite', v_j::text);

    -- 7b. Sensitive word (accents and case ignored, whole words) -> 'recu', invisible
    perform pg_temp.wp_jouer('authenticated', v_pauvre2);
    v_j := public.soumettre_probleme('quotidien', 'Je dors À LA RUE depuis lundi',
                                     'Ce problème doit attendre la modération.', null);
    v_pb_sensible := (v_j ->> 'id')::uuid;
    v_ok := v_j ->> 'statut' = 'recu' and public.get_probleme_public(v_pb_sensible) is null;
    perform pg_temp.wp_jouer(null);
    v_res := v_res || pg_temp.wp_ligne(
      v_ok and exists (select 1 from public.problems p where p.id = v_pb_sensible and p.statut = 'recu'),
      'un mot sensible dans le titre ou le texte envoie le problème en relecture (« recu », invisible)', v_j::text);

    -- 7c. Automatic publication switched off -> everything waits ('recu')
    update public.reglages set valeur = 'false'::jsonb where cle = 'publication_auto';
    perform pg_temp.wp_jouer('authenticated', v_pauvre2);
    v_j := public.soumettre_probleme('quotidien', 'Je veux publier tout seul',
                                     'Ce problème doit rester en attente de modération.', 50);
    v_pb_premod := (v_j ->> 'id')::uuid;
    v_ok := v_j ->> 'statut' = 'recu' and public.get_probleme_public(v_pb_premod) is null;
    perform pg_temp.wp_jouer(null);
    update public.reglages set valeur = 'true'::jsonb where cle = 'publication_auto';
    v_res := v_res || pg_temp.wp_ligne(
      v_ok and exists (select 1 from public.problems p where p.id = v_pb_premod and p.statut = 'recu'),
      'publication_auto = false : un problème propre reste « recu » (pré-modération)', v_j::text);

    -- 7d. wp_contient_mot_sensible: normalization and whole words (as postgres)
    for v_t, v_ok in
      select f.texte, f.attendu from (values
        ('Ma mère commence sa CHIMIO lundi',   true),
        ('Je suis à la rue',                    true),
        ('Harcèlement au bureau',               true),
        ('Mon chat est très expressif',         false),
        ('J''ai subi un viol',                  true),
        ('Un violon pour mon chat',             false),
        ('Mon chat dort dans la rue du four',   false),
        ('Bonjour à tous, on y croit !',        false)
      ) as f(texte, attendu)
    loop
      v_res := v_res || pg_temp.wp_ligne(public.wp_contient_mot_sensible(v_t) = v_ok,
        format('mot sensible : « %s » → %s', v_t, case when v_ok then 'relecture' else 'publication' end),
        public.wp_contient_mot_sensible(v_t)::text);
    end loop;

    -- 7e. Missing setting = pre-moderation (safe default)
    delete from public.reglages where cle = 'publication_auto';
    v_ok := not public.wp_publication_auto();
    insert into public.reglages (cle, valeur) values ('publication_auto', 'true'::jsonb);
    v_res := v_res || pg_temp.wp_ligne(v_ok and public.wp_publication_auto(),
      'réglage publication_auto absent = pré-modération ; présent à true = publication immédiate');
    -- No function a member can call takes a status / mask / block / example / verified argument,
    -- except the moderators' mod_* functions (006), which refuse non-moderators (section 16)
    select string_agg(p.proname, ', ') into v_txt
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (has_function_privilege('authenticated', p.oid, 'execute')
           or has_function_privilege('anon', p.oid, 'execute'))
      and p.proargnames && array['p_statut', 'p_masque', 'p_masque_par', 'p_bloque',
                                 'p_est_exemple', 'p_verifie', 'p_valeur', 'p_user_id']::text[]
      and p.proname not in ('mod_moderer_probleme', 'mod_masquer', 'mod_bloquer');
    v_res := v_res || pg_temp.wp_ligne(v_txt is null,
      'aucune fonction accessible aux membres ne change un statut, un masquage, un blocage ou une vérification (hors mod_*, réservées aux modérateurs)', v_txt);
    -- The mod_* functions are executable by authenticated only, never by anon
    select string_agg(p.proname, ', ') into v_txt
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'mod\_%'
      and (has_function_privilege('anon', p.oid, 'execute')
           or not has_function_privilege('authenticated', p.oid, 'execute')
           or not p.prosecdef);
    v_res := v_res || pg_temp.wp_ligne(v_txt is null
      and (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'mod\_%') = 8,
      'les 8 fonctions mod_* sont SECURITY DEFINER, exécutables par authenticated seulement', v_txt);
    -- Every function a member can call is SECURITY DEFINER with an empty search_path
    select string_agg(p.proname, ', ') into v_txt
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (has_function_privilege('authenticated', p.oid, 'execute')
           or has_function_privilege('anon', p.oid, 'execute'))
      and not (p.prosecdef and coalesce(p.proconfig, '{}') @> array['search_path=""'])
      and p.proname not like 'wp\_%' escape '\';
    v_res := v_res || pg_temp.wp_ligne(v_txt is null,
      'les fonctions accessibles sont SECURITY DEFINER avec search_path vide', v_txt);
    -- Internal helpers (wp_*) are not executable by anon / authenticated
    select string_agg(p.proname, ', ') into v_txt
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'wp\_%' escape '\'
      and (has_function_privilege('authenticated', p.oid, 'execute')
           or has_function_privilege('anon', p.oid, 'execute'));
    v_res := v_res || pg_temp.wp_ligne(v_txt is null,
      'les fonctions internes wp_* ne sont pas exécutables par anon ni authenticated', v_txt);

    -- =================================================================
    -- 8. A member cannot declare themself verified
    -- =================================================================
    perform pg_temp.wp_jouer('authenticated', v_pauvre);
    begin
      execute format('insert into public.verifications (user_id) values (%L)', v_pauvre);
      v_hint := 'insertion acceptée';
    exception when insufficient_privilege then v_hint := null;
              when others then v_hint := 'erreur ' || sqlstate;
    end;
    v_res := v_res || pg_temp.wp_ligne(v_hint is null,
      'un membre ne peut pas s''ajouter dans verifications', v_hint);
    v_j := public.get_mon_espace();
    v_res := v_res || pg_temp.wp_ligne((v_j ->> 'verifie')::boolean = false
                                       and v_j ->> 'email' = 'pauvre-' || v_suffixe || '@exemple.invalid',
      'get_mon_espace : verifie = false, renvoie bien le propre e-mail du membre', v_j::text);
    perform pg_temp.wp_jouer(null);

    -- =================================================================
    -- 9. Masking a comment: only the author of the problem
    -- =================================================================
    perform pg_temp.wp_jouer('authenticated', v_riche);
    begin
      perform public.masquer_commentaire(v_com_autre);
      v_hint := '(aucune erreur)';
    exception when others then
      get stacked diagnostics v_hint = pg_exception_hint;
    end;
    v_res := v_res || pg_temp.wp_ligne(v_hint = 'interdit',
      'un membre ne peut pas masquer un commentaire sur le problème d''un autre', v_hint);
    begin
      perform public.supprimer_mon_commentaire(v_com_autre);
      v_hint := '(aucune erreur)';
    exception when others then
      get stacked diagnostics v_hint = pg_exception_hint;
    end;
    v_res := v_res || pg_temp.wp_ligne(v_hint = 'interdit',
      'un membre ne peut pas supprimer le commentaire d''un autre', v_hint);
    perform pg_temp.wp_jouer('authenticated', v_pauvre);
    v_ok := public.masquer_commentaire(v_com_autre);
    perform pg_temp.wp_jouer(null);
    v_res := v_res || pg_temp.wp_ligne(
      v_ok and exists (select 1 from public.comments c
                       where c.id = v_com_autre and c.masque and c.masque_par = 'auteur_probleme'),
      'l''auteur du problème peut masquer un commentaire (masque_par = auteur_probleme)');

    -- =================================================================
    -- 10. Content filters
    -- =================================================================
    -- 10a. wp_raison_filtre (as postgres): reason for each sample
    for v_t, v_attendu in
      select f.texte, f.raison from (values
        ('Appelle-moi au 06 12 34 56 78',                 'telephone'),
        ('Mon numéro : 06.12.34.56.78',                   'telephone'),
        ('Mon numéro : +33 6 12 34 56 78',                'telephone'),
        ('Call me: +44 20 7946 0958',                     'telephone'),
        ('Référence 1234567890123',                       'telephone'),
        ('Mon IBAN : FR76 3000 6000 0112 3456 7890 189',  'iban'),
        ('IBAN DE89370400440532013000',                   'iban'),
        ('Écris-moi : jean.dupont@gmail.com',             'email'),
        ('jean (at) gmail.com',                           'email'),
        ('Va voir https://exemple.org/page',              'lien'),
        ('Rendez-vous sur www.exemple.com',               'lien'),
        ('Mon site : monprojet.fr',                       'lien'),
        ('Espèce de CONNARD !',                           'mot_interdit'),
        ('Quel enculé',                                   'mot_interdit'),
        ('Ta Gueule',                                     'mot_interdit'),
        ('J’envoie un pdf rapide',                        null),
        ('Le 12 mai à 14 h, j’ai payé 350 €.',            null),
        ('Mon chat a 3 ans et pèse 5 kg.',                null),
        ('Bonjour à tous, on y croit !',                  null)
      ) as f(texte, raison)
    loop
      v_txt := public.wp_raison_filtre(v_t);
      v_res := v_res || pg_temp.wp_ligne(v_txt is not distinct from v_attendu,
        format('filtre : « %s » → %s', v_t, coalesce(v_attendu, 'accepté')), coalesce(v_txt, 'accepté'));
    end loop;

    -- 10b. Through the RPC functions (as a member)
    perform pg_temp.wp_jouer('authenticated', v_pauvre3);
    for v_t, v_attendu in
      select f.texte, f.libelle from (values
        ('Appelle-moi au 06 12 34 56 78',                 'un numéro de téléphone'),
        ('Mon IBAN : FR76 3000 6000 0112 3456 7890 189',  'un IBAN'),
        ('Écris-moi : jean.dupont@gmail.com',             'une adresse e-mail'),
        ('Va voir www.exemple.com',                       'un lien'),
        ('Espèce de connard',                             'un mot interdit')
      ) as f(texte, libelle)
    loop
      begin
        perform public.commenter(v_pb_publie, v_t);
        v_hint := '(aucune erreur)';
      exception when others then
        get stacked diagnostics v_hint = pg_exception_hint, v_txt = message_text;
      end;
      v_res := v_res || pg_temp.wp_ligne(
        v_hint = 'filtre' and v_txt = 'Ton message contient un numéro, un lien ou un mot interdit. Relis les règles du jeu.',
        'commenter rejette ' || v_attendu, v_hint);
    end loop;
    begin
      perform public.soumettre_probleme('reve', 'Appelez le 06 12 34 56 78', 'Un texte de test assez long.', null);
      v_hint := '(aucune erreur)';
    exception when others then
      get stacked diagnostics v_hint = pg_exception_hint;
    end;
    v_res := v_res || pg_temp.wp_ligne(v_hint = 'filtre', 'soumettre_probleme filtre le titre', v_hint);
    begin
      perform public.envoyer_message_club('Mon IBAN : FR76 3000 6000 0112 3456 7890 189');
      v_hint := '(aucune erreur)';
    exception when others then
      get stacked diagnostics v_hint = pg_exception_hint;
    end;
    v_res := v_res || pg_temp.wp_ligne(v_hint = 'filtre', 'envoyer_message_club filtre le message', v_hint);
    begin
      perform public.maj_profil(p_pseudo => 'Connard');
      v_hint := '(aucune erreur)';
    exception when others then
      get stacked diagnostics v_hint = pg_exception_hint;
    end;
    v_res := v_res || pg_temp.wp_ligne(v_hint = 'filtre', 'maj_profil filtre le pseudo', v_hint);
    begin
      perform public.commenter(v_pb_publie, '   ');
      v_hint := '(aucune erreur)';
    exception when others then
      get stacked diagnostics v_hint = pg_exception_hint, v_txt = message_text;
    end;
    v_res := v_res || pg_temp.wp_ligne(v_hint = 'invalide' and v_txt = 'Ton commentaire est vide.',
      'commenter refuse un commentaire vide (« Ton commentaire est vide. »)', v_txt);
    v_j := public.commenter(v_pb_publie, E'  C’est   rapide   et efficace, bravo !\n\n\n\nVraiment.  ');
    v_res := v_res || pg_temp.wp_ligne(
      v_j ->> 'texte' = E'C’est rapide et efficace, bravo !\n\nVraiment.' and (v_j ->> 'est_moi')::boolean,
      'un commentaire propre est accepté et nettoyé (espaces, lignes vides)', v_j ->> 'texte');
    perform pg_temp.wp_jouer(null);

    -- =================================================================
    -- 11. A blocked member can no longer write
    -- =================================================================
    perform pg_temp.wp_jouer('authenticated', v_bloque);
    foreach v_t in array array[
      format('select public.soumettre_probleme(%L, %L, %L)', 'reve', 'Un titre correct', 'Un texte de test assez long.'),
      format('select public.reagir(%L::uuid, %L)', v_pb_publie, 'rire'),
      format('select public.commenter(%L::uuid, %L)', v_pb_publie, 'Je suis bloqué'),
      format('select public.envoyer_message_club(%L)', 'Je suis bloqué'),
      format('select public.signaler(%L, %L::uuid)', 'probleme', v_pb_publie),
      format('select public.maj_profil(p_pseudo => %L)', 'Nouveau pseudo'),
      format('select public.masquer_commentaire(%L::uuid)', v_com_visible),
      'select public.get_club_messages()'
    ] loop
      begin
        execute v_t;
        v_hint := '(aucune erreur)';
      exception when others then
        get stacked diagnostics v_hint = pg_exception_hint;
      end;
      v_res := v_res || pg_temp.wp_ligne(v_hint = 'bloque', 'un membre bloqué est refusé : ' || v_t, v_hint);
    end loop;
    v_j := public.get_mon_espace();
    v_res := v_res || pg_temp.wp_ligne((v_j ->> 'bloque')::boolean,
      'un membre bloqué voit son état dans get_mon_espace', v_j::text);
    perform pg_temp.wp_jouer(null);

    -- =================================================================
    -- 12. The 3rd report masks the target (problem, comment, club message)
    -- =================================================================
    -- comment v_com_visible (R's comment on P's problem), reported by P, P2, P3
    v_txt := '';
    foreach v_role in array array[v_pauvre::text, v_pauvre2::text, v_pauvre3::text] loop
      perform pg_temp.wp_jouer('authenticated', v_role::uuid);
      v_txt := v_txt || (public.signaler('commentaire', v_com_visible) ->> 'masque') || ' ';
    end loop;
    perform pg_temp.wp_jouer('anon');
    select e into v_j
    from jsonb_array_elements(public.get_commentaires(v_pb_publie, null)) as e
    where e ->> 'id' = v_com_visible::text;
    perform pg_temp.wp_jouer(null);
    v_res := v_res || pg_temp.wp_ligne(
      v_txt = 'false false true '
        and v_j -> 'texte' = 'null'::jsonb
        and exists (select 1 from public.comments c
                    where c.id = v_com_visible and c.masque and c.masque_par = 'signalements'),
      'le 3e signalement masque un commentaire (masque_par = signalements)', v_txt);

    -- problem v_pb_riche, reported by P, P2, P3
    v_txt := '';
    foreach v_role in array array[v_pauvre::text, v_pauvre2::text, v_pauvre3::text] loop
      perform pg_temp.wp_jouer('authenticated', v_role::uuid);
      v_txt := v_txt || (public.signaler('probleme', v_pb_riche) ->> 'masque') || ' ';
    end loop;
    perform pg_temp.wp_jouer('anon');
    v_ok := public.get_probleme_public(v_pb_riche) is null;
    perform pg_temp.wp_jouer(null);
    v_res := v_res || pg_temp.wp_ligne(v_txt = 'false false true ' and v_ok,
      'le 3e signalement masque un problème (il disparaît du site)', v_txt);

    -- club message v_msg_cible (P2), reported by P, P3, P4
    v_txt := '';
    foreach v_role in array array[v_pauvre::text, v_pauvre3::text, v_pauvre4::text] loop
      perform pg_temp.wp_jouer('authenticated', v_role::uuid);
      v_txt := v_txt || (public.signaler('message', v_msg_cible) ->> 'masque') || ' ';
    end loop;
    v_ok := position(v_msg_cible::text in public.get_club_messages()::text) = 0;
    v_res := v_res || pg_temp.wp_ligne(v_txt = 'false false true ' and v_ok,
      'le 3e signalement masque un message de club', v_txt);

    -- one report per member and per target
    perform pg_temp.wp_jouer('authenticated', v_pauvre);
    begin
      perform public.signaler('commentaire', v_com_visible);
      v_hint := '(aucune erreur)';
    exception when others then
      get stacked diagnostics v_hint = pg_exception_hint;
    end;
    v_res := v_res || pg_temp.wp_ligne(v_hint = 'deja_fait',
      'un membre ne peut signaler deux fois le même contenu', v_hint);
    perform pg_temp.wp_jouer(null);

    -- =================================================================
    -- 13. Rate limits (member P5): 3 problems / 24 h, 10 comments / h,
    --     30 club messages / h, 20 reports / h
    -- =================================================================
    perform pg_temp.wp_jouer('authenticated', v_pauvre5);

    v_i := 0; v_hint := null;
    begin
      for v_k in 1 .. 4 loop
        perform public.soumettre_probleme('defi', 'Problème de test ' || v_k,
                                          'Un texte de test pour la limite, numéro ' || v_k || '.', null);
        v_i := v_i + 1;
      end loop;
    exception when others then
      get stacked diagnostics v_hint = pg_exception_hint;
    end;
    v_res := v_res || pg_temp.wp_ligne(v_i = 3 and v_hint = 'limite',
      'limite de 3 problèmes par 24 h', format('%s acceptés, %s', v_i, v_hint));

    v_i := 0; v_hint := null;
    begin
      for v_k in 1 .. 11 loop
        perform public.commenter(v_pb_publie, 'Commentaire de test ' || v_k);
        v_i := v_i + 1;
      end loop;
    exception when others then
      get stacked diagnostics v_hint = pg_exception_hint;
    end;
    v_res := v_res || pg_temp.wp_ligne(v_i = 10 and v_hint = 'limite',
      'limite de 10 commentaires par heure', format('%s acceptés, %s', v_i, v_hint));

    v_i := 0; v_hint := null;
    begin
      for v_k in 1 .. 31 loop
        perform public.envoyer_message_club('Message de test ' || v_k);
        v_i := v_i + 1;
      end loop;
    exception when others then
      get stacked diagnostics v_hint = pg_exception_hint;
    end;
    v_res := v_res || pg_temp.wp_ligne(v_i = 30 and v_hint = 'limite',
      'limite de 30 messages de club par heure', format('%s acceptés, %s', v_i, v_hint));

    perform pg_temp.wp_jouer(null);
    insert into public.comments (problem_id, user_id, texte)
    select v_pb_publie, v_riche, 'Cible de signalement ' || g
    from generate_series(1, 21) as g;
    select array_agg(c.id) into v_cibles
    from public.comments c
    where c.problem_id = v_pb_publie and c.texte like 'Cible de signalement %';
    perform pg_temp.wp_jouer('authenticated', v_pauvre5);
    v_i := 0; v_hint := null;
    begin
      for v_k in 1 .. 21 loop
        perform public.signaler('commentaire', v_cibles[v_k]);
        v_i := v_i + 1;
      end loop;
    exception when others then
      get stacked diagnostics v_hint = pg_exception_hint;
    end;
    v_res := v_res || pg_temp.wp_ligne(v_i = 20 and v_hint = 'limite',
      'limite de 20 signalements par heure', format('%s acceptés, %s', v_i, v_hint));
    perform pg_temp.wp_jouer(null);

    -- =================================================================
    -- 14. Callers without session / without profile
    -- =================================================================
    perform pg_temp.wp_jouer('authenticated', null);
    begin
      perform public.commenter(v_pb_publie, 'Bonjour');
      v_hint := '(aucune erreur)';
    exception when others then
      get stacked diagnostics v_hint = pg_exception_hint;
    end;
    v_res := v_res || pg_temp.wp_ligne(v_hint = 'non_connecte',
      'sans identifiant (auth.uid() null) : refus non_connecte', v_hint);

    perform pg_temp.wp_jouer('authenticated', v_anonyme);
    begin
      perform public.commenter(v_pb_publie, 'Bonjour');
      v_hint := '(aucune erreur)';
    exception when others then
      get stacked diagnostics v_hint = pg_exception_hint;
    end;
    v_res := v_res || pg_temp.wp_ligne(v_hint = 'profil_absent',
      'sans profil : refus profil_absent', v_hint);
    v_res := v_res || pg_temp.wp_ligne(public.get_mes_reactions(array[v_pb_publie]) = '[]'::jsonb,
      'sans profil : get_mes_reactions renvoie une liste vide');

    perform pg_temp.wp_jouer('authenticated', v_pauvre);
    begin
      perform public.creer_profil('riche', 'Deuxieme profil', 'autre-' || v_suffixe || '@exemple.invalid');
      v_hint := '(aucune erreur)';
    exception when others then
      get stacked diagnostics v_hint = pg_exception_hint, v_txt = message_text;
    end;
    v_res := v_res || pg_temp.wp_ligne(v_hint = 'invalide' and v_txt = 'Ton profil existe déjà.',
      'creer_profil refuse un second profil', v_txt);

    -- Referral: P5 joined with P's code (lower case)
    v_j := public.get_mon_espace();
    v_res := v_res || pg_temp.wp_ligne((v_j ->> 'nb_invites')::integer = 1,
      'parrainage : le code de partage (insensible à la casse) est résolu', v_j ->> 'nb_invites');
    perform pg_temp.wp_jouer(null);

    -- =================================================================
    -- 15. supprimer_utilisateur_anonyme / supprimer_mon_compte
    -- =================================================================
    perform pg_temp.wp_jouer('authenticated', v_riche);
    v_ok := public.supprimer_utilisateur_anonyme();
    perform pg_temp.wp_jouer('authenticated', v_anonyme);
    v_ok := (not v_ok) and public.supprimer_utilisateur_anonyme();
    perform pg_temp.wp_jouer(null);
    v_res := v_res || pg_temp.wp_ligne(
      v_ok and not exists (select 1 from auth.users u where u.id = v_anonyme)
           and exists (select 1 from auth.users u where u.id = v_riche),
      'supprimer_utilisateur_anonyme ne supprime qu''un utilisateur anonyme sans profil');

    perform pg_temp.wp_jouer('authenticated', v_partant);
    perform public.soumettre_probleme('amour', 'Problème du partant', 'Ce problème part avec son auteur.', null);
    perform public.reagir(v_pb_publie, 'courage');
    v_ok := public.supprimer_mon_compte();
    perform pg_temp.wp_jouer(null);
    v_res := v_res || pg_temp.wp_ligne(
      v_ok
      and not exists (select 1 from public.profiles pr where pr.id = v_partant)
      and not exists (select 1 from public.problems p where p.user_id = v_partant)
      and not exists (select 1 from public.reactions r where r.user_id = v_partant)
      and not exists (select 1 from auth.users u where u.id = v_partant),
      'supprimer_mon_compte efface le profil, les contenus et l''utilisateur auth');

    -- =================================================================
    -- 16. Moderators (006): mod_* closed to anon and to non-moderators,
    --     full moderator flow, never an e-mail
    -- =================================================================
    perform pg_temp.wp_jouer(null);
    insert into public.reglages (cle, valeur) values ('publication_auto', 'true'::jsonb)
    on conflict (cle) do update set valeur = excluded.valeur;
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at,
                            raw_app_meta_data, raw_user_meta_data, is_anonymous)
    select '00000000-0000-0000-0000-000000000000'::uuid, u.id, 'authenticated', 'authenticated',
           u.nom || '-' || v_suffixe || '@exemple.invalid', '', now(), now(), now(),
           '{}'::jsonb, '{}'::jsonb, false
    from (values (v_modo, 'modo'), (v_auteur, 'auteur')) as u(id, nom);
    perform pg_temp.wp_jouer('authenticated', v_modo);
    perform public.creer_profil('riche', 'Modo de test', 'modo-' || v_suffixe || '@exemple.invalid');
    perform pg_temp.wp_jouer('authenticated', v_auteur);
    perform public.creer_profil('pauvre', 'Auteur modere', 'auteur-' || v_suffixe || '@exemple.invalid');
    v_j := public.soumettre_probleme('quotidien', 'Mon chat me snobe', 'Mon chat refuse de me dire bonjour le matin.', null);
    v_pb_m_pub := (v_j ->> 'id')::uuid;
    v_j := public.soumettre_probleme('famille', 'Ma soeur malade', 'Ma soeur commence sa chimio, on aimerait un coup de main.', null);
    v_pb_m_recu := (v_j ->> 'id')::uuid;
    v_com_m := (public.commenter(v_pb_m_pub, 'Commentaire a moderer') ->> 'id')::uuid;
    perform pg_temp.wp_jouer(null);
    insert into public.moderateurs (user_id) values (v_modo);

    v_mod_fns := array[
      'select public.mod_suis_je()',
      'select public.mod_a_relire()',
      'select public.mod_recents(48)',
      'select public.mod_masques()',
      'select public.mod_signalements_24h()',
      format('select public.mod_moderer_probleme(%L::uuid, %L)', v_pb_m_recu, 'publie'),
      format('select public.mod_masquer(%L, %L::uuid, true)', 'probleme', v_pb_m_pub),
      format('select public.mod_bloquer(%L::uuid, true)', v_auteur)
    ];

    -- anon: no EXECUTE on any mod_* function
    perform pg_temp.wp_jouer('anon');
    foreach v_t in array v_mod_fns loop
      begin
        execute v_t;
        v_hint := 'exécuté';
      exception when insufficient_privilege then v_hint := null;
                when others then v_hint := 'erreur ' || sqlstate;
      end;
      v_res := v_res || pg_temp.wp_ligne(v_hint is null, 'anon ne peut pas exécuter : ' || v_t, v_hint);
    end loop;

    -- a member who is not a moderator: mod_suis_je() = false, every other mod_* refused ('interdit')
    perform pg_temp.wp_jouer('authenticated', v_pauvre);
    v_res := v_res || pg_temp.wp_ligne(public.mod_suis_je() = false,
      'mod_suis_je() renvoie false pour un membre non modérateur');
    foreach v_t in array v_mod_fns[2:] loop
      begin
        execute v_t;
        v_hint := 'exécuté';
      exception when others then
        get stacked diagnostics v_hint = pg_exception_hint;
      end;
      v_res := v_res || pg_temp.wp_ligne(v_hint = 'interdit', 'un non-modérateur est refusé : ' || v_t, v_hint);
    end loop;
    -- the author of the problems (not a moderator either), and a caller without uid
    perform pg_temp.wp_jouer('authenticated', v_auteur);
    begin
      perform public.mod_moderer_probleme(v_pb_m_recu, 'publie');
      v_hint := 'exécuté';
    exception when others then
      get stacked diagnostics v_hint = pg_exception_hint;
    end;
    v_res := v_res || pg_temp.wp_ligne(v_hint = 'interdit',
      'un auteur ne peut pas publier lui-même son problème en attente', v_hint);
    perform pg_temp.wp_jouer('authenticated', null);
    begin
      perform public.mod_a_relire();
      v_hint := 'exécuté';
    exception when others then
      get stacked diagnostics v_hint = pg_exception_hint;
    end;
    v_res := v_res || pg_temp.wp_ligne(public.mod_suis_je() = false and v_hint = 'interdit',
      'sans identifiant : mod_suis_je() = false et mod_a_relire refusé', v_hint);
    perform pg_temp.wp_jouer(null);
    v_res := v_res || pg_temp.wp_ligne(
      (select p.statut from public.problems p where p.id = v_pb_m_recu) = 'recu'
      and not (select p.masque from public.problems p where p.id = v_pb_m_pub)
      and not (select pr.bloque from public.profiles pr where pr.id = v_auteur),
      'les refus n''ont rien modifié (statut, masque, blocage)');

    -- the moderator
    perform pg_temp.wp_jouer('authenticated', v_modo);
    v_res := v_res || pg_temp.wp_ligne(public.mod_suis_je(), 'mod_suis_je() renvoie true pour un modérateur');

    v_j := public.mod_a_relire();
    v_res := v_res || pg_temp.wp_ligne(
      jsonb_typeof(v_j) = 'array'
      and exists (select 1 from jsonb_array_elements(v_j) e
                  where e ->> 'id' = v_pb_m_recu::text and e ->> 'user_id' = v_auteur::text
                    and e ->> 'pseudo' = 'Auteur modere')
      and not exists (select 1 from jsonb_array_elements(v_j) e where e ->> 'id' = v_pb_m_pub::text),
      'mod_a_relire liste le problème sensible en attente (avec son auteur), pas le publié');

    v_j := public.mod_recents(48);
    v_res := v_res || pg_temp.wp_ligne(
      exists (select 1 from jsonb_array_elements(v_j) e where e ->> 'id' = v_pb_m_pub::text)
      and not exists (select 1 from jsonb_array_elements(v_j) e where e ->> 'id' = v_pb_m_recu::text)
      and not exists (select 1 from jsonb_array_elements(v_j) e where (e ->> 'statut') <> 'publie'),
      'mod_recents(48) liste les problèmes publiés récents seulement');

    v_j := public.mod_moderer_probleme(v_pb_m_recu, 'publie');
    perform pg_temp.wp_jouer(null);  -- table checks as postgres
    v_res := v_res || pg_temp.wp_ligne(
      v_j ->> 'statut' = 'publie'
      and exists (select 1 from public.problems p
                  where p.id = v_pb_m_recu and p.statut = 'publie' and p.modere_le is not null)
      and public.get_probleme_public(v_pb_m_recu) is not null,
      'mod_moderer_probleme publie un problème en attente (visible sur le site)');
    perform pg_temp.wp_jouer('authenticated', v_modo);
    perform public.mod_moderer_probleme(v_pb_m_recu, 'reoriente');
    perform public.mod_moderer_probleme(v_pb_m_recu, 'refuse');
    perform pg_temp.wp_jouer(null);  -- table checks as postgres
    v_res := v_res || pg_temp.wp_ligne(
      (select p.statut from public.problems p where p.id = v_pb_m_recu) = 'refuse'
      and public.get_probleme_public(v_pb_m_recu) is null,
      'mod_moderer_probleme réoriente puis refuse (retiré du site)');
    perform pg_temp.wp_jouer('authenticated', v_modo);
    begin
      perform public.mod_moderer_probleme(v_pb_m_recu, 'supprime');
      v_hint := 'exécuté';
    exception when others then
      get stacked diagnostics v_hint = pg_exception_hint;
    end;
    v_res := v_res || pg_temp.wp_ligne(v_hint = 'invalide', 'mod_moderer_probleme refuse un statut inconnu', v_hint);

    perform public.signaler('probleme', v_pb_m_pub);
    v_j := public.mod_signalements_24h();
    v_res := v_res || pg_temp.wp_ligne(
      exists (select 1 from jsonb_array_elements(v_j) e
              where e ->> 'cible_id' = v_pb_m_pub::text and (e ->> 'nb_signalements')::integer = 1
                and e ->> 'user_id' = v_auteur::text),
      'mod_signalements_24h liste le contenu signalé et son auteur');

    v_j := public.mod_masquer('probleme', v_pb_m_pub, true);
    v_ok := exists (select 1 from jsonb_array_elements(public.mod_masques()) e
                    where e ->> 'cible_id' = v_pb_m_pub::text and e ->> 'cible_type' = 'probleme');
    perform pg_temp.wp_jouer(null);  -- table checks as postgres
    v_ok := v_ok and (select p.masque from public.problems p where p.id = v_pb_m_pub)
            and public.get_probleme_public(v_pb_m_pub) is null;
    perform pg_temp.wp_jouer('authenticated', v_modo);
    perform public.mod_masquer('problem', v_pb_m_pub, false);
    perform pg_temp.wp_jouer(null);  -- table checks as postgres
    v_res := v_res || pg_temp.wp_ligne(
      v_ok and not (select p.masque from public.problems p where p.id = v_pb_m_pub)
      and public.get_probleme_public(v_pb_m_pub) is not null,
      'mod_masquer masque un problème (listé dans mod_masques) puis le rétablit (alias problem)');

    perform pg_temp.wp_jouer('authenticated', v_modo);
    perform public.mod_masquer('commentaire', v_com_m, true);
    perform pg_temp.wp_jouer(null);  -- table checks as postgres
    v_ok := exists (select 1 from public.comments c where c.id = v_com_m and c.masque and c.masque_par = 'admin');
    perform pg_temp.wp_jouer('authenticated', v_modo);
    perform public.mod_masquer('comment', v_com_m, false);
    perform pg_temp.wp_jouer(null);  -- table checks as postgres
    v_res := v_res || pg_temp.wp_ligne(
      v_ok and exists (select 1 from public.comments c where c.id = v_com_m and not c.masque and c.masque_par is null),
      'mod_masquer masque puis rétablit un commentaire');
    perform pg_temp.wp_jouer('authenticated', v_modo);
    perform public.mod_masquer('message', v_msg_cible, true);
    perform pg_temp.wp_jouer(null);  -- table checks as postgres
    v_ok := exists (select 1 from public.club_messages m where m.id = v_msg_cible and m.masque);
    perform pg_temp.wp_jouer('authenticated', v_modo);
    perform public.mod_masquer('club_message', v_msg_cible, false);
    perform pg_temp.wp_jouer(null);  -- table checks as postgres
    v_res := v_res || pg_temp.wp_ligne(
      v_ok and exists (select 1 from public.club_messages m where m.id = v_msg_cible and not m.masque),
      'mod_masquer masque puis rétablit un message de club');
    perform pg_temp.wp_jouer('authenticated', v_modo);
    begin
      perform public.mod_masquer('profil', v_pb_m_pub, true);
      v_hint := 'exécuté';
    exception when others then
      get stacked diagnostics v_hint = pg_exception_hint;
    end;
    v_res := v_res || pg_temp.wp_ligne(v_hint = 'invalide', 'mod_masquer refuse un type inconnu', v_hint);

    perform public.mod_bloquer(v_auteur, true);
    perform pg_temp.wp_jouer('authenticated', v_auteur);
    begin
      perform public.commenter(v_pb_m_pub, 'Je suis bloqué');
      v_hint := 'exécuté';
    exception when others then
      get stacked diagnostics v_hint = pg_exception_hint;
    end;
    perform pg_temp.wp_jouer('authenticated', v_modo);
    v_txt := v_hint;
    perform public.mod_bloquer(v_auteur, false);
    perform pg_temp.wp_jouer(null);  -- table checks as postgres
    v_res := v_res || pg_temp.wp_ligne(
      v_txt = 'bloque' and not (select pr.bloque from public.profiles pr where pr.id = v_auteur),
      'mod_bloquer bloque un auteur (plus d''écriture) puis le débloque', v_txt);
    perform pg_temp.wp_jouer('authenticated', v_modo);
    begin
      perform public.mod_bloquer(v_modo, true);
      v_hint := 'exécuté';
    exception when others then
      get stacked diagnostics v_hint = pg_exception_hint;
    end;
    v_res := v_res || pg_temp.wp_ligne(v_hint = 'invalide', 'un modérateur ne peut pas se bloquer lui-même', v_hint);

    v_txt := public.mod_a_relire()::text || public.mod_recents(720)::text || public.mod_masques()::text
          || public.mod_signalements_24h()::text;
    v_res := v_res || pg_temp.wp_ligne(position(v_suffixe in v_txt) = 0 and v_txt !~ '"email"',
      'les fonctions mod_* ne renvoient aucune adresse e-mail');

    -- deleting the moderator's account removes their moderator right
    v_ok := public.supprimer_mon_compte();
    perform pg_temp.wp_jouer(null);
    v_res := v_res || pg_temp.wp_ligne(
      v_ok and not exists (select 1 from public.moderateurs m where m.user_id = v_modo),
      'supprimer_mon_compte retire aussi le droit de modérateur');

    -- End: undo everything written above
    raise exception using errcode = 'P0999', message = 'wp_fin_des_tests';
  exception
    when sqlstate 'P0999' then
      null;
    when others then
      get stacked diagnostics v_etat = returned_sqlstate, v_txt = message_text, v_hint = pg_exception_context;
      v_res := v_res || ('ÉCHEC - erreur inattendue, tests interrompus : ' || v_txt
                         || ' [' || v_etat || '] ' || coalesce(v_hint, ''));
  end;

  -- Here the sub-transaction is rolled back: no test data is left, the role is postgres again.
  v_i := (select count(*) from unnest(v_res) as l where l like 'ÉCHEC%');
  v_res := v_res || (case when v_i = 0
                          then format('OK - BILAN : %s tests, aucun échec', array_length(v_res, 1))
                          else format('ÉCHEC - BILAN : %s tests, %s échec(s)', array_length(v_res, 1), v_i) end);
  foreach v_txt in array v_res loop
    raise notice '%', v_txt;
  end loop;
  insert into pg_temp.wp_resultats (ligne) select unnest(v_res);
end
$test$;

select ligne as resultat from pg_temp.wp_resultats order by n;

rollback;
