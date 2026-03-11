


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."account_type" AS ENUM (
    'checking',
    'wallet',
    'savings',
    'credit_card',
    'investment',
    'cash',
    'other'
);


ALTER TYPE "public"."account_type" OWNER TO "postgres";


CREATE TYPE "public"."member_role" AS ENUM (
    'owner',
    'admin',
    'member',
    'viewer'
);


ALTER TYPE "public"."member_role" OWNER TO "postgres";


CREATE TYPE "public"."txn_direction" AS ENUM (
    'expense',
    'income',
    'transfer'
);


ALTER TYPE "public"."txn_direction" OWNER TO "postgres";


CREATE TYPE "public"."txn_status" AS ENUM (
    'pending',
    'posted',
    'voided'
);


ALTER TYPE "public"."txn_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_workspace_admin"("p_workspace_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = auth.uid()
      and wm.role in ('owner','admin')
  );
$$;


ALTER FUNCTION "public"."is_workspace_admin"("p_workspace_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_workspace_member"("p_workspace_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."is_workspace_member"("p_workspace_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."path_workspace_id"("obj_name" "text") RETURNS "uuid"
    LANGUAGE "sql" STABLE
    AS $$
  select nullif(split_part(obj_name, '/', 1), '')::uuid;
$$;


ALTER FUNCTION "public"."path_workspace_id"("obj_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."uid"() RETURNS "uuid"
    LANGUAGE "sql" STABLE
    AS $$
  select auth.uid();
$$;


ALTER FUNCTION "public"."uid"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "account_type" "public"."account_type" NOT NULL,
    "initial_balance" numeric NOT NULL,
    "current_balance" numeric NOT NULL,
    "color" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."accounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cards" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "brand" "text" NOT NULL,
    "credit_limit" numeric NOT NULL,
    "closing_day" integer NOT NULL,
    "due_day" integer NOT NULL,
    "used_limit" numeric NOT NULL,
    "available_limit" numeric NOT NULL,
    "color" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "account_id" "uuid",
    "updated_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "chk_cards_closing_day" CHECK ((("closing_day" >= 1) AND ("closing_day" <= 31))),
    CONSTRAINT "chk_cards_due_day" CHECK ((("due_day" >= 1) AND ("due_day" <= 31))),
    CONSTRAINT "chk_cards_limit" CHECK (("credit_limit" >= (0)::numeric))
);


ALTER TABLE "public"."cards" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "icon" "text",
    "color" "text",
    "is_default" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."recurring_expenses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "amount" numeric NOT NULL,
    "description" "text" NOT NULL,
    "recurrence_type" "text" NOT NULL,
    "category_id" "uuid",
    "account_id" "uuid",
    "card_id" "uuid",
    "tags" "text"[],
    "start_date" timestamp with time zone NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "interval_value" integer,
    "interval_unit" "text",
    "next_execution" timestamp with time zone,
    "updated_at" timestamp with time zone,
    CONSTRAINT "chk_recurring_amount" CHECK (("amount" > (0)::numeric))
);


ALTER TABLE "public"."recurring_expenses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tags" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."tags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transaction_tags" (
    "transaction_id" "uuid" NOT NULL,
    "tag_id" "uuid" NOT NULL
);


ALTER TABLE "public"."transaction_tags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "amount" numeric NOT NULL,
    "description" "text" NOT NULL,
    "transaction_type" "public"."txn_direction" NOT NULL,
    "date" timestamp with time zone NOT NULL,
    "category_id" "uuid",
    "account_id" "uuid",
    "card_id" "uuid",
    "current_installment" integer,
    "parent_transaction_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "installment_group_id" "uuid",
    "installment_number" integer,
    "installment_total" integer,
    "updated_at" timestamp with time zone,
    "status" "public"."txn_status" DEFAULT 'posted'::"public"."txn_status",
    "deleted_at" timestamp with time zone,
    CONSTRAINT "chk_installment_total_valid" CHECK ((("installment_total" IS NULL) OR ("installment_total" >= 1))),
    CONSTRAINT "chk_transactions_amount" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "installment_valid" CHECK ((("installment_number" IS NULL) OR (("installment_number" >= 1) AND ("installment_total" >= "installment_number")))),
    CONSTRAINT "transaction_payment_check" CHECK (((("account_id" IS NOT NULL) AND ("card_id" IS NULL)) OR (("account_id" IS NULL) AND ("card_id" IS NOT NULL))))
);


