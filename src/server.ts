import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import { z } from "zod";
import { randomUUID } from "crypto";
import { supabaseAnon, supabaseService } from "./db.js";
import { requireAuth, type AuthedRequest } from "./auth.js";
import {
  type Account,
  type CreditCard,
  type Category,
  type Tag,
  type Transaction,
  type RecurringExpense
} from "./types.js";
import { addMonths, startOfMonth, endOfMonth, monthLabel } from "./utils/date.js";

const app = express();
const apiPrefix = "/api";

app.use(express.json());
app.use(
  cors({
    credentials: true,
    origin: (process.env.CORS_ORIGINS || "*").split(",")
  })
);

const DEFAULT_CATEGORIES = [
  { name: "Alimentação", icon: "utensils", color: "#059669" },
  { name: "Moradia", icon: "home", color: "#0EA5E9" },
  { name: "Transporte", icon: "car", color: "#D97706" },
  { name: "Lazer", icon: "gamepad-2", color: "#DC2626" },
  { name: "Saúde", icon: "heart-pulse", color: "#059669" },
  { name: "Educação", icon: "graduation-cap", color: "#0F172A" },
  { name: "Outros", icon: "folder", color: "#64748B" }
];

function parseBody<T>(schema: z.ZodSchema<T>, req: Request, res: Response): T | null {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ detail: "Dados inválidos" });
    return null;
  }
  return result.data;
}

function asIsoString(input: string | Date): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid date");
  }
  return date.toISOString();
}

