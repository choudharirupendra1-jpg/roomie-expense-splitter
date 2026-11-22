import { useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { calculateSettlement, formatRupees, type Expense } from "./expenses";
import { activeCycle, cycleLabel, listCycles, settleCycle, type ClosedCycle } from "./cycles";
import { memberLabels, type RoomMember } from "./rooms";

type Props = {
  roomId: string;
  user: User;
  expenses: Expense[];
  members: RoomMember[];
  cycleStartDay: number;
  closedCycles: ClosedCycle[];
  readOnly: boolean;
};

function today() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

export default function SettlementSummary({ roomId, user, expenses, members, cycleStartDay, closedCycles, readOnly }: Props) {
  const [selectedCycleId, setSelectedCycleId] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const active = activeCycle(new Date(), cycleStartDay, closedCycles);
  const cycles = useMemo(() => listCycles(expenses, closedCycles, cycleStartDay, active), [expenses, closedCycles, cycleStartDay, active.cycleId]);
  const cycle = cycles.find((item) => item.cycleId === selectedCycleId) || active;
  const isClosed = closedCycles.some((item) => item.cycleId === cycle.cycleId);
  const summary = useMemo(
    () => calculateSettlement(expenses, members, cycle.startDate, cycle.endDate, isClosed),
    [expenses, members, cycle.startDate, cycle.endDate, isClosed],
  );
  const displayNames = memberLabels(members);
  const canClose = !readOnly && !isClosed && (cycle.cycleId === active.cycleId || cycle.endDate <= today());

  async function closeCycle() {
    const settledThrough = today() < cycle.endDate ? today() : cycle.endDate;
    const settledCycle = { ...cycle, endDate: settledThrough };
    const nextStart = new Date(`${settledThrough}T00:00:00`);
    nextStart.setDate(nextStart.getDate() + 1);
    const nextStartLabel = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(nextStart);
    if (!window.confirm(`Start a new cycle? ${cycleLabel(settledCycle)} will move to past cycles, and the new cycle starts ${nextStartLabel}.`)) return;
    setSaving(true);
    setError("");
    try {
      await settleCycle(roomId, settledCycle, user);
      setSelectedCycleId("");
    } catch (reason) {
      const code = (reason as { code?: string })?.code;
      setError(code === "PERMISSION_DENIED"
        ? "Firebase denied this update. Publish the latest database.rules.json, then try again."
        : "Couldn't settle this cycle. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="settlement-section" aria-label="Cycle settlement">
      <div className="settlement-heading">
        <div>
          <p className="panel-kicker">{cycle.cycleId === active.cycleId ? "CURRENT CYCLE" : "PAST CYCLE"}</p>
          <h3>{cycle.cycleId === active.cycleId ? "Room summary" : "Cycle summary"}</h3>
          <p>Paid totals, shares and who owes whom.</p>
        </div>
        {cycle.cycleId !== active.cycleId && <button type="button" className="cycle-history-back" onClick={() => setSelectedCycleId("")}>Back to current</button>}
      </div>

      <div className="cycle-status"><span>{cycleLabel(cycle)}</span><strong className={isClosed ? "cycle-closed" : ""}>{isClosed ? "Settled" : "Open"}</strong></div>
      {cycle.cycleId === active.cycleId && cycles.some((item) => item.cycleId !== active.cycleId) && <div className="cycle-history"><button type="button" className="cycle-history-toggle" aria-expanded={showHistory} onClick={() => setShowHistory((shown) => !shown)}>{showHistory ? "Hide past cycles" : "Past cycles"}</button>{showHistory && <select aria-label="Choose a past cycle" value={selectedCycleId} onChange={(event) => setSelectedCycleId(event.target.value)}><option value="">Choose a cycle</option>{cycles.filter((item) => item.cycleId !== active.cycleId).map((item) => <option key={item.cycleId} value={item.cycleId}>{cycleLabel(item)}{closedCycles.some((closed) => closed.cycleId === item.cycleId) ? " (Settled)" : " (Open)"}</option>)}</select>}</div>}
      <div className="settlement-total"><span>Room total</span><strong>{formatRupees(summary.totalSpentPaise)}</strong></div>
      <div className="settlement-members">
        {summary.members.map((member) => (
          <div className="settlement-member" key={member.uid}>
            <strong>{displayNames.get(member.uid) || "Roommate"}</strong>
            <span>Paid {formatRupees(member.paidPaise)}</span>
            <span>Share {formatRupees(member.sharePaise)}</span>
            <b className={member.balancePaise > 0 ? "settlement-positive" : member.balancePaise < 0 ? "settlement-negative" : ""}>
              {isClosed ? "Settled" : member.balancePaise > 0 ? `Gets ${formatRupees(member.balancePaise)}` : member.balancePaise < 0 ? `Owes ${formatRupees(-member.balancePaise)}` : "Settled"}
            </b>
          </div>
        ))}
      </div>

      <div className="settlement-transfers">
        <h4>{summary.minimal ? "Minimum transfers" : "Suggested transfers"}</h4>
        {summary.transfers.length ? (
          <ul>{summary.transfers.map((transfer, index) => (
            <li key={`${transfer.from}-${transfer.to}-${index}`}>
              <span><strong>{displayNames.get(transfer.from) || "Roommate"}</strong> pays <strong>{displayNames.get(transfer.to) || "Roommate"}</strong></span>
              <b>{formatRupees(transfer.amountPaise)}</b>
            </li>
          ))}</ul>
        ) : <p className="settlement-empty">{isClosed ? "This cycle is settled." : "No transfers needed for this cycle."}</p>}
        {canClose && <button type="button" className="cycle-settle-button" onClick={() => void closeCycle()} disabled={saving}>{saving ? "Starting..." : "Start new cycle"}</button>}
        {error && <p className="error-message" role="alert">{error}</p>}
      </div>
    </section>
  );
}
