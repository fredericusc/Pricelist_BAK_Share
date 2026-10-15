CREATE TABLE "history_logs" (
	"id" serial PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"item_code" text NOT NULL,
	"item_name" text DEFAULT '' NOT NULL,
	"customer_code" text DEFAULT '' NOT NULL,
	"customer_name" text DEFAULT '' NOT NULL,
	"moq" text NOT NULL,
	"old_price" double precision DEFAULT 0 NOT NULL,
	"new_price" double precision DEFAULT 0 NOT NULL,
	"diff" double precision DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"item_code" text PRIMARY KEY,
	"item_name" text DEFAULT '' NOT NULL,
	"customer_code" text DEFAULT '' NOT NULL,
	"customer_name" text DEFAULT '' NOT NULL,
	"moq_prices" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
