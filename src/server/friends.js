// Hardcoded friend graph, swap when auth is wired up.
// IDs match the ones used in Grid.jsx FRIENDS.
const graph = {
  'you@gmail.com': ['emily@gmail.com', 'clarice@gmail.com', 'julie@gmail.com'],
  'emily@gmail.com': ['you@gmail.com', 'clarice@gmail.com', 'julie@gmail.com'],
  'clarice@gmail.com': ['you@gmail.com', 'emily@gmail.com'],
  'julie@gmail.com': ['you@gmail.com', 'emily@gmail.com'],
};

export const getFriends = (userId) => graph[userId] ?? [];
