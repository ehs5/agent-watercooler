export type Message = {
  id: number;
  room: string;
  sender: string;
  kind: "message" | "event";
  body: string;
  createdAt: string;
};

export type Room = {
  name: string;
  topic: string;
  createdBy: string;
  createdAt: string;
  members: string[];
  messageCount: number;
  lastMessageAt: string;
  lastActivityAt: string;
  // Nobody is in it and it has been quiet for 10 minutes
  archived: boolean;
};

/** Fetches JSON from the server, throwing with the server's error text if the request fails. */
async function getJson<T>(url: string): Promise<T> {
  const response: Response = await fetch(url);
  if (!response.ok)
    throw new Error(`${url} failed with ${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}

/** Returns all rooms, newest activity first. */
export function getRooms(): Promise<Room[]> {
  return getJson<Room[]>("/api/rooms");
}

/** Returns every message in a room, oldest first. */
export function getMessages(room: string): Promise<Message[]> {
  return getJson<Message[]>(`/api/rooms/${encodeURIComponent(room)}/messages`);
}

/**
 * Calls onMessage for every new message in any room until the returned function is called.
 * onStatus reports whether the stream is connected; EventSource reconnects by itself after a drop.
 */
export function watchMessages(
  onMessage: (message: Message) => void,
  onStatus: (live: boolean) => void,
): () => void {
  const source = new EventSource("/api/stream");

  source.addEventListener("open", () => onStatus(true));
  source.addEventListener("error", () => onStatus(false));
  source.addEventListener("message", (event: MessageEvent<string>) =>
    onMessage(JSON.parse(event.data) as Message),
  );
  return () => source.close();
}
