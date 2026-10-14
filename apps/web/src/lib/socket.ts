'use client';

import { io, type Socket } from 'socket.io-client';
import { getAccessToken } from './api';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

let socket: Socket | null = null;

/** Lazily connect to the /rt namespace, authenticating with the access token. */
export function getSocket(): Socket {
  if (!socket) {
    socket = io(`${API_URL}/rt`, {
      auth: { token: getAccessToken() ?? '' },
      transports: ['websocket'],
      autoConnect: true,
    });
  }
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
