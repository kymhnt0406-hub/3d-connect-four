const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname + "/public"));

const rooms = {};

function createBoard() {
  return Array(4).fill(null).map(() =>
    Array(4).fill(null).map(() =>
      Array(4).fill(null)
    )
  );
}

function createRoom() {
  return {
    board: createBoard(),
    turn: "black",
    winner: null,
    winLine: [],
    players: {
      black: null,
      white: null
    }
  };
}

function getState(room) {
  return {
    board: room.board,
    turn: room.turn,
    winner: room.winner,
    winLine: room.winLine,

    // 何人プレイヤーがいるかをクライアントに送る
    playerCount:
      (room.players.black ? 1 : 0) +
      (room.players.white ? 1 : 0)
  };
}

function sendState(roomId) {
  const room = rooms[roomId];

  if (room) {
    io.to(roomId).emit("state", getState(room));
  }
}

io.on("connection", (socket) => {
  const roomId = socket.handshake.query.room || "default";

  if (!rooms[roomId]) {
    rooms[roomId] = createRoom();
  }

  const room = rooms[roomId];

  socket.join(roomId);

  // 役割を決める
  if (!room.players.black) {
    room.players.black = socket.id;
    socket.emit("role", "black");

  } else if (!room.players.white) {
    room.players.white = socket.id;
    socket.emit("role", "white");

  } else {
    socket.emit("role", "spectator");
  }

  // 入室したことを全員に通知
  sendState(roomId);

  socket.on("place", ({ x, y }) => {
    if (room.winner) return;

    // 不正な座標を防ぐ
    if (
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      x < 0 || x > 3 ||
      y < 0 || y > 3
    ) {
      return;
    }

    const myColor =
      room.players.black === socket.id
        ? "black"
        : room.players.white === socket.id
        ? "white"
        : null;

    // 観戦者は置けない
    if (!myColor) return;

    // 自分のターン以外は置けない
    if (myColor !== room.turn) return;

    let z = -1;

    for (let i = 0; i < 4; i++) {
      if (!room.board[i][y][x]) {
        z = i;
        break;
      }
    }

    // その棒が満杯
    if (z === -1) return;

    room.board[z][y][x] = room.turn;

    const result = checkWinner(room.board);

    if (result) {
      room.winner = result.winner;
      room.winLine = result.line;

      sendState(roomId);
      return;
    }

    room.turn =
      room.turn === "black"
        ? "white"
        : "black";

    sendState(roomId);
  });

  socket.on("reset", () => {
    // 観戦者によるリセットを禁止
    const isPlayer =
      room.players.black === socket.id ||
      room.players.white === socket.id;

    if (!isPlayer) return;

    room.board = createBoard();
    room.turn = "black";
    room.winner = null;
    room.winLine = [];

    sendState(roomId);
  });

  socket.on("disconnect", () => {
    if (room.players.black === socket.id) {
      room.players.black = null;
    }

    if (room.players.white === socket.id) {
      room.players.white = null;
    }

    // 残った人に退出を反映
    sendState(roomId);

    // 誰もいなくなった部屋は削除
    const socketsInRoom = io.sockets.adapter.rooms.get(roomId);

    if (!socketsInRoom || socketsInRoom.size === 0) {
      delete rooms[roomId];
    }
  });
});

function checkWinner(board) {
  const lines = generateWinningLines();

  for (const line of lines) {
    const [a, b, c, d] = line;

    const color = board[a[2]][a[1]][a[0]];

    if (
      color &&
      board[b[2]][b[1]][b[0]] === color &&
      board[c[2]][c[1]][c[0]] === color &&
      board[d[2]][d[1]][d[0]] === color
    ) {
      return {
        winner: color,
        line
      };
    }
  }

  return null;
}

function generateWinningLines() {
  const lines = [];

  const dirs = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],

    [1, 1, 0],
    [1, -1, 0],

    [1, 0, 1],
    [1, 0, -1],

    [0, 1, 1],
    [0, 1, -1],

    [1, 1, 1],
    [1, 1, -1],
    [1, -1, 1],
    [1, -1, -1]
  ];

  for (let z = 0; z < 4; z++) {
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        for (const [dx, dy, dz] of dirs) {
          const line = [];

          for (let i = 0; i < 4; i++) {
            const nx = x + dx * i;
            const ny = y + dy * i;
            const nz = z + dz * i;

            if (
              nx < 0 || nx >= 4 ||
              ny < 0 || ny >= 4 ||
              nz < 0 || nz >= 4
            ) {
              break;
            }

            line.push([nx, ny, nz]);
          }

          if (line.length === 4) {
            lines.push(line);
          }
        }
      }
    }
  }

  return lines;
}

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});