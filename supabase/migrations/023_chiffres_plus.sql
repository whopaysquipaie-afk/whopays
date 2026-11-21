-- =====================================================================
-- Qui paie ? / Who pays? — 023: « Les chiffres » enriched (R-046, bonus)
--  * get_chiffres_plus(): public, read only, aggregates only (no id, no pseudo, no e-mail) →
--      par_jour: the 30 last days (Paris): [{ jour, total, nb }] — Riens published per day
--      categorie_semaine: { categorie, total, nb } — the category with the most Riens over 7 days, or null
--      heure_pointe: { heure, nb } — the hour of the day (Paris) with the most problems over 30 days, or null
--      par_heure: 24 counts (0 h → 23 h, Paris, 30 days)
--    Problems of the poor only, published, visible, not examples (same scope as get_chiffres).
-- 001 to 022 are NOT modified. Run after 022 (or any time after 011). Idempotent.
-- Same rules as getChiffresPlus() in site/assets/js/api-demo.js.
-- =====================================================================

create or replace function public.get_chiffres_plus()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  with pb as (
    select p.categorie, coalesce(p.montant, 0) as montant,
           (coalesce(p.modere_le, p.cree_le) at time zone 'Europe/Paris') as quand
    from public.problems p
    where p.type = 'pauvre' and p.statut = 'publie' and not p.masque and not p.est_exemple
      and coalesce(p.modere_le, p.cree_le) > now() - interval '31 days'
  ), jours as (
    select (d)::date as jour
    from generate_series((now() at time zone 'Europe/Paris')::date - 29, (now() at time zone 'Europe/Paris')::date, interval '1 day') d
  )
  select jsonb_build_object(
    'par_jour', (
      select jsonb_agg(jsonb_build_object('jour', j.jour, 'total', coalesce(x.total, 0), 'nb', coalesce(x.nb, 0)) order by j.jour)
      from jours j
      left join (select quand::date as jour, sum(montant)::bigint as total, count(*) as nb from pb group by 1) x on x.jour = j.jour
    ),
    'categorie_semaine', (
      select jsonb_build_object('categorie', c.categorie, 'total', c.total, 'nb', c.nb)
      from (select pb.categorie, sum(pb.montant)::bigint as total, count(*) as nb from pb
            where pb.quand > (now() at time zone 'Europe/Paris') - interval '7 days'
            group by pb.categorie order by 2 desc, 3 desc, 1 limit 1) c
    ),
    'heure_pointe', (
      select jsonb_build_object('heure', h.heure, 'nb', h.nb)
      from (select extract(hour from pb.quand)::int as heure, count(*) as nb from pb
            where pb.quand > (now() at time zone 'Europe/Paris') - interval '30 days'
            group by 1 order by 2 desc, 1 limit 1) h
    ),
    'par_heure', (
      select jsonb_agg(coalesce(x.nb, 0) order by g.h)
      from generate_series(0, 23) g(h)
      left join (select extract(hour from pb.quand)::int as h, count(*) as nb from pb
                 where pb.quand > (now() at time zone 'Europe/Paris') - interval '30 days' group by 1) x on x.h = g.h
    )
  );
$fn$;
revoke all on function public.get_chiffres_plus() from public, anon, authenticated;
grant execute on function public.get_chiffres_plus() to anon, authenticated;
