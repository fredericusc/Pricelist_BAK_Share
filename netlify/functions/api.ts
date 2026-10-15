import type { Config } from "@netlify/functions";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { items, historyLogs } from "../../db/schema.js";

type ItemInput = {
  itemCode: string;
  itemName?: string;
  customerCode?: string;
  customerName?: string;
  moqPrices?: Record<string, number>;
};

type LogInput = {
  timestamp?: string;
  itemCode: string;
  itemName?: string;
  customerCode?: string;
  customerName?: string;
  moq: string;
  oldPrice?: number;
  newPrice?: number;
  diff?: number;
};

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

const cleanPrices = (prices: Record<string, unknown> = {}) => {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(prices)) out[k] = Number(v) || 0;
  return out;
};

const toItemRow = (i: ItemInput) => ({
  itemCode: String(i.itemCode).trim(),
  itemName: String(i.itemName ?? ""),
  customerCode: String(i.customerCode ?? ""),
  customerName: String(i.customerName ?? ""),
  moqPrices: cleanPrices(i.moqPrices),
});

// Logs saved earlier in the browser use the id-ID locale string ("15/10/2026, 10.30.00").
const parseLocalTimestamp = (s?: string) => {
  if (!s) return new Date();
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2})[.:](\d{2})(?:[.:](\d{2}))?/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] ?? 0));
  const d = new Date(s);
  return isNaN(d.getTime()) ? new Date() : d;
};

const toLogRow = (l: LogInput) => ({
  createdAt: parseLocalTimestamp(l.timestamp),
  itemCode: String(l.itemCode),
  itemName: String(l.itemName ?? ""),
  customerCode: String(l.customerCode ?? ""),
  customerName: String(l.customerName ?? ""),
  moq: String(l.moq),
  oldPrice: Number(l.oldPrice) || 0,
  newPrice: Number(l.newPrice) || 0,
  diff: Number(l.diff) || 0,
});

async function getData() {
  const [itemRows, logRows] = await Promise.all([
    db.select().from(items).orderBy(desc(items.createdAt), items.itemCode),
    db.select().from(historyLogs).orderBy(desc(historyLogs.createdAt), desc(historyLogs.id)),
  ]);
  return {
    items: itemRows.map(({ itemCode, itemName, customerCode, customerName, moqPrices }) => ({
      itemCode, itemName, customerCode, customerName, moqPrices,
    })),
    historyLogs: logRows.map((l) => ({
      id: l.id,
      createdAt: l.createdAt,
      itemCode: l.itemCode,
      itemName: l.itemName,
      customerCode: l.customerCode,
      customerName: l.customerName,
      moq: l.moq,
      oldPrice: l.oldPrice,
      newPrice: l.newPrice,
      diff: l.diff,
    })),
  };
}

export default async (req: Request) => {
  const route = new URL(req.url).pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");

  try {
    if (req.method === "GET" && route === "data") {
      return json(await getData());
    }

    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const body = await req.json().catch(() => ({}));

    // Update a single MOQ price and record the change in the history log.
    if (route === "price") {
      const itemCode = String(body.itemCode ?? "");
      const moq = String(body.moq ?? "");
      const newPrice = Number(body.newPrice);
      if (!itemCode || !moq || !Number.isFinite(newPrice)) {
        return json({ error: "Data tidak lengkap" }, 400);
      }

      const result = await db.transaction(async (tx) => {
        const [item] = await tx.select().from(items).where(eq(items.itemCode, itemCode)).for("update");
        if (!item) return null;
        const oldPrice = Number(item.moqPrices?.[moq]) || 0;
        await tx
          .update(items)
          .set({ moqPrices: { ...item.moqPrices, [moq]: newPrice }, updatedAt: new Date() })
          .where(eq(items.itemCode, itemCode));
        await tx.insert(historyLogs).values({
          itemCode: item.itemCode,
          itemName: item.itemName,
          customerCode: item.customerCode,
          customerName: item.customerName,
          moq,
          oldPrice,
          newPrice,
          diff: newPrice - oldPrice,
        });
        return true;
      });
      if (!result) return json({ error: "Item tidak ditemukan" }, 404);
      return json(await getData());
    }

    // Add a new item.
    if (route === "items") {
      const row = toItemRow(body);
      if (!row.itemCode) return json({ error: "Item code wajib diisi" }, 400);
      const inserted = await db.insert(items).values(row).onConflictDoNothing().returning();
      if (inserted.length === 0) return json({ error: `Item code ${row.itemCode} sudah ada` }, 409);
      await db.insert(historyLogs).values({
        itemCode: row.itemCode,
        itemName: row.itemName,
        customerCode: row.customerCode,
        customerName: row.customerName,
        moq: "ALL (NEW)",
      });
      return json(await getData(), 201);
    }

    // Replace the whole master list (Excel import / reset). Optionally append history logs.
    if (route === "import") {
      const rows: ReturnType<typeof toItemRow>[] = [];
      const seen = new Set<string>();
      for (const i of (Array.isArray(body.items) ? body.items : []) as ItemInput[]) {
        const row = toItemRow(i);
        if (row.itemCode && !seen.has(row.itemCode)) {
          seen.add(row.itemCode);
          rows.push(row);
        }
      }
      const logs = (Array.isArray(body.historyLogs) ? body.historyLogs : []) as LogInput[];
      // Only seed when the database is still empty (used for the first-time migration from the browser).
      const onlyIfEmpty = body.onlyIfEmpty === true;

      await db.transaction(async (tx) => {
        if (onlyIfEmpty) {
          const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(items);
          if (count > 0) return;
        }
        if (body.clearHistory === true) await tx.delete(historyLogs);
        await tx.delete(items);
        // Keep rows in their original order: first row gets the newest createdAt.
        const base = Date.now();
        for (let i = 0; i < rows.length; i += 500) {
          await tx.insert(items).values(
            rows.slice(i, i + 500).map((r, j) => ({ ...r, createdAt: new Date(base - (i + j)) })),
          );
        }
        for (let i = 0; i < logs.length; i += 500) {
          await tx.insert(historyLogs).values(logs.slice(i, i + 500).map(toLogRow));
        }
      });
      return json(await getData());
    }

    return json({ error: "Not found" }, 404);
  } catch (err) {
    console.error(err);
    return json({ error: "Terjadi kesalahan pada server" }, 500);
  }
};

export const config: Config = {
  path: "/api/*",
};