ALTER TABLE "public"."transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."users" OWNER TO "postgres";


ALTER TABLE ONLY "public"."accounts"
    ADD CONSTRAINT "accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cards"
    ADD CONSTRAINT "cards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."recurring_expenses"
    ADD CONSTRAINT "recurring_expenses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tags"
    ADD CONSTRAINT "tags_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transaction_tags"
    ADD CONSTRAINT "transaction_tags_pkey" PRIMARY KEY ("transaction_id", "tag_id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_accounts_not_deleted" ON "public"."accounts" USING "btree" ("user_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_accounts_user" ON "public"."accounts" USING "btree" ("user_id");



CREATE INDEX "idx_cards_account" ON "public"."cards" USING "btree" ("account_id");



CREATE INDEX "idx_cards_not_deleted" ON "public"."cards" USING "btree" ("user_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_cards_user" ON "public"."cards" USING "btree" ("user_id");



CREATE INDEX "idx_categories_user" ON "public"."categories" USING "btree" ("user_id");



CREATE INDEX "idx_recurring_user" ON "public"."recurring_expenses" USING "btree" ("user_id");



CREATE INDEX "idx_tags_user" ON "public"."tags" USING "btree" ("user_id");



CREATE INDEX "idx_transaction_tags_composite" ON "public"."transaction_tags" USING "btree" ("transaction_id", "tag_id");



CREATE INDEX "idx_transaction_tags_tag" ON "public"."transaction_tags" USING "btree" ("tag_id");



CREATE INDEX "idx_transaction_tags_tx" ON "public"."transaction_tags" USING "btree" ("transaction_id");



CREATE INDEX "idx_transactions_account" ON "public"."transactions" USING "btree" ("account_id");



CREATE INDEX "idx_transactions_card" ON "public"."transactions" USING "btree" ("card_id");



CREATE INDEX "idx_transactions_category" ON "public"."transactions" USING "btree" ("category_id");



CREATE INDEX "idx_transactions_date" ON "public"."transactions" USING "btree" ("date");



CREATE INDEX "idx_transactions_group" ON "public"."transactions" USING "btree" ("installment_group_id");



CREATE INDEX "idx_transactions_installments" ON "public"."transactions" USING "btree" ("installment_group_id");



CREATE INDEX "idx_transactions_not_deleted" ON "public"."transactions" USING "btree" ("user_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_transactions_parent" ON "public"."transactions" USING "btree" ("parent_transaction_id");



CREATE INDEX "idx_transactions_status" ON "public"."transactions" USING "btree" ("status");



CREATE INDEX "idx_transactions_user" ON "public"."transactions" USING "btree" ("user_id");



CREATE INDEX "idx_transactions_user_account" ON "public"."transactions" USING "btree" ("user_id", "account_id");



CREATE INDEX "idx_transactions_user_account_date" ON "public"."transactions" USING "btree" ("user_id", "account_id", "date" DESC);



CREATE INDEX "idx_transactions_user_card" ON "public"."transactions" USING "btree" ("user_id", "card_id");



CREATE INDEX "idx_transactions_user_card_date" ON "public"."transactions" USING "btree" ("user_id", "card_id", "date" DESC);



CREATE INDEX "idx_transactions_user_category" ON "public"."transactions" USING "btree" ("user_id", "category_id");



CREATE INDEX "idx_transactions_user_date" ON "public"."transactions" USING "btree" ("user_id", "date" DESC);



CREATE INDEX "idx_transactions_user_status" ON "public"."transactions" USING "btree" ("user_id", "status");



CREATE UNIQUE INDEX "uniq_category_user_name" ON "public"."categories" USING "btree" ("user_id", "name");



CREATE UNIQUE INDEX "uniq_tag_user_name" ON "public"."tags" USING "btree" ("user_id", "name");



CREATE OR REPLACE TRIGGER "trg_accounts_updated" BEFORE UPDATE ON "public"."accounts" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_cards_updated" BEFORE UPDATE ON "public"."cards" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_categories_updated" BEFORE UPDATE ON "public"."categories" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_recurring_updated" BEFORE UPDATE ON "public"."recurring_expenses" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_transactions_updated" BEFORE UPDATE ON "public"."transactions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."accounts"
    ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cards"
    ADD CONSTRAINT "cards_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id");



ALTER TABLE ONLY "public"."cards"
    ADD CONSTRAINT "cards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recurring_expenses"
    ADD CONSTRAINT "recurring_expenses_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id");



ALTER TABLE ONLY "public"."recurring_expenses"
    ADD CONSTRAINT "recurring_expenses_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id");



ALTER TABLE ONLY "public"."recurring_expenses"
    ADD CONSTRAINT "recurring_expenses_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id");



