import { EventEmitter } from "node:events";

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

export function notifyRecipient(recipientName: string): void {
  emitter.emit(`n:${recipientName}`);
}

export function subscribeRecipient(
  recipientName: string,
  handler: () => void,
): () => void {
  const channel = `n:${recipientName}`;
  emitter.on(channel, handler);
  return () => emitter.off(channel, handler);
}