function normalizeNullableId(value?: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function shapeTransaction<T extends Record<string, unknown>>(transaction: T) {
  const installmentTotal =
    typeof transaction.installment_total === "number" ? transaction.installment_total : null;
  const currentInstallment =
    typeof transaction.current_installment === "number"
      ? transaction.current_installment
      : typeof transaction.installment_number === "number"
        ? transaction.installment_number
        : null;

  return {
    ...transaction,
    installments: installmentTotal,
    current_installment: currentInstallment
  };
}

function validatePaymentSource(accountId?: string | null, cardId?: string | null) {
  const hasAccount = Boolean(accountId);
  const hasCard = Boolean(cardId);
  if (hasAccount === hasCard) {
    return "Informe exatamente uma origem de pagamento: conta ou cartao";
  }
  return null;
}

async function recalculateBalances(
  userId: string,
  accountId?: string | null,
  cardId?: string | null,
  authToken?: string
) {
  const supabase = supabaseAnon(authToken);
  if (accountId) {
    const { data: account, error: accountError } = await supabase
      .from("accounts")
      .select("*")
      .eq("id", accountId)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .maybeSingle();
    if (accountError) throw accountError;
    if (account) {
      const { data: transactions, error: txError } = await supabase
        .from("transactions")
        .select("amount, transaction_type")
        .eq("user_id", userId)
        .eq("account_id", accountId)
        .is("deleted_at", null)
        .neq("status", "voided");
      if (txError) throw txError;
      const balance = (transactions || []).reduce((acc, t) => {
        return t.transaction_type === "income" ? acc + t.amount : acc - t.amount;
      }, account.initial_balance);
      const { error: updateError } = await supabase
        .from("accounts")
        .update({ current_balance: balance })
        .eq("id", accountId);
      if (updateError) throw updateError;
    }
  }

  if (cardId) {
    const { data: card, error: cardError } = await supabase
      .from("cards")
      .select("*")
      .eq("id", cardId)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .maybeSingle();
    if (cardError) throw cardError;
    if (card) {
      const { data: transactions, error: txError } = await supabase
        .from("transactions")
        .select("amount")
        .eq("user_id", userId)
        .eq("card_id", cardId)
        .eq("transaction_type", "expense")
        .is("deleted_at", null)
        .neq("status", "voided");
      if (txError) throw txError;
      const used = (transactions || []).reduce((acc, t) => acc + t.amount, 0);
      const available = card.credit_limit - used;
      const { error: updateError } = await supabase
        .from("cards")
        .update({ used_limit: used, available_limit: available })
        .eq("id", cardId);
      if (updateError) throw updateError;
    }
  }
}

app.get(`${apiPrefix}/health`, (req, res) => {
  res.json({ status: "ok" });
});

// ============= AUTH ENDPOINTS =============
app.post(`${apiPrefix}/auth/register`, async (req, res) => {
  const body = parseBody(
    z.object({
      email: z.string().email(),
      name: z.string().min(1),
      password: z.string().min(1)
    }),
    req,
    res
  );
  if (!body) return;

  const supabase = supabaseAnon();
  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email: body.email,
    password: body.password,
    options: { data: { name: body.name } }
  });
  if (signUpError) return res.status(400).json({ detail: signUpError.message });

  const userId = signUpData.user?.id;
  const session = signUpData.session;
  if (!userId) return res.status(500).json({ detail: "Erro interno" });

  const now = new Date().toISOString();
  const profilePayload = {
    id: userId,
    email: body.email,
    name: body.name,
    created_at: now
  };

  if (session?.access_token) {
    const authed = supabaseAnon(session.access_token);
    const { error: profileError } = await authed.from("users").insert(profilePayload);
    if (profileError) return res.status(500).json({ detail: "Erro interno" });

    const categoriesToInsert = DEFAULT_CATEGORIES.map((cat) => ({
      id: randomUUID(),
      user_id: userId,
      name: cat.name,
      icon: cat.icon,
      color: cat.color,
      is_default: true,
      created_at: now
    }));
    const { error: catError } = await authed.from("categories").insert(categoriesToInsert);
    if (catError) return res.status(500).json({ detail: "Erro interno" });
  } else if (supabaseService) {
    const { error: profileError } = await supabaseService.from("users").insert(profilePayload);
    if (profileError) return res.status(500).json({ detail: "Erro interno" });

    const categoriesToInsert = DEFAULT_CATEGORIES.map((cat) => ({
      id: randomUUID(),
      user_id: userId,
      name: cat.name,
      icon: cat.icon,
      color: cat.color,
      is_default: true,
      created_at: now
    }));
    const { error: catError } = await supabaseService.from("categories").insert(categoriesToInsert);
    if (catError) return res.status(500).json({ detail: "Erro interno" });
  }

  // return res.status(201).json({\n    id: userId,\n    email: body.email,\n    name: body.name,\n    created_at: now\n  });
  return res.status(201).json({ detail: "Usuário registrado com sucesso" });
});
app.post(`${apiPrefix}/auth/login`, async (req, res) => {
  const body = parseBody(
    z.object({
      email: z.string().email(),
      password: z.string().min(1)
    }),
    req,
    res
  );
  if (!body) return;

  const supabase = supabaseAnon();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: body.email,
    password: body.password
  });
  if (error) return res.status(401).json({ detail: "E-mail ou senha incorretos" });

  const accessToken = data.session?.access_token || "";
  if (accessToken) {
    const authed = supabaseAnon(accessToken);
    const { data: profile } = await authed
      .from("users")
      .select("id")
      .eq("id", data.user?.id || "")
      .maybeSingle();

    if (!profile && data.user?.id) {
      const now = new Date().toISOString();
      const profilePayload = {
        id: data.user.id,
        email: data.user.email,
        name: (data.user.user_metadata?.name as string) || "",
        created_at: now
      };
      const { error: profileError } = await authed.from("users").insert(profilePayload);
      if (profileError) return res.status(500).json({ detail: "Erro interno" });

      const categoriesToInsert = DEFAULT_CATEGORIES.map((cat) => ({
        id: randomUUID(),
        user_id: data.user.id,
        name: cat.name,
        icon: cat.icon,
        color: cat.color,
        is_default: true,
        created_at: now
      }));
      const { error: catError } = await authed.from("categories").insert(categoriesToInsert);
      if (catError) return res.status(500).json({ detail: "Erro interno" });
    }
  }

  return res.json({
    access_token: accessToken,
    token_type: "bearer"
  });
});
app.get(`${apiPrefix}/auth/me`, requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const supabase = supabaseAnon(req.authToken);
  const { data: profile, error } = await supabase
    .from("users")
    .select("id, email, name, created_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) return res.status(500).json({ detail: "Erro interno" });
  if (!profile) {
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      return res.status(404).json({ detail: "Usuário não encontrado" });
    }
    return res.json({
      id: authData.user.id,
      email: authData.user.email,
      name: (authData.user.user_metadata?.name as string) || "",
      created_at: authData.user.created_at
    });
  }
  return res.json(profile);
});
// ============= ACCOUNT ENDPOINTS =============
app.post(`${apiPrefix}/accounts`, requireAuth, async (req: AuthedRequest, res) => {
  const body = parseBody(
    z.object({
      name: z.string().min(1),
      account_type: z.enum([
        "checking",
        "wallet",
        "savings",
        "credit_card",
        "investment",
        "cash",
        "other"
      ]),
      initial_balance: z.number(),
      color: z.string().optional()
    }),
    req,
    res
  );
  if (!body) return;

  const now = new Date().toISOString();
  const account: Account = {
    id: randomUUID(),
    user_id: req.userId!,
    name: body.name,
    account_type: body.account_type as Account["account_type"],
    initial_balance: body.initial_balance,
    current_balance: body.initial_balance,
    color: body.color ?? "#059669",
    created_at: now
  };

  const supabase = supabaseAnon(req.authToken);
  const { error } = await supabase.from("accounts").insert(account);
  if (error) return res.status(500).json({ detail: "Erro interno" });
  return res.status(201).json(account);
});

app.get(`${apiPrefix}/accounts`, requireAuth, async (req: AuthedRequest, res) => {
  const supabase = supabaseAnon(req.authToken);
  const { data, error } = await supabase
    .from("accounts")
    .select("*")
    .eq("user_id", req.userId!)
    .is("deleted_at", null);
  if (error) return res.status(500).json({ detail: "Erro interno" });
  return res.json(data || []);
});

app.get(`${apiPrefix}/accounts/:accountId`, requireAuth, async (req: AuthedRequest, res) => {
  const supabase = supabaseAnon(req.authToken);
  const { data, error } = await supabase
    .from("accounts")
    .select("*")
    .eq("id", req.params.accountId)
    .eq("user_id", req.userId!)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) return res.status(500).json({ detail: "Erro interno" });
  if (!data) return res.status(404).json({ detail: "Conta não encontrada" });
  return res.json(data);
});

