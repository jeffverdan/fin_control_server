# FinControl Backend (Node + Express + Supabase)

Este backend mantém os mesmos endpoints do FastAPI original, usando Express + TypeScript e Supabase (Postgres) como banco.
Agora a autenticação é feita via **Supabase Auth** (email/senha).
Os endpoints `/api/auth/register` e `/api/auth/login` continuam existindo e retornam o mesmo formato do backend antigo.

## Configuração

1. Crie um projeto no Supabase e execute o SQL abaixo no SQL Editor.
2. Crie um arquivo `.env` baseado em `.env.example`.
3. Instale dependências e rode o servidor.

### Variáveis de ambiente

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CORS_ORIGINS` (default: `*`)
- `PORT` (default: 3001)

### SQL (schema sugerido)

```sql
create table if not exists users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  name text not null,
  created_at timestamptz not null
);

create table if not exists accounts (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  account_type text not null,
  initial_balance numeric not null,
  current_balance numeric not null,
  color text,
  created_at timestamptz not null
);

create table if not exists cards (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  brand text not null,
  credit_limit numeric not null,
  closing_day int not null,
  due_day int not null,
  used_limit numeric not null,
  available_limit numeric not null,
  color text,
  created_at timestamptz not null
);

create table if not exists categories (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  icon text,
  color text,
  is_default boolean not null default false,
  created_at timestamptz not null
);

create table if not exists tags (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null
);

create table if not exists transactions (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  amount numeric not null,
  description text not null,
  transaction_type text not null,
  payment_method text not null,
  date timestamptz not null,
  category_id uuid references categories(id),
  account_id uuid references accounts(id),
  card_id uuid references cards(id),
  tags text[],
  installments int,
  current_installment int,
  parent_transaction_id uuid,
  created_at timestamptz not null
);

create table if not exists recurring_expenses (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  amount numeric not null,
  description text not null,
  recurrence_type text not null,
  category_id uuid references categories(id),
  account_id uuid references accounts(id),
  card_id uuid references cards(id),
  tags text[],
  start_date timestamptz not null,
  is_active boolean not null default true,
  created_at timestamptz not null
);

create index if not exists idx_accounts_user on accounts(user_id);
create index if not exists idx_cards_user on cards(user_id);
create index if not exists idx_categories_user on categories(user_id);
create index if not exists idx_tags_user on tags(user_id);
create index if not exists idx_transactions_user on transactions(user_id);
create index if not exists idx_transactions_date on transactions(date);
create index if not exists idx_recurring_user on recurring_expenses(user_id);
```

### RLS (Row Level Security)

Para usar a chave pública do Supabase, ative RLS e políticas. O SQL está em:

- `backend/rls_policies.sql`

Notas importantes:

- O Supabase valida JWTs usando o **JWT secret do projeto** (gerenciado pelo próprio Supabase).
- O token precisa carregar a claim `role: "authenticated"` e `sub` com o `user_id` (o Supabase Auth já faz isso).
- Para `auth/register`, se a confirmação de e-mail estiver ativa e não houver sessão, usamos a `SUPABASE_SERVICE_ROLE_KEY` para criar o perfil e categorias padrão.
- Se preferir não usar service role, deixe a confirmação de e-mail desativada ou permita que o perfil seja criado no primeiro login.

## Execução

```bash
npm install
npm run dev
```

## Observações

- O backend usa `SUPABASE_SERVICE_ROLE_KEY` para operar (bypass de RLS). Se quiser ativar RLS, será preciso criar policies equivalentes.
- Os endpoints e contratos seguem o FastAPI original em `/api`.
