-- Enable RLS
alter table users enable row level security;
alter table accounts enable row level security;
alter table cards enable row level security;
alter table categories enable row level security;
alter table tags enable row level security;
alter table transactions enable row level security;
alter table recurring_expenses enable row level security;

-- USERS
create policy "users_select_own" on users
  for select using (id::text = auth.uid()::text);

create policy "users_insert_own" on users
  for insert with check (id::text = auth.uid()::text);

create policy "users_update_own" on users
  for update using (id::text = auth.uid()::text)
  with check (id::text = auth.uid()::text);

-- ACCOUNTS
create policy "accounts_select_own" on accounts
  for select using (user_id::text = auth.uid()::text);

create policy "accounts_insert_own" on accounts
  for insert with check (user_id::text = auth.uid()::text);

create policy "accounts_update_own" on accounts
  for update using (user_id::text = auth.uid()::text)
  with check (user_id::text = auth.uid()::text);

create policy "accounts_delete_own" on accounts
  for delete using (user_id::text = auth.uid()::text);

-- CARDS
create policy "cards_select_own" on cards
  for select using (user_id::text = auth.uid()::text);

create policy "cards_insert_own" on cards
  for insert with check (user_id::text = auth.uid()::text);

create policy "cards_update_own" on cards
  for update using (user_id::text = auth.uid()::text)
  with check (user_id::text = auth.uid()::text);

create policy "cards_delete_own" on cards
  for delete using (user_id::text = auth.uid()::text);

-- CATEGORIES
create policy "categories_select_own" on categories
  for select using (user_id::text = auth.uid()::text);

create policy "categories_insert_own" on categories
  for insert with check (user_id::text = auth.uid()::text);

create policy "categories_update_own" on categories
  for update using (user_id::text = auth.uid()::text)
  with check (user_id::text = auth.uid()::text);

create policy "categories_delete_own" on categories
  for delete using (user_id::text = auth.uid()::text);

-- TAGS
create policy "tags_select_own" on tags
  for select using (user_id::text = auth.uid()::text);

create policy "tags_insert_own" on tags
  for insert with check (user_id::text = auth.uid()::text);

create policy "tags_update_own" on tags
  for update using (user_id::text = auth.uid()::text)
  with check (user_id::text = auth.uid()::text);

create policy "tags_delete_own" on tags
  for delete using (user_id::text = auth.uid()::text);

-- TRANSACTIONS
create policy "transactions_select_own" on transactions
  for select using (user_id::text = auth.uid()::text);

create policy "transactions_insert_own" on transactions
  for insert with check (user_id::text = auth.uid()::text);

create policy "transactions_update_own" on transactions
  for update using (user_id::text = auth.uid()::text)
  with check (user_id::text = auth.uid()::text);

create policy "transactions_delete_own" on transactions
  for delete using (user_id::text = auth.uid()::text);

-- RECURRING EXPENSES
create policy "recurring_select_own" on recurring_expenses
  for select using (user_id::text = auth.uid()::text);

create policy "recurring_insert_own" on recurring_expenses
  for insert with check (user_id::text = auth.uid()::text);

create policy "recurring_update_own" on recurring_expenses
  for update using (user_id::text = auth.uid()::text)
  with check (user_id::text = auth.uid()::text);

create policy "recurring_delete_own" on recurring_expenses
  for delete using (user_id::text = auth.uid()::text);