app.put(`${apiPrefix}/accounts/:accountId`, requireAuth, async (req: AuthedRequest, res) => {
  const body = parseBody(
    z.object({
      name: z.string().min(1).optional(),
      account_type: z
        .enum([
          "checking",
          "wallet",
          "savings",
          "credit_card",
          "investment",
          "cash",
          "other"
        ])
        .optional(),
      color: z.string().optional()
    }),
    req,
    res
  );
  if (!body) return;

  const supabase = supabaseAnon(req.authToken);
  const { data: account, error: accountError } = await supabase
    .from("accounts")
    .select("*")
    .eq("id", req.params.accountId)
    .eq("user_id", req.userId!)
    .is("deleted_at", null)
    .maybeSingle();
  if (accountError) return res.status(500).json({ detail: "Erro interno" });
  if (!account) return res.status(404).json({ detail: "Conta não encontrada" });

  const updateData: Record<string, unknown> = Object.fromEntries(
    Object.entries(body).filter(([, value]) => value !== undefined)
  );
  if (Object.keys(updateData).length > 0) {
    const { error } = await supabase.from("accounts").update(updateData).eq("id", account.id);
    if (error) return res.status(500).json({ detail: "Erro interno" });
    Object.assign(account, updateData);
  }

  return res.json(account);
});

app.delete(`${apiPrefix}/accounts/:accountId`, requireAuth, async (req: AuthedRequest, res) => {
  const supabase = supabaseAnon(req.authToken);
  const deletedAt = new Date().toISOString();
  const { error, count } = await supabase
    .from("accounts")
    .update({ deleted_at: deletedAt }, { count: "exact" })
    .eq("id", req.params.accountId)
    .eq("user_id", req.userId!)
    .is("deleted_at", null);
  if (error) return res.status(500).json({ detail: "Erro interno" });
  if (!count) return res.status(404).json({ detail: "Conta não encontrada" });
  return res.status(204).send();
});

// ============= CREDIT CARD ENDPOINTS =============
app.post(`${apiPrefix}/cards`, requireAuth, async (req: AuthedRequest, res) => {
  const body = parseBody(
    z.object({
      name: z.string().min(1),
      brand: z.string().min(1),
      credit_limit: z.number(),
      closing_day: z.number(),
      due_day: z.number(),
      account_id: z.string().optional(),
      color: z.string().optional()
    }),
    req,
    res
  );
  if (!body) return;

  const now = new Date().toISOString();
  const card: CreditCard = {
    id: randomUUID(),
    user_id: req.userId!,
    name: body.name,
    brand: body.brand,
    credit_limit: body.credit_limit,
    closing_day: body.closing_day,
    due_day: body.due_day,
    used_limit: 0,
    available_limit: body.credit_limit,
    account_id: normalizeNullableId(body.account_id),
    color: body.color ?? "#0F172A",
    created_at: now
  };

  const supabase = supabaseAnon(req.authToken);
  const { error } = await supabase.from("cards").insert(card);
  if (error) return res.status(500).json({ detail: "Erro interno" });
  return res.status(201).json(card);
});

app.get(`${apiPrefix}/cards`, requireAuth, async (req: AuthedRequest, res) => {
  const supabase = supabaseAnon(req.authToken);
  const { data, error } = await supabase
    .from("cards")
    .select("*")
    .eq("user_id", req.userId!)
    .is("deleted_at", null);
  if (error) return res.status(500).json({ detail: "Erro interno" });
  return res.json(data || []);
});

app.get(`${apiPrefix}/cards/:cardId`, requireAuth, async (req: AuthedRequest, res) => {
  const supabase = supabaseAnon(req.authToken);
  const { data, error } = await supabase
    .from("cards")
    .select("*")
    .eq("id", req.params.cardId)
    .eq("user_id", req.userId!)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) return res.status(500).json({ detail: "Erro interno" });
  if (!data) return res.status(404).json({ detail: "Cartão não encontrado" });
  return res.json(data);
});

app.put(`${apiPrefix}/cards/:cardId`, requireAuth, async (req: AuthedRequest, res) => {
  const body = parseBody(
    z.object({
      name: z.string().min(1).optional(),
      brand: z.string().min(1).optional(),
      credit_limit: z.number().optional(),
      closing_day: z.number().optional(),
      due_day: z.number().optional(),
      account_id: z.string().optional(),
      color: z.string().optional()
    }),
    req,
    res
  );
  if (!body) return;

  const supabase = supabaseAnon(req.authToken);
  const { data: card, error: cardError } = await supabase
    .from("cards")
    .select("*")
    .eq("id", req.params.cardId)
    .eq("user_id", req.userId!)
    .is("deleted_at", null)
    .maybeSingle();
  if (cardError) return res.status(500).json({ detail: "Erro interno" });
  if (!card) return res.status(404).json({ detail: "Cartão não encontrado" });

  const updateData: Record<string, unknown> = Object.fromEntries(
    Object.entries(body).filter(([, value]) => value !== undefined)
  );
  if ("account_id" in updateData) {
    updateData.account_id = normalizeNullableId(updateData.account_id as string | null);
  }
  if (Object.keys(updateData).length > 0) {
    const { error } = await supabase.from("cards").update(updateData).eq("id", card.id);
    if (error) return res.status(500).json({ detail: "Erro interno" });
    Object.assign(card, updateData);
  }

  return res.json(card);
});

