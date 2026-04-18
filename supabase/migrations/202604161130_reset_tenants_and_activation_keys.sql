begin;

-- Reset onboarding state first so old key formats cannot block new constraints.
delete from public.tenants;
delete from public.activation_keys;

-- Enforce 5-block activation key format (XXXXX-XXXXX-XXXXX-XXXXX-XXXXX).
alter table public.activation_keys
  drop constraint if exists activation_keys_key_code_format_check;

alter table public.activation_keys
  add constraint activation_keys_key_code_format_check
  check (key_code ~ '^[A-Z0-9]{5}(?:-[A-Z0-9]{5}){4}$');

-- Seed 10 fresh available activation keys (5-block format only).
insert into public.activation_keys (key_code, status, notes)
values
  ('ALS26-KEY01-START-FRESH-00001', 'available', 'Fresh seed key 1'),
  ('ALS26-KEY02-START-FRESH-00002', 'available', 'Fresh seed key 2'),
  ('ALS26-KEY03-START-FRESH-00003', 'available', 'Fresh seed key 3'),
  ('ALS26-KEY04-START-FRESH-00004', 'available', 'Fresh seed key 4'),
  ('ALS26-KEY05-START-FRESH-00005', 'available', 'Fresh seed key 5'),
  ('ALS26-KEY06-START-FRESH-00006', 'available', 'Fresh seed key 6'),
  ('ALS26-KEY07-START-FRESH-00007', 'available', 'Fresh seed key 7'),
  ('ALS26-KEY08-START-FRESH-00008', 'available', 'Fresh seed key 8'),
  ('ALS26-KEY09-START-FRESH-00009', 'available', 'Fresh seed key 9'),
  ('ALS26-KEY10-START-FRESH-00010', 'available', 'Fresh seed key 10');

commit;
