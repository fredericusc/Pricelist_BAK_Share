import { pgTable, serial, text, timestamp, jsonb, doublePrecision } from "drizzle-orm/pg-core";

export const items = pgTable("items", {
  itemCode: text("item_code").primaryKey(),
  itemName: text("item_name").notNull().default(""),
  customerCode: text("customer_code").notNull().default(""),
  customerName: text("customer_name").notNull().default(""),
  moqPrices: jsonb("moq_prices").$type<Record<string, number>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const historyLogs = pgTable("history_logs", {
  id: serial().primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  itemCode: text("item_code").notNull(),
  itemName: text("item_name").notNull().default(""),
  customerCode: text("customer_code").notNull().default(""),
  customerName: text("customer_name").notNull().default(""),
  moq: text().notNull(),
  oldPrice: doublePrecision("old_price").notNull().default(0),
  newPrice: doublePrecision("new_price").notNull().default(0),
  diff: doublePrecision().notNull().default(0),
});
