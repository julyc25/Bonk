import { io } from 'socket.io-client';

const socket = io({ autoConnect: false, withCredentials: true });

export default socket;
