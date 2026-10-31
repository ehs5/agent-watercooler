import { EventEmitter } from "node:events";
import type { DatabaseSync } from "node:sqlite";

export type MessageKind = "message" | "event";

export type Message = {
  id: number;
  room: string;
  sender: string;
  kind: MessageKind;
  body: string;
  createdAt: string;
};

export type RoomSummary = {
  name: string;
  topic: string;
  createdBy: string;
  createdAt: string;
  members: string[];
  messageCount: number;
  lastMessageAt: string;
  // Last message or event, such as someone leaving
  lastActivityAt: string;
  archived: boolean;
};

// Something an agent can take, like an issue, a branch, a file or a test environment. owner is "" while it's open.
export type Claim = {
  id: number;
  room: string;
  name: string;
  type: string;
  description: string;
  owner: string;
  createdBy: string;
  createdAt: string;
  takenAt: string;
};

const ROOM_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MEMBER_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const MAX_TOPIC_LENGTH = 200;
const MAX_BODY_LENGTH = 8000;
const HISTORY_ON_JOIN = 50;
const ARCHIVE_AFTER_MS = 10 * 60 * 1000;
const MAX_CLAIM_NAME_LENGTH = 100;
const MAX_CLAIM_TYPE_LENGTH = 40;
const MAX_CLAIM_DESCRIPTION_LENGTH = 500;

const MESSAGE_COLUMNS = "id, room, sender, kind, body, created_at AS createdAt";
const CLAIM_COLUMNS =
  "id, room, name, type, description, owner, created_by AS createdBy, created_at AS createdAt, taken_at AS takenAt";

/** Rooms, members and messages in SQLite, plus a live feed of new messages for waiters and streams. */
export class ChatService {
  private readonly events = new EventEmitter();

  constructor(private readonly db: DatabaseSync) {
    // Every waiting agent and every open browser tab adds a listener.
    this.events.setMaxListeners(0);
  }

  /**
   * Returns all rooms with their current members, newest activity first.
   * A room is archived once nobody is in it and nothing has happened there for 10 minutes; joining it again makes it active.
   */
  listRooms(now: number = Date.now()): RoomSummary[] {
    const rows = this.db
      .prepare(
        `SELECT r.name, r.topic, r.created_by AS createdBy, r.created_at AS createdAt,
                COUNT(m.id) AS messageCount, COALESCE(MAX(m.created_at), r.created_at) AS lastMessageAt,
                COALESCE((SELECT MAX(created_at) FROM messages WHERE room = r.name), r.created_at) AS lastActivityAt
         FROM rooms r LEFT JOIN messages m ON m.room = r.name AND m.kind = 'message'
         GROUP BY r.name
         ORDER BY lastMessageAt DESC`,
      )
      .all() as Omit<RoomSummary, "members" | "archived">[];

    const rooms: RoomSummary[] = [];
    for (const row of rows) {
      const members: string[] = this.getActiveMembers(row.name);
      const quiet: boolean = now - Date.parse(row.lastActivityAt) >= ARCHIVE_AFTER_MS;
      rooms.push({ ...row, members, archived: members.length === 0 && quiet });
    }
    return rooms;
  }

  /** Returns one room, or throws if it doesn't exist. */
  getRoom(room: string): RoomSummary {
    const found: RoomSummary | undefined = this.listRooms().find((r) => r.name === room);
    if (!found) throw new Error(`Room "${room}" doesn't exist. Use list_rooms to see the rooms.`);
    return found;
  }

  /** Creates a room and joins its creator to it. Returns the creator's view of the room's history. */
  createRoom(room: string, topic: string, creator: string): Message[] {
    if (!ROOM_NAME.test(room)) {
      throw new Error(
        `Room names use lowercase letters, digits and hyphens, up to 64 characters. "${room}" doesn't.`,
      );
    }
    if (topic.length > MAX_TOPIC_LENGTH)
      throw new Error(`The topic can be at most ${MAX_TOPIC_LENGTH} characters.`);
    this.assertMemberName(creator);
    if (this.roomExists(room))
      throw new Error(`Room "${room}" already exists. Join it with join_room.`);

    this.db
      .prepare("INSERT INTO rooms (name, topic, created_by, created_at) VALUES (?, ?, ?, ?)")
      .run(room, topic.trim(), creator, new Date().toISOString());

    this.insertMessage(room, creator, "event", `${creator} created the room`);

    // "created the room" already says the creator is in it, so no separate "joined" event
    this.activateMember(room, creator);
    return this.getRecentMessages(room, HISTORY_ON_JOIN);
  }

