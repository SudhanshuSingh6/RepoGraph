-- SQLModel table classes (`class X(SQLModel, table=True)`) are entities too: the ER view
-- shows them and the APIs view links detected queries to them.
alter table parsed_entities drop constraint parsed_entities_orm_check;
alter table parsed_entities add constraint parsed_entities_orm_check
  check (orm in ('jpa', 'typeorm', 'django', 'sqlalchemy', 'sqlmodel'));