app.delete(`${apiPrefix}/cards/:cardId`, requireAuth, async (req: AuthedRequest, res) => {
  const supabase = supabaseAnon(req.authToken);
  const deletedAt = new Date().toISOString();
  const { error, count } = await supabase
    .from("cards")
    .update({ deleted_at: deletedAt }, { count: "exact" })
    .eq("id", req.params.cardId)
    .eq("user_id", req.userId!)
    .is("deleted_at", null);
  if (error) return res.status(500).json({ detail: "Erro interno" });
  if (!count) return res.status(404).json({ detail: "Cartão não encontrado" });
  return res.status(204).send();
});

// ============= CATEGORY ENDPOINTS =============
app.post(`${apiPrefix}/categories`, requireAuth, async (req: AuthedRequest, res) => {
  const body = parseBody(
    z.object({
      name: z.string().min(1),
      icon: z.string().optional(),
      color: z.string().optional()
    }),
    req,
    res
  );
  if (!body) return;

  const now = new Date().toISOString();
  const category: Category = {
    id: randomUUID(),
    user_id: req.userId!,
    name: body.name,
    icon: body.icon ?? "folder",
    color: body.color ?? "#059669",
    is_default: false,
    created_at: now
  };

  const supabase = supabaseAnon(req.authToken);
  const { error } = await supabase.from("categories").insert(category);
  if (error) return res.status(500).json({ detail: "Erro interno" });
  return res.status(201).json(category);
});

app.get(`${apiPrefix}/categories`, requireAuth, async (req: AuthedRequest, res) => {
  const supabase = supabaseAnon(req.authToken);
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .eq("user_id", req.userId!)
    .is("deleted_at", null);
  if (error) return res.status(500).json({ detail: "Erro interno" });
  return res.json(data || []);
});

app.put(`${apiPrefix}/categories/:categoryId`, requireAuth, async (req: AuthedRequest, res) => {
  const body = parseBody(
    z.object({
      name: z.string().min(1).optional(),
      icon: z.string().optional(),
      color: z.string().optional()
    }),
    req,
    res
  );
  if (!body) return;

  const supabase = supabaseAnon(req.authToken);
  const { data: category, error: categoryError } = await supabase
    .from("categories")
    .select("*")
    .eq("id", req.params.categoryId)
    .eq("user_id", req.userId!)
    .is("deleted_at", null)
    .maybeSingle();
  if (categoryError) return res.status(500).json({ detail: "Erro interno" });
  if (!category) return res.status(404).json({ detail: "Categoria nÃ£o encontrada" });

  const updateData: Record<string, unknown> = Object.fromEntries(
    Object.entries(body).filter(([, value]) => value !== undefined)
  );
  if (Object.keys(updateData).length > 0) {
    const { error } = await supabase.from("categories").update(updateData).eq("id", category.id);
    if (error) return res.status(500).json({ detail: "Erro interno" });
    Object.assign(category, updateData);
  }

  return res.json(category);
});

app.delete(`${apiPrefix}/categories/:categoryId`, requireAuth, async (req: AuthedRequest, res) => {
  const supabase = supabaseAnon(req.authToken);
  const { data: category, error: categoryError } = await supabase
    .from("categories")
    .select("*")
    .eq("id", req.params.categoryId)
    .eq("user_id", req.userId!)
    .is("deleted_at", null)
    .maybeSingle();
  if (categoryError) return res.status(500).json({ detail: "Erro interno" });
  if (!category) return res.status(404).json({ detail: "Categoria não encontrada" });
  if (category.is_default) {
    return res.status(400).json({ detail: "Não é possível excluir categorias padrão" });
  }

  const deletedAt = new Date().toISOString();
  const { error, count } = await supabase
    .from("categories")
    .update({ deleted_at: deletedAt }, { count: "exact" })
    .eq("id", req.params.categoryId)
    .eq("user_id", req.userId!)
    .is("deleted_at", null);
  if (error) return res.status(500).json({ detail: "Erro interno" });
  if (!count) return res.status(404).json({ detail: "Categoria não encontrada" });
  return res.status(204).send();
});

// ============= TAG ENDPOINTS =============
app.post(`${apiPrefix}/tags`, requireAuth, async (req: AuthedRequest, res) => {
  const body = parseBody(z.object({ name: z.string().min(1) }), req, res);
  if (!body) return;

  const now = new Date().toISOString();
  const tag: Tag = {
    id: randomUUID(),
    user_id: req.userId!,
    name: body.name,
    created_at: now
  };

  const supabase = supabaseAnon(req.authToken);
  const { error } = await supabase.from("tags").insert(tag);
  if (error) return res.status(500).json({ detail: "Erro interno" });
  return res.status(201).json(tag);
});

app.get(`${apiPrefix}/tags`, requireAuth, async (req: AuthedRequest, res) => {
  const supabase = supabaseAnon(req.authToken);
  const { data, error } = await supabase.from("tags").select("*").eq("user_id", req.userId!);
  if (error) return res.status(500).json({ detail: "Erro interno" });
  return res.json(data || []);
});