  /** Joins member to room and returns the room's recent history. Joining a room you're already in just returns the history. */
  joinRoom(room: string, member: string): Message[] {
    this.assertMemberName(member);
    if (!this.roomExists(room))
      throw new Error(`Room "${room}" doesn't exist. Create it with create_room.`);

    const alreadyActive: boolean = this.isInRoom(room, member);
    this.activateMember(room, member);

    if (!alreadyActive) this.insertMessage(room, member, "event", `${member} joined`);
    return this.getRecentMessages(room, HISTORY_ON_JOIN);
  }

  /** Removes member from room. They stop getting its messages until they join again. */
  leaveRoom(room: string, member: string): void {
    this.assertActiveMember(room, member);

    this.db
      .prepare("UPDATE members SET active = 0 WHERE room = ? AND member = ?")
      .run(room, member);
    this.insertMessage(room, member, "event", `${member} left`);
  }

  /** Posts a message from sender, who must be in the room. */
  postMessage(room: string, sender: string, body: string): Message {
    const text: string = body.trim();
    if (!text) throw new Error("The message is empty.");
    if (text.length > MAX_BODY_LENGTH)
      throw new Error(`Messages can be at most ${MAX_BODY_LENGTH} characters.`);
    this.assertActiveMember(room, sender);

    return this.insertMessage(room, sender, "message", text);
  }

  /** Returns messages from others that member hasn't read yet, in one room or (room "") all their rooms, and marks them read. */
  readUnread(member: string, room: string): Message[] {
    const rooms: string[] = this.getRoomsToRead(member, room);

    const unread: Message[] = [];
    for (const name of rooms) {
      const rows = this.db
        .prepare(
          `SELECT ${MESSAGE_COLUMNS} FROM messages
           WHERE room = ? AND sender <> ?
             AND id > (SELECT last_read_id FROM members WHERE room = ? AND member = ?)
           ORDER BY id`,
        )
        .all(name, member, name, member) as Message[];

      unread.push(...rows);
      this.db
        .prepare("UPDATE members SET last_read_id = ? WHERE room = ? AND member = ?")
        .run(this.getLatestId(name), name, member);
    }
    return unread.sort((a, b) => a.id - b.id);
  }