ALTER TABLE ONLY "public"."recurring_expenses"
    ADD CONSTRAINT "recurring_expenses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tags"
    ADD CONSTRAINT "tags_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transaction_tags"
    ADD CONSTRAINT "transaction_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transaction_tags"
    ADD CONSTRAINT "transaction_tags_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE "public"."accounts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "accounts_delete_own" ON "public"."accounts" FOR DELETE USING ((("user_id")::"text" = ("auth"."uid"())::"text"));



CREATE POLICY "accounts_insert_own" ON "public"."accounts" FOR INSERT WITH CHECK ((("user_id")::"text" = ("auth"."uid"())::"text"));



CREATE POLICY "accounts_select_own" ON "public"."accounts" FOR SELECT USING ((("user_id")::"text" = ("auth"."uid"())::"text"));



CREATE POLICY "accounts_update_own" ON "public"."accounts" FOR UPDATE USING ((("user_id")::"text" = ("auth"."uid"())::"text")) WITH CHECK ((("user_id")::"text" = ("auth"."uid"())::"text"));



ALTER TABLE "public"."cards" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cards_delete_own" ON "public"."cards" FOR DELETE USING ((("user_id")::"text" = ("auth"."uid"())::"text"));



CREATE POLICY "cards_insert_own" ON "public"."cards" FOR INSERT WITH CHECK ((("user_id")::"text" = ("auth"."uid"())::"text"));



CREATE POLICY "cards_select_own" ON "public"."cards" FOR SELECT USING ((("user_id")::"text" = ("auth"."uid"())::"text"));



CREATE POLICY "cards_update_own" ON "public"."cards" FOR UPDATE USING ((("user_id")::"text" = ("auth"."uid"())::"text")) WITH CHECK ((("user_id")::"text" = ("auth"."uid"())::"text"));



ALTER TABLE "public"."categories" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "categories_delete_own" ON "public"."categories" FOR DELETE USING ((("user_id")::"text" = ("auth"."uid"())::"text"));



CREATE POLICY "categories_insert_own" ON "public"."categories" FOR INSERT WITH CHECK ((("user_id")::"text" = ("auth"."uid"())::"text"));



CREATE POLICY "categories_select_own" ON "public"."categories" FOR SELECT USING ((("user_id")::"text" = ("auth"."uid"())::"text"));



CREATE POLICY "categories_update_own" ON "public"."categories" FOR UPDATE USING ((("user_id")::"text" = ("auth"."uid"())::"text")) WITH CHECK ((("user_id")::"text" = ("auth"."uid"())::"text"));



CREATE POLICY "recurring_delete_own" ON "public"."recurring_expenses" FOR DELETE USING ((("user_id")::"text" = ("auth"."uid"())::"text"));



ALTER TABLE "public"."recurring_expenses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "recurring_insert_own" ON "public"."recurring_expenses" FOR INSERT WITH CHECK ((("user_id")::"text" = ("auth"."uid"())::"text"));



CREATE POLICY "recurring_select_own" ON "public"."recurring_expenses" FOR SELECT USING ((("user_id")::"text" = ("auth"."uid"())::"text"));



