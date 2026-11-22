import {
  onValue,
  endAt,
  orderByChild,
  push,
  query,
  ref,
  serverTimestamp,
  update,
} from "firebase/database";
import type { User } from "firebase/auth";
import { database } from "./firebase";
import type { RoomMember } from "./rooms";

export type ExpenseDraft = {
  description: string;
  amountPaise: number;
  paidBy: string;
  participantIds: string[];
  date: string;
  receipt?: string;
};

export type Expense = ExpenseDraft & {
  id: string;
  createdAt: number;
  createdBy: string;
  updatedAt?: number;
};

export function suggestionKey(value: string) {
  return encodeURIComponent(value.trim().toLowerCase()).replaceAll(".", "%2E");
}

type ExpenseRecord = Omit<Expense, "id" | "participantIds"> & {
  participants?: Record<string, boolean>;
};

export function splitAmount(amountPaise: number, participantIds: string[]) {
  const ids = [...participantIds].sort();
  if (!ids.length) return {} as Record<string, number>;
  const each = Math.floor(amountPaise / ids.length);
  const remainder = amountPaise % ids.length;
  return Object.fromEntries(ids.map((id, index) => [id, each + (index < remainder ? 1 : 0)]));
}

export function formatRupees(paise: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(paise / 100);
}

export function subscribeToExpenses(
  roomId: string,
  onExpenses: (expenses: Expense[]) => void,
  onError: (error: unknown) => void,
  historyCutoff?: number,
) {
  if (!database) throw new Error("database-not-configured");
  const expensesRef = ref(database, `rooms/${roomId}/expenses`);
  const expensesQuery = historyCutoff === undefined
    ? expensesRef
    : query(expensesRef, orderByChild("createdAt"), endAt(historyCutoff));
  return onValue(
    expensesQuery,
    (snapshot) => {
      const records = snapshot.val() as Record<string, ExpenseRecord> | null;
      const expenses = Object.entries(records || {}).map(([id, record]) => ({
        id,
        description: record.description,
        amountPaise: record.amountPaise,
        paidBy: record.paidBy,
        participantIds: Object.keys(record.participants || {}).filter((uid) => record.participants?.[uid]),
        date: record.date,
        receipt: record.receipt,
        createdAt: record.createdAt,
        createdBy: record.createdBy,
        updatedAt: record.updatedAt,
      }));
      onExpenses(expenses.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt));
    },
    onError,
  );
}

export function subscribeToSuggestions(roomId: string, onSuggestions: (items: string[]) => void, onError: (error: unknown) => void) {
  if (!database) throw new Error("database-not-configured");
  return onValue(
    ref(database, `rooms/${roomId}/suggestions`),
    (snapshot) => {
      const saved = snapshot.val() as Record<string, string> | null;
      onSuggestions(Object.values(saved || {}).filter((item): item is string => typeof item === "string"));
    },
    onError,
  );
}

export async function saveExpense(roomId: string, draft: ExpenseDraft, user: User) {
  if (!database) throw new Error("database-not-configured");
  const participantIds = [...new Set(draft.participantIds)];
  const data = {
    description: draft.description.trim(),
    amountPaise: draft.amountPaise,
    paidBy: draft.paidBy,
    participants: Object.fromEntries(participantIds.map((uid) => [uid, true])),
    date: draft.date,
    ...(draft.receipt ? { receipt: draft.receipt } : {}),
  };
  const itemPath = `rooms/${roomId}/suggestions/${suggestionKey(data.description)}`;

  const newRef = push(ref(database, `rooms/${roomId}/expenses`));
  if (!newRef.key) throw new Error("expense-id-unavailable");
  await update(ref(database), {
    [`rooms/${roomId}/expenses/${newRef.key}`]: {
      ...data,
      createdAt: serverTimestamp(),
      createdBy: user.uid,
    },
    [itemPath]: data.description,
  });
}