  /** Like readUnread, but when nothing is unread it waits up to timeoutMs for a message from someone else. Returns [] on timeout or abort. */
  async waitForUnread(
    member: string,
    room: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<Message[]> {
    const unread: Message[] = this.readUnread(member, room);
    if (unread.length > 0) return unread;

    const rooms: string[] = this.getRoomsToRead(member, room);
    await this.waitForMessage(
      timeoutMs,
      signal,
      (message) => message.sender !== member && rooms.includes(message.room),
    );
    return this.readUnread(member, room);
  }

  /** Returns a room's messages after afterId, oldest first. */
  getMessages(room: string, afterId: number): Message[] {
    if (!this.roomExists(room)) throw new Error(`Room "${room}" doesn't exist.`);

    return this.db
      .prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE room = ? AND id > ? ORDER BY id`)
      .all(room, afterId) as Message[];
  }

  /** Defines a claim in the room, open for anyone to take. member must be in the room, and the name must be new there. */
  defineClaim(
    room: string,
    member: string,
    name: string,
    type: string,
    description: string,
  ): Claim {
    this.assertActiveMember(room, member);
    name = this.requireClaimText(name, "name", MAX_CLAIM_NAME_LENGTH);
    type = this.requireClaimText(type, "type", MAX_CLAIM_TYPE_LENGTH);
    description = description.trim();
    if (description.length > MAX_CLAIM_DESCRIPTION_LENGTH)
      throw new Error(`The description can be at most ${MAX_CLAIM_DESCRIPTION_LENGTH} characters.`);
    if (this.findClaim(room, name))
      throw new Error(`"${name}" is already a claim in room "${room}". Take it with take_claim.`);

    this.db
      .prepare(
        "INSERT INTO claims (room, name, type, description, owner, created_by, created_at, taken_at) VALUES (?, ?, ?, ?, '', ?, ?, '')",
      )
      .run(room, name, type, description, member, new Date().toISOString());

    this.insertMessage(room, member, "event", `${member} defined the claim ${name} (${type})`);
    return this.getClaim(room, name);
  }

  /** Makes member the owner of an open claim. Taking your own claim again changes nothing; taking someone else's throws, naming them. */
  takeClaim(room: string, member: string, name: string): Claim {
    this.assertActiveMember(room, member);
    const claim: Claim = this.getClaim(room, name);
    if (claim.owner === member) return claim;
    if (claim.owner)
      throw new Error(
        `${name} is taken by ${claim.owner}. Ask them in the room to release it, or ask the user.`,
      );

    this.db
      .prepare("UPDATE claims SET owner = ?, taken_at = ? WHERE id = ?")
      .run(member, new Date().toISOString(), claim.id);

    this.insertMessage(room, member, "event", `${member} took ${name}`);
    return this.getClaim(room, name);
  }

  /** Makes member's claim open again. Works after member has left the room, so a claim can be released once the work is done. */
  releaseClaim(room: string, member: string, name: string): Claim {
    const claim: Claim = this.getClaim(room, name);
    if (claim.owner !== member) {
      const holder: string = claim.owner ? `${claim.owner} has it` : "it's open";
      throw new Error(`${name} isn't yours to release: ${holder}.`);
    }

    this.db.prepare("UPDATE claims SET owner = '', taken_at = '' WHERE id = ?").run(claim.id);
    this.insertMessage(room, member, "event", `${member} released ${name}`);
    return this.getClaim(room, name);
  }

  /** Returns the claims in one room or (room "") all rooms, in the order they were defined. */
  listClaims(room: string = ""): Claim[] {
    if (!room)
      return this.db.prepare(`SELECT ${CLAIM_COLUMNS} FROM claims ORDER BY id`).all() as Claim[];
    return this.db
      .prepare(`SELECT ${CLAIM_COLUMNS} FROM claims WHERE room = ? ORDER BY id`)
      .all(room) as Claim[];
  }

  /** Calls listener for every new message and event. Returns a function that stops listening. */
  onMessage(listener: (message: Message) => void): () => void {
    this.events.on("message", listener);
    return () => this.events.off("message", listener);
  }

  /** Resolves when a message matching accept arrives, the timeout passes or signal aborts. */
  private waitForMessage(
    timeoutMs: number,
    signal: AbortSignal | undefined,
    accept: (message: Message) => boolean,
  ) {
    const events: EventEmitter = this.events;

    return new Promise<void>((resolve) => {
      const timer = setTimeout(finish, timeoutMs);

      function onMessage(message: Message) {
        if (!accept(message)) return;
        finish();
      }

      function finish() {
        clearTimeout(timer);
        events.off("message", onMessage);
        signal?.removeEventListener("abort", finish);
        resolve();
      }

      events.on("message", onMessage);
      signal?.addEventListener("abort", finish, { once: true });
    });
  }

  /** Returns the rooms readUnread should look in, or throws if member isn't in them. */
  private getRoomsToRead(member: string, room: string): string[] {
    if (room) {
      this.assertActiveMember(room, member);
      return [room];
    }

    const rows = this.db
      .prepare("SELECT room FROM members WHERE member = ? AND active = 1 ORDER BY room")
      .all(member) as { room: string }[];

    if (rows.length === 0)
      throw new Error(`${member} isn't in any rooms. Join one with join_room.`);
    return rows.map((row) => row.room);
  }

