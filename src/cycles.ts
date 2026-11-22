import { endAt, onValue, orderByChild, query, ref, serverTimestamp, set } from "firebase/database";
import type { User } from "firebase/auth";
import { database } from "./firebase";
import type { Expense } from "./expenses";

export type ExpenseCycle = { cycleId: string; startDate: string; endDate: string };
export type ClosedCycle = ExpenseCycle & { settledAt: number; settledBy: string };

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function cycleRange(start: Date, end: Date): ExpenseCycle {
  const startDate = dateKey(start);
  return { cycleId: startDate, startDate, endDate: dateKey(end) };
}

function naturalCycle(start: Date) {
  return cycleRange(start, new Date(start.getFullYear(), start.getMonth() + 1, start.getDate() - 1));
}

export function cycleForDate(value: string | Date, cycleStartDay: number, closedCycles: ClosedCycle[] = []): ExpenseCycle {
  const date = typeof value === "string" ? new Date(`${value}T00:00:00`) : value;
  let start = new Date(date.getFullYear(), date.getMonth(), cycleStartDay);
  if (date < start) start = new Date(date.getFullYear(), date.getMonth() - 1, cycleStartDay);
  const natural = naturalCycle(start);
  const day = dateKey(date);
  const closed = closedCycles.find((item) => item.startDate <= day && item.endDate >= day);
  if (closed) return { cycleId: closed.cycleId, startDate: closed.startDate, endDate: closed.endDate };

  const previous = closedCycles
    .filter((item) => item.startDate >= natural.startDate && item.startDate <= natural.endDate && item.endDate < day)
    .sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
  if (!previous) return natural;
  const nextStart = new Date(`${previous.endDate}T00:00:00`);
  nextStart.setDate(nextStart.getDate() + 1);
  return cycleRange(nextStart, new Date(`${natural.endDate}T00:00:00`));
}

export function activeCycle(value: Date, cycleStartDay: number, closedCycles: ClosedCycle[]) {
  const day = dateKey(value);
  const closed = closedCycles.find((item) => item.startDate <= day && item.endDate >= day);
  if (!closed) return cycleForDate(value, cycleStartDay, closedCycles);
  const nextDay = new Date(`${closed.endDate}T00:00:00`);
  nextDay.setDate(nextDay.getDate() + 1);
  return cycleForDate(nextDay, cycleStartDay, closedCycles);
}

export function listCycles(expenses: Expense[], closedCycles: ClosedCycle[], cycleStartDay: number, current: ExpenseCycle) {
  const cycles = new Map<string, ExpenseCycle>();
  cycles.set(current.cycleId, current);
  closedCycles.forEach((cycle) => cycles.set(cycle.cycleId, cycle));
  expenses.forEach((expense) => {
    const cycle = cycleForDate(expense.date, cycleStartDay, closedCycles);
    cycles.set(cycle.cycleId, cycle);
  });
  return [...cycles.values()].sort((a, b) => b.startDate.localeCompare(a.startDate));
}

export function cycleLabel(cycle: ExpenseCycle) {
  const format = (value: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(new Date(`${value}T00:00:00`));
  return `${format(cycle.startDate)} to ${format(cycle.endDate)}`;
}

export function subscribeToClosedCycles(
  roomId: string,
  onCycles: (cycles: ClosedCycle[]) => void,
  onError: (error: unknown) => void,
  historyCutoff?: number,
) {
  if (!database) throw new Error("database-not-configured");
  const cyclesRef = ref(database, `rooms/${roomId}/cycles`);
  const cyclesQuery = historyCutoff === undefined
    ? cyclesRef
    : query(cyclesRef, orderByChild("settledAt"), endAt(historyCutoff));
  return onValue(cyclesQuery, (snapshot) => {
    const records = snapshot.val() as Record<string, Omit<ClosedCycle, "cycleId">> | null;
    onCycles(Object.entries(records || {}).map(([cycleId, cycle]) => ({ cycleId, ...cycle })));
  }, onError);
}

export async function settleCycle(roomId: string, cycle: ExpenseCycle, user: User) {
  if (!database) throw new Error("database-not-configured");
  await set(ref(database, `rooms/${roomId}/cycles/${cycle.cycleId}`), {
    cycleId: cycle.cycleId,
    startDate: cycle.startDate,
    endDate: cycle.endDate,
    settledAt: serverTimestamp(),
    settledBy: user.uid,
  });
}
