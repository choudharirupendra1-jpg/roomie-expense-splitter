import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { User } from "firebase/auth";
import {
  defaultParticipants,
  formatRupees,
  saveExpense,
  splitAmount,
  subscribeToExpenses,
  subscribeToSuggestions,
  type Expense,
} from "./expenses";
import { cycleForDate, subscribeToClosedCycles, type ClosedCycle } from "./cycles";
import { memberLabels, type RoomMember, type RoomSummary } from "./rooms";
import { compressReceipt } from "./receipt";
import SettlementSummary from "./SettlementSummary";

type Props = { room: RoomSummary; user: User; readOnly?: boolean; historyCutoff?: number };
const QUICK_ITEMS = ["Milk", "Water Can", "Groceries", "Wi-Fi", "Vegetables", "Chai/Snacks"];

function localToday() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 10);
}

function displayDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function expenseErrorMessage(error: unknown) {
  const code = (error as { code?: string })?.code;
  if (error instanceof Error && error.message === "database-not-configured") {
    return "Expenses are unavailable right now. Please try again later.";
  }
  if (code === "PERMISSION_DENIED") {
    return "Couldn't save this expense. Check the details and try again.";
  }
  return "Couldn't save the expense right now. Please try again.";
}

export default function ExpenseLedger({ room, user, readOnly = false, historyCutoff }: Props) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [closedCycles, setClosedCycles] = useState<ClosedCycle[]>([]);
  const [savedSuggestions, setSavedSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [ledgerView, setLedgerView] = useState<"summary" | "transactions">("summary");
  const [description, setDescription] = useState("");
  const [amountText, setAmountText] = useState("");
  const [paidBy, setPaidBy] = useState(user.uid);
  const [participantIds, setParticipantIds] = useState<string[]>(() => defaultParticipants(room.members));
  const [date, setDate] = useState(localToday);
  const [receipt, setReceipt] = useState("");
  const [compressingReceipt, setCompressingReceipt] = useState(false);
  const [error, setError] = useState("");
  const memberIdsKey = room.members.map((member) => member.uid).sort().join(",");

  useEffect(() => {
    const currentIds = room.members.map((member) => member.uid);
    setParticipantIds((selected) => {
      const selectedIds = new Set(selected.filter((uid) => currentIds.includes(uid)));
      currentIds.forEach((uid) => {
        if (!selected.includes(uid)) selectedIds.add(uid);
      });
      return currentIds.filter((uid) => selectedIds.has(uid));
    });
  }, [memberIdsKey]);

  useEffect(() => {
    try {
      const stopExpenses = subscribeToExpenses(
        room.id,
        (nextExpenses) => { setExpenses(nextExpenses); setLoading(false); },
        (reason) => { setError(expenseErrorMessage(reason)); setLoading(false); },
        readOnly ? historyCutoff : undefined,
      );
      const stopCycles = subscribeToClosedCycles(
        room.id,
        setClosedCycles,
        (reason) => { setError(expenseErrorMessage(reason)); setLoading(false); },
        readOnly ? historyCutoff : undefined,
      );
      const stopSuggestions = readOnly ? () => {} : subscribeToSuggestions(room.id, setSavedSuggestions, () => {});
      return () => { stopExpenses(); stopCycles(); stopSuggestions(); };
    } catch (reason) {
      setError(expenseErrorMessage(reason));
      setLoading(false);
    }
  }, [historyCutoff, readOnly, room.id]);

  const amountPaise = Math.round(Number(amountText) * 100);
  const visibleExpenses = useMemo(
    () => readOnly && historyCutoff
      ? expenses.filter((expense) => expense.createdAt <= historyCutoff)
      : expenses,
    [expenses, historyCutoff, readOnly],
  );
  const ledgerMembers = useMemo(() => {
    const byId = new Map(room.members.map((member) => [member.uid, member]));
    room.formerMembers.forEach((member) => {
      if (!byId.has(member.uid)) {
        byId.set(member.uid, { uid: member.uid, name: member.name, isOwner: false, joinedAt: member.joinedAt } satisfies RoomMember);
      }
    });
    return [...byId.values()];
  }, [room.members, room.formerMembers]);
  const displayNames = memberLabels(ledgerMembers);
  const previewSplit = useMemo(
    () => splitAmount(amountPaise, participantIds),
    [amountPaise, participantIds],
  );
  const suggestionOptions = useMemo(() => {
    const unique = new Map<string, string>();
    [...QUICK_ITEMS, ...savedSuggestions].forEach((item) => unique.set(item.toLowerCase(), item));
    return [...unique.values()];
  }, [savedSuggestions]);
  const filteredSuggestions = description.trim()
    ? suggestionOptions
        .filter((item) => item.toLowerCase().includes(description.trim().toLowerCase()))
        .filter((item) => item.toLowerCase() !== description.trim().toLowerCase())
        .slice(0, 6)
    : [];

  function resetForm() {
    setDescription("");
    setAmountText("");
    setPaidBy(user.uid);
    setParticipantIds(defaultParticipants(room.members));
    setDate(localToday());
    setReceipt("");
    setError("");
    setShowForm(false);
  }

  function toggleParticipant(uid: string) {
    setError("");
    setParticipantIds((current) => current.includes(uid)
      ? current.filter((id) => id !== uid)
      : [...current, uid]);
  }

  async function chooseReceipt(file?: File) {
    if (!file) return;
    setCompressingReceipt(true);
    setError("");
    try {
      setReceipt(await compressReceipt(file));
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "";
      setError(message === "receipt-image-only"
        ? "Choose an image file for the receipt."
        : message === "receipt-file-too-large"
          ? "Choose an image smaller than 10 MB."
          : message === "receipt-compressed-too-large"
            ? "This image is still too large after compression. Choose another photo."
            : "Couldn't process this image. Choose another photo.");
    } finally {
      setCompressingReceipt(false);
    }
  }

  async function submitExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanDescription = description.trim();
    const numericAmount = Number(amountText);
    const amount = Math.round(numericAmount * 100);
    if (!cleanDescription || cleanDescription.length > 80) {
      setError("Enter an expense name between 1 and 80 characters.");
      return;
    }
    if (!Number.isFinite(numericAmount) || amount < 1 || amount > 99_999_999) {
      setError("Enter an amount from ₹0.01 to ₹999,999.99.");
      return;
    }
    if (!room.members.some((member) => member.uid === paidBy)) {
      setError("Choose a payer from this room.");
      return;
    }
    const selectedRoomMemberIds = room.members
      .filter((member) => participantIds.includes(member.uid))
      .map((member) => member.uid);
    if (!selectedRoomMemberIds.length) {
      setError("Select at least one room member to share this expense.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError("Choose a valid expense date.");
      return;
    }
    const expenseCycle = cycleForDate(date, room.cycleStartDay);
    if (closedCycles.some((cycle) => cycle.cycleId === expenseCycle.cycleId)) {
      setError("This cycle is settled. Choose a date in an open cycle.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await saveExpense(room.id, {
        description: cleanDescription,
        amountPaise: amount,
        paidBy,
        participantIds: selectedRoomMemberIds,
        date,
        ...(receipt ? { receipt } : {}),
      }, user);
      resetForm();
    } catch (reason) {
      setError(expenseErrorMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="expense-ledger" aria-label="Room expenses">
      <div className="ledger-heading">
        <div><p className="panel-kicker">ROOM SPENDING</p><h2>Expenses</h2><p>Every shared spend, in one place.</p></div>
        {!readOnly && <button className="share-button" onClick={() => { setShowForm((shown) => !shown); setError(""); }}>
          {showForm ? "Close form" : "+ Add expense"}
        </button>}
      </div>

      {showForm && !readOnly && (
        <form className="expense-form" onSubmit={submitExpense}>
          <div className="expense-form-heading"><div><p className="panel-kicker">NEW ENTRY</p><h3>Add an expense</h3></div></div>
          <div className="expense-fields">
            <div className="expense-field expense-name-field"><label htmlFor="expense-description">What was it for?</label><div className="suggest-input-wrap"><input id="expense-description" value={description} maxLength={80} onChange={(event) => setDescription(event.target.value)} placeholder="e.g. Milk or another item" autoComplete="off" />{filteredSuggestions.length > 0 && <div className="suggestion-menu" role="listbox" aria-label="Expense suggestions">{filteredSuggestions.map((item) => <button type="button" role="option" key={item} onClick={() => setDescription(item)}>{item}</button>)}</div>}</div><div className="quick-suggestions"><span>Quick add</span>{QUICK_ITEMS.map((item) => <button type="button" key={item} onClick={() => setDescription(item)}>{item}</button>)}</div></div>
            <div className="expense-field"><label htmlFor="expense-amount">Amount</label><div className="rupee-input"><span>₹</span><input id="expense-amount" type="number" min="0.01" max="999999.99" step="0.01" inputMode="decimal" value={amountText} onChange={(event) => setAmountText(event.target.value)} placeholder="0.00" /></div></div>
            <div className="expense-field"><label htmlFor="expense-date">Date</label><input id="expense-date" type="date" value={date} max={localToday()} onChange={(event) => setDate(event.target.value)} /></div>
            <div className="expense-field"><label htmlFor="expense-payer">Paid by</label><select id="expense-payer" value={paidBy} onChange={(event) => setPaidBy(event.target.value)}>{room.members.map((member) => <option value={member.uid} key={member.uid}>{displayNames.get(member.uid)}{member.uid === user.uid ? " (you)" : ""}</option>)}</select></div>
          </div>

          <div className="receipt-field">
            <label htmlFor="expense-receipt">Receipt photo <span>optional</span></label>
            <input id="expense-receipt" type="file" accept="image/*" onChange={(event) => { void chooseReceipt(event.target.files?.[0]); event.target.value = ""; }} disabled={compressingReceipt || saving} />
            {compressingReceipt && <small>Preparing photo…</small>}
            {receipt && <div className="receipt-preview"><a href={receipt} target="_blank" rel="noreferrer" aria-label="Open receipt preview"><img src={receipt} alt="Compressed receipt preview" /></a><button type="button" className="text-button" onClick={() => setReceipt("")}>Remove photo</button></div>}
          </div>

          <fieldset className="participants-fieldset">
            <legend>Shared by <span className="participants-count">{participantIds.length} of {room.members.length} selected</span></legend>
            <div className="participant-help">
              <p>Everyone is included by default.</p>
              {participantIds.length < room.members.length && <button type="button" onClick={() => setParticipantIds(defaultParticipants(room.members))}>Select everyone</button>}
            </div>
            <div className="participant-options">
              {room.members.map((member) => <label className="participant-option" key={member.uid}><input type="checkbox" checked={participantIds.includes(member.uid)} onChange={() => toggleParticipant(member.uid)} /><span className="participant-check" />{displayNames.get(member.uid)}{member.uid === user.uid ? " (you)" : ""}</label>)}
            </div>
          </fieldset>

          {participantIds.length > 0 && amountPaise > 0 && <div className="split-preview"><span>Equal split preview</span><div>{Object.entries(previewSplit).map(([uid, share]) => <span key={uid}>{displayNames.get(uid) || "Roommate"}: {formatRupees(share)}</span>)}</div></div>}
          {error && <p className="error-message" role="alert">{error}</p>}
          <div className="expense-form-actions"><button type="button" className="cancel-button" onClick={resetForm}>Cancel</button><button type="submit" className="share-button" disabled={saving || compressingReceipt}>{saving ? "Saving..." : "Add expense"}</button></div>
        </form>
      )}

      {error && !showForm && <p className="error-message" role="alert">{error}</p>}
      <div className="ledger-view-switch" role="group" aria-label="Expense view">
        <button type="button" className={ledgerView === "summary" ? "active" : ""} aria-pressed={ledgerView === "summary"} onClick={() => setLedgerView("summary")}>Monthly summary</button>
        <button type="button" className={ledgerView === "transactions" ? "active" : ""} aria-pressed={ledgerView === "transactions"} onClick={() => setLedgerView("transactions")}>Transactions <span>{visibleExpenses.length}</span></button>
      </div>
      <div hidden={ledgerView !== "transactions"}>
      <div className="expense-list-heading"><h3>All transactions</h3><span>{visibleExpenses.length} {visibleExpenses.length === 1 ? "entry" : "entries"}</span></div>
      {loading ? <p className="empty-expenses">Loading expenses...</p> : visibleExpenses.length ? (
        <div className="expense-list">
          {visibleExpenses.map((expense) => {
            const payer = displayNames.get(expense.paidBy) || "Roommate";
            const shares = splitAmount(expense.amountPaise, expense.participantIds);
            return (
              <article className="expense-row" key={expense.id}>
                <div className="expense-mark">₹</div>
                    <div className="expense-main"><div className="expense-row-title"><h4>{expense.description}</h4><time dateTime={expense.date}>{displayDate(expense.date)}</time></div><p>Paid by <strong>{payer}{expense.paidBy === user.uid ? " (you)" : ""}</strong></p><div className="expense-share-line">{Object.entries(shares).map(([uid, share]) => <span key={uid}>{displayNames.get(uid) || "Roommate"} {formatRupees(share)}</span>)}</div>{expense.receipt && <a className="receipt-link" href={expense.receipt} target="_blank" rel="noreferrer">View receipt</a>}</div>
                <div className="expense-row-side"><strong>{formatRupees(expense.amountPaise)}</strong></div>
              </article>
            );
          })}
        </div>
      ) : <p className="empty-expenses">No expenses yet. Add the first shared spend for this room.</p>}
      </div>
      {ledgerView === "summary" && (loading ? <p className="empty-expenses">Loading expenses...</p> : <SettlementSummary roomId={room.id} user={user} expenses={visibleExpenses} members={ledgerMembers} cycleStartDay={room.cycleStartDay} closedCycles={closedCycles} readOnly={readOnly} />)}
    </section>
  );
}