export function defaultParticipants(members: RoomMember[]) {
  return members.map((member) => member.uid);
}

export type MemberSettlement = {
  uid: string;
  paidPaise: number;
  sharePaise: number;
  balancePaise: number;
};

export type SettlementTransfer = {
  from: string;
  to: string;
  amountPaise: number;
};

export function calculateSettlement(expenses: Expense[], members: RoomMember[], startDate: string, endDate: string, isClosed = false) {
  const monthlyExpenses = expenses.filter((expense) => expense.date >= startDate && expense.date <= endDate);
  const balances = new Map<string, MemberSettlement>(members.map((member) => [member.uid, {
    uid: member.uid,
    paidPaise: 0,
    sharePaise: 0,
    balancePaise: 0,
  }]));

  monthlyExpenses.forEach((expense) => {
    const payer = balances.get(expense.paidBy);
    if (payer) payer.paidPaise += expense.amountPaise;
    Object.entries(splitAmount(expense.amountPaise, expense.participantIds)).forEach(([uid, share]) => {
      const member = balances.get(uid);
      if (member) member.sharePaise += share;
    });
  });

  const memberBalances = [...balances.values()].map((member) => ({
    ...member,
    balancePaise: isClosed ? 0 : member.paidPaise - member.sharePaise,
  }));
  const nonzero = memberBalances.filter((member) => member.balancePaise !== 0);
  let minimal = nonzero.length <= 14;
  const groups: MemberSettlement[][] = [];

  if (minimal && nonzero.length) {
    const size = nonzero.length;
    const limit = 1 << size;
    const sums = new Array<number>(limit).fill(0);
    for (let mask = 1; mask < limit; mask++) {
      const bit = mask & -mask;
      const index = 31 - Math.clz32(bit);
      sums[mask] = sums[mask ^ bit] + nonzero[index].balancePaise;
    }

    const memo = new Int8Array(limit).fill(-1);
    const choices = new Int32Array(limit);
    memo[0] = 0;
    function maxGroups(mask: number): number {
      if (memo[mask] >= 0) return memo[mask];
      const first = mask & -mask;
      let best = 0;
      for (let subset = mask; subset; subset = (subset - 1) & mask) {
        if (!(subset & first) || sums[subset] !== 0) continue;
        const groupsLeft = 1 + maxGroups(mask ^ subset);
        if (groupsLeft > best) {
          best = groupsLeft;
          choices[mask] = subset;
        }
      }
      memo[mask] = best;
      return best;
    }

    let mask = limit - 1;
    maxGroups(mask);
    while (mask) {
      const groupMask = choices[mask];
      const group = nonzero.filter((_, index) => groupMask & (1 << index));
      groups.push(group);
      mask ^= groupMask;
    }
  }

  const transferGroups = minimal
    ? groups
    : nonzero.length ? [nonzero] : [];
  const transfers: SettlementTransfer[] = [];
  transferGroups.forEach((group) => {
    const debtors = group.filter((member) => member.balancePaise < 0).map((member) => ({ uid: member.uid, amount: -member.balancePaise }));
    const creditors = group.filter((member) => member.balancePaise > 0).map((member) => ({ uid: member.uid, amount: member.balancePaise }));
    let debtorIndex = 0;
    let creditorIndex = 0;
    while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
      const debtor = debtors[debtorIndex];
      const creditor = creditors[creditorIndex];
      const amountPaise = Math.min(debtor.amount, creditor.amount);
      transfers.push({ from: debtor.uid, to: creditor.uid, amountPaise });
      debtor.amount -= amountPaise;
      creditor.amount -= amountPaise;
      if (!debtor.amount) debtorIndex++;
      if (!creditor.amount) creditorIndex++;
    }
  });

  return {
    totalSpentPaise: monthlyExpenses.reduce((total, expense) => total + expense.amountPaise, 0),
    members: memberBalances,
    transfers,
    minimal,
  };
}