CREATE POLICY "recurring_update_own" ON "public"."recurring_expenses" FOR UPDATE USING ((("user_id")::"text" = ("auth"."uid"())::"text")) WITH CHECK ((("user_id")::"text" = ("auth"."uid"())::"text"));



ALTER TABLE "public"."tags" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tags_delete_own" ON "public"."tags" FOR DELETE USING ((("user_id")::"text" = ("auth"."uid"())::"text"));



CREATE POLICY "tags_insert_own" ON "public"."tags" FOR INSERT WITH CHECK ((("user_id")::"text" = ("auth"."uid"())::"text"));



CREATE POLICY "tags_select_own" ON "public"."tags" FOR SELECT USING ((("user_id")::"text" = ("auth"."uid"())::"text"));



CREATE POLICY "tags_update_own" ON "public"."tags" FOR UPDATE USING ((("user_id")::"text" = ("auth"."uid"())::"text")) WITH CHECK ((("user_id")::"text" = ("auth"."uid"())::"text"));



ALTER TABLE "public"."transactions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "transactions_delete_own" ON "public"."transactions" FOR DELETE USING ((("user_id")::"text" = ("auth"."uid"())::"text"));



CREATE POLICY "transactions_insert_own" ON "public"."transactions" FOR INSERT WITH CHECK ((("user_id")::"text" = ("auth"."uid"())::"text"));



CREATE POLICY "transactions_select_own" ON "public"."transactions" FOR SELECT USING ((("user_id")::"text" = ("auth"."uid"())::"text"));



CREATE POLICY "transactions_update_own" ON "public"."transactions" FOR UPDATE USING ((("user_id")::"text" = ("auth"."uid"())::"text")) WITH CHECK ((("user_id")::"text" = ("auth"."uid"())::"text"));



ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "users_insert_own" ON "public"."users" FOR INSERT WITH CHECK ((("id")::"text" = ("auth"."uid"())::"text"));



CREATE POLICY "users_select_own" ON "public"."users" FOR SELECT USING ((("id")::"text" = ("auth"."uid"())::"text"));



CREATE POLICY "users_update_own" ON "public"."users" FOR UPDATE USING ((("id")::"text" = ("auth"."uid"())::"text")) WITH CHECK ((("id")::"text" = ("auth"."uid"())::"text"));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."is_workspace_admin"("p_workspace_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_workspace_admin"("p_workspace_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_workspace_admin"("p_workspace_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_workspace_member"("p_workspace_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_workspace_member"("p_workspace_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_workspace_member"("p_workspace_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."path_workspace_id"("obj_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."path_workspace_id"("obj_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."path_workspace_id"("obj_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."uid"() TO "anon";
GRANT ALL ON FUNCTION "public"."uid"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."uid"() TO "service_role";



GRANT ALL ON TABLE "public"."accounts" TO "anon";
GRANT ALL ON TABLE "public"."accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."accounts" TO "service_role";



GRANT ALL ON TABLE "public"."cards" TO "anon";
GRANT ALL ON TABLE "public"."cards" TO "authenticated";
GRANT ALL ON TABLE "public"."cards" TO "service_role";



GRANT ALL ON TABLE "public"."categories" TO "anon";
GRANT ALL ON TABLE "public"."categories" TO "authenticated";
GRANT ALL ON TABLE "public"."categories" TO "service_role";



GRANT ALL ON TABLE "public"."recurring_expenses" TO "anon";
GRANT ALL ON TABLE "public"."recurring_expenses" TO "authenticated";
GRANT ALL ON TABLE "public"."recurring_expenses" TO "service_role";



GRANT ALL ON TABLE "public"."tags" TO "anon";
GRANT ALL ON TABLE "public"."tags" TO "authenticated";
GRANT ALL ON TABLE "public"."tags" TO "service_role";



GRANT ALL ON TABLE "public"."transaction_tags" TO "anon";
GRANT ALL ON TABLE "public"."transaction_tags" TO "authenticated";
GRANT ALL ON TABLE "public"."transaction_tags" TO "service_role";



GRANT ALL ON TABLE "public"."transactions" TO "anon";
GRANT ALL ON TABLE "public"."transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."transactions" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