app.delete(`${apiPrefix}/tags/:tagId`, requireAuth, async (req: AuthedRequest, res) => {
  const supabase = supabaseAnon(req.authToken);
  const { error, count } = await supabase
    .from("tags")
    .delete({ count: "exact" })
    .eq("id", req.params.tagId)
    .eq("user_id", req.userId!);
  if (error) return res.status(500).json({ detail: "Erro interno" });
  if (!count) return res.status(404).json({ detail: "Tag não encontrada" });
  return res.status(204).send();
});

// ============= TRANSACTION ENDPOINTS =============
app.post(`${apiPrefix}/transactions`, requireAuth, async (req: AuthedRequest, res) => {
  const body = parseBody(
    z.object({
      amount: z.number(),
      description: z.string().min(1),
      transaction_type: z.enum(["income", "expense", "transfer"]),
      payment_method: z.string().optional(),
      date: z.union([z.string(), z.date()]),
      category_id: z.string().nullable().optional(),
      account_id: z.string().nullable().optional(),
      card_id: z.string().nullable().optional(),
      status: z.enum(["pending", "posted", "voided"]).optional(),
      tags: z.array(z.string()).optional(),
      installments: z.number().int().min(1).optional(),
      installment_total: z.number().int().min(1).nullable().optional()
    }),
    req,
    res
  );
  if (!body) return;

  const supabase = supabaseAnon(req.authToken);
  const accountId = normalizeNullableId(body.account_id);
  const cardId = normalizeNullableId(body.card_id);
  const categoryId = normalizeNullableId(body.category_id);
  const paymentSourceError = validatePaymentSource(accountId, cardId);
  if (paymentSourceError) return res.status(400).json({ detail: paymentSourceError });

  if (accountId) {
    const { data: account } = await supabase
      .from("accounts")
      .select("id")
      .eq("id", accountId)
      .eq("user_id", req.userId!)
      .is("deleted_at", null)
      .maybeSingle();
    if (!account) return res.status(404).json({ detail: "Conta não encontrada" });
  }
  if (cardId) {
    const { data: card } = await supabase
      .from("cards")
      .select("id")
      .eq("id", cardId)
      .eq("user_id", req.userId!)
      .is("deleted_at", null)
      .maybeSingle();
    if (!card) return res.status(404).json({ detail: "Cartão não encontrado" });
  }
  if (categoryId) {
    const { data: category } = await supabase
      .from("categories")
      .select("id")
      .eq("id", categoryId)
      .eq("user_id", req.userId!)
      .is("deleted_at", null)
      .maybeSingle();
    if (!category) return res.status(404).json({ detail: "Categoria não encontrada" });
  }

  const now = new Date().toISOString();
  const baseDate = new Date(asIsoString(body.date as string | Date));
  const installmentTotal = body.installment_total ?? body.installments ?? 1;
  const status = body.status ?? "posted";
  const installmentGroupId = installmentTotal > 1 ? randomUUID() : null;
  const inserts: Array<Record<string, unknown>> = [];

  for (let i = 0; i < installmentTotal; i += 1) {
    const isInstallment = installmentTotal > 1;
    const transDate = isInstallment ? addMonths(baseDate, i) : new Date(baseDate);
    inserts.push({
      id: randomUUID(),
      user_id: req.userId!,
      amount: isInstallment ? body.amount / installmentTotal : body.amount,
      description: body.description,
      transaction_type: body.transaction_type,
      date: asIsoString(transDate),
      category_id: categoryId,
      account_id: accountId,
      card_id: cardId,
      current_installment: isInstallment ? i + 1 : null,
      installment_group_id: installmentGroupId,
      installment_number: isInstallment ? i + 1 : null,
      installment_total: isInstallment ? installmentTotal : null,
      parent_transaction_id: installmentGroupId,
      status,
      created_at: now
    });
  }

  const { error } = await supabase.from("transactions").insert(inserts);
  if (error) return res.status(500).json({ detail: "Erro interno" });

  if ((body.tags || []).length > 0) {
    const rows = inserts.flatMap((item) =>
      (body.tags || []).map((tagId) => ({
        transaction_id: String(item.id),
        tag_id: tagId
      }))
    );
    const { error: tagsError } = await supabase.from("transaction_tags").insert(rows);
    if (tagsError) return res.status(500).json({ detail: "Erro interno" });
  }

  await recalculateBalances(req.userId!, accountId, cardId, req.authToken);
  return res.status(201).json(shapeTransaction(inserts[0]));
});

app.get(`${apiPrefix}/transactions`, requireAuth, async (req: AuthedRequest, res) => {
  let query = supabaseAnon(req.authToken)
    .from("transactions")
    .select("*")
    .eq("user_id", req.userId!)
    .is("deleted_at", null);

  if (req.query.account_id) query = query.eq("account_id", String(req.query.account_id));
  if (req.query.card_id) query = query.eq("card_id", String(req.query.card_id));
  if (req.query.category_id) query = query.eq("category_id", String(req.query.category_id));
  if (req.query.transaction_type) {
    query = query.eq("transaction_type", String(req.query.transaction_type));
  }
  if (req.query.status) query = query.eq("status", String(req.query.status));
  if (req.query.start_date) query = query.gte("date", String(req.query.start_date));
  if (req.query.end_date) query = query.lte("date", String(req.query.end_date));

  const { data, error } = await query.order("date", { ascending: false });
  if (error) return res.status(500).json({ detail: "Erro interno" });
  return res.json((data || []).map((item) => shapeTransaction(item)));
});

