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

-- Runs p_sql as the current role and expects an error whose hint (our error code) is p_code.
create function pg_temp.wp_attendre_erreur(p_sql text, p_code text, p_libelle text)
returns text
language plpgsql
as $f$
declare
  v_hint text;
begin
  begin
    execute p_sql;
    v_hint := 'aucune erreur';
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    v_hint := coalesce(nullif(v_hint, ''), 'erreur ' || sqlstate || ' ' || sqlerrm);
  end;
  return pg_temp.wp_ligne(v_hint = p_code, p_libelle, v_hint);
end;
$f$;

-- Default privileges (002) remove EXECUTE from PUBLIC: give the test helpers back to everyone.
grant execute on function pg_temp.wp_jouer(text, uuid) to public;
grant execute on function pg_temp.wp_ligne(boolean, text, text) to public;
grant execute on function pg_temp.wp_attendre_erreur(text, text, text) to public;

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
                             'moderateurs', 'annonces', 'annonce_envois', 'limites_ip', 'couronnes', 'notifications'];
  v_colonnes text[] := array['pseudo', 'titre', 'type', 'texte', 'texte',
                             'cible_type', 'verifie_le', 'mot', 'valeur', 'mot',
                             'user_id', 'user_id', 'user_id', 'action', 'riche_id', 'texte'];
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
  -- paying rich members (010)
  v_r_att       uuid := gen_random_uuid();
  v_r_ex        uuid := gen_random_uuid();
  v_modo2       uuid := gen_random_uuid();
  v_avant       integer;
  v_annonce     uuid;
  v_moment      uuid;
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
    -- 010: a new rich member waits for a moderator; the two test rich members are validated here
    perform pg_temp.wp_jouer(null);
    update public.profiles pr set statut_riche = 'actif' where pr.id in (v_riche, v_partant);

    v_res := v_res || pg_temp.wp_ligne(v_code_p ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$',
      'creer_profil renvoie un code de partage de 8 caractères', v_code_p);

    -- Problems: P submits 3, R submits 1 (published at once, except v_pb_recu: sensitive word -> 'recu')
    perform pg_temp.wp_jouer('authenticated', v_pauvre);
    v_pb_publie := (public.soumettre_probleme('factures', 'Ma facture de test',
                    'Un texte de test, assez long pour passer.', 120) ->> 'id')::uuid;
    v_pb_recu   := (public.soumettre_probleme('reve', 'Mon rêve non publié',
                    'Ma mère commence sa chimio : ce problème attend la modération.', 80) ->> 'id')::uuid;
    v_pb_masque := (public.soumettre_probleme('patron', 'Mon patron masqué',
                    'Ce problème est publié puis masqué.', 300) ->> 'id')::uuid;
    perform pg_temp.wp_jouer('authenticated', v_riche);
    v_pb_riche  := (public.publier_riche('riche', 'Un projet de riche, publié pour les tests.',
                    'Le projet du riche', 5000) ->> 'id')::uuid;

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
                                     'Ce problème doit attendre la modération.', 60);
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
        ('Bonjour à tous, on y croit !',        false),
        -- 007: fewer false positives, explicit first-person expressions
        ('Je vais mourir de rire',              false),
        ('Mon enceinte Bluetooth est cassée',   false),
        ('Un abus de pouvoir de mon chef',      false),
        ('Je suis drogué au café',              false),
        ('Mon chat frappe à la porte',          false),
        ('J''ai envie de mourir',               true),
        ('Je veux mourir',                      true),
        ('Je suis enceinte de 3 mois',          true),
        ('Il me frappe quand il a bu',          true),
        ('J''ai des idées noires',              true),
        ('Des pensées suicidaires',             true)
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

    -- 7f. Through soumettre_probleme (007): humour published at once, real distress waits
    perform pg_temp.wp_jouer('authenticated', v_pauvre4);
    v_j := public.soumettre_probleme('quotidien', 'Je vais mourir de rire',
                                     'Mon chat a encore raté son saut sur le canapé.', 20);
    v_txt := v_j ->> 'statut';
    v_j := public.soumettre_probleme('plaisir', 'Mon enceinte Bluetooth me trahit',
                                     'Elle se connecte toute seule chez le voisin.', 30);
    v_txt := v_txt || ' ' || (v_j ->> 'statut');
    v_j := public.soumettre_probleme('quotidien', 'Une période difficile',
                                     'J''ai envie de mourir depuis quelques semaines.', 100);
    v_txt := v_txt || ' ' || (v_j ->> 'statut');
    perform pg_temp.wp_jouer(null);
    v_res := v_res || pg_temp.wp_ligne(v_txt = 'publie publie recu',
      '007 : « mourir de rire » et « enceinte Bluetooth » publiés, « envie de mourir » en relecture', v_txt);
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
      and not (p.proname like 'mod\_%' and p.prosrc like '%public.wp_exiger_moderateur()%');
    v_res := v_res || pg_temp.wp_ligne(v_txt is null,
      'aucune fonction accessible aux membres ne change un statut, un masquage, un blocage ou une vérification (hors mod_*, réservées aux modérateurs)', v_txt);
    -- The mod_* functions are executable by authenticated only, never by anon, and every one of them
    -- (except mod_suis_je) starts with the moderator check
    select string_agg(p.proname, ', ') into v_txt
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'mod\_%'
      and (has_function_privilege('anon', p.oid, 'execute')
           or not has_function_privilege('authenticated', p.oid, 'execute')
           or not p.prosecdef
           or (p.proname <> 'mod_suis_je' and p.prosrc not like '%public.wp_exiger_moderateur()%'));
    v_res := v_res || pg_temp.wp_ligne(v_txt is null
      and (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'mod\_%') >= 12,
      'les fonctions mod_* (12 au moins) sont SECURITY DEFINER, authenticated seulement, et vérifient le modérateur', v_txt);
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
      perform public.soumettre_probleme('reve', 'Appelez le 06 12 34 56 78', 'Un texte de test assez long.', 100);
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
      format('select public.soumettre_probleme(%L, %L, %L, 100)', 'reve', 'Un titre correct', 'Un texte de test assez long.'),
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
    -- 13. Rate limits (member P5): 10 problems / 24 h (008), 10 comments / h,
    --     30 club messages / h, 20 reports / h
    -- =================================================================
    perform pg_temp.wp_jouer('authenticated', v_pauvre5);

    v_i := 0; v_hint := null;
    begin
      for v_k in 1 .. 11 loop
        perform public.soumettre_probleme('defi', 'Problème de test ' || v_k,
                                          'Un texte de test pour la limite, numéro ' || v_k || '.', 10 * v_k);
        v_i := v_i + 1;
      end loop;
    exception when others then
      get stacked diagnostics v_hint = pg_exception_hint;
    end;
    v_res := v_res || pg_temp.wp_ligne(v_i = 10 and v_hint = 'limite',
      'limite de 10 problèmes par 24 h (008)', format('%s acceptés, %s', v_i, v_hint));

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
    perform public.publier_riche('publication', 'Cette publication part avec son auteur.');
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
    v_j := public.soumettre_probleme('quotidien', 'Mon chat me snobe', 'Mon chat refuse de me dire bonjour le matin.', 40);
    v_pb_m_pub := (v_j ->> 'id')::uuid;
    v_j := public.soumettre_probleme('famille', 'Ma soeur malade', 'Ma soeur commence sa chimio, on aimerait un coup de main.', 200);
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

    -- =================================================================
    -- 17. R-027 (008): the poor must give an amount from 1 to 10 000 €
    -- =================================================================
    perform pg_temp.wp_jouer('authenticated', v_pauvre3);
    foreach v_t in array array['null', '0', '-5', '10001'] loop
      begin
        execute format('select public.soumettre_probleme(%L, %L, %L, %s)',
                       'reve', 'Un rêve sans plafond', 'Un texte de test assez long.', v_t);
        v_hint := '(aucune erreur)'; v_txt := null;
      exception when others then
        get stacked diagnostics v_hint = pg_exception_hint, v_txt = message_text;
      end;
      v_res := v_res || pg_temp.wp_ligne(v_hint = 'invalide'
          and (v_t <> '10001' or v_txt = 'Un problème de pauvre ne dépasse jamais 10x Rien (10 000 €).'),
        'un pauvre ne publie pas avec le montant ' || v_t, coalesce(v_txt, v_hint));
    end loop;
    v_j := public.soumettre_probleme('reve', 'Un rêve au plafond', 'Un texte de test assez long.', 10000);
    perform pg_temp.wp_jouer(null);
    v_res := v_res || pg_temp.wp_ligne(
      (select p.montant from public.problems p where p.id = (v_j ->> 'id')::uuid) = 10000,
      'un pauvre publie avec 10 000 € (le plafond)', v_j::text);
    v_res := v_res || pg_temp.wp_ligne(
      not exists (select 1 from public.problems p where p.est_exemple and p.montant > 10000),
      'aucun exemple ne dépasse 10 000 €');

    -- =================================================================
    -- 18. R-028 (009): leaderboard of the poor
    -- =================================================================
    perform pg_temp.wp_jouer('anon');
    v_j := public.get_palmares(100);
    v_res := v_res || pg_temp.wp_ligne(
      public.get_mon_rang() is null and jsonb_typeof(v_j -> 'lignes') = 'array'
        and jsonb_array_length(v_j -> 'lignes') <= 100 and (v_j ->> 'classes')::integer >= 0,
      'anon lit le palmarès ; get_mon_rang renvoie null pour un visiteur', left(v_j::text, 200));
    v_res := v_res || pg_temp.wp_ligne(
      jsonb_array_length(public.get_palmares(1000) -> 'lignes') <= 100
        and jsonb_array_length(public.get_palmares(0) -> 'lignes') <= 1,
      'get_palmares borne p_limite entre 1 et 100');
    v_res := v_res || pg_temp.wp_ligne(
      not exists (select 1 from jsonb_array_elements(v_j -> 'lignes') l
                  where (select array_agg(k order by k) from jsonb_object_keys(l) k)
                        <> array['camp', 'nb', 'pseudo', 'rang', 'total']
                     or l ->> 'camp' <> 'pauvre')
        and position(v_suffixe in v_j::text) = 0,
      'le palmarès n''expose que rang, pseudo, camp, nb, total (pauvres seulement, ni id ni e-mail)');
    perform pg_temp.wp_jouer('authenticated', v_pauvre);
    v_j := public.get_mon_rang();
    perform pg_temp.wp_jouer(null);
    select count(*), coalesce(sum(p.montant), 0) into v_i, v_k
    from public.problems p where p.user_id = v_pauvre and p.statut = 'publie' and not p.masque;
    v_res := v_res || pg_temp.wp_ligne(
      (v_j ->> 'nb')::integer = v_i and (v_j ->> 'total')::integer = v_k and v_k > 0
        and (v_j ->> 'total')::integer < (select sum(coalesce(p.montant, 0)) from public.problems p where p.user_id = v_pauvre)
        and (v_j ->> 'rang')::integer between 1 and (v_j ->> 'sur')::integer
        and (select array_agg(k order by k) from jsonb_object_keys(v_j) k) = array['camp', 'nb', 'pseudo', 'rang', 'sur', 'total'],
      'get_mon_rang : total et nombre des seuls problèmes publiés non masqués, rang dans le classement', v_j::text);
    v_res := v_res || pg_temp.wp_ligne(
      not exists (
        select 1 from public.wp_classement_pauvres() a
        join public.wp_classement_pauvres() b on b.rang = a.rang + 1
        where b.total > a.total or (b.total = a.total and b.nb > a.nb)),
      'classement trié par total, puis nombre de problèmes');
    perform pg_temp.wp_jouer('authenticated', v_riche);
    v_res := v_res || pg_temp.wp_ligne(public.get_mon_rang() is null, 'get_mon_rang renvoie null pour un riche');
    perform pg_temp.wp_jouer(null);
    perform public.bloquer_membre(v_pauvre3, true);
    v_res := v_res || pg_temp.wp_ligne(
      not exists (select 1 from public.wp_classement_pauvres() c where c.user_id in (v_pauvre3, v_riche)),
      'ni les membres bloqués ni les riches ne sont classés');
    perform public.bloquer_membre(v_pauvre3, false);
    perform pg_temp.wp_jouer('authenticated', v_pauvre);
    begin
      perform public.wp_classement_pauvres();
      v_hint := 'exécuté';
    exception when insufficient_privilege then v_hint := null;
              when others then v_hint := 'erreur ' || sqlstate;
    end;
    v_res := v_res || pg_temp.wp_ligne(v_hint is null, 'un membre ne peut pas exécuter wp_classement_pauvres (avec les id)', v_hint);
    perform pg_temp.wp_jouer(null);

    -- =================================================================
    -- 19. R-029 (010): no rich account is active without a moderator
    -- =================================================================
    perform pg_temp.wp_jouer(null);
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at,
                            raw_app_meta_data, raw_user_meta_data, is_anonymous)
    select '00000000-0000-0000-0000-000000000000'::uuid, u.id, 'authenticated', 'authenticated',
           u.nom || '-' || v_suffixe || '@exemple.invalid', '', now(), now(), now(),
           '{}'::jsonb, '{}'::jsonb, false
    from (values (v_r_att, 'ratt'), (v_r_ex, 'rex'), (v_modo2, 'modo2')) as u(id, nom);
    insert into public.moderateurs (user_id) values (v_modo2);
    perform pg_temp.wp_jouer('anon');
    v_avant := (public.get_compteurs() ->> 'riches')::integer;
    perform pg_temp.wp_jouer('authenticated', v_r_att);
    perform public.creer_profil('riche', 'Riche en attente', 'ratt-' || v_suffixe || '@exemple.invalid');
    perform pg_temp.wp_jouer('authenticated', v_modo2);
    perform public.creer_profil('riche', 'Modo riche', 'modo2-' || v_suffixe || '@exemple.invalid');
    perform pg_temp.wp_jouer('authenticated', v_r_att);
    v_j := public.get_mon_espace();
    v_res := v_res || pg_temp.wp_ligne(v_j ->> 'statut_riche' = 'en_attente' and v_j -> 'riche_jusqu_au' = 'null'::jsonb,
      'un riche qui s''inscrit est en attente', v_j ->> 'statut_riche');
    perform pg_temp.wp_jouer('anon');
    v_res := v_res || pg_temp.wp_ligne((public.get_compteurs() ->> 'riches')::integer = v_avant + 1
        and (public.get_chiffres() ->> 'riches')::integer = v_avant + 1,
      'le compteur Riches ne compte que les riches actifs (le modérateur oui, le riche en attente non)',
      public.get_compteurs() ->> 'riches');
    perform pg_temp.wp_jouer('authenticated', v_r_att);
    foreach v_t in array array[
      format('select public.soumettre_probleme(%L, %L, %L, 100)', 'reve', 'Un titre correct', 'Un texte de test assez long.'),
      format('select public.reagir(%L::uuid, %L)', v_pb_publie, 'rire'),
      format('select public.commenter(%L::uuid, %L)', v_pb_publie, 'Je suis en attente'),
      format('select public.envoyer_message_club(%L)', 'Je suis en attente'),
      format('select public.signaler(%L, %L::uuid)', 'probleme', v_pb_publie),
      'select public.get_club_messages()'
    ] loop
      begin
        execute v_t;
        v_hint := '(aucune erreur)';
      exception when others then
        get stacked diagnostics v_hint = pg_exception_hint;
      end;
      v_res := v_res || pg_temp.wp_ligne(v_hint = 'riche_en_attente', 'un riche en attente est refusé : ' || v_t, v_hint);
    end loop;
    v_j := public.maj_profil(p_pseudo => 'Riche patient');
    v_res := v_res || pg_temp.wp_ligne(v_j ->> 'pseudo' = 'Riche patient' and v_j ->> 'statut_riche' = 'en_attente',
      'un riche en attente peut changer son pseudo (et rien d''autre ne change)', v_j::text);
    -- moderation functions closed to non-moderators
    foreach v_t in array array[
      'select public.mod_riches()',
      format('select public.mod_activer_riche(%L::uuid, %L)', v_r_att, 'annuel'),
      format('select public.mod_desactiver_riche(%L::uuid)', v_riche),
      format('select public.mod_refuser_riche(%L::uuid)', v_riche)
    ] loop
      foreach v_role in array array['anon', 'authenticated'] loop
        perform pg_temp.wp_jouer(v_role, case when v_role = 'authenticated' then v_r_att end);
        begin
          execute v_t;
          v_hint := 'exécuté';
        exception when insufficient_privilege then v_hint := 'droits';
                  when others then get stacked diagnostics v_hint = pg_exception_hint;
        end;
        v_res := v_res || pg_temp.wp_ligne(v_hint in ('droits', 'interdit'),
          format('%s ne peut pas exécuter : %s', v_role, v_t), v_hint);
      end loop;
    end loop;
    perform pg_temp.wp_jouer(null);
    v_res := v_res || pg_temp.wp_ligne(
      (select pr.statut_riche from public.profiles pr where pr.id = v_r_att) = 'en_attente'
        and (select pr.camp from public.profiles pr where pr.id = v_riche) = 'riche',
      'rien n''a changé après les tentatives refusées');
    -- the moderator: always active, lists and activates
    perform pg_temp.wp_jouer('authenticated', v_modo2);
    v_j := public.mod_riches();
    v_res := v_res || pg_temp.wp_ligne(
      exists (select 1 from jsonb_array_elements(v_j) x where x ->> 'pseudo' = 'Riche patient' and x ->> 'statut' = 'en_attente')
        and exists (select 1 from jsonb_array_elements(v_j) x where x ->> 'pseudo' = 'Modo riche' and x ->> 'statut' = 'actif')
        and position(v_suffixe in v_j::text) = 0 and v_j::text !~ '"email"',
      'mod_riches liste les riches en attente et actifs, sans e-mail (modérateur toujours actif)');
    v_j := public.commenter(v_pb_publie, 'Un modérateur riche commente');
    v_j := public.mod_activer_riche(v_r_att, 'mensuel');
    v_res := v_res || pg_temp.wp_ligne(
      (v_j ->> 'jusqu_au')::timestamptz between now() + interval '27 days' and now() + interval '32 days',
      'mod_activer_riche (mensuel) active pour un mois', v_j ->> 'jusqu_au');
    v_j := public.mod_activer_riche(v_r_att, 'annuel');
    v_res := v_res || pg_temp.wp_ligne(
      (v_j ->> 'jusqu_au')::timestamptz between now() + interval '13 months' - interval '4 days'
                                            and now() + interval '13 months' + interval '4 days',
      'une nouvelle activation prolonge depuis la date de fin en cours (1 mois + 1 an)', v_j ->> 'jusqu_au');
    perform pg_temp.wp_jouer('authenticated', v_r_att);
    v_j := public.commenter(v_pb_publie, 'Je suis enfin validé');
    v_res := v_res || pg_temp.wp_ligne(v_j ->> 'texte' = 'Je suis enfin validé'
        and public.get_mon_espace() ->> 'statut_riche' = 'actif' and public.get_mon_espace() ->> 'riche_formule' = 'annuel',
      'un riche activé peut commenter ; Mon espace affiche actif et la formule');
    -- expiry, computed (no scheduled job)
    perform pg_temp.wp_jouer(null);
    update public.profiles pr set riche_jusqu_au = now() - interval '1 second' where pr.id = v_r_att;
    perform pg_temp.wp_jouer('authenticated', v_r_att);
    begin
      perform public.reagir(v_pb_publie, 'rire');
      v_hint := '(aucune erreur)';
    exception when others then
      get stacked diagnostics v_hint = pg_exception_hint;
    end;
    v_res := v_res || pg_temp.wp_ligne(v_hint = 'riche_en_attente' and public.get_mon_espace() ->> 'statut_riche' = 'en_attente',
      'date de fin passée : le riche redevient en attente', v_hint);
    perform pg_temp.wp_jouer('anon');
    v_res := v_res || pg_temp.wp_ligne((public.get_compteurs() ->> 'riches')::integer = v_avant + 1,
      'un riche expiré ne compte plus dans le match', public.get_compteurs() ->> 'riches');
    -- deactivate, refuse, moderators untouchable
    perform pg_temp.wp_jouer('authenticated', v_modo2);
    perform public.mod_activer_riche(v_r_att, 'mensuel');
    perform public.mod_desactiver_riche(v_r_att);
    perform pg_temp.wp_jouer('authenticated', v_r_att);
    v_res := v_res || pg_temp.wp_ligne(public.get_mon_espace() ->> 'statut_riche' = 'en_attente',
      'mod_desactiver_riche remet le riche en attente');
    perform pg_temp.wp_jouer('authenticated', v_modo2);
    perform public.mod_refuser_riche(v_r_att);
    begin
      perform public.mod_refuser_riche(v_modo2);
      v_hint := 'exécuté';
    exception when others then
      get stacked diagnostics v_hint = pg_exception_hint;
    end;
    v_res := v_res || pg_temp.wp_ligne(v_hint = 'invalide', 'un modérateur ne peut pas être refusé ni désactivé', v_hint);
    perform pg_temp.wp_jouer('authenticated', v_r_att);
    v_j := public.soumettre_probleme('reve', 'Retour chez les pauvres', 'Un texte de test assez long.', 100);
    v_res := v_res || pg_temp.wp_ligne(public.get_mon_espace() ->> 'camp' = 'pauvre' and v_j ->> 'statut' = 'publie',
      'mod_refuser_riche renvoie au camp pauvre (qui peut publier)');
    -- a poor member who becomes rich waits too
    v_j := public.maj_profil(p_camp => 'riche');
    v_res := v_res || pg_temp.wp_ligne(v_j ->> 'statut_riche' = 'en_attente', 'passer de pauvre à riche met le compte en attente', v_j::text);
    begin
      perform public.envoyer_message_club('Bonjour les riches');
      v_hint := '(aucune erreur)';
    exception when others then
      get stacked diagnostics v_hint = pg_exception_hint;
    end;
    v_res := v_res || pg_temp.wp_ligne(v_hint = 'riche_en_attente', 'un pauvre devenu riche ne peut pas écrire au club des riches', v_hint);
    perform pg_temp.wp_jouer('authenticated', v_riche);
    v_j := public.maj_profil(p_camp => 'pauvre');
    v_j := public.maj_profil(p_camp => 'riche');
    v_res := v_res || pg_temp.wp_ligne(v_j ->> 'statut_riche' = 'en_attente',
      'un riche actif qui quitte puis revient chez les riches repasse en attente', v_j::text);
    perform pg_temp.wp_jouer(null);
    update public.profiles pr set statut_riche = 'actif' where pr.id = v_riche;

    -- =================================================================
    -- 20. R-030 (011): problems and posts of the rich
    -- =================================================================
    perform pg_temp.wp_jouer('anon');
    v_avant := (public.get_chiffres() ->> 'montant_total')::integer;
    -- a rich member never posts a problem of the poor, a poor member never posts as rich
    perform pg_temp.wp_jouer('authenticated', v_modo2);
    begin
      perform public.soumettre_probleme('reve', 'Un yacht de plus', 'Le premier est trop petit.', 100);
      v_hint := '(aucune erreur)';
    exception when others then
      get stacked diagnostics v_hint = pg_exception_hint;
    end;
    v_res := v_res || pg_temp.wp_ligne(v_hint = 'interdit', 'un riche ne publie pas de problème de pauvre', v_hint);
    perform pg_temp.wp_jouer('authenticated', v_pauvre2);
    begin
      perform public.publier_riche('publication', 'Je me fais passer pour un riche.');
      v_hint := '(aucune erreur)';
    exception when others then
      get stacked diagnostics v_hint = pg_exception_hint;
    end;
    v_res := v_res || pg_temp.wp_ligne(v_hint = 'interdit', 'un pauvre ne publie pas comme un riche', v_hint);
    perform pg_temp.wp_jouer('authenticated', v_r_att);
    begin
      perform public.publier_riche('publication', 'Je ne suis pas encore validé.');
      v_hint := '(aucune erreur)';
    exception when others then
      get stacked diagnostics v_hint = pg_exception_hint;
    end;
    v_res := v_res || pg_temp.wp_ligne(v_hint = 'riche_en_attente', 'un riche en attente ne publie pas', v_hint);
    perform pg_temp.wp_jouer('anon');
    begin
      perform public.publier_riche('publication', 'Un visiteur anonyme.');
      v_hint := 'exécuté';
    exception when insufficient_privilege then v_hint := null;
              when others then v_hint := 'erreur ' || sqlstate;
    end;
    v_res := v_res || pg_temp.wp_ligne(v_hint is null, 'anon ne peut pas exécuter publier_riche', v_hint);
    -- an active rich member: first post, then a rich problem without the 10 000 cap
    perform pg_temp.wp_jouer('authenticated', v_modo2);
    v_j := public.publier_riche('publication', 'Bonjour les pauvres, je viens d''arriver avec mon yacht.', 'Titre ignoré', 999);
    v_pb_m_pub := (v_j ->> 'id')::uuid;
    v_res := v_res || pg_temp.wp_ligne(v_j ->> 'statut' = 'publie' and (v_j ->> 'premiere')::boolean,
      'première publication d''un riche : publiée, premiere = vrai', v_j::text);
    v_j := public.publier_riche('riche', 'Mon majordome refuse de repasser mes chaussettes en soie.', 'Problème de majordome', 50000);
    v_pb_test := (v_j ->> 'id')::uuid;
    v_res := v_res || pg_temp.wp_ligne(v_j ->> 'statut' = 'publie' and not (v_j ->> 'premiere')::boolean,
      'problème de riche à 50 000 € accepté (pas de plafond à 10 000), premiere = faux', v_j::text);
    foreach v_t in array array[
      format('select public.publier_riche(%L, %L, %L, 1000001)', 'riche', 'Un texte de test assez long.', 'Titre trop cher'),
      format('select public.publier_riche(%L, %L)', 'riche', 'Un problème de riche sans titre.'),
      format('select public.publier_riche(%L, %L)', 'publication', repeat('x', 601)),
      format('select public.publier_riche(%L, %L)', 'publication', 'court'),
      format('select public.publier_riche(%L, %L)', 'pauvre', 'Un riche qui se déguise en pauvre.'),
      format('select public.publier_riche(%L, %L)', 'publication', 'Appelez-moi au 06 12 34 56 78 pour mon yacht.')
    ] loop
      begin
        execute v_t;
        v_hint := '(aucune erreur)';
      exception when others then
        get stacked diagnostics v_hint = pg_exception_hint;
      end;
      v_res := v_res || pg_temp.wp_ligne(v_hint in ('invalide', 'filtre'), 'publier_riche refuse : ' || left(v_t, 110), v_hint);
    end loop;
    v_j := public.publier_riche('publication', 'Ma mère commence sa chimio, je ne sais pas quoi faire.');
    v_res := v_res || pg_temp.wp_ligne(v_j ->> 'statut' = 'recu', 'une publication avec un mot sensible part en relecture', v_j::text);
    perform pg_temp.wp_jouer(null);
    v_res := v_res || pg_temp.wp_ligne(
      exists (select 1 from public.problems p where p.id = v_pb_m_pub and p.type = 'publication'
              and p.titre is null and p.montant is null and p.categorie is null and p.premiere),
      'une publication n''a ni titre, ni montant, ni catégorie');
    -- the wall: type filter and public fields
    perform pg_temp.wp_jouer('anon');
    v_j := public.get_problemes_publics(null, 48, null, 'publication');
    v_res := v_res || pg_temp.wp_ligne(
      jsonb_array_length(v_j) > 0
        and not exists (select 1 from jsonb_array_elements(v_j) x where x ->> 'type' <> 'publication')
        and exists (select 1 from jsonb_array_elements(v_j) x where (x ->> 'id')::uuid = v_pb_m_pub and (x ->> 'premiere')::boolean),
      'filtre « Publications de riches » : seulement des publications (avec type et premiere)');
    v_j := public.get_problemes_publics(null, 48, null, 'riche');
    v_res := v_res || pg_temp.wp_ligne(
      not exists (select 1 from jsonb_array_elements(v_j) x where x ->> 'type' <> 'riche')
        and exists (select 1 from jsonb_array_elements(v_j) x where (x ->> 'id')::uuid = v_pb_test),
      'filtre « Problèmes de riches » : seulement des problèmes de riches');
    v_j := public.get_problemes_publics(null, 48, null, 'pauvre');
    v_res := v_res || pg_temp.wp_ligne(
      not exists (select 1 from jsonb_array_elements(v_j) x where x ->> 'type' <> 'pauvre'),
      'filtre « Problèmes de pauvres » : seulement des problèmes de pauvres');
    begin
      perform public.get_problemes_publics(null, 12, null, 'yacht');
      v_hint := '(aucune erreur)';
    exception when others then
      get stacked diagnostics v_hint = pg_exception_hint;
    end;
    v_res := v_res || pg_temp.wp_ligne(v_hint = 'invalide', 'type de publication inconnu refusé', v_hint);
    v_res := v_res || pg_temp.wp_ligne((public.get_chiffres() ->> 'montant_total')::integer = v_avant,
      'les problèmes de riches ne comptent pas dans « Les chiffres »', public.get_chiffres() ->> 'montant_total');
    perform pg_temp.wp_jouer(null);
    v_res := v_res || pg_temp.wp_ligne(
      not exists (select 1 from public.wp_classement_pauvres() c
                  join public.problems p on p.user_id = c.user_id and p.type <> 'pauvre'),
      'le palmarès ne compte que des problèmes de pauvres');
    -- same moderation: report, mask, review lists
    perform pg_temp.wp_jouer('authenticated', v_pauvre4);
    v_j := public.signaler('probleme', v_pb_m_pub);
    perform public.reagir(v_pb_m_pub, 'rire');
    perform pg_temp.wp_jouer(null);
    perform public.masquer_contenu('probleme', v_pb_m_pub, true);
    v_res := v_res || pg_temp.wp_ligne(
      (select m.contenu from public.moderation_masques m where m.cible_id = v_pb_m_pub) like 'Bonjour les pauvres%'
        and (select s.contenu from public.moderation_signalements_24h s where s.cible_id = v_pb_m_pub) like 'Bonjour les pauvres%',
      'une publication signalée puis masquée est lisible dans la modération (sans titre)');
    perform pg_temp.wp_jouer('authenticated', v_modo2);
    v_res := v_res || pg_temp.wp_ligne(
      exists (select 1 from jsonb_array_elements(public.mod_a_relire()) x where x ->> 'type' = 'publication')
        and exists (select 1 from jsonb_array_elements(public.mod_signalements_24h()) x
                    where (x ->> 'cible_id')::uuid = v_pb_m_pub and x ->> 'contenu' like 'Bonjour les pauvres%'),
      'mod_a_relire et mod_signalements_24h donnent le type et le texte des publications');
    v_j := public.get_mon_espace();
    v_res := v_res || pg_temp.wp_ligne(
      exists (select 1 from jsonb_array_elements(v_j -> 'problemes') x
              where x ->> 'type' = 'publication' and x ->> 'titre' like 'Bonjour les pauvres%'),
      'Mon espace liste les publications avec le début du texte');
    perform pg_temp.wp_jouer(null);

    -- =================================================================
    -- 21. R-031 (012): « Un nouveau riche est arrivé », unsubscribe, e-mail budget
    -- =================================================================
    perform pg_temp.wp_jouer(null);
    v_res := v_res || pg_temp.wp_ligne(
      not exists (select 1 from public.profiles pr where pr.jeton_desinscription is null)
        and (select count(distinct pr.jeton_desinscription) from public.profiles pr) = (select count(*) from public.profiles),
      'chaque membre a un jeton de désinscription unique');
    -- v_r_att is a pending rich member (end of section 19): the moderator activates him
    delete from public.annonces a where a.user_id = v_r_att;  -- created by the activations of section 19
    perform pg_temp.wp_jouer('authenticated', v_modo2);
    v_j := public.mod_activer_riche(v_r_att, 'mensuel');
    v_res := v_res || pg_temp.wp_ligne((v_j ->> 'annonce')::boolean, 'activer un riche en attente crée une annonce', v_j::text);
    v_j := public.mod_activer_riche(v_r_att, 'annuel');
    perform pg_temp.wp_jouer(null);
    v_res := v_res || pg_temp.wp_ligne(not (v_j ->> 'annonce')::boolean
        and (select count(*) from public.annonces a where a.user_id = v_r_att) = 1
        and (select a.expire_le from public.annonces a where a.user_id = v_r_att)
            between now() + interval '71 hours' and now() + interval '73 hours',
      'prolonger un riche déjà actif n''annonce rien ; une annonce dure 72 h', v_j::text);
    v_annonce := (select a.id from public.annonces a where a.user_id = v_r_att);
    perform pg_temp.wp_jouer('anon');
    v_j := public.get_annonces();
    v_res := v_res || pg_temp.wp_ligne(
      exists (select 1 from jsonb_array_elements(v_j) x
              where x ->> 'pseudo' = 'Riche patient' and x ->> 'lien' = 'index.html?type=publication#mur')
        and not exists (select 1 from jsonb_array_elements(v_j) x
                        where (select array_agg(k order by k) from jsonb_object_keys(x) k) <> array['lien', 'pseudo'])
        and position(v_suffixe in v_j::text) = 0,
      'get_annonces (anon) : pseudo et lien seulement ; sans publication, lien vers les publications de riches', v_j::text);
    perform pg_temp.wp_jouer('authenticated', v_r_att);
    v_pb_test := (public.publier_riche('publication', 'Bonjour les pauvres, je suis enfin validé !') ->> 'id')::uuid;
    perform pg_temp.wp_jouer('anon');
    v_res := v_res || pg_temp.wp_ligne(
      exists (select 1 from jsonb_array_elements(public.get_annonces()) x
              where x ->> 'pseudo' = 'Riche patient' and x ->> 'lien' = 'p.html?id=' || v_pb_test::text),
      'l''annonce pointe vers sa première publication');
    -- moderation list of announcements
    foreach v_role in array array['anon', 'authenticated'] loop
      perform pg_temp.wp_jouer(v_role, case when v_role = 'authenticated' then v_pauvre end);
      begin
        perform public.mod_annonces();
        v_hint := 'exécuté';
      exception when insufficient_privilege then v_hint := 'droits';
                when others then get stacked diagnostics v_hint = pg_exception_hint;
      end;
      v_res := v_res || pg_temp.wp_ligne(v_hint in ('droits', 'interdit'), v_role || ' ne peut pas exécuter mod_annonces', v_hint);
    end loop;
    perform pg_temp.wp_jouer('authenticated', v_modo2);
    v_j := public.mod_annonces();
    v_res := v_res || pg_temp.wp_ligne(
      exists (select 1 from jsonb_array_elements(v_j) x where x ->> 'pseudo' = 'Riche patient'
              and (x ->> 'en_cours')::boolean and (x ->> 'envoyes')::integer = 0)
        and position(v_suffixe in v_j::text) = 0,
      'mod_annonces liste l''annonce en cours (sans e-mail)', left(v_j::text, 200));
    -- e-mail functions: service_role only
    foreach v_t in array array[
      format('select public.srv_reserver_envois(%L::uuid, 10)', v_annonce),
      format('select public.srv_annuler_envois(%L::uuid, array[%L::uuid])', v_annonce, v_pauvre)
    ] loop
      foreach v_role in array array['anon', 'authenticated'] loop
        perform pg_temp.wp_jouer(v_role, case when v_role = 'authenticated' then v_modo2 end);
        begin
          execute v_t;
          v_hint := 'exécuté';
        exception when insufficient_privilege then v_hint := null;
                  when others then v_hint := 'erreur ' || sqlstate;
        end;
        v_res := v_res || pg_temp.wp_ligne(v_hint is null, format('%s ne peut pas exécuter : %s', v_role, left(v_t, 60)), v_hint);
      end loop;
    end loop;
    perform pg_temp.wp_jouer('service_role');
    v_j := public.srv_reserver_envois(v_annonce, 100);
    perform pg_temp.wp_jouer(null);
    v_res := v_res || pg_temp.wp_ligne(
      jsonb_array_length(v_j -> 'destinataires') > 0
        and v_j -> 'annonce' ->> 'pseudo' = 'Riche patient'
        and not exists (
          select 1 from jsonb_array_elements(v_j -> 'destinataires') x
          join public.profiles d on d.id = (x ->> 'user_id')::uuid
          join auth.users u on u.id = d.id
          where d.camp <> 'pauvre' or not d.newsletter or d.bloque or u.email_confirmed_at is null
             or u.is_anonymous or x ->> 'email' <> d.email or (x ->> 'jeton')::uuid <> d.jeton_desinscription)
        and exists (select 1 from jsonb_array_elements(v_j -> 'destinataires') x where (x ->> 'user_id')::uuid = v_pauvre),
      'srv_reserver_envois : seulement des pauvres inscrits à la lettre, e-mail confirmé, non bloqués', left(v_j::text, 200));
    v_i := jsonb_array_length(v_j -> 'destinataires');
    perform pg_temp.wp_jouer('service_role');
    v_j := public.srv_reserver_envois(v_annonce, 100);
    v_k := public.srv_annuler_envois(v_annonce, array[v_pauvre]);
    perform pg_temp.wp_jouer(null);
    v_res := v_res || pg_temp.wp_ligne(
      not exists (select 1 from jsonb_array_elements(v_j -> 'destinataires') x where (x ->> 'user_id')::uuid = v_pauvre)
        and v_k = 1
        and (select count(*) from public.annonce_envois e
             where e.annonce_id = v_annonce) = v_i - 1 + jsonb_array_length(v_j -> 'destinataires'),
      'jamais deux fois la même annonce ; srv_annuler_envois libère un envoi raté', v_k::text);
    -- 250 e-mails per rolling 24 h at most
    insert into public.annonces (id, user_id, expire_le)
    select gen_random_uuid(), v_riche, now() - interval '1 day' from generate_series(1, 250);
    insert into public.annonce_envois (annonce_id, user_id)
    select a.id, v_pauvre2 from public.annonces a where a.user_id = v_riche;
    perform public.srv_annuler_envois(v_annonce, array[v_pauvre]);
    perform pg_temp.wp_jouer('service_role');
    v_j := public.srv_reserver_envois(v_annonce, 100);
    perform pg_temp.wp_jouer(null);
    v_res := v_res || pg_temp.wp_ligne(
      jsonb_array_length(v_j -> 'destinataires') = 0 and (v_j ->> 'restant_24h')::integer = 0
        and (v_j ->> 'reste_a_envoyer')::integer >= 1,
      'plafond de 250 e-mails par 24 h', left(v_j::text, 200));
    delete from public.annonces a where a.user_id = v_riche;
    -- unsubscribe
    v_txt := (select pr.jeton_desinscription::text from public.profiles pr where pr.id = v_pauvre);
    perform pg_temp.wp_jouer('anon');
    v_ok := public.se_desinscrire(v_txt::uuid);
    v_res := v_res || pg_temp.wp_ligne(v_ok and not public.se_desinscrire(gen_random_uuid()) and not public.se_desinscrire(null),
      'se_desinscrire : vrai avec le bon jeton, faux sinon');
    perform pg_temp.wp_jouer(null);
    v_res := v_res || pg_temp.wp_ligne(not (select pr.newsletter from public.profiles pr where pr.id = v_pauvre),
      'après désinscription, la case newsletter est décochée');
    -- an expired announcement disappears
    update public.annonces a set expire_le = now() - interval '1 second' where a.user_id = v_r_att;
    perform pg_temp.wp_jouer('anon');
    v_res := v_res || pg_temp.wp_ligne(
      not exists (select 1 from jsonb_array_elements(public.get_annonces()) x where x ->> 'pseudo' = 'Riche patient'),
      'une annonce de plus de 72 h n''est plus affichée');
    perform pg_temp.wp_jouer(null);

    -- =================================================================
    -- 22. R-034 (013): « Le problème du moment » (hero card of the home page)
    -- =================================================================
    perform pg_temp.wp_jouer(null);
    delete from public.reactions;
    perform pg_temp.wp_jouer('anon');
    v_j := public.get_probleme_du_moment();
    perform pg_temp.wp_jouer(null);
    v_moment := (select p.id from public.problems p join public.profiles pr on pr.id = p.user_id and not pr.bloque
                 where p.type = 'pauvre' and p.statut = 'publie' and not p.masque and not p.est_exemple
                 order by coalesce(p.modere_le, p.cree_le) desc, p.id desc limit 1);
    v_res := v_res || pg_temp.wp_ligne(v_j is not null and (v_j ->> 'id')::uuid = v_moment and v_j ->> 'type' = 'pauvre',
      'problème du moment (anon) : sans réaction depuis 7 jours, le problème de pauvre le plus récent', v_j::text);
    v_res := v_res || pg_temp.wp_ligne(not (v_j ? 'user_id') and v_j::text not like '%@%' and v_j ? 'pseudo' and v_j ? 'montant',
      'problème du moment : projection publique (pseudo, montant), ni id d''utilisateur ni e-mail', v_j::text);
    -- the oldest candidate receives 2 reactions yesterday → it becomes the problem of the moment
    v_moment := (select p.id from public.problems p join public.profiles pr on pr.id = p.user_id and not pr.bloque
                 where p.type = 'pauvre' and p.statut = 'publie' and not p.masque and not p.est_exemple
                 order by coalesce(p.modere_le, p.cree_le) asc, p.id asc limit 1);
    insert into public.reactions (problem_id, user_id, type, cree_le) values
      (v_moment, v_riche, 'rire', now() - interval '1 day'),
      (v_moment, v_pauvre2, 'courage', now() - interval '2 days');
    -- a rich problem and a masked problem get more reactions: never chosen
    insert into public.reactions (problem_id, user_id, type, cree_le)
    select p.id, u.id, 'rire', now() - interval '1 hour'
    from public.problems p cross join (values (v_riche), (v_pauvre), (v_pauvre3)) u(id)
    where p.id in (v_pb_riche, v_pb_masque)
       or p.id = (select q.id from public.problems q where q.type <> 'pauvre' and q.statut = 'publie' and not q.masque limit 1);
    perform pg_temp.wp_jouer('authenticated', v_pauvre);
    v_j := public.get_probleme_du_moment();
    perform pg_temp.wp_jouer(null);
    v_res := v_res || pg_temp.wp_ligne((v_j ->> 'id')::uuid = v_moment and (v_j ->> 'courage')::int = 1,
      'problème du moment : le plus de réactions sur 7 jours (problèmes de riches, publications et masqués exclus)', v_j::text);
    -- reactions older than 7 days do not count
    update public.reactions r set cree_le = now() - interval '8 days' where r.problem_id = v_moment;
    perform pg_temp.wp_jouer('anon');
    v_j := public.get_probleme_du_moment();
    perform pg_temp.wp_jouer(null);
    v_res := v_res || pg_temp.wp_ligne((v_j ->> 'id')::uuid <> v_moment,
      'problème du moment : les réactions de plus de 7 jours ne comptent pas', v_j::text);
    -- a blocked author, a masked problem: never shown
    update public.reactions r set cree_le = now() - interval '1 day' where r.problem_id = v_moment;
    update public.profiles pr set bloque = true where pr.id = (select p.user_id from public.problems p where p.id = v_moment);
    perform pg_temp.wp_jouer('anon');
    v_ok := (public.get_probleme_du_moment() ->> 'id')::uuid is distinct from v_moment;
    perform pg_temp.wp_jouer(null);
    update public.profiles pr set bloque = false where pr.id = (select p.user_id from public.problems p where p.id = v_moment);
    update public.problems p set masque = true where p.id = v_moment;
    perform pg_temp.wp_jouer('anon');
    v_ok := v_ok and (public.get_probleme_du_moment() ->> 'id')::uuid is distinct from v_moment;
    perform pg_temp.wp_jouer(null);
    v_res := v_res || pg_temp.wp_ligne(v_ok, 'problème du moment : jamais un problème masqué ni celui d''un membre bloqué');
    -- nothing to show → null (the page keeps its static card)
    update public.problems p set masque = true where p.type = 'pauvre';
    perform pg_temp.wp_jouer('anon');
    v_j := public.get_probleme_du_moment();
    perform pg_temp.wp_jouer(null);
    v_res := v_res || pg_temp.wp_ligne(v_j is null, 'problème du moment : null quand aucun problème de pauvre n''est visible', coalesce(v_j::text, 'null'));
    v_res := v_res || pg_temp.wp_ligne(
      has_function_privilege('anon', 'public.get_probleme_du_moment()', 'execute')
        and (select p.prosecdef and coalesce(p.proconfig, '{}') @> array['search_path=""'] and p.provolatile = 's'
             from pg_proc p where p.oid = 'public.get_probleme_du_moment()'::regprocedure),
      'get_probleme_du_moment : public, SECURITY DEFINER, search_path vide, lecture seule');

    -- =================================================================
    -- 014. Anti-bot limits per IP (R-035)
    -- =================================================================
    declare
      v_ip1   uuid := gen_random_uuid();
      v_ip2   uuid := gen_random_uuid();
      v_ip3   uuid := gen_random_uuid();
      v_n     integer;
      v_sel   text;
      v_e     text;
      v_pb    uuid;
    begin
      perform pg_temp.wp_jouer(null);
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                              created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_anonymous)
      select '00000000-0000-0000-0000-000000000000'::uuid, u.id, 'authenticated', 'authenticated',
             u.nom || '-' || v_suffixe || '@exemple.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false
      from (values (v_ip1, 'ip1'), (v_ip2, 'ip2'), (v_ip3, 'ip3')) as u(id, nom);
      update public.reglages r set valeur = '{"profil": 1, "publication": 30, "message": 60, "reaction": 3}'::jsonb
      where r.cle = 'limites_ip';
      delete from public.limites_ip;
      -- an old line (25 h) is purged at the next insertion
      insert into public.limites_ip (empreinte, action, cree_le) values (repeat('a', 64), 'reaction', now() - interval '25 hours');

      -- profile creation: 1 per IP per hour here
      perform set_config('request.headers', '{"cf-connecting-ip": "203.0.113.5", "x-forwarded-for": "198.51.100.9"}', true);
      perform pg_temp.wp_jouer('authenticated', v_ip1);
      perform public.creer_profil('pauvre', 'Pauvre IP un', 'ip1-' || v_suffixe || '@exemple.invalid');
      begin
        perform pg_temp.wp_jouer('authenticated', v_ip2);
        perform public.creer_profil('pauvre', 'Pauvre IP deux', 'ip2-' || v_suffixe || '@exemple.invalid');
        v_txt := 'aucune erreur';
      exception when others then
        v_txt := sqlerrm;
      end;
      v_res := v_res || pg_temp.wp_ligne(v_txt = 'Doucement ! Trop d''actions depuis ta connexion, reviens dans une heure.',
        '014 : 2ᵉ création de profil depuis la même IP refusée (plafond atteint)', v_txt);
      perform pg_temp.wp_jouer(null);
      v_res := v_res || pg_temp.wp_ligne(not exists (select 1 from public.profiles pr where pr.id = v_ip2),
        '014 : le profil refusé n''est pas créé');
      insert into public.problems (user_id, type, categorie, titre, texte, montant, statut)
      values (v_ip1, 'pauvre', 'reve', 'Un rêve pour les IP', 'Un texte assez long pour le test des IP.', 100, 'publie')
      returning id into v_pb;
      -- another IP (first element of x-forwarded-for when cf-connecting-ip is missing) is not blocked
      perform set_config('request.headers', '{"x-forwarded-for": "198.51.100.7, 10.0.0.1"}', true);
      perform pg_temp.wp_jouer('authenticated', v_ip2);
      v_j := public.creer_profil('pauvre', 'Pauvre IP deux', 'ip2-' || v_suffixe || '@exemple.invalid');
      perform pg_temp.wp_jouer(null);
      select r.valeur #>> '{}' into v_sel from public.reglages r where r.cle = 'ip_sel';
      v_e := encode(sha256(convert_to('198.51.100.7' || v_sel, 'UTF8')), 'hex');
      v_res := v_res || pg_temp.wp_ligne(v_j ? 'code_partage'
          and exists (select 1 from public.limites_ip l where l.empreinte = v_e and l.action = 'profil'),
        '014 : sans cf-connecting-ip, le premier élément de x-forwarded-for est compté (autre IP, pas de blocage)');

      -- reactions: 3 per IP per hour here; the 4th is refused, and the refused call is not counted
      perform set_config('request.headers', '{"cf-connecting-ip": "203.0.113.5"}', true);
      perform pg_temp.wp_jouer('authenticated', v_ip1);
      perform public.reagir(v_pb, 'rire');
      perform public.reagir(v_pb, 'courage');
      perform public.reagir(v_pb, 'paierais');
      begin
        perform public.reagir(v_pb, 'rire');
        v_txt := 'aucune erreur';
      exception when others then
        get stacked diagnostics v_hint = pg_exception_hint;
        v_txt := v_hint;
      end;
      perform pg_temp.wp_jouer(null);
      v_n := (select count(*) from public.limites_ip l where l.action = 'reaction' and l.empreinte <> repeat('a', 64));
      v_res := v_res || pg_temp.wp_ligne(v_txt = 'limite' and v_n = 3,
        '014 : 4ᵉ réaction depuis la même IP refusée (code limite), seules les 3 réussies sont comptées', v_txt || ' / ' || v_n);
      v_res := v_res || pg_temp.wp_ligne(not exists (select 1 from public.limites_ip l where l.empreinte = repeat('a', 64)),
        '014 : les lignes de plus de 24 h sont purgées à chaque insertion');
      -- comments share the "message" quota, not the reaction one
      perform pg_temp.wp_jouer('authenticated', v_ip1);
      v_j := public.commenter(v_pb, 'Un commentaire depuis une IP pressée.');
      perform pg_temp.wp_jouer(null);
      v_res := v_res || pg_temp.wp_ligne(v_j ? 'id', '014 : le plafond des réactions ne bloque pas les commentaires (quota « message » séparé)');

      -- no IP at all → nothing is blocked
      perform set_config('request.headers', '', true);
      perform pg_temp.wp_jouer('authenticated', v_ip1);
      for v_i in 1 .. 6 loop
        perform public.reagir(v_pb, 'rire');
      end loop;
      perform pg_temp.wp_jouer('authenticated', v_ip3);
      v_j := public.creer_profil('pauvre', 'Pauvre IP trois', 'ip3-' || v_suffixe || '@exemple.invalid');
      perform pg_temp.wp_jouer(null);
      v_res := v_res || pg_temp.wp_ligne(v_j ? 'code_partage'
          and (select count(*) from public.limites_ip l where l.action = 'reaction') = 3,
        '014 : IP introuvable → aucun blocage et rien n''est compté');
      perform set_config('request.headers', '{"cf-connecting-ip": "pas du json', true);
      perform pg_temp.wp_jouer('authenticated', v_ip3);
      v_j := public.reagir(v_pb, 'rire');
      perform pg_temp.wp_jouer(null);
      perform set_config('request.headers', '', true);
      v_res := v_res || pg_temp.wp_ligne(v_j ? 'actif', '014 : en-têtes illisibles → aucun blocage');

      -- the IP is never stored in clear
      v_res := v_res || pg_temp.wp_ligne(
        not exists (select 1 from public.limites_ip l
                    where l.empreinte !~ '^[0-9a-f]{64}$' or l.empreinte like '%203.0.113%' or l.empreinte like '%198.51%')
        and (select count(*) from public.limites_ip) >= 5,
        '014 : aucune IP en clair stockée (empreintes sha256 seulement)');
      v_res := v_res || pg_temp.wp_ligne(
        (select c.relrowsecurity and c.relforcerowsecurity from pg_class c where c.oid = 'public.limites_ip'::regclass)
        and not has_table_privilege('anon', 'public.limites_ip', 'select,insert,update,delete')
        and not has_table_privilege('authenticated', 'public.limites_ip', 'select,insert,update,delete')
        and char_length(v_sel) >= 32,
        '014 : limites_ip en RLS forcée sans aucun droit ; sel aléatoire rangé dans reglages');
      select string_agg(p.proname, ', ') into v_txt
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'wp\_coeur\_%'
        and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
      v_res := v_res || pg_temp.wp_ligne(v_txt is null
          and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname like 'wp\_coeur\_%') = 6
          and (select bool_and(p.prosrc like '%public.wp_limite_ip(%') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname in ('creer_profil', 'soumettre_probleme', 'publier_riche',
                                                            'commenter', 'envoyer_message_club', 'reagir')),
        '014 : les 6 fonctions d''écriture passent par wp_limite_ip ; leurs cœurs wp_coeur_* ne sont pas appelables', v_txt);
    end;

    -- =================================================================
    -- 015. Powers of the rich: crowns, notifications, rich reactions (R-037)
    -- =================================================================
    declare
      v_r1   uuid := gen_random_uuid();
      v_r2   uuid := gen_random_uuid();
      v_a1   uuid := gen_random_uuid();
      v_p2   uuid := gen_random_uuid();
      v_pbs  uuid[] := '{}';
      v_pbr  uuid;
      v_id   uuid;
      v_n    integer;
    begin
      perform pg_temp.wp_jouer(null);
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                              created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_anonymous)
      select '00000000-0000-0000-0000-000000000000'::uuid, u.id, 'authenticated', 'authenticated',
             u.nom || '-' || v_suffixe || '@exemple.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false
      from (values (v_r1, 'r1'), (v_r2, 'r2'), (v_a1, 'a1'), (v_p2, 'p2')) as u(id, nom);
      perform pg_temp.wp_jouer('authenticated', v_r1);
      perform public.creer_profil('riche', 'Riche couronneur', 'r1-' || v_suffixe || '@exemple.invalid');
      perform pg_temp.wp_jouer('authenticated', v_r2);
      perform public.creer_profil('riche', 'Riche en attente', 'r2-' || v_suffixe || '@exemple.invalid');
      perform pg_temp.wp_jouer('authenticated', v_a1);
      perform public.creer_profil('pauvre', 'Pauvre couronnable', 'a1-' || v_suffixe || '@exemple.invalid');
      perform pg_temp.wp_jouer('authenticated', v_p2);
      perform public.creer_profil('pauvre', 'Pauvre jaloux', 'p2-' || v_suffixe || '@exemple.invalid');
      perform pg_temp.wp_jouer(null);
      update public.profiles pr set statut_riche = 'actif' where pr.id = v_r1;
      for v_i in 1 .. 4 loop
        insert into public.problems (user_id, type, categorie, titre, texte, montant, statut)
        values (v_a1, 'pauvre', 'reve', 'Problème à couronner ' || v_i, 'Un texte assez long pour être couronné.', 100 * v_i, 'publie')
        returning id into v_id;
        v_pbs := v_pbs || v_id;
      end loop;
      insert into public.problems (user_id, type, titre, texte, montant, statut)
      values (v_r1, 'riche', 'Mon yacht est trop petit', 'Un problème de riche, pas couronnable.', 5000, 'publie')
      returning id into v_pbr;

      -- refusals: poor, pending rich, visitor
      perform pg_temp.wp_jouer('authenticated', v_p2);
      v_res := v_res || pg_temp.wp_attendre_erreur('select public.couronner(''' || v_pbs[1] || ''')', 'interdit',
        '015 : un pauvre ne couronne pas');
      perform pg_temp.wp_jouer('authenticated', v_r2);
      v_res := v_res || pg_temp.wp_attendre_erreur('select public.couronner(''' || v_pbs[1] || ''')', 'riche_en_attente',
        '015 : un riche en attente ne couronne pas');
      perform pg_temp.wp_jouer(null);
      v_res := v_res || pg_temp.wp_ligne(
        not has_function_privilege('anon', 'public.couronner(uuid)', 'execute')
        and not has_function_privilege('anon', 'public.retirer_couronne(uuid)', 'execute')
        and not has_function_privilege('anon', 'public.mes_notifications()', 'execute')
        and not has_function_privilege('anon', 'public.marquer_notifications_lues()', 'execute')
        and has_function_privilege('anon', 'public.get_riche_de_la_semaine()', 'execute'),
        '015 : couronner / retirer / notifications réservés aux membres ; riche de la semaine public');

      -- crowning: notification to the author, 3 per day
      perform pg_temp.wp_jouer('authenticated', v_r1);
      v_j := public.couronner(v_pbs[1]);
      v_res := v_res || pg_temp.wp_ligne((v_j ->> 'couronnes')::int = 1 and (v_j ->> 'restantes')::int = 2,
        '015 : un riche actif couronne un problème de pauvre (il lui reste 2 couronnes)', v_j::text);
      v_j := public.couronner(v_pbs[1]);
      v_res := v_res || pg_temp.wp_ligne((v_j ->> 'couronnes')::int = 1 and (v_j ->> 'restantes')::int = 2,
        '015 : une seule couronne par problème et par riche', v_j::text);
      perform pg_temp.wp_jouer(null);
      v_n := (select count(*) from public.notifications n where n.user_id = v_a1 and n.type = 'couronne');
      v_res := v_res || pg_temp.wp_ligne(v_n = 1 and exists (
          select 1 from public.notifications n where n.user_id = v_a1
            and n.texte like 'Le riche Riche couronneur a couronné ton problème%' and n.lien = 'p.html?id=' || v_pbs[1] and not n.lu),
        '015 : notification « Le riche X a couronné ton problème » créée pour l''auteur (une seule)', v_n::text);
      perform pg_temp.wp_jouer('authenticated', v_r1);
      perform public.couronner(v_pbs[2]);
      v_j := public.couronner(v_pbs[3]);
      v_res := v_res || pg_temp.wp_ligne((v_j ->> 'restantes')::int = 0, '015 : 3 couronnes données → plus aucune ce jour', v_j::text);
      v_res := v_res || pg_temp.wp_attendre_erreur('select public.couronner(''' || v_pbs[4] || ''')', 'limite',
        '015 : 4ᵉ couronne du jour refusée');
      v_res := v_res || pg_temp.wp_attendre_erreur('select public.couronner(''' || v_pbr || ''')', 'introuvable',
        '015 : un problème de riche ne se couronne pas');
      -- removing frees nothing; crowning again the same problem does not notify twice
      v_j := public.retirer_couronne(v_pbs[1]);
      v_res := v_res || pg_temp.wp_ligne((v_j ->> 'couronnes')::int = 0 and (v_j ->> 'couronne')::boolean = false,
        '015 : une couronne se retire', v_j::text);
      v_res := v_res || pg_temp.wp_attendre_erreur('select public.couronner(''' || v_pbs[4] || ''')', 'limite',
        '015 : retirer une couronne ne rend pas de couronne pour la journée');
      v_j := public.couronner(v_pbs[1]);
      perform pg_temp.wp_jouer(null);
      v_res := v_res || pg_temp.wp_ligne((v_j ->> 'couronnes')::int = 1
          and (select count(*) from public.notifications n where n.user_id = v_a1) = 3,
        '015 : recouronner le même problème ne renvoie pas de notification', v_j::text);

      -- projection
      perform pg_temp.wp_jouer('anon');
      v_j := public.get_probleme_public(v_pbs[2]);
      v_res := v_res || pg_temp.wp_ligne((v_j ->> 'couronnes')::int = 1 and v_j ->> 'couronne_par' = 'Riche couronneur'
          and (v_j ->> 'ma_couronne')::boolean = false and (v_j ->> 'yacht')::int = 0 and v_j::text !~ '@'
          and not (v_j ? 'riche_id') and not (v_j ? 'user_id'),
        '015 : la projection publique montre « Couronné par <pseudo> », sans id ni e-mail', v_j::text);
      perform pg_temp.wp_jouer('authenticated', v_r1);
      v_res := v_res || pg_temp.wp_ligne((public.get_probleme_public(v_pbs[2]) ->> 'ma_couronne')::boolean,
        '015 : le riche voit sa propre couronne (ma_couronne)');

      -- notifications of the author
      perform pg_temp.wp_jouer('authenticated', v_a1);
      v_j := public.mes_notifications();
      v_res := v_res || pg_temp.wp_ligne((v_j ->> 'non_lues')::int = 3 and jsonb_array_length(v_j -> 'liste') = 3
          and v_j::text !~ '@' and not (v_j -> 'liste' -> 0 ? 'user_id'),
        '015 : mes_notifications → 3 non lues (3 problèmes couronnés), sans id d''utilisateur ni e-mail', v_j::text);
      v_n := public.marquer_notifications_lues();
      v_j := public.mes_notifications();
      v_res := v_res || pg_temp.wp_ligne(v_n = 3 and (v_j ->> 'non_lues')::int = 0,
        '015 : marquer_notifications_lues → 0 non lue', v_j::text);
      perform pg_temp.wp_jouer('authenticated', v_p2);
      v_j := public.mes_notifications();
      v_res := v_res || pg_temp.wp_ligne((v_j ->> 'non_lues')::int = 0 and jsonb_array_length(v_j -> 'liste') = 0,
        '015 : un membre ne voit jamais les notifications d''un autre', v_j::text);

      -- reactions reserved to active rich members
      v_res := v_res || pg_temp.wp_attendre_erreur('select public.reagir(''' || v_pbs[1] || ''', ''yacht'')', 'interdit',
        '015 : un pauvre ne peut pas réagir « yacht »');
      perform pg_temp.wp_jouer('authenticated', v_r2);
      v_res := v_res || pg_temp.wp_attendre_erreur('select public.reagir(''' || v_pbs[1] || ''', ''majordome'')', 'riche_en_attente',
        '015 : un riche en attente ne peut pas réagir « majordome »');
      perform pg_temp.wp_jouer('authenticated', v_r1);
      v_j := public.reagir(v_pbs[1], 'yacht');
      v_res := v_res || pg_temp.wp_ligne((v_j ->> 'actif')::boolean and (v_j ->> 'yacht')::int = 1 and (v_j ->> 'majordome')::int = 0,
        '015 : un riche actif réagit « Je regarde ça depuis mon yacht »', v_j::text);
      v_j := public.reagir(v_pbs[1], 'majordome');
      v_res := v_res || pg_temp.wp_ligne((v_j ->> 'majordome')::int = 1, '015 : … et « Mon majordome s''en occupe »', v_j::text);

      -- rich of the week, problem of the moment
      perform pg_temp.wp_jouer('anon');
      v_j := public.get_riche_de_la_semaine();
      v_res := v_res || pg_temp.wp_ligne(v_j ->> 'pseudo' = 'Riche couronneur' and (v_j ->> 'couronnes_7j')::int = 3
          and v_j -> 'derniere' ->> 'id' = v_pbr::text and v_j::text !~ '@',
        '015 : le riche de la semaine = celui qui a donné le plus de couronnes, avec sa dernière publication', v_j::text);
      v_j := public.get_probleme_du_moment();
      v_res := v_res || pg_temp.wp_ligne((v_j ->> 'id')::uuid = any (v_pbs[1:3]),
        '015 : un problème couronné devient « le problème du moment » (une couronne = 10 réactions)', v_j ->> 'titre');
      perform pg_temp.wp_jouer(null);
      v_res := v_res || pg_temp.wp_ligne(
        (select bool_and(c.relrowsecurity and c.relforcerowsecurity) from pg_class c
         where c.oid in ('public.couronnes'::regclass, 'public.notifications'::regclass))
        and not has_table_privilege('authenticated', 'public.notifications', 'select,insert,update,delete')
        and not has_table_privilege('authenticated', 'public.couronnes', 'select,insert,update,delete'),
        '015 : couronnes et notifications en RLS forcée sans aucun droit direct');
    end;

    -- =================================================================
    -- 016. Seasons of the leaderboard (R-038)
    -- =================================================================
    declare
      v_m1 uuid := gen_random_uuid();
      v_m2 uuid := gen_random_uuid();
      v_r1 integer;
      v_r2 integer;
    begin
      perform pg_temp.wp_jouer(null);
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                              created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_anonymous)
      select '00000000-0000-0000-0000-000000000000'::uuid, u.id, 'authenticated', 'authenticated',
             u.nom || '-' || v_suffixe || '@exemple.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false
      from (values (v_m1, 'm1'), (v_m2, 'm2')) as u(id, nom);
      perform pg_temp.wp_jouer('authenticated', v_m1);
      perform public.creer_profil('pauvre', 'Pauvre du mois dernier', 'm1-' || v_suffixe || '@exemple.invalid');
      perform pg_temp.wp_jouer('authenticated', v_m2);
      perform public.creer_profil('pauvre', 'Pauvre de ce mois', 'm2-' || v_suffixe || '@exemple.invalid');
      perform pg_temp.wp_jouer(null);
      -- m1: a huge problem shown last month (Paris); m2: a small one this month
      insert into public.problems (user_id, type, categorie, titre, texte, montant, statut, cree_le)
      values (v_m1, 'pauvre', 'factures', 'Le mois dernier', 'Un problème du mois dernier, déjà loin.', 10000, 'publie',
              public.wp_debut_mois_paris() - interval '2 days'),
             (v_m2, 'pauvre', 'factures', 'Ce mois-ci', 'Un petit problème de ce mois-ci.', 1, 'publie', now());

      perform pg_temp.wp_jouer('anon');
      v_j := public.get_palmares(100, 'mois');
      v_res := v_res || pg_temp.wp_ligne(
        v_j ->> 'periode' = 'mois'
        and exists (select 1 from jsonb_array_elements(v_j -> 'lignes') l where l ->> 'pseudo' = 'Pauvre de ce mois')
        and not exists (select 1 from jsonb_array_elements(v_j -> 'lignes') l where l ->> 'pseudo' = 'Pauvre du mois dernier'),
        '016 : palmarès du mois = seulement les problèmes du mois en cours (heure de Paris)', left(v_j::text, 300));
      v_j := public.get_palmares(100, 'toujours');
      select (l ->> 'rang')::int into v_r1 from jsonb_array_elements(v_j -> 'lignes') l where l ->> 'pseudo' = 'Pauvre du mois dernier';
      select (l ->> 'rang')::int into v_r2 from jsonb_array_elements(v_j -> 'lignes') l where l ->> 'pseudo' = 'Pauvre de ce mois';
      v_res := v_res || pg_temp.wp_ligne(v_r1 is not null and v_r2 is not null and v_r1 < v_r2
          and v_j::text !~ '@' and v_j::text !~ v_m1::text,
        '016 : palmarès « depuis toujours » = tous les mois, sans id ni e-mail', v_r1 || ' / ' || v_r2);
      v_res := v_res || pg_temp.wp_ligne(public.get_palmares(100) -> 'lignes' = (select jsonb_agg(l - 'badges' - 'code' order by (l ->> 'rang')::int) from jsonb_array_elements(v_j -> 'lignes') l),
        '016 : l''ancienne signature get_palmares(p_limite) renvoie toujours le général');
      v_res := v_res || pg_temp.wp_attendre_erreur('select public.get_palmares(10, ''semaine'')', 'invalide',
        '016 : période inconnue refusée');
      perform pg_temp.wp_jouer('authenticated', v_m1);
      v_j := public.get_mon_rang('mois');
      v_res := v_res || pg_temp.wp_ligne(v_j ? 'rang' and v_j -> 'rang' = 'null'::jsonb and (v_j ->> 'total')::int = 0
          and (public.get_mon_rang('toujours') ->> 'rang')::int = v_r1 and (public.get_mon_rang() ->> 'rang')::int = v_r1,
        '016 : mon rang du mois (pas classé ce mois-ci) et mon rang général', v_j::text);
      perform pg_temp.wp_jouer('authenticated', v_m2);
      v_res := v_res || pg_temp.wp_ligne((public.get_mon_rang('mois') ->> 'rang') is not null,
        '016 : un pauvre qui a publié ce mois-ci est classé dans le palmarès du mois');
      perform pg_temp.wp_jouer(null);
      v_res := v_res || pg_temp.wp_ligne(
        has_function_privilege('anon', 'public.get_palmares(integer, text)', 'execute')
        and has_function_privilege('anon', 'public.get_mon_rang(text)', 'execute')
        and (select bool_and(p.prosecdef and coalesce(p.proconfig, '{}') @> array['search_path=""'] and p.provolatile = 's')
             from pg_proc p where p.oid in ('public.get_palmares(integer, text)'::regprocedure, 'public.get_mon_rang(text)'::regprocedure))
        and (select coalesce(p.pronargdefaults, 0) from pg_proc p where p.oid = 'public.get_palmares(integer, text)'::regprocedure) = 0,
        '016 : nouvelles signatures publiques, SECURITY DEFINER, lecture seule, sans valeur par défaut (pas d''ambiguïté PostgREST)');
    end;

    -- =================================================================
    -- 017. Titles and badges (R-039)
    -- =================================================================
    declare
      v_b1    uuid := gen_random_uuid();
      v_code  text;
      v_code_r text;
      v_code_b text;
      v_pbs   uuid[] := '{}';
      v_id    uuid;
    begin
      perform pg_temp.wp_jouer(null);
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                              created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_anonymous)
      values ('00000000-0000-0000-0000-000000000000'::uuid, v_b1, 'authenticated', 'authenticated',
              'b1-' || v_suffixe || '@exemple.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false);
      perform pg_temp.wp_jouer('authenticated', v_b1);
      v_code := public.creer_profil('pauvre', 'Pauvre médaillé', 'b1-' || v_suffixe || '@exemple.invalid') ->> 'code_partage';
      perform pg_temp.wp_jouer(null);
      -- 1 problem at 10x Rien + 10 small « factures » problems, all this month
      insert into public.problems (user_id, type, categorie, titre, texte, montant, statut)
      values (v_b1, 'pauvre', 'factures', 'Le plafond', 'Un problème qui touche le plafond des pauvres.', 10000, 'publie');
      for v_i in 1 .. 10 loop
        insert into public.problems (user_id, type, categorie, titre, texte, montant, statut)
        values (v_b1, 'pauvre', 'factures', 'Facture ' || v_i, 'Encore une facture, la ' || v_i || 'ᵉ du mois.', 1, 'publie')
        returning id into v_id;
        v_pbs := v_pbs || v_id;
      end loop;
      -- a rich member crowns 10 of them (= 10 crowns given), 3 members invited by b1
      insert into public.couronnes (problem_id, riche_id) select unnest(v_pbs), v_riche;
      update public.profiles pr set invite_par = v_b1 where pr.id in (v_pauvre2, v_pauvre3, v_pauvre4);
      select pr.code_partage into v_code_r from public.profiles pr where pr.id = v_riche;
      select pr.code_partage into v_code_b from public.profiles pr where pr.id = v_bloque;

      perform pg_temp.wp_jouer('anon');
      v_j := public.get_badges(lower(v_code));
      v_res := v_res || pg_temp.wp_ligne(v_j ->> 'pseudo' = 'Pauvre médaillé'
          and v_j -> 'badges' = '["or", "roi_decouvert", "plafond", "couronne", "rabatteur", "premier"]'::jsonb
          and (select count(*) from jsonb_object_keys(v_j)) = 2,
        '017 : badges calculés (or du mois, roi du découvert, plafond, couronné, rabatteur, premier problème), seulement pseudo + badges', v_j::text);
      v_res := v_res || pg_temp.wp_ligne((public.get_badges(v_code_r) -> 'badges') ? 'mecene',
        '017 : 🎩 Mécène imaginaire pour un riche qui a donné 10 couronnes');
      v_res := v_res || pg_temp.wp_ligne(public.get_badges('pas-un-code') is null and public.get_badges(null) is null
          and public.get_badges(v_code_b) is null,
        '017 : code invalide ou membre bloqué → null');
      v_j := public.get_palmares(100, 'mois');
      v_res := v_res || pg_temp.wp_ligne(v_j -> 'lignes' -> 0 ->> 'pseudo' = 'Pauvre médaillé'
          and v_j -> 'lignes' -> 0 -> 'badges' ? 'or' and v_j -> 'lignes' -> 0 ->> 'code' = v_code
          and v_j::text !~ '@' and v_j::text !~ v_b1::text,
        '017 : le palmarès porte les badges et le code de partage de chaque ligne (jamais l''id)', left(v_j::text, 300));
      perform pg_temp.wp_jouer(null);
      update public.problems p set masque = true where p.user_id = v_b1 and p.montant = 10000;
      v_res := v_res || pg_temp.wp_ligne(not ((public.get_badges(v_code) -> 'badges') ? 'plafond'),
        '017 : un problème masqué ne donne plus de badge');
      v_res := v_res || pg_temp.wp_ligne(has_function_privilege('anon', 'public.get_badges(text)', 'execute')
          and not has_function_privilege('anon', 'public.wp_badges(uuid)', 'execute'),
        '017 : get_badges public, wp_badges interne');
    end;

    -- =================================================================
    -- 018. Public profile (R-040)
    -- =================================================================
    declare
      v_cp text;
      v_cr text;
      v_cb text;
    begin
      perform pg_temp.wp_jouer(null);
      select pr.code_partage into v_cp from public.profiles pr where pr.pseudo = 'Pauvre médaillé';
      select pr.code_partage into v_cr from public.profiles pr where pr.id = v_riche;
      select pr.code_partage into v_cb from public.profiles pr where pr.id = v_bloque;
      perform pg_temp.wp_jouer('anon');
      v_j := public.get_profil_public(lower(v_cp));
      v_res := v_res || pg_temp.wp_ligne(v_j ->> 'pseudo' = 'Pauvre médaillé' and v_j ->> 'camp' = 'pauvre'
          and (v_j -> 'rang_mois' ->> 'rang') is not null and (v_j -> 'rang_general' ->> 'rang') is not null
          and (v_j ->> 'nb')::int = 10 and jsonb_array_length(v_j -> 'problemes') = 10
          and v_j -> 'badges' ? 'premier' and v_j ->> 'arrive_le' ~ '^\d{4}-\d{2}-\d{2}$'
          and v_j::text !~ '@' and not (v_j ? 'id') and not (v_j -> 'problemes' -> 0 ? 'user_id'),
        '018 : profil public d''un pauvre (rangs, total, badges, problèmes visibles seulement), sans id ni e-mail', left(v_j::text, 400));
      v_res := v_res || pg_temp.wp_ligne(v_j -> 'problemes' -> 0 ->> 'code_auteur' = v_cp,
        '018 : la projection publique porte le code de partage de l''auteur (lien vers son profil)');
      v_j := public.get_profil_public(v_cr);
      v_res := v_res || pg_temp.wp_ligne(v_j ->> 'camp' = 'riche' and not (v_j ? 'rang_mois')
          and jsonb_array_length(v_j -> 'couronnes_donnees') = 10 and v_j ->> 'statut_riche' = 'actif',
        '018 : profil public d''un riche : publications et couronnes données, pas de rang', left(v_j::text, 300));
      v_res := v_res || pg_temp.wp_ligne(public.get_profil_public(v_cb) is null and public.get_profil_public('xx') is null
          and public.get_profil_public(null) is null,
        '018 : code inconnu, invalide ou membre bloqué → null');
      perform pg_temp.wp_jouer(null);
    end;

    -- =================================================================
    -- 019. Follow a profile (R-047)
    -- =================================================================
    declare
      v_s1  uuid := gen_random_uuid();
      v_s2  uuid := gen_random_uuid();
      v_c1  text;
      v_c2  text;
      v_cr  text;
      v_id  uuid;
    begin
      perform pg_temp.wp_jouer(null);
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                              created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_anonymous)
      select '00000000-0000-0000-0000-000000000000'::uuid, u.id, 'authenticated', 'authenticated',
             u.nom || '-' || v_suffixe || '@exemple.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false
      from (values (v_s1, 's1'), (v_s2, 's2')) as u(id, nom);
      perform pg_temp.wp_jouer('authenticated', v_s1);
      v_c1 := public.creer_profil('pauvre', 'Pauvre fan', 's1-' || v_suffixe || '@exemple.invalid') ->> 'code_partage';
      perform pg_temp.wp_jouer('authenticated', v_s2);
      v_c2 := public.creer_profil('pauvre', 'Pauvre star', 's2-' || v_suffixe || '@exemple.invalid') ->> 'code_partage';
      perform pg_temp.wp_jouer(null);
      select pr.code_partage into v_cr from public.profiles pr where pr.id = v_riche;
      v_res := v_res || pg_temp.wp_ligne(
        not has_function_privilege('anon', 'public.suivre(text)', 'execute')
        and not has_function_privilege('anon', 'public.ne_plus_suivre(text)', 'execute')
        and not has_function_privilege('anon', 'public.mes_suivis()', 'execute')
        and not has_function_privilege('anon', 'public.get_fil_suivis(integer, timestamptz)', 'execute')
        and has_function_privilege('anon', 'public.get_plus_suivis()', 'execute')
        and (select c.relforcerowsecurity from pg_class c where c.oid = 'public.suivis'::regclass)
        and not has_table_privilege('authenticated', 'public.suivis', 'select,insert,update,delete'),
        '019 : suivre réservé aux membres (anon refusé), suivis en RLS forcée sans droit, plus suivis public');

      perform pg_temp.wp_jouer('authenticated', v_s1);
      v_res := v_res || pg_temp.wp_attendre_erreur(format('select public.suivre(%L)', v_c1), 'invalide',
        '019 : se suivre soi-même refusé');
      v_res := v_res || pg_temp.wp_attendre_erreur('select public.suivre(''ZZZZZZZZ'')', 'introuvable',
        '019 : code inconnu → introuvable');
      v_j := public.suivre(lower(v_c2));
      v_j := public.suivre(v_c2);
      v_res := v_res || pg_temp.wp_ligne((v_j ->> 'suivi')::boolean and (v_j ->> 'abonnes')::int = 1,
        '019 : double suivi sans effet (1 abonné)', v_j::text);
      perform public.suivre(v_cr);
      v_j := public.get_profil_public(v_c2);
      v_res := v_res || pg_temp.wp_ligne((v_j ->> 'abonnes')::int = 1 and (v_j ->> 'je_suis')::boolean,
        '019 : le profil public montre le nombre d''abonnés et si je le suis', v_j ->> 'abonnes');

      -- the followed account publishes → notification + wall « Mes suivis »
      perform pg_temp.wp_jouer('authenticated', v_s2);
      v_id := (public.soumettre_probleme('amour', 'Mon ex garde le chat', 'Il a aussi gardé le canapé, et le chat dort dessus.', 300) ->> 'id')::uuid;
      perform pg_temp.wp_jouer('authenticated', v_s1);
      v_j := public.mes_notifications();
      v_res := v_res || pg_temp.wp_ligne(exists (select 1 from jsonb_array_elements(v_j -> 'liste') n
          where n ->> 'type' = 'suivi' and n ->> 'texte' = 'Pauvre star a publié : « Mon ex garde le chat »' and n ->> 'lien' = 'p.html?id=' || v_id),
        '019 : notification au suiveur quand un compte suivi publie', left(v_j::text, 300));
      v_j := public.get_fil_suivis(12, null);
      v_res := v_res || pg_temp.wp_ligne(v_j -> 0 ->> 'id' = v_id::text and v_j::text !~ '@' and not (v_j -> 0 ? 'user_id'),
        '019 : fil « Mes suivis » = publications des comptes suivis, du plus récent au plus ancien', left(v_j::text, 200));
      v_j := public.mes_suivis();
      v_res := v_res || pg_temp.wp_ligne(jsonb_array_length(v_j) = 2 and v_j -> 0 ->> 'pseudo' = 'Pauvre star'
          and v_j -> 0 -> 'dernier' ->> 'id' = v_id::text and v_j -> 0 ? 'badges' and v_j::text !~ '@'
          and v_j::text !~ v_s2::text,
        '019 : mes_suivis (pseudo, camp, code, badges, dernière publication), sans id ni e-mail', left(v_j::text, 300));
      v_j := public.get_plus_suivis();
      v_res := v_res || pg_temp.wp_ligne(v_j -> 'pauvres' -> 0 ->> 'pseudo' = 'Pauvre star' and (v_j -> 'pauvres' -> 0 ->> 'abonnes')::int = 1
          and jsonb_array_length(v_j -> 'riches') >= 1 and v_j::text !~ '@',
        '019 : les plus suivis (pauvres et riches)', left(v_j::text, 300));
      v_j := public.ne_plus_suivre(v_c2);
      v_res := v_res || pg_temp.wp_ligne(not (v_j ->> 'suivi')::boolean and (v_j ->> 'abonnes')::int = 0,
        '019 : ne plus suivre', v_j::text);
      perform pg_temp.wp_jouer(null);
    end;

    -- =================================================================
    -- 020. The duel (R-041)
    -- =================================================================
    declare
      v_d   uuid := gen_random_uuid();
      v_a   uuid;
      v_b   uuid;
      v_pr  uuid;
    begin
      perform pg_temp.wp_jouer(null);
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                              created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_anonymous)
      values ('00000000-0000-0000-0000-000000000000'::uuid, v_d, 'authenticated', 'authenticated',
              'd1-' || v_suffixe || '@exemple.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false);
      perform pg_temp.wp_jouer('authenticated', v_d);
      perform public.creer_profil('pauvre', 'Pauvre duelliste', 'd1-' || v_suffixe || '@exemple.invalid');
      perform pg_temp.wp_jouer(null);
      insert into public.problems (user_id, type, categorie, titre, texte, montant, statut)
      values (v_d, 'pauvre', 'quotidien', 'Le plus drôle du monde', 'Mon chat a appris à commander des croquettes.', 50, 'publie')
      returning id into v_a;
      insert into public.problems (user_id, type, categorie, titre, texte, montant, statut)
      values (v_d, 'pauvre', 'quotidien', 'Le moins drôle', 'Mon chat a appris à se taire, c''est tout.', 40, 'publie')
      returning id into v_b;
      select p.id into v_pr from public.problems p where p.type = 'riche' and p.statut = 'publie' limit 1;

      perform pg_temp.wp_jouer('anon');
      v_j := public.get_duel(null);
      v_res := v_res || pg_temp.wp_ligne(jsonb_array_length(v_j) = 2 and v_j -> 0 ->> 'id' <> v_j -> 1 ->> 'id'
          and v_j -> 0 ->> 'type' = 'pauvre' and v_j -> 1 ->> 'type' = 'pauvre' and v_j::text !~ '@',
        '020 : un visiteur reçoit un duel de deux problèmes de pauvres différents', left(v_j::text, 200));
      v_j := public.get_duel(array[v_a]);
      v_res := v_res || pg_temp.wp_ligne(v_j -> 0 ->> 'id' <> v_a::text and v_j -> 1 ->> 'id' <> v_a::text,
        '020 : le duel évite les problèmes qu''on vient de voir');
      -- 8 wins for A (visitor, with and without an IP)
      for v_i in 1 .. 7 loop
        perform public.voter_duel(v_a, v_b);
      end loop;
      perform set_config('request.headers', '{"cf-connecting-ip": "192.0.2.44"}', true);
      v_j := public.voter_duel(v_a, v_b);
      perform set_config('request.headers', '', true);
      v_res := v_res || pg_temp.wp_ligne((v_j ->> 'victoires_7j')::int = 8, '020 : un visiteur vote (8 victoires)', v_j::text);
      v_res := v_res || pg_temp.wp_attendre_erreur(format('select public.voter_duel(%L, %L)', v_a, v_a), 'invalide',
        '020 : un problème ne se bat pas contre lui-même');
      v_res := v_res || pg_temp.wp_attendre_erreur(format('select public.voter_duel(%L, %L)', v_a, v_pr), 'invalide',
        '020 : un problème de riche n''entre pas dans le duel');
      v_j := public.get_plus_droles_semaine(5);
      v_res := v_res || pg_temp.wp_ligne(v_j -> 0 -> 'carte' ->> 'id' = v_a::text and (v_j -> 0 ->> 'victoires')::int = 8,
        '020 : « Les plus drôles de la semaine » classés par victoires', left(v_j::text, 200));
      v_res := v_res || pg_temp.wp_ligne(public.get_probleme_du_moment() ->> 'id' = v_a::text,
        '020 : les victoires des 7 derniers jours comptent dans « Le problème du moment »');
      perform pg_temp.wp_jouer(null);
      v_res := v_res || pg_temp.wp_ligne(
        (select count(*) from public.duels d where d.votant_empreinte ~ '^[0-9a-f]{64}$') = 1
        and not exists (select 1 from public.duels d where d.votant_empreinte like '%192.0.2%')
        and (select c.relforcerowsecurity from pg_class c where c.oid = 'public.duels'::regclass)
        and not has_table_privilege('anon', 'public.duels', 'select,insert,update,delete'),
        '020 : votant gardé en empreinte seulement (jamais l''IP), table duels en RLS forcée sans droit');
    end;

    -- =================================================================
    -- 021. La Gazette des pauvres (R-043) — reservations only, nothing is ever sent from SQL
    -- =================================================================
    declare
      v_avant24 integer;
      v_gid     uuid;
      v_n       integer;
      v_mg      uuid := gen_random_uuid();
    begin
      perform pg_temp.wp_jouer(null);
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                              created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_anonymous)
      values ('00000000-0000-0000-0000-000000000000'::uuid, v_mg, 'authenticated', 'authenticated',
              'mg-' || v_suffixe || '@exemple.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false);
      perform pg_temp.wp_jouer('authenticated', v_mg);
      perform public.creer_profil('pauvre', 'Modo gazette', 'mg-' || v_suffixe || '@exemple.invalid');
      perform pg_temp.wp_jouer(null);
      insert into public.moderateurs (user_id) values (v_mg);
      update public.profiles pr set newsletter = true, bloque = false where pr.id in (v_pauvre2, v_pauvre3);
      perform pg_temp.wp_jouer('authenticated', v_pauvre2);
      v_res := v_res || pg_temp.wp_attendre_erreur('select public.mod_gazette_apercu()', 'interdit',
        '021 : l''aperçu de la gazette est réservé aux modérateurs');
      perform pg_temp.wp_jouer('authenticated', v_mg);
      v_j := public.mod_gazette_apercu();
      v_res := v_res || pg_temp.wp_ligne(v_j -> 'contenu' ? 'top' and v_j -> 'contenu' ? 'pauvre_du_mois'
          and v_j -> 'contenu' ? 'nouveaux_riches' and jsonb_array_length(v_j -> 'contenu' -> 'themes') = 7
          and jsonb_array_length(v_j -> 'contenu' -> 'top') between 1 and 5
          and not (v_j ->> 'figee')::boolean and (v_j ->> 'destinataires')::int >= 1
          and (v_j -> 'contenu')::text !~ '@',
        '021 : aperçu modérateur (top 5, pauvre du mois, nouveaux riches, thèmes), sans e-mail', left(v_j::text, 300));
      perform pg_temp.wp_jouer(null);
      v_res := v_res || pg_temp.wp_ligne(
        not has_function_privilege('anon', 'public.srv_gazette_reserver(integer)', 'execute')
        and not has_function_privilege('authenticated', 'public.srv_gazette_reserver(integer)', 'execute')
        and not has_function_privilege('authenticated', 'public.srv_gazette_annuler(uuid, uuid[])', 'execute')
        and has_function_privilege('service_role', 'public.srv_gazette_reserver(integer)', 'execute')
        and not has_function_privilege('anon', 'public.mod_gazette_apercu()', 'execute')
        and (select bool_and(c.relforcerowsecurity) from pg_class c
             where c.oid in ('public.gazettes'::regclass, 'public.gazette_envois'::regclass)),
        '021 : envois de la gazette réservés à service_role ; tables en RLS forcée');

      v_avant24 := public.wp_envois_24h();
      perform pg_temp.wp_jouer('service_role');
      v_j := public.srv_gazette_reserver(100);
      perform pg_temp.wp_jouer(null);
      v_gid := (v_j -> 'gazette' ->> 'id')::uuid;
      v_n := jsonb_array_length(v_j -> 'destinataires');
      v_res := v_res || pg_temp.wp_ligne(v_n >= 1 and (v_j ->> 'reste_a_envoyer')::int = 0
          and public.wp_envois_24h() = v_avant24 + v_n
          and not exists (select 1 from jsonb_array_elements(v_j -> 'destinataires') d
                          join public.profiles pr on pr.id = (d ->> 'user_id')::uuid where not pr.newsletter or pr.bloque),
        '021 : la gazette réserve les membres qui ont coché la case (budget de 250 / 24 h partagé avec les annonces)', v_n::text);
      perform pg_temp.wp_jouer('service_role');
      v_j := public.srv_gazette_reserver(100);
      v_res := v_res || pg_temp.wp_ligne(jsonb_array_length(v_j -> 'destinataires') = 0 and (v_j -> 'gazette' ->> 'id')::uuid = v_gid,
        '021 : jamais deux fois le même numéro (gazette figée pour la semaine)');
      v_n := public.srv_gazette_annuler(v_gid, array[v_pauvre2]);
      v_j := public.srv_gazette_reserver(100);
      perform pg_temp.wp_jouer(null);
      v_res := v_res || pg_temp.wp_ligne(v_n = 1 and jsonb_array_length(v_j -> 'destinataires') = 1,
        '021 : un envoi refusé par Brevo est libéré et repris plus tard');
      perform pg_temp.wp_jouer('authenticated', v_mg);
      v_res := v_res || pg_temp.wp_ligne((public.mod_gazette_apercu() ->> 'figee')::boolean,
        '021 : après le premier envoi, l''aperçu montre le numéro figé de la semaine');
      perform pg_temp.wp_jouer(null);
    end;

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
