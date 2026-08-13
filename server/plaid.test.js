import { describe, expect, it } from 'vitest'
import { normalizeAccount, normalizeTransaction } from './plaid.js'

/**
 * The sign and category conventions are where a bank integration quietly goes
 * wrong: a flipped sign turns income into spending and every chart with it.
 */

const account = (over = {}) => ({
  account_id: 'acc_1',
  name: 'Everyday Checking',
  official_name: 'Big Bank Everyday Checking',
  type: 'depository',
  subtype: 'checking',
  balances: { current: 1200.5, iso_currency_code: 'USD' },
  ...over,
})

const txn = (over = {}) => ({
  transaction_id: 'txn_1',
  account_id: 'acc_1',
  date: '2026-08-12',
  name: 'TRADER JOES #123',
  merchant_name: "Trader Joe's",
  amount: 42.5,
  pending: false,
  personal_finance_category: {
    primary: 'FOOD_AND_DRINK',
    detailed: 'FOOD_AND_DRINK_GROCERIES',
  },
  ...over,
})

describe('normalizeAccount', () => {
  it('maps depository subtypes onto app account types', () => {
    expect(normalizeAccount(account(), 'item_1').type).toBe('checking')
    expect(normalizeAccount(account({ subtype: 'savings' }), 'item_1').type).toBe('savings')
    expect(normalizeAccount(account({ subtype: 'cd' }), 'item_1').type).toBe('savings')
  })

  it('falls back to checking for an unknown depository subtype', () => {
    expect(normalizeAccount(account({ subtype: 'weird' }), 'item_1').type).toBe('checking')
  })

  it('maps the non-depository types', () => {
    expect(
      normalizeAccount(account({ type: 'credit', subtype: 'credit card' }), 'i').type,
    ).toBe('credit')
    expect(normalizeAccount(account({ type: 'loan', subtype: 'student' }), 'i').type).toBe(
      'loan',
    )
    expect(
      normalizeAccount(account({ type: 'investment', subtype: 'ira' }), 'i').type,
    ).toBe('investment')
    expect(normalizeAccount(account({ type: 'brokerage', subtype: 'x' }), 'i').type).toBe(
      'other',
    )
  })

  it('stores liabilities as a positive amount owed', () => {
    // Net worth subtracts liabilities, so a negative here would add debt to it.
    const card = normalizeAccount(
      account({ type: 'credit', subtype: 'credit card', balances: { current: -840.25 } }),
      'item_1',
    )
    expect(card.balance).toBe(840.25)
  })

  it('keeps asset balances signed as reported', () => {
    expect(normalizeAccount(account(), 'item_1').balance).toBe(1200.5)
  })

  it('carries the item id and marks the account as synced', () => {
    const row = normalizeAccount(account(), 'item_9')
    expect(row.plaid_item_id).toBe('item_9')
    expect(row.plaid_account_id).toBe('acc_1')
    expect(row.is_manual).toBe(false)
  })

  it('survives a missing balance block', () => {
    const row = normalizeAccount(account({ balances: undefined }), 'item_1')
    expect(row.balance).toBe(0)
    expect(row.currency).toBe('USD')
  })
})

describe('normalizeTransaction', () => {
  it('flips the sign — Plaid reports outflows positive', () => {
    expect(normalizeTransaction(txn()).amount).toBe(-42.5)
  })

  it('makes income positive', () => {
    const row = normalizeTransaction(
      txn({
        amount: -3325,
        personal_finance_category: { primary: 'INCOME', detailed: 'INCOME_WAGES' },
      }),
    )
    expect(row.amount).toBe(3325)
    expect(row.category).toBe('Income')
  })

  it('separates groceries from eating out', () => {
    // Plaid files both under FOOD_AND_DRINK, but they are budgeted separately.
    expect(normalizeTransaction(txn()).category).toBe('Groceries')
    expect(
      normalizeTransaction(
        txn({
          personal_finance_category: {
            primary: 'FOOD_AND_DRINK',
            detailed: 'FOOD_AND_DRINK_RESTAURANT',
          },
        }),
      ).category,
    ).toBe('Dining')
  })

  it('maps categories onto ones the budgets UI offers', () => {
    const mapped = (primary) =>
      normalizeTransaction(txn({ personal_finance_category: { primary, detailed: '' } }))
        .category

    expect(mapped('TRANSPORTATION')).toBe('Transport')
    expect(mapped('RENT_AND_UTILITIES')).toBe('Utilities')
    expect(mapped('LOAN_PAYMENTS')).toBe('Loan Payment')
    expect(mapped('TRANSFER_OUT')).toBe('Transfer')
  })

  it('title-cases an unrecognised category rather than dropping it', () => {
    const row = normalizeTransaction(
      txn({ personal_finance_category: { primary: 'SOME_NEW_THING', detailed: '' } }),
    )
    expect(row.category).toBe('Some New Thing')
  })

  it('falls back to Other with no category at all', () => {
    expect(
      normalizeTransaction(txn({ personal_finance_category: undefined })).category,
    ).toBe('Other')
  })

  it('prefers the raw name and keeps the merchant separately', () => {
    const row = normalizeTransaction(txn())
    expect(row.name).toBe('TRADER JOES #123')
    expect(row.merchant).toBe("Trader Joe's")
  })

  it('falls back to the merchant when there is no name', () => {
    expect(normalizeTransaction(txn({ name: undefined })).name).toBe("Trader Joe's")
  })

  it('carries the pending flag', () => {
    expect(normalizeTransaction(txn({ pending: true })).pending).toBe(true)
  })
})