app.get(`${apiPrefix}/transactions/:transactionId`, requireAuth, async (req: AuthedRequest, res) => {
  const supabase = supabaseAnon(req.authToken);
  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .eq("id", req.params.transactionId)
    .eq("user_id", req.userId!)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) return res.status(500).json({ detail: "Erro interno" });
  if (!data) return res.status(404).json({ detail: "Transação não encontrada" });
  return res.json(shapeTransaction(data));
});

app.put(`${apiPrefix}/transactions/:transactionId`, requireAuth, async (req: AuthedRequest, res) => {
  const body = parseBody(
    z.object({
      amount: z.number().optional(),
      description: z.string().optional(),
      transaction_type: z.enum(["income", "expense", "transfer"]).optional(),
      payment_method: z.string().optional(),
      date: z.union([z.string(), z.date()]).optional(),
      category_id: z.string().nullable().optional(),
      account_id: z.string().nullable().optional(),
      card_id: z.string().nullable().optional(),
      status: z.enum(["pending", "posted", "voided"]).optional(),
      tags: z.array(z.string()).optional(),
      installments: z.number().int().min(1).optional(),
      installment_total: z.number().int().min(1).optional()
    }),
    req,
    res
  );
  if (!body) return;

  const supabase = supabaseAnon(req.authToken);
  const { data: transaction, error: txError } = await supabase
    .from("transactions")
    .select("*")
    .eq("id", req.params.transactionId)
    .eq("user_id", req.userId!)
    .is("deleted_at", null)
    .maybeSingle();
  if (txError) return res.status(500).json({ detail: "Erro interno" });
  if (!transaction) return res.status(404).json({ detail: "Transação não encontrada" });

  const oldAccountId = transaction.account_id;
  const oldCardId = transaction.card_id;
  const nextAccountId =
    body.account_id !== undefined ? normalizeNullableId(body.account_id) : transaction.account_id;
  const nextCardId = body.card_id !== undefined ? normalizeNullableId(body.card_id) : transaction.card_id;
  const paymentSourceError = validatePaymentSource(nextAccountId, nextCardId);
  if (paymentSourceError) return res.status(400).json({ detail: paymentSourceError });

  if (nextAccountId) {
    const { data: account } = await supabase
      .from("accounts")
      .select("id")
      .eq("id", nextAccountId)
      .eq("user_id", req.userId!)
      .is("deleted_at", null)
      .maybeSingle();
    if (!account) return res.status(404).json({ detail: "Conta não encontrada" });
  }
  if (nextCardId) {
    const { data: card } = await supabase
      .from("cards")
      .select("id")
      .eq("id", nextCardId)
      .eq("user_id", req.userId!)
      .is("deleted_at", null)
      .maybeSingle();
    if (!card) return res.status(404).json({ detail: "Cartão não encontrado" });
  }
  const nextCategoryId =
    body.category_id !== undefined ? normalizeNullableId(body.category_id) : transaction.category_id;
  if (nextCategoryId) {
    const { data: category } = await supabase
      .from("categories")
      .select("id")
      .eq("id", nextCategoryId)
      .eq("user_id", req.userId!)
      .is("deleted_at", null)
      .maybeSingle();
    if (!category) return res.status(404).json({ detail: "Categoria não encontrada" });
  }

  const updateData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined) continue;
    if (key === "date" && value) {
      updateData.date = asIsoString(value as string | Date);
    } else if (key === "account_id") {
      updateData.account_id = normalizeNullableId(value as string | null);
    } else if (key === "card_id") {
      updateData.card_id = normalizeNullableId(value as string | null);
    } else if (key === "category_id") {
      updateData.category_id = normalizeNullableId(value as string | null);
    } else if (key === "installments") {
      updateData.installment_total = value;
    } else {
      updateData[key] = value;
    }
  }
  if (body.installment_total !== undefined) {
    updateData.installment_total = body.installment_total;
  }
  delete updateData.payment_method;
  delete updateData.installments;
  delete updateData.tags;

  if (Object.keys(updateData).length > 0) {
    const { error } = await supabase
      .from("transactions")
      .update(updateData)
      .eq("id", transaction.id);
    if (error) return res.status(500).json({ detail: "Erro interno" });
    Object.assign(transaction, updateData);
  }

  if (body.tags) {
    const { error: clearError } = await supabase
      .from("transaction_tags")
      .delete()
      .eq("transaction_id", transaction.id);
    if (clearError) return res.status(500).json({ detail: "Erro interno" });

    if (body.tags.length > 0) {
      const rows = body.tags.map((tagId) => ({ transaction_id: transaction.id, tag_id: tagId }));
      const { error: insertError } = await supabase.from("transaction_tags").insert(rows);
      if (insertError) return res.status(500).json({ detail: "Erro interno" });
    }
  }

  await recalculateBalances(req.userId!, oldAccountId, oldCardId, req.authToken);
  if (nextAccountId && nextAccountId !== oldAccountId) {
    await recalculateBalances(req.userId!, nextAccountId, null, req.authToken);
  }
  if (nextCardId && nextCardId !== oldCardId) {
    await recalculateBalances(req.userId!, null, nextCardId, req.authToken);
  }

  return res.json(shapeTransaction(transaction));
});

