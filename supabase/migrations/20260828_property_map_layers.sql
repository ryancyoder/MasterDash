-- Georeferenced map layers, keyed by property.
--
-- The overlays a property's map is drawn against: a landscape plan, a survey,
-- an older aerial. Keyed by PROPERTY rather than by estimate or by session,
-- because aligning a plan against a yard is a fact about the yard. It takes
-- real care to get right, it does not change because somebody started a second
-- quote, and both apps want the same answer — a plan placed on site in Upright
-- is the plan the estimator opens at the desk.
--
-- The geometry is Upright's five numbers, name for name (`upright_sessions`
-- carries plan_center_lat/lng, plan_width_m, plan_aspect, plan_rot_deg), so
-- porting that side is a rename rather than a translation. Three corners of a
-- parallelogram fully define an affine mapping from image pixel to coordinate,
-- which is why those five rebuild a placed image exactly.

create table if not exists public.property_map_layers (
  id            uuid primary key default gen_random_uuid(),
  property_id   bigint not null references public.properties(id) on delete cascade,
  label         text not null default 'Plan',

  -- Object in the `estimate-plans` bucket, under a properties/<id>/ prefix.
  -- Null while the image is still only on the device that picked it.
  storage_path  text,

  -- Centre, ground width in metres, height/width, and clockwise-from-north.
  centre_lat    double precision not null,
  centre_lng    double precision not null,
  width_m       double precision not null check (width_m > 0),
  aspect        double precision not null default 1 check (aspect > 0),
  rot_deg       double precision not null default 0,

  opacity       double precision not null default 1
                  check (opacity >= 0 and opacity <= 1),
  z             integer not null default 0,

  -- Placed and not to be nudged. Default true, because an unlocked overlay is
  -- one a stray thumb can move and reopening an old property to look at it is
  -- not the moment to find that out.
  locked        boolean not null default true,

  -- Its width came from a dimension read off the drawing rather than from
  -- eyeballing it against the satellite. Until this is true the layer is a
  -- picture in roughly the right place; after it, it is the measurement.
  scale_locked  boolean not null default false,

  -- Which app placed it, so a hand-eye alignment never reads as a survey.
  source        text not null default 'masterdash'
                  check (source in ('masterdash', 'upright')),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists property_map_layers_property_idx
  on public.property_map_layers (property_id, z);

-- The project convention, and both apps': RLS on, zero policies. The browser
-- holds no credential that reaches this table. MasterDash reads it through its
-- own route handlers and Upright through `upright-api`, both of which hold a
-- service key server-side.
alter table public.property_map_layers enable row level security;
