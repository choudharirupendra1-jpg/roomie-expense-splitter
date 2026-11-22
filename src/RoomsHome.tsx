import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { User } from "firebase/auth";
import { databaseConfigured } from "./firebase";
import ExpenseLedger from "./ExpenseLedger";
import {
  createRoom,
  deleteRoom,
  joinRoom,
  leaveRoom,
  memberLabels,
  makeInviteLink,
  subscribeToRooms,
  updateCycleStartDay,
  type RoomSummary,
} from "./rooms";

type Props = {
  user: User;
  busy: boolean;
  accountError: string;
  onSignOut: () => void;
  onConnectGoogle: () => void;
};

function roomErrorMessage(error: unknown) {
  const code = (error as { code?: string })?.code;
  const normalizedCode = String(code || "").toUpperCase();
  const detail = error instanceof Error ? error.message : String((error as { message?: string })?.message || "");
  if (error instanceof Error && error.message === "database-not-configured") {
    return "Rooms are unavailable right now. Please try again later.";
  }
  if (error instanceof Error && error.message === "invalid-room-name") {
    return "Room names must be between 1 and 60 characters.";
  }
  if (error instanceof Error && error.message === "invalid-room-code") {
    return "That invite code doesn’t look right. Open the invite link or enter the 8-character code.";
  }
  if (normalizedCode.includes("PERMISSION_DENIED") || /permission denied/i.test(detail)) {
    return "Couldn't access this room right now. Please try again.";
  }
  if (normalizedCode.includes("NETWORK") || /network/i.test(detail)) {
    return "Couldn't connect right now. Check your internet connection and try again.";
  }
  return "Couldn’t load your rooms right now. Please try again.";
}

function roomActionError(error: unknown) {
  if ((error as { code?: string })?.code === "PERMISSION_DENIED") {
    return "Couldn't complete that room action. Please try again.";
  }
  return roomErrorMessage(error);
}