app.delete(`${apiPrefix}/transactions/:transactionId`, requireAuth, async (req: AuthedRequest, res) => {
  const supabase = supabaseAnon(req.authToken);
  const { data: transaction, error: txError } = await supabase
    .from("transactions")
    .select("*")
    .eq("id", req.params.transactionId)
    .eq("user_id", req.userId!)
    .is("deleted_at", null)
    .maybeSingle();
  if (txError) return res.status(500).json({ detail: "Erro interno" });
  if (!transaction) return res.status(404).json({ detail: "Transação não encontrada" });

  const deletedAt = new Date().toISOString();
  const installmentGroupId = transaction.installment_group_id || transaction.parent_transaction_id;
  if (installmentGroupId) {
    const { data: groupTransactions, error: groupError } = await supabase
      .from("transactions")
      .select("account_id, card_id")
      .eq("user_id", req.userId!)
      .eq("installment_group_id", installmentGroupId)
      .is("deleted_at", null);
    if (groupError) return res.status(500).json({ detail: "Erro interno" });

    const { error } = await supabase
      .from("transactions")
      .update({ deleted_at: deletedAt, status: "voided" })
      .eq("user_id", req.userId!)
      .eq("installment_group_id", installmentGroupId)
      .is("deleted_at", null);
    if (error) return res.status(500).json({ detail: "Erro interno" });

    const accountIds = Array.from(
      new Set((groupTransactions || []).map((item) => item.account_id).filter(Boolean))
    ) as string[];
    const cardIds = Array.from(
      new Set((groupTransactions || []).map((item) => item.card_id).filter(Boolean))
    ) as string[];
    for (const account of accountIds) {
      await recalculateBalances(req.userId!, account, null, req.authToken);
    }
    for (const card of cardIds) {
      await recalculateBalances(req.userId!, null, card, req.authToken);
    }
    return res.status(204).send();
  }

  const { error } = await supabase
    .from("transactions")
    .update({ deleted_at: deletedAt, status: "voided" })
    .eq("id", transaction.id)
    .eq("user_id", req.userId!)
    .is("deleted_at", null);
  if (error) return res.status(500).json({ detail: "Erro interno" });

  await recalculateBalances(req.userId!, transaction.account_id, transaction.card_id, req.authToken);
  return res.status(204).send();
});

// ============= RECURRING EXPENSE ENDPOINTS =============
app.post(`${apiPrefix}/recurring`, requireAuth, async (req: AuthedRequest, res) => {
  const body = parseBody(
    z.object({
      amount: z.number(),
      description: z.string().min(1),
      recurrence_type: z.string().min(1),
      category_id: z.string().optional(),
      account_id: z.string().optional(),
      card_id: z.string().optional(),
      tags: z.array(z.string()).optional(),
      start_date: z.union([z.string(), z.date()]),
      is_active: z.boolean().optional()
    }),
    req,
    res
  );
  if (!body) return;

  const now = new Date().toISOString();
  const categoryId = normalizeNullableId(body.category_id);
  const accountId = normalizeNullableId(body.account_id);
  const cardId = normalizeNullableId(body.card_id);
  const recurring: RecurringExpense = {
    id: randomUUID(),
    user_id: req.userId!,
    amount: body.amount,
    description: body.description,
    recurrence_type: body.recurrence_type as RecurringExpense["recurrence_type"],
    category_id: categoryId,
    account_id: accountId,
    card_id: cardId,
    tags: body.tags ?? [],
    start_date: asIsoString(body.start_date as string | Date),
    is_active: body.is_active ?? true,
    created_at: now
  };

  const supabase = supabaseAnon(req.authToken);
  const { error } = await supabase.from("recurring_expenses").insert(recurring);
  if (error) return res.status(500).json({ detail: "Erro interno" });
  return res.status(201).json(recurring);
});

app.get(`${apiPrefix}/recurring`, requireAuth, async (req: AuthedRequest, res) => {
  const supabase = supabaseAnon(req.authToken);
  const { data, error } = await supabase
    .from("recurring_expenses")
    .select("*")
    .eq("user_id", req.userId!);
  if (error) return res.status(500).json({ detail: "Erro interno" });
  return res.json(data || []);
});

app.put(`${apiPrefix}/recurring/:recurringId`, requireAuth, async (req: AuthedRequest, res) => {
  const body = parseBody(
    z.object({
      amount: z.number().optional(),
      description: z.string().optional(),
      recurrence_type: z.string().optional(),
      category_id: z.string().optional(),
      account_id: z.string().optional(),
      card_id: z.string().optional(),
      tags: z.array(z.string()).optional(),
      is_active: z.boolean().optional()
    }),
    req,
    res
  );
  if (!body) return;

  const supabase = supabaseAnon(req.authToken);
  const { data: recurring, error: recurringError } = await supabase
    .from("recurring_expenses")
    .select("*")
    .eq("id", req.params.recurringId)
    .eq("user_id", req.userId!)
    .maybeSingle();
  if (recurringError) return res.status(500).json({ detail: "Erro interno" });
  if (!recurring) return res.status(404).json({ detail: "Despesa recorrente não encontrada" });

  const updateData: Record<string, unknown> = Object.fromEntries(
    Object.entries(body).filter(([, value]) => value !== undefined)
  );
  if ("category_id" in updateData) {
    updateData.category_id = normalizeNullableId(updateData.category_id as string | null);
  }
  if ("account_id" in updateData) {
    updateData.account_id = normalizeNullableId(updateData.account_id as string | null);
  }
  if ("card_id" in updateData) {
    updateData.card_id = normalizeNullableId(updateData.card_id as string | null);
  }
  if (Object.keys(updateData).length > 0) {
    const { error } = await supabase
      .from("recurring_expenses")
      .update(updateData)
      .eq("id", recurring.id);
    if (error) return res.status(500).json({ detail: "Erro interno" });
    Object.assign(recurring, updateData);
  }

  return res.json(recurring);
});

