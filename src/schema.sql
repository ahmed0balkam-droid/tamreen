-- ⚽ تمرين السبت — قاعدة البيانات
-- كل جدول فيه seq: رقم ترتيب ثابت للصف (مثل رقم السطر في جوجل شيت).
-- الوصول للجداول فقط من خلال الدالة api على الخادم؛ RLS مفعّل بدون أي سياسة = ممنوع من المتصفح مباشرة.

create table if not exists settings (
  seq    bigint not null unique,
  key    text primary key,
  value  text
);

create table if not exists sessions (
  seq        bigint not null unique,
  id         text primary key,
  date       date not null,
  start      text check (start ~ '^\d{2}:\d{2}$'),
  "end"      text check ("end" ~ '^\d{2}:\d{2}$'),
  lock       text check (lock ~ '^\d{2}:\d{2}$'),
  pitch      text,
  map        text,
  fee        numeric check (fee >= 0),
  seed       integer,
  published  smallint default 0,
  created_at bigint
);

create table if not exists players (
  seq        bigint not null unique,
  id         text primary key,
  name       text not null,
  pos        text check (pos in ('GK','DEF','MID','FWD','ANY')),
  created_at bigint
);

create table if not exists registrations (
  seq        bigint not null unique,
  id         text primary key,
  session_id text not null,
  player_id  text not null,
  pos        text,
  created_at bigint,
  status     text check (status in ('active','removed')),
  reason     text,
  removed_at bigint,
  device     text,
  by_admin   smallint
);
create index if not exists registrations_session on registrations (session_id);

create table if not exists bib_draws (
  seq        bigint not null unique,
  id         text primary key,
  session_id text not null,
  n          integer,
  team       text,
  at         bigint
);

create table if not exists matches (
  seq        bigint not null unique,
  session_id text primary key,
  sa         integer check (sa >= 0),
  sb         integer check (sb >= 0),
  saved_at   bigint
);

create table if not exists match_players (
  seq        bigint primary key,
  session_id text not null,
  player_id  text not null,
  team       text check (team in ('A','B')),
  goals      integer default 0,
  assists    integer default 0
);
create index if not exists match_players_session on match_players (session_id);

create table if not exists votes (
  seq        bigint not null unique,
  id         text primary key,
  session_id text not null,
  device     text,
  category   text check (category in ('mvp','def')),
  player_id  text,
  at         bigint
);
create index if not exists votes_session on votes (session_id);

alter table settings      enable row level security;
alter table sessions      enable row level security;
alter table players       enable row level security;
alter table registrations enable row level security;
alter table bib_draws     enable row level security;
alter table matches       enable row level security;
alter table match_players enable row level security;
alter table votes         enable row level security;