  /** Puts member in the room with everything so far marked read. The history is returned on join, so the member starts with nothing unread. */
  private activateMember(room: string, member: string): void {
    this.db
      .prepare(
        `INSERT INTO members (room, member, active, last_read_id) VALUES (?, ?, 1, ?)
         ON CONFLICT (room, member) DO UPDATE SET active = 1, last_read_id = excluded.last_read_id`,
      )
      .run(room, member, this.getLatestId(room));
  }

  /** Stores a message and tells listeners about it. */
  private insertMessage(room: string, sender: string, kind: MessageKind, body: string): Message {
    const createdAt: string = new Date().toISOString();
    const result = this.db
      .prepare("INSERT INTO messages (room, sender, kind, body, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(room, sender, kind, body, createdAt);

    const message: Message = {
      id: Number(result.lastInsertRowid),
      room,
      sender,
      kind,
      body,
      createdAt,
    };
    this.events.emit("message", message);
    return message;
  }

  /** Returns the last limit messages in a room, oldest first. */
  private getRecentMessages(room: string, limit: number): Message[] {
    const rows = this.db
      .prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE room = ? ORDER BY id DESC LIMIT ?`)
      .all(room, limit) as Message[];
    return rows.reverse();
  }

  /** Returns the names of everyone currently in a room. */
  private getActiveMembers(room: string): string[] {
    const rows = this.db
      .prepare("SELECT member FROM members WHERE room = ? AND active = 1 ORDER BY member")
      .all(room) as { member: string }[];
    return rows.map((row) => row.member);
  }

  /** Returns the id of the newest message in a room, or 0. */
  private getLatestId(room: string): number {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(id), 0) AS id FROM messages WHERE room = ?")
      .get(room) as {
      id: number;
    };
    return row.id;
  }

  /** True if the room exists. */
  private roomExists(room: string): boolean {
    return this.db.prepare("SELECT 1 FROM rooms WHERE name = ?").get(room) !== undefined;
  }

  /** True if member is currently in the room. */
  isInRoom(room: string, member: string): boolean {
    return (
      this.db
        .prepare("SELECT 1 FROM members WHERE room = ? AND member = ? AND active = 1")
        .get(room, member) !== undefined
    );
  }

  /** Throws unless the room exists and member is in it. */
  private assertActiveMember(room: string, member: string): void {
    if (!this.roomExists(room))
      throw new Error(`Room "${room}" doesn't exist. Use list_rooms to see the rooms.`);
    if (!this.isInRoom(room, member))
      throw new Error(`${member} isn't in room "${room}". Join it with join_room.`);
  }

  /** Returns the claim with this name in the room, or undefined. */
  private findClaim(room: string, name: string): Claim | undefined {
    return this.db
      .prepare(`SELECT ${CLAIM_COLUMNS} FROM claims WHERE room = ? AND name = ?`)
      .get(room, name.trim()) as Claim | undefined;
  }

  /** Returns the claim with this name in the room, or throws if there is none. */
  private getClaim(room: string, name: string): Claim {
    if (!this.roomExists(room))
      throw new Error(`Room "${room}" doesn't exist. Use list_rooms to see the rooms.`);
    const claim: Claim | undefined = this.findClaim(room, name);
    if (!claim) throw new Error(`There's no claim "${name}" in room "${room}". See list_claims.`);
    return claim;
  }

  /** Returns value trimmed, or throws if it's empty or longer than max. label names it in the error. */
  private requireClaimText(value: string, label: string, max: number): string {
    const text: string = value.trim();
    if (!text) throw new Error(`The claim needs a ${label}.`);
    if (text.length > max)
      throw new Error(`The claim's ${label} can be at most ${max} characters.`);
    return text;
  }

  /** Throws unless member is a valid name. */
  private assertMemberName(member: string): void {
    if (MEMBER_NAME.test(member)) return;
    throw new Error(
      `Names use letters, digits, dots, hyphens and underscores, up to 40 characters. "${member}" doesn't.`,
    );
  }
}
