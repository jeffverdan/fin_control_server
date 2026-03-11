# Documentação do Banco de Dados — FinControl

## Visão Geral

O banco de dados do FinControl é responsável por gerenciar informações financeiras pessoais dos usuários, incluindo:

- Contas financeiras
- Cartões de crédito
- Transações
- Categorias
- Tags
- Despesas recorrentes

O banco utiliza **PostgreSQL (Supabase)** e possui:

- Row Level Security (RLS) para isolamento entre usuários
- soft delete
- validações de integridade
- índices otimizados para consultas financeiras
- triggers automáticos para atualização de timestamps

---

# Arquitetura Geral

Relacionamento simplificado:

users
 ├── accounts
 │     └── transactions
 │
 ├── cards
 │     └── transactions
 │
 ├── categories
 │     └── transactions
 │
 ├── tags
 │     └── transaction_tags
 │            └── transactions
 │
 └── recurring_expenses

---

# Tipos ENUM

## account_type

Tipos de contas suportados:

- checking
- wallet
- savings
- credit_card
- investment
- cash
- other

Usado na `accounts`.

---

## txn_direction

Define a direção da transação.

- expense
- income
- transfer

---

## txn_status

Status da transação.

- pending
- posted
- voided

---

# Tables

---

# users

Representa usuários da aplicação.

| Campo | Tipo | Descrição |
|------|------|-------------|
| id | uuid | Identificador do usuário |
| email | text | Email único |
| name | text | Nome do usuário |
| created_at | timestamptz | Data de criação |

Regras:

- email é único
- RLS garante acesso apenas ao próprio usuário

---

# accounts

Contas financeiras do usuário.

Exemplos:

- Conta corrente
- Carteira
- Conta investimento

| Campo | Tipo | Descrição |
|------|------|-------------|
| id | uuid | Id da conta |
| user_id | uuid | Dono da conta |
| name | text | Nome da conta |
| account_type | enum | Tipo da conta |
| initial_balance | numeric | Saldo inicial |
| current_balance | numeric | Saldo atual |
| color | text | Cor visual |
| created_at | timestamptz | Data criação |
| updated_at | timestamptz | Última atualização |
| deleted_at | timestamptz | Soft delete |

Relacionamentos:

accounts.user_id → users.id

---

# cards

Cartões de crédito do usuário.

| Campo | Tipo | Descrição |
|------|------|-------------|
| id | uuid | Id do cartão |
| user_id | uuid | Dono do cartão |
| name | text | Nome do cartão |
| brand | text | Bandeira |
| credit_limit | numeric | Limite total |
| used_limit | numeric | Limite usado |
| available_limit | numeric | Limite disponível |
| closing_day | int | Dia de fechamento |
| due_day | int | Dia de vencimento |
| account_id | uuid | Conta associada |
| color | text | UI color |

Validações:

- closing_day BETWEEN 1 AND 31
- due_day BETWEEN 1 AND 31
- credit_limit >= 0

---

# categories

Categorias para organização das transações.

Exemplos:

- Alimentação
- Transporte
- Moradia
- Lazer

| Campo | Tipo |
|------|------|
| id | uuid |
| user_id | uuid |
| name | text |
| icon | text |
| color | text |
| is_default | boolean |

Regras:

- (user_id, name) deve ser único;

---

# transactions

Registro financeiro principal do sistema.

Pode representar:

- Gasto
- Receita
- Transferência

| Campo | Tipo |
|------|------|
| id | uuid |
| user_id | uuid |
| amount | numeric |
| description | text |
| transaction_type | enum |
| date | timestamptz |
| category_id | uuid |
| account_id | uuid |
| card_id | uuid |
| status | txn_status |
| deleted_at | timestamptz |

Validações importantes:

- amount must be greater than 0

Pagamento deve ser:

- account_id != NULL XOR card_id != NULL
- uma transação não pode ter conta e cartão ao mesmo tempo

Only **one** of these must exist:

- account_id
- card_id

---

# Parcelamentos

O sistema suporta parcelamentos usando:

- installment_group_id
- installment_number
- installment_total
- parent_transaction_id

Regras:

- installment_total ≥ 1
- installment_number ≥ 1
- installment_number ≤ installment_total

---

# tags

Permite categorizar transações com múltiplas tags.

Exemplos:

- viagem
- trabalho
- lazer

| Campo | Tipo |
|------|------|
| id | uuid |
| user_id | uuid |
| name | text |

Regra:

(user_id, name) único.

---

# transaction_tags

Tabela de relação many-to-many entre:

- transactions
- tags

Campos:

- transaction_id
- tag_id

---

# recurring_expenses

Gerencia despesas recorrentes.

Exemplos:

- Netflix
- aluguel
- academia

| Campos | Tipo |
|------|------|
| amount | numeric |
| description | text |
| recurrence_type | text |
| start_date | timestamptz |
| next_execution | timestamptz |
| interval_value | int |
| interval_unit | text |

---

# Segurança (Row Level Security)

Todas as tabelas possuem **RLS habilitado**.

Exemplo de policy:

- user_id = auth.uid()

Isso garante que:

- usuários só veem seus próprios dados
- dados são isolados por usuário

---

# Soft Delete

Algumas tabelas possuem:

deleted_at timestamptz

Isso permite:

- restaurar registros
- manter histórico

---

# Triggers

Trigger automática:

- set_updated_at()

Aplicada em:

- accounts
- cards
- categories
- recurring_expenses
- transactions

Função:

- updated_at = now() on update.

em qualquer update.

---

# Índices

O banco possui diversos índices para performance.

Principais:

- idx_transactions_user_date
- idx_transactions_user_account_date
- idx_transactions_user_card_date
- idx_transactions_user_category

Esses índices otimizam consultas comuns como:

- histórico de transações
- dashboard financeiro
- filtros por categoria
- filtros por cartão

---

# Recursos Suportados

O banco suporta nativamente:

### Contas múltiplas

- conta corrente
- carteira
- investimentos

### Cartões de crédito

- limite total
- limite usado
- limite disponível

### Transações financeiras

- receitas
- despesas
- transferências

### Parcelamentos

- controle de parcelas
- agrupamento de parcelas

### Tags

- classificação múltipla de transações

### Categorias

- organização financeira

### Despesas recorrentes

- assinaturas
- pagamentos periódicos

---

# Segurança

O sistema utiliza:

- Supabase Auth
- Row Level Security
- auth.uid()

Isso garante:

- isolamento completo entre usuários
- segurança no acesso aos dados

---

# Escalabilidade

O schema foi projetado para suportar:

- milhões de transações
- consultas rápidas por usuário
- dashboards financeiros complexos

# Possíveis Extensões Futuras

O banco permite adicionar facilmente:

- metas financeiras
- orçamento mensal
- contas compartilhadas
- relatórios analíticos
- projeções financeiras