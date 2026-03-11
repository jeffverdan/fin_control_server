export type AccountType =
  | "checking"
  | "wallet"
  | "savings"
  | "credit_card"
  | "investment"
  | "cash"
  | "other";
export type TransactionType = "income" | "expense" | "transfer";
export type TransactionStatus = "pending" | "posted" | "voided";
export type RecurrenceType = string;

export interface User {
  id: string;
  email: string;
  name: string;
  created_at: string;
}

export interface Account {
  id: string;
  user_id: string;
  name: string;
  account_type: AccountType;
  initial_balance: number;
  current_balance: number;
  color?: string | null;
  created_at: string;
  updated_at?: string | null;
  deleted_at?: string | null;
}

export interface CreditCard {
  id: string;
  user_id: string;
  name: string;
  brand: string;
  credit_limit: number;
  closing_day: number;
  due_day: number;
  used_limit: number;
  available_limit: number;
  account_id?: string | null;
  color?: string | null;
  created_at: string;
  updated_at?: string | null;
  deleted_at?: string | null;
}

export interface Category {
  id: string;
  user_id: string;
  name: string;
  icon?: string | null;
  color?: string | null;
  is_default: boolean;
  created_at: string;
  updated_at?: string | null;
  deleted_at?: string | null;
}

export interface Tag {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
}

export interface Transaction {
  id: string;
  user_id: string;
  amount: number;
  description: string;
  transaction_type: TransactionType;
  date: string;
  category_id?: string | null;
  account_id?: string | null;
  card_id?: string | null;
  current_installment?: number | null;
  parent_transaction_id?: string | null;
  installment_group_id?: string | null;
  installment_number?: number | null;
  installment_total?: number | null;
  status?: TransactionStatus | null;
  created_at: string;
  updated_at?: string | null;
  deleted_at?: string | null;
}

export interface RecurringExpense {
  id: string;
  user_id: string;
  amount: number;
  description: string;
  recurrence_type: RecurrenceType;
  category_id?: string | null;
  account_id?: string | null;
  card_id?: string | null;
  tags?: string[] | null;
  start_date: string;
  is_active: boolean;
  interval_value?: number | null;
  interval_unit?: string | null;
  next_execution?: string | null;
  created_at: string;
  updated_at?: string | null;
}
