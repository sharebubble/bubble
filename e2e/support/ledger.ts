import { createHash } from 'node:crypto';

import type { Browser, BrowserContext } from '@playwright/test';

import type { ApiClient } from './api';
import { contextForRole } from './auth-state';
import type { Role } from './config';

/**
 * Helpers for the community-ledger specs (specs/ledger/).
 *
 * The ledger is append-only: nothing a spec posts can be deleted afterwards.
 * Specs therefore never assert absolute balances; they create uniquely named
 * (namespaced) entries and assert on those, so runs can be repeated and run
 * in parallel against the same database.
 */

export interface LedgerAccountRef {
  id: string;
  name: string;
  type: string;
  owner: string | null;
}

export interface LedgerMe extends LedgerAccountRef {
  balance: string;
  payment_reference: string;
  is_ledger_admin: boolean;
}

export interface LedgerEntry {
  id: string;
  account: LedgerAccountRef;
  amount: string;
  display_amount: string;
}

export interface LedgerTransaction {
  id: string;
  seq: number;
  kind: string;
  description: string;
  amount: string;
  occurred_on: string;
  entries: LedgerEntry[];
  receipt_count: number;
  open_disputes: number;
  reverses: string | null;
  reversed_by: string[];
}

export interface LedgerCategory {
  id: string;
  code: string;
  kind: string;
}

export interface LedgerPeriod {
  id: string;
  starts_on: string;
  ends_on: string;
  export_hash: string;
}

interface Page<T> {
  results: T[];
}

/** The signed-in member's own ledger account. */
export async function myAccount(api: ApiClient): Promise<LedgerMe> {
  return api.getJson<LedgerMe>('/api/ledger/accounts/me/');
}

/** Transactions whose description contains `text`, newest first. */
export async function findTransactions(api: ApiClient, text: string): Promise<LedgerTransaction[]> {
  const page = await api.getJson<Page<LedgerTransaction>>('/api/ledger/transactions/', {
    q: text,
  });
  return page.results;
}

/** The single transaction whose description contains `text`. */
export async function findTransaction(api: ApiClient, text: string): Promise<LedgerTransaction> {
  const found = await findTransactions(api, text);
  if (found.length !== 1) {
    throw new Error(`Expected one transaction matching "${text}", found ${found.length}`);
  }
  return api.getJson<LedgerTransaction>(`/api/ledger/transactions/${found[0].id}/`);
}

/** The entry of `transaction` on `accountId`, as the account holder reads it. */
export function effectOn(transaction: LedgerTransaction, accountId: string): number {
  const entry = transaction.entries.find(e => e.account.id === accountId);
  if (!entry) {
    throw new Error(`Transaction #${transaction.seq} has no entry on account ${accountId}`);
  }
  return Number(entry.display_amount);
}

/** Post a manual entry (an intent) through the API. */
export async function postIntent(
  api: ApiClient,
  body: {
    intent: 'expense_for_community' | 'top_up' | 'member_to_member' | 'payout' | 'income';
    amount: string;
    description: string;
    occurred_on?: string;
    category?: string;
    counterparty?: string;
    via?: 'bank' | 'cash';
  },
): Promise<LedgerTransaction> {
  return api.postJson<LedgerTransaction>('/api/ledger/transactions/', {
    occurred_on: today(),
    via: 'bank',
    ...body,
  });
}

export async function categoryByCode(api: ApiClient, code: string): Promise<LedgerCategory> {
  const categories = await api.getJson<LedgerCategory[]>('/api/ledger/categories/');
  const category = categories.find(c => c.code === code);
  if (!category) throw new Error(`No ledger category "${code}"`);
  return category;
}

export async function closedPeriods(api: ApiClient): Promise<LedgerPeriod[]> {
  return api.getJson<LedgerPeriod[]>('/api/ledger/periods/');
}

/** Today as yyyy-mm-dd in local time (what date inputs and the API expect). */
export function today(): string {
  return new Date().toLocaleDateString('en-CA');
}

/** A date `days` before `isoDate` (yyyy-mm-dd). */
export function daysBefore(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/** A small amount that is unique enough to find a line or entry again. */
export function uniqueAmount(base: number): string {
  const cents = Math.floor(Math.random() * 90) + 10;
  return `${base}.${cents}`;
}

export function sha256(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Recompute the hash chain from the `/api/ledger/chain/export/` CSV and return
 * the head; throws at the first link that does not match.
 */
export function verifyChainCsv(csv: string): { head: string; length: number } {
  const rows = parseCsv(csv.replace(/^﻿/, ''));
  const [header, ...links] = rows;
  const col = (name: string) => header.indexOf(name);
  let prev = '0'.repeat(64);
  for (const row of links) {
    if (row[col('prev_hash')] !== prev) {
      throw new Error(`Chain breaks at position ${row[col('position')]}: prev_hash differs`);
    }
    const hash = sha256(prev + row[col('canonical')]);
    if (hash !== row[col('hash')]) {
      throw new Error(`Chain breaks at position ${row[col('position')]}: hash differs`);
    }
    prev = hash;
  }
  return { head: prev, length: links.length };
}

/** Minimal RFC 4180 parser (quoted fields, doubled quotes, embedded commas). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export interface CamtLine {
  amount: string;
  incoming: boolean;
  name: string;
  iban?: string;
  text: string;
  bankReference: string;
  bookedOn?: string;
}

/** A CAMT.053 statement file as online banking exports it. */
export function camtStatement(lines: CamtLine[]): Buffer {
  const entries = lines
    .map(line => {
      const role = line.incoming ? 'Dbtr' : 'Cdtr';
      const day = line.bookedOn ?? today();
      return `
    <Ntry>
      <Amt Ccy="EUR">${line.amount}</Amt>
      <CdtDbtInd>${line.incoming ? 'CRDT' : 'DBIT'}</CdtDbtInd>
      <Sts><Cd>BOOK</Cd></Sts>
      <BookgDt><Dt>${day}</Dt></BookgDt>
      <ValDt><Dt>${day}</Dt></ValDt>
      <AcctSvcrRef>${line.bankReference}</AcctSvcrRef>
      <NtryDtls><TxDtls>
        <Refs><EndToEndId>NOTPROVIDED</EndToEndId></Refs>
        <RltdPties>
          <${role}><Pty><Nm>${line.name}</Nm></Pty></${role}>
          <${role}Acct><Id><IBAN>${line.iban ?? 'DE02120300000000202051'}</IBAN></Id></${role}Acct>
        </RltdPties>
        <RmtInf><Ustrd>${line.text}</Ustrd></RmtInf>
      </TxDtls></NtryDtls>
    </Ntry>`;
    })
    .join('');
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
  <BkToCstmrStmt><Stmt><Id>E2E</Id>${entries}
  </Stmt></BkToCstmrStmt>
</Document>`);
}

/** A tiny valid PDF, enough for the server's receipt type sniffing. */
export function receiptPdf(): Buffer {
  return Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
      '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n' +
      'trailer<</Root 1 0 R>>\n%%EOF\n',
  );
}

/**
 * A browser context for `role` with the UI in English, so page objects can use
 * role and label selectors regardless of the machine's language.
 */
export async function ledgerContext(browser: Browser, role: Role): Promise<BrowserContext> {
  const context = await contextForRole(browser, role, { locale: 'en-US' });
  await context.addInitScript(() => window.localStorage.setItem('bubble-language', 'en'));
  return context;
}