app.delete(`${apiPrefix}/recurring/:recurringId`, requireAuth, async (req: AuthedRequest, res) => {
  const supabase = supabaseAnon(req.authToken);
  const { error, count } = await supabase
    .from("recurring_expenses")
    .delete({ count: "exact" })
    .eq("id", req.params.recurringId)
    .eq("user_id", req.userId!);
  if (error) return res.status(500).json({ detail: "Erro interno" });
  if (!count) return res.status(404).json({ detail: "Despesa recorrente não encontrada" });
  return res.status(204).send();
});

// ============= DASHBOARD ENDPOINT =============
app.get(`${apiPrefix}/dashboard`, requireAuth, async (req: AuthedRequest, res) => {
  const now = new Date();
  const start = startOfMonth(now);
  const end = endOfMonth(now);

  const supabase = supabaseAnon(req.authToken);
  const { data: transactions, error: txError } = await supabase
    .from("transactions")
    .select("*")
    .eq("user_id", req.userId!)
    .is("deleted_at", null)
    .neq("status", "voided")
    .gte("date", start.toISOString())
    .lte("date", end.toISOString());
  if (txError) return res.status(500).json({ detail: "Erro interno" });

  const totalIncome = (transactions || []).reduce(
    (acc, t) => (t.transaction_type === "income" ? acc + t.amount : acc),
    0
  );
  const totalExpense = (transactions || []).reduce(
    (acc, t) => (t.transaction_type === "expense" ? acc + t.amount : acc),
    0
  );
  const balance = totalIncome - totalExpense;

  const { data: accounts, error: accError } = await supabase
    .from("accounts")
    .select("*")
    .eq("user_id", req.userId!)
    .is("deleted_at", null);
  if (accError) return res.status(500).json({ detail: "Erro interno" });

  const totalAccountsBalance = (accounts || []).reduce(
    (acc, a) => acc + a.current_balance,
    0
  );

  const { data: cards, error: cardError } = await supabase
    .from("cards")
    .select("*")
    .eq("user_id", req.userId!)
    .is("deleted_at", null);
  if (cardError) return res.status(500).json({ detail: "Erro interno" });

  const { data: categories, error: catError } = await supabase
    .from("categories")
    .select("id, name")
    .eq("user_id", req.userId!)
    .is("deleted_at", null);
  if (catError) return res.status(500).json({ detail: "Erro interno" });

  const categoryDict = new Map((categories || []).map((c) => [c.id, c.name]));
  const expensesByCategory: Record<string, number> = {};
  for (const t of transactions || []) {
    if (t.transaction_type === "expense" && t.category_id) {
      const name = categoryDict.get(t.category_id) || "Outros";
      expensesByCategory[name] = (expensesByCategory[name] || 0) + t.amount;
    }
  }

  const monthlyData: Array<{ month: string; income: number; expense: number; balance: number }> = [];
  for (let i = 5; i >= 0; i -= 1) {
    const monthStart = startOfMonth(addMonths(start, -i));
    const monthEnd = endOfMonth(monthStart);
    const { data: monthTransactions, error } = await supabase
      .from("transactions")
      .select("amount, transaction_type")
      .eq("user_id", req.userId!)
      .is("deleted_at", null)
      .neq("status", "voided")
      .gte("date", monthStart.toISOString())
      .lte("date", monthEnd.toISOString());
    if (error) return res.status(500).json({ detail: "Erro interno" });

    const income = (monthTransactions || []).reduce(
      (acc, t) => (t.transaction_type === "income" ? acc + t.amount : acc),
      0
    );
    const expense = (monthTransactions || []).reduce(
      (acc, t) => (t.transaction_type === "expense" ? acc + t.amount : acc),
      0
    );
    monthlyData.push({
      month: monthLabel(monthStart),
      income,
      expense,
      balance: income - expense
    });
  }

  return res.json({
    summary: {
      total_income: totalIncome,
      total_expense: totalExpense,
      balance,
      total_accounts_balance: totalAccountsBalance
    },
    accounts: accounts || [],
    cards: cards || [],
    expenses_by_category: expensesByCategory,
    monthly_evolution: monthlyData,
    recent_transactions: (transactions || []).slice(0, 10)
  });
});

if (!process.env.VERCEL) {
  const port = Number(process.env.PORT || "3001");
  app.listen(port, () => {
    console.log(`FinControl API listening on port ${port}`);
    console.log(`API Prefix: ${apiPrefix}`);
    console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
    console.log(`URL: http://localhost:${port}${apiPrefix}/health`);
  });
}

export default app;