export default function RoomsHome({ user, busy, accountError, onSignOut, onConnectGoogle }: Props) {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [roomName, setRoomName] = useState("");
  const [joinCode, setJoinCode] = useState(() => new URLSearchParams(window.location.search).get("join") || "");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState("");
  const selectedRoom = rooms.find((room) => room.id === selectedId) || null;
  const selectedMemberLabels = selectedRoom
    ? memberLabels([...selectedRoom.members, ...selectedRoom.formerMembers])
    : new Map<string, string>();

  useEffect(() => {
    if (!databaseConfigured) {
      setRoomsLoading(false);
      return;
    }
    try {
      return subscribeToRooms(
        user,
        (nextRooms) => {
          setRooms(nextRooms);
          setRoomsLoading(false);
          setError("");
        },
        (reason) => {
          setError(roomErrorMessage(reason));
          setRoomsLoading(false);
        },
      );
    } catch (reason) {
      setError(roomErrorMessage(reason));
      setRoomsLoading(false);
    }
  }, [user]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setError("");
    try {
      const id = await createRoom(roomName, user);
      setRoomName("");
      setSelectedId(id);
      clearJoinQuery();
    } catch (reason) {
      setError(roomErrorMessage(reason));
    } finally {
      setWorking(false);
    }
  }

  async function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setError("");
    try {
      const id = await joinRoom(joinCode, user);
      setJoinCode("");
      setSelectedId(id);
      clearJoinQuery();
    } catch (reason) {
      setError(roomErrorMessage(reason));
    } finally {
      setWorking(false);
    }
  }

  async function handleLeaveRoom() {
    if (!selectedRoom) return;
    const otherMembers = selectedRoom.members.filter((member) => member.uid !== user.uid);
    const nextOwner = [...otherMembers].sort((a, b) => a.joinedAt - b.joinedAt)[0];
    const isOwner = selectedRoom.members.some((member) => member.uid === user.uid && member.isOwner);
    const message = isOwner && nextOwner
      ? `Leave ${selectedRoom.name}? ${nextOwner.name} will become the owner. Your room history will stay available.`
      : `Leave ${selectedRoom.name}? It will stay in Past rooms as read-only history.`;
    if (!window.confirm(message)) return;

    setWorking(true);
    setError("");
    try {
      await leaveRoom(selectedRoom, user);
      setSelectedId(null);
      setCopyMessage("");
    } catch (reason) {
      setError(roomActionError(reason));
    } finally {
      setWorking(false);
    }
  }

  async function handleDeleteRoom() {
    if (!selectedRoom || !window.confirm(`Delete ${selectedRoom.name} for everyone? This removes its expenses and cannot be undone.`)) return;
    setWorking(true);
    setError("");
    try {
      await deleteRoom(selectedRoom, user);
      setSelectedId(null);
      setCopyMessage("");
    } catch (reason) {
      setError(roomActionError(reason));
    } finally {
      setWorking(false);
    }
  }

  async function handleCycleStartChange(day: number) {
    if (!selectedRoom) return;
    if (!window.confirm("Changing the cycle start day will regroup past expenses. Continue?")) return;
    setWorking(true);
    setError("");
    try {
      await updateCycleStartDay(selectedRoom, day, user);
    } catch (reason) {
      setError(roomActionError(reason));
    } finally {
      setWorking(false);
    }
  }

  async function copyInvite(room: RoomSummary) {
    const invite = makeInviteLink(room.id);
    try {
      if (navigator.share) await navigator.share({ title: `Join ${room.name} on Roomie`, url: invite });
      else {
        await navigator.clipboard.writeText(invite);
        setCopyMessage("Invite link copied");
        window.setTimeout(() => setCopyMessage(""), 2200);
      }
    } catch (reason) {
      if ((reason as { name?: string })?.name !== "AbortError") {
        setCopyMessage(invite);
      }
    }
  }

  return (
    <section className="rooms-layout" aria-label="Your rooms">
      <div className="rooms-heading">
        <div>
          <p className="panel-kicker">YOUR ROOMMATE SPACE</p>
          <h1 className="rooms-title">Rooms, together.</h1>
          <p className="rooms-subtitle">Create a room or join one with an invite from a roommate.</p>
        </div>
        <div className="account-actions">
          <div className="account-chip">
            <span className="account-avatar">{(user.displayName || user.email || "R").slice(0, 1).toUpperCase()}</span>
            <span className="account-name">{user.displayName || user.email || "Roommate"}<small>{user.isAnonymous ? "Guest account" : "Google account"}</small></span>
          </div>
          {user.isAnonymous && <button className="account-link" onClick={onConnectGoogle} disabled={busy}>Link Google</button>}
          <button className="text-button" onClick={onSignOut}>Sign out</button>
        </div>
      </div>

      {user.isAnonymous && <div className="guest-banner"><span>↗</span> Guest accounts live in this browser. Link Google before switching devices.</div>}
      {accountError && <p className="error-message" role="alert">{accountError}</p>}
      {!databaseConfigured && <p className="room-service-message" role="status">Rooms are unavailable right now. Please try again later.</p>}

      {selectedRoom ? (
        <div className="room-detail-card">
          <button className="back-button" onClick={() => { setSelectedId(null); setCopyMessage(""); }}>← All rooms</button>
          <div className="room-detail-top">
            <div><p className="panel-kicker">{selectedRoom.isArchived ? "ROOM HISTORY" : "ROOM"}</p><h2>{selectedRoom.name}</h2><p className="room-detail-copy">{selectedRoom.isArchived ? "You left this room. Its expenses are available to view." : "Invite roommates to join this space."}</p></div>
            <div className="room-management-actions">
              <button className="share-button" onClick={() => copyInvite(selectedRoom)}>Share invite</button>
              {!selectedRoom.isArchived && <button className="room-exit-button" onClick={handleLeaveRoom} disabled={working}>Leave room</button>}
              {(selectedRoom.members.some((member) => member.uid === user.uid && member.isOwner) || (!selectedRoom.members.length && selectedRoom.formerMembers.some((member) => member.uid === user.uid && member.wasOwner))) && <button className="room-delete-button" onClick={handleDeleteRoom} disabled={working}>Delete room</button>}
            </div>
          </div>
          {copyMessage && <p className="copy-message">{copyMessage}</p>}
          {error && <p className="error-message room-error" role="alert">{error}</p>}
          <div className="invite-code-row"><span>INVITE CODE</span><code>{selectedRoom.id.toUpperCase()}</code><button onClick={() => { navigator.clipboard?.writeText(selectedRoom.id.toUpperCase()); setCopyMessage("Invite code copied"); window.setTimeout(() => setCopyMessage(""), 2200); }}>Copy code</button></div>
          {!selectedRoom.isArchived && selectedRoom.members.some((member) => member.uid === user.uid && member.isOwner) && <div className="cycle-setting"><label htmlFor="cycle-start-day">Monthly cycle starts on</label><select id="cycle-start-day" value={selectedRoom.cycleStartDay} disabled={working} onChange={(event) => void handleCycleStartChange(Number(event.target.value))}>{Array.from({ length: 28 }, (_, index) => index + 1).map((day) => <option value={day} key={day}>{day}{day === 1 ? "st" : day === 2 ? "nd" : day === 3 ? "rd" : "th"} of each month</option>)}</select><small>For example, day 4 means the 4th through the 3rd.</small></div>}
          <div className="members-section">
            <div className="members-heading"><h3>Roommates</h3><span>{selectedRoom.members.length} {selectedRoom.members.length === 1 ? "member" : "members"}</span></div>
            <ul className="member-list">
              {selectedRoom.members.map((member, index) => (
                <li key={member.uid}>
                  <span className={`member-avatar member-tone-${index % 4}`}>{member.name.slice(0, 1).toUpperCase()}</span>
                  <span className="member-name">{selectedMemberLabels.get(member.uid) || member.name}{member.uid === user.uid && <small>You</small>}</span>
                  {member.isOwner && <span className="owner-label">ROOM OWNER</span>}
                </li>
              ))}
            </ul>
          </div>
          {selectedRoom.formerMembers.length > 0 && <div className="members-section"><div className="members-heading"><h3>Past roommates</h3><span>{selectedRoom.formerMembers.length} {selectedRoom.formerMembers.length === 1 ? "person" : "people"}</span></div><ul className="member-list">{selectedRoom.formerMembers.map((member, index) => <li key={member.uid}><span className={`member-avatar member-tone-${index % 4}`}>{member.name.slice(0, 1).toUpperCase()}</span><span className="member-name">{selectedMemberLabels.get(member.uid) || member.name}{member.uid === user.uid && <small>You left</small>}</span></li>)}</ul></div>}
          {selectedRoom.isArchived && <p className="room-history-note">This is a read-only snapshot of expenses recorded before you left. Rejoin with the invite code to add new expenses.</p>}
          <ExpenseLedger key={selectedRoom.id} room={selectedRoom} user={user} readOnly={selectedRoom.isArchived} historyCutoff={selectedRoom.archivedAt} />
        </div>
      ) : (
        <>
          <div className="room-actions-grid">
            <form className="room-action-card" onSubmit={handleCreate}>
              <div className="action-icon create-icon">＋</div>
              <p className="panel-kicker">START A NEW ROOM</p>
              <h2>Create your room</h2>
              <p>Name your shared space. You can invite everyone with a private link.</p>
              <label htmlFor="room-name">Room name</label>
              <div className="room-form-row"><input id="room-name" value={roomName} maxLength={60} onChange={(event) => setRoomName(event.target.value)} placeholder="e.g. Maple Hostel, Room 204" disabled={!databaseConfigured || working} /><button type="submit" disabled={!databaseConfigured || working || !roomName.trim()}>{working ? "Working…" : "Create room"}</button></div>
            </form>
            <form className="room-action-card join-card" onSubmit={handleJoin}>
              <div className="action-icon join-icon">↗</div>
              <p className="panel-kicker">HAVE AN INVITE?</p>
              <h2>Join your roommates</h2>
              <p>Share the 8-character code or invite link with your roommates.</p>
              <label htmlFor="join-code">Invite link or code</label>
              <div className="room-form-row"><input id="join-code" value={joinCode} onChange={(event) => setJoinCode(event.target.value)} placeholder="Paste invite link or code" autoCapitalize="none" disabled={!databaseConfigured || working} /><button type="submit" disabled={!databaseConfigured || working || !joinCode.trim()}>{working ? "Joining…" : "Join room"}</button></div>
            </form>
          </div>
          {error && <p className="error-message room-error" role="alert">{error}</p>}
          <div className="your-rooms-section">
            <div className="members-heading"><h2>Your rooms</h2><span>{rooms.length} {rooms.length === 1 ? "room" : "rooms"}</span></div>
            {roomsLoading ? <p className="empty-rooms">Loading your rooms…</p> : rooms.length ? (
              <div className="room-list">
                {rooms.map((room) => <button className="room-list-item" key={room.id} onClick={() => setSelectedId(room.id)}><span className="room-list-icon">⌂</span><span className="room-list-text"><strong>{room.name}</strong><small>{room.isArchived ? "Past room · view history" : `${room.members.length} ${room.members.length === 1 ? "roommate" : "roommates"}`}</small></span><span className="room-list-open">{room.isArchived ? "History" : "Open"}</span></button>)}
              </div>
            ) : <p className="empty-rooms">Your rooms will show up here. Create one or join with an invite link.</p>}
          </div>
        </>
      )}
    </section>
  );
}

function clearJoinQuery() {
  const next = new URL(window.location.href);
  next.searchParams.delete("join");
  window.history.replaceState({}, "", next);
}
