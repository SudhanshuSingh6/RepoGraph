-- Public GitHub repos and the sample project can be imported without signing in.
-- Such projects have no owner: their code is already public, so anyone holding the
-- project link may open it. Projects imported while signed in stay owned and private.
alter table projects alter column owner_id drop not null;
