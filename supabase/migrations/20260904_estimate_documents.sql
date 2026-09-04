-- The take-off and the visit get columns of their own.
--
-- They had been riding inside `quick_estimates.lines`, the jsonb blob whose
-- whole contract is that it is DISPOSABLE: `lines` carries `taps`, `labels`,
-- `assemblyBuckets`, `rendered` and `takeoff`, every one of which is a
-- projection of `quick_estimate_taps` and can be rebuilt from it at any time.
-- The invariant everybody is told — "lines is a projection, the estimate lives
-- in quick_estimate_taps" — is an instruction to treat that column as safe to
-- throw away and regenerate.
--
-- Two things in there were never projections. The map take-off and the visit
-- transcript are DOCUMENTS: they are not derivable from the op log, from the
-- catalog, or from anything else on the row. Rebuilding `lines` from the taps
-- — the correct reading of the invariant, and a reasonable thing for a report,
-- a backfill or a future maintainer to do — would have destroyed every plan
-- and every transcript in the project, with nothing anywhere to restore them
-- from. A morning spent drawing a yard is the most expensive data this app
-- holds and it was in the one column labelled cheap.
--
-- So they move out. After this, `lines` really is disposable and the invariant
-- is true without an asterisk.
--
-- BOTH PLACES ARE WRITTEN FOR NOW, and that is deliberate rather than
-- untidiness. This is an offline-first app on a fleet of iPads that update
-- whenever somebody remembers to, and a build still in the field reads
-- `lines.plan`. Cutting over in one step would take the take-off away from
-- every tablet that has not been updated. The client writes both and prefers
-- the column on read; dropping the copy inside `lines` is a later migration,
-- once the fleet is known to be current.

alter table public.quick_estimates
  add column if not exists plan  jsonb,
  add column if not exists visit jsonb;

comment on column public.quick_estimates.plan is
  'The map take-off. A DOCUMENT, not derivable from quick_estimate_taps.';
comment on column public.quick_estimates.visit is
  'The site-visit transcript and what was read from it. A DOCUMENT.';
comment on column public.quick_estimates.lines is
  'Projection of quick_estimate_taps, plus the rendered proposal lines. '
  'Safe to rebuild. It also still carries copies of plan/visit for builds '
  'that predate those columns; those copies are not the source of truth.';

-- Backfill from where they have been living. Only where the column is still
-- empty and the blob actually holds one, so re-running this is a no-op and it
-- can never overwrite a document written since.
update public.quick_estimates
   set plan = lines -> 'plan'
 where plan is null
   and lines ? 'plan'
   and jsonb_typeof(lines -> 'plan') = 'object';

update public.quick_estimates
   set visit = lines -> 'visit'
 where visit is null
   and lines ? 'visit'
   and jsonb_typeof(lines -> 'visit') = 'object';
