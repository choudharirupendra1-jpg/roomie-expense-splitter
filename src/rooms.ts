import {
  onValue,
  remove,
  ref,
  serverTimestamp,
  set,
  update,
} from "firebase/database";
import type { User } from "firebase/auth";
import { database } from "./firebase";

export type RoomMember = {
  uid: string;
  name: string;
  isOwner: boolean;
  joinedAt: number;
};

export type FormerRoomMember = {
  uid: string;
  name: string;
  joinedAt: number;
  leftAt: number;
  wasOwner: boolean;
};

export type RoomSummary = {
  id: string;
  name: string;
  createdBy: string;
  createdAt: number;
  cycleStartDay: number;
  members: RoomMember[];
  formerMembers: FormerRoomMember[];
  isArchived: boolean;
  archivedAt?: number;
};

export function memberLabels(members: Array<Pick<RoomMember, "uid" | "name"> | Pick<FormerRoomMember, "uid" | "name">>) {
  const uniqueMembers = [...new Map(members.map((member) => [member.uid, member])).values()];
  const counts = new Map<string, number>();
  uniqueMembers.forEach(({ name }) => {
    const key = name.trim().toLocaleLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return new Map(uniqueMembers.map(({ uid, name }) => {
    const cleanName = name.trim() || "Roommate";
    const key = cleanName.toLocaleLowerCase();
    return [uid, counts.get(key)! > 1 ? `${cleanName} (#${uid.slice(-5).toUpperCase()})` : cleanName] as const;
  }));
}

type RoomRecord = {
  info?: { name?: string; createdBy?: string; createdAt?: number; cycleStartDay?: number };
  members?: Record<string, Partial<RoomMember>>;
  formerMembers?: Record<string, Partial<FormerRoomMember>>;
};

function requireDatabase() {
  if (!database) throw new Error("database-not-configured");
  return database;
}

function roomId() {
  const alphabet = "23456789abcdefghjkmnpqrstuvwxyz";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function memberFor(user: User, value: Partial<RoomMember>, uid: string): RoomMember {
  return {
    uid,
    name: value.name || user.displayName || user.email?.split("@")[0] || "Roommate",
    isOwner: value.isOwner === true,
    joinedAt: value.joinedAt || Date.now(),
  };
}

function summaryFromRecord(id: string, record: RoomRecord, user: User): RoomSummary | null {
  if (!record?.info?.name || !record.info.createdBy) return null;
  const members = Object.entries(record.members || {}).map(([uid, value]) =>
    memberFor(user, value || {}, uid),
  );
  const formerMembers = Object.entries(record.formerMembers || {}).map(([uid, value]) => ({
    uid,
    name: value?.name || "Roommate",
    joinedAt: value?.joinedAt || 0,
    leftAt: value?.leftAt || 0,
    wasOwner: value?.wasOwner === true,
  }));
  const formerRecord = record.formerMembers?.[user.uid];
  const isArchived = !record.members?.[user.uid] && Boolean(formerRecord);
  return {
    id,
    name: record.info.name,
    createdBy: record.info.createdBy,
    createdAt: record.info.createdAt || Date.now(),
    cycleStartDay: Math.min(28, Math.max(1, record.info.cycleStartDay || new Date(record.info.createdAt || Date.now()).getDate())),
    members: members.sort((a, b) => Number(b.isOwner) - Number(a.isOwner) || a.name.localeCompare(b.name)),
    formerMembers,
    isArchived,
    archivedAt: isArchived ? formerRecord?.leftAt : undefined,
  };
}

export function makeInviteLink(id: string) {
  const link = new URL(window.location.href);
  link.search = "";
  link.searchParams.set("join", id);
  return link.toString();
}

export function roomCodeFromInput(value: string) {
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed);
    return parsed.searchParams.get("join") || trimmed;
  } catch {
    return trimmed;
  }
}

export async function createRoom(name: string, user: User) {
  const db = requireDatabase();
  const cleanName = name.trim();
  if (!cleanName || cleanName.length > 60) throw new Error("invalid-room-name");

  const id = roomId();
  const displayName = user.displayName || user.email?.split("@")[0] || "Roommate";
  await set(ref(db, `rooms/${id}/info`), {
    name: cleanName,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    cycleStartDay: Math.min(28, new Date().getDate()),
  });
  await set(ref(db, `rooms/${id}/members/${user.uid}`), {
    uid: user.uid,
    name: displayName,
    isOwner: true,
    joinedAt: serverTimestamp(),
  });
  await remove(ref(db, `rooms/${id}/formerMembers/${user.uid}`));
  await set(ref(db, `users/${user.uid}/rooms/${id}`), true);
  return id;
}

export async function updateCycleStartDay(room: RoomSummary, day: number, user: User) {
  if (!Number.isInteger(day) || day < 1 || day > 28) throw new Error("invalid-cycle-start-day");
  if (!room.members.some((member) => member.uid === user.uid && member.isOwner)) throw new Error("owner-only-cycle-setting");
  await update(ref(requireDatabase(), `rooms/${room.id}/info`), { cycleStartDay: day });
}

export async function joinRoom(input: string, user: User) {
  const db = requireDatabase();
  const id = roomCodeFromInput(input).toLowerCase();
  if (!/^(?:[23456789abcdefghjkmnpqrstuvwxyz]{8}|[23456789abcdefghjkmnpqrstuvwxyz]{20})$/.test(id)) {
    throw new Error("invalid-room-code");
  }

  const name = user.displayName || user.email?.split("@")[0] || "Roommate";
  await set(ref(db, `rooms/${id}/members/${user.uid}`), {
    uid: user.uid,
    name,
    isOwner: false,
    joinedAt: serverTimestamp(),
  });
  await remove(ref(db, `rooms/${id}/formerMembers/${user.uid}`));
  await set(ref(db, `users/${user.uid}/rooms/${id}`), true);
  return id;
}

export async function leaveRoom(room: RoomSummary, user: User) {
  const db = requireDatabase();
  const currentMember = room.members.find((member) => member.uid === user.uid);
  if (!currentMember) throw new Error("not-room-member");

  const remainingMembers = room.members.filter((member) => member.uid !== user.uid);
  const updates: Record<string, unknown> = {
    [`rooms/${room.id}/members/${user.uid}`]: null,
    [`rooms/${room.id}/formerMembers/${user.uid}`]: {
      uid: user.uid,
      name: currentMember.name,
      joinedAt: currentMember.joinedAt,
      leftAt: serverTimestamp(),
      wasOwner: currentMember.isOwner,
    },
  };
  if (currentMember.isOwner && remainingMembers.length) {
    const nextOwner = [...remainingMembers].sort((a, b) => a.joinedAt - b.joinedAt)[0];
    updates[`rooms/${room.id}/members/${nextOwner.uid}/isOwner`] = true;
  }

  await update(ref(db), updates);
}

export async function deleteRoom(room: RoomSummary, user: User) {
  const db = requireDatabase();
  const isActiveOwner = room.members.some((member) => member.uid === user.uid && member.isOwner);
  const canDeleteArchivedRoom = !room.members.length && room.formerMembers.some((member) => member.uid === user.uid && member.wasOwner);
  if (!isActiveOwner && !canDeleteArchivedRoom) {
    throw new Error("owner-only-room-delete");
  }

  const updates: Record<string, unknown> = { [`rooms/${room.id}`]: null };
  room.members.forEach((member) => {
    updates[`users/${member.uid}/rooms/${room.id}`] = null;
  });
  room.formerMembers.forEach((member) => {
    updates[`users/${member.uid}/rooms/${room.id}`] = null;
  });
  await update(ref(db), updates);
}

export function subscribeToRooms(user: User, onRooms: (rooms: RoomSummary[]) => void, onError: (error: unknown) => void) {
  const db = requireDatabase();
  let roomUnsubscribers: Array<() => void> = [];
  let generation = 0;
  const unsubscribeIndex = onValue(
    ref(db, `users/${user.uid}/rooms`),
    (snapshot) => {
      const currentGeneration = ++generation;
      roomUnsubscribers.forEach((unsubscribe) => unsubscribe());
      roomUnsubscribers = [];
      const ids = Object.keys(snapshot.val() || {});
      if (!ids.length) {
        onRooms([]);
        return;
      }

      const rooms = new Map<string, RoomSummary>();
      onRooms([]);
      for (const id of ids) {
        const record: RoomRecord = {};
        const roomPaths = ["info", "members", "formerMembers"] as const;
        const loadedPaths = new Set<string>();
        const updateRoom = () => {
          if (currentGeneration !== generation || loadedPaths.size !== roomPaths.length) return;
          const room = summaryFromRecord(id, record, user);
          if (room) rooms.set(id, room);
          else rooms.delete(id);
          onRooms([...rooms.values()].sort((a, b) => a.name.localeCompare(b.name)));
        };
        const failRoom = (error: unknown) => {
          if (currentGeneration !== generation) return;
          onError(error);
        };
        roomPaths.forEach((path) => {
          const unsubscribePart = onValue(
            ref(db, `rooms/${id}/${path}`),
            (partSnapshot) => {
              if (currentGeneration !== generation) return;
              record[path] = partSnapshot.val() || undefined;
              loadedPaths.add(path);
              updateRoom();
            },
            failRoom,
          );
          roomUnsubscribers.push(unsubscribePart);
        });
      }
    },
    onError,
  );
  return () => {
    generation++;
    unsubscribeIndex();
    roomUnsubscribers.forEach((unsubscribe) => unsubscribe());
  };
}
