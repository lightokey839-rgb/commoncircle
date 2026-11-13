-- CommonCircle chat server schema (server/store-postgres.ts).
-- New schema for CommonCircle; it does not reuse the LoanBook tables in supabase/.
-- Off-chain only: chat text and loan-request reasons are never written on-chain.
-- Access-controlled by the server, NOT end-to-end encrypted: an operator with
-- database access can read every message.

-- One counter row per circle room. Locking it serialises inserts per room, so
-- message numbers (seq) become visible in order and a poller never skips one.
create table if not exists chat_rooms (
  circle_id  text primary key check (circle_id ~ '^[0-9]{1,20}$'),
  last_seq   bigint not null default 0
);

create table if not exists chat_messages (
  circle_id  text   not null check (circle_id ~ '^[0-9]{1,20}$'),
  seq        bigint not null,
  account_id text   not null check (char_length(account_id) between 2 and 64),
  body       text   not null check (char_length(body) between 1 and 4000),
  created_ms bigint not null,
  primary key (circle_id, seq)
);

-- Loan request cards ("ask the circle") and the reasons of direct loans.
create table if not exists loan_requests (
  id          bigserial primary key,
  circle_id   text    not null check (circle_id ~ '^[0-9]{1,20}$'),
  borrower    text    not null,
  amount      text    not null check (amount ~ '^[1-9][0-9]{0,37}$'), -- USDC base units
  days        integer not null check (days between 1 and 3650),
  note        text    not null check (char_length(note) between 1 and 2000),
  created_ms  bigint  not null,
  offers      text[]  not null default '{}',
  lender      text,
  loan_id     text check (loan_id is null or loan_id ~ '^[0-9]{1,20}$'),
  cancelled   boolean not null default false,
  direct      boolean not null default false,
  updated_ms  bigint  not null
);
create index if not exists loan_requests_room on loan_requests (circle_id, id);
-- One card per on-chain loan, even under concurrent links from several servers.
create unique index if not exists loan_requests_one_card_per_loan on loan_requests (circle_id, loan_id) where loan_id is not null;

-- NEP-413 sign-in challenges: one row per nonce, deleted when used (DELETE … RETURNING).
create table if not exists auth_challenges (
  nonce      text primary key,
  account_id text   not null,
  message    text   not null,
  recipient  text   not null,
  expires_ms bigint not null
);
create index if not exists auth_challenges_expiry on auth_challenges (expires_ms);

-- Fixed-window rate-limit counters shared by every server process.
create table if not exists rate_limits (
  key        text   not null,
  window_no  bigint not null,
  hits       integer not null,
  primary key (key, window_no)
);
