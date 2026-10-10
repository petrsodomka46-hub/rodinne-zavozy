-- Propojení uživatelů s rodinou.
-- Nejdřív založte 4 uživatele v Authentication → Users → Add user → Create new user
-- (zaškrtněte „Auto Confirm User“). E-maily níže musí sedět s těmi v js/config.js.

insert into public.members (id, key, role)
select u.id, v.key, v.role
from (values
  ('petr@zavozy.example',    'petr',    'parent'),
  ('miluska@zavozy.example', 'miluska', 'parent'),
  ('tomas@zavozy.example',   'tomas',   'child'),
  ('elen@zavozy.example',    'elen',    'child')
) as v(email, key, role)
join auth.users u on lower(u.email) = lower(v.email)
on conflict (id) do update set key = excluded.key, role = excluded.role;

-- Kontrola: musí vrátit 4 řádky.
select m.key, m.role, u.email from public.members m join auth.users u on u.id = m.id;
