import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const socket = io({
  query: {
    room: new URLSearchParams(location.search).get("room") || "default"
  }
});

let state = null;
let oldBoard = null;
let myRole = null;
let pieces = {};
let fallingPieces = [];
let winLine = [];
let winSoundPlayed = false;

let selectedMove = null;
let selectedMarker = null;
let previewPiece = null;
let bgmOn = true;

const infoEl = document.getElementById("info");
const turnEl = document.getElementById("turn");
const area = document.getElementById("gameArea");
const bgmToggleBtn = document.getElementById("bgmToggle");

// 音
const bgm = new Audio("bgm.mp3");
bgm.loop = true;
bgm.volume = 0.25;

const putSound = new Audio("put.mp3");
putSound.volume = 0.8;

const winSound = new Audio("win.mp3");
winSound.volume = 0.8;

window.addEventListener("click", () => {
  if (bgmOn) bgm.play().catch(() => {});
}, { once: true });

// 3D基本設定
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf5f5f5);

const camera = new THREE.PerspectiveCamera(
  45,
  area.clientWidth / area.clientHeight,
  0.1,
  100
);
camera.position.set(5, 6, 8);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(area.clientWidth, area.clientHeight);
renderer.shadowMap.enabled = true;
area.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 1.5, 0);

const light = new THREE.DirectionalLight(0xffffff, 1.2);
light.position.set(5, 8, 5);
light.castShadow = true;
scene.add(light);

scene.add(new THREE.AmbientLight(0xffffff, 0.65));

const boardGroup = new THREE.Group();
scene.add(boardGroup);

const spacing = 1.35;
const levelGap = 0.75;

const woodMat = new THREE.MeshStandardMaterial({
  color: 0x9b5f2e,
  roughness: 0.45
});

const pegMat = new THREE.MeshStandardMaterial({
  color: 0xd8b077,
  roughness: 0.35
});

const blackMat = new THREE.MeshStandardMaterial({
  color: 0x050505,
  roughness: 0.25,
  metalness: 0.1
});

const whiteMat = new THREE.MeshStandardMaterial({
  color: 0xf2eee5,
  roughness: 0.2,
  metalness: 0.05
});

const winBlackMat = new THREE.MeshStandardMaterial({
  color: 0x050505,
  emissive: 0xffd700,
  emissiveIntensity: 0.9,
  roughness: 0.2
});

const winWhiteMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  emissive: 0xffd700,
  emissiveIntensity: 0.9,
  roughness: 0.2
});

const selectMat = new THREE.MeshBasicMaterial({
  color: 0xffff00,
  transparent: true,
  opacity: 0.75,
  depthTest: false
});

const previewBlackMat = new THREE.MeshStandardMaterial({
  color: 0x050505,
  transparent: true,
  opacity: 0.35,
  roughness: 0.25
});

const previewWhiteMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0.45,
  roughness: 0.25
});

const clickable = [];

function pos(x, y, z) {
  return {
    x: (x - 1.5) * spacing,
    y: 0.45 + z * levelGap,
    z: (y - 1.5) * spacing
  };
}

function createBoardModel() {
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(5.8, 0.35, 5.8),
    woodMat
  );
  base.position.y = -0.15;
  base.receiveShadow = true;
  boardGroup.add(base);

  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const p = pos(x, y, 0);

      const peg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.07, 3.3, 24),
        pegMat
      );
      peg.position.set(p.x, 1.35, p.z);
      peg.castShadow = true;
      boardGroup.add(peg);

      const hit = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.35, 3.8, 16),
        new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0
        })
      );
      hit.position.set(p.x, 1.4, p.z);
      hit.userData = { x, y };
      boardGroup.add(hit);
      clickable.push(hit);
    }
  }
}

createBoardModel();

function getNextZ(x, y) {
  if (!state) return -1;

  for (let z = 0; z < 4; z++) {
    if (!state.board[z][y][x]) {
      return z;
    }
  }

  return -1;
}

function canPlace(x, y) {
  return getNextZ(x, y) !== -1;
}

function showSelectedMarker(x, y) {
  clearSelectedMarker();

  const p = pos(x, y, 0);

  selectedMarker = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.28, 3.8, 32),
    selectMat
  );

  selectedMarker.position.set(p.x, 1.4, p.z);
  selectedMarker.renderOrder = 999;
  boardGroup.add(selectedMarker);
}

function showPreviewPiece(x, y) {
  clearPreviewPiece();

  const z = getNextZ(x, y);
  if (z === -1) return;

  const p = pos(x, y, z);

  previewPiece = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 32, 32),
    myRole === "black" ? previewBlackMat : previewWhiteMat
  );

  previewPiece.position.set(p.x, p.y, p.z);
  previewPiece.renderOrder = 1000;
  boardGroup.add(previewPiece);
}

function clearSelectedMarker() {
  if (selectedMarker) {
    boardGroup.remove(selectedMarker);
    selectedMarker = null;
  }

  clearPreviewPiece();
}

function clearPreviewPiece() {
  if (previewPiece) {
    boardGroup.remove(previewPiece);
    previewPiece = null;
  }
}

// 入力
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function handleInput(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();

  mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);

  const hits = raycaster.intersectObjects(clickable);

  if (hits.length > 0 && !state?.winner) {
    if (myRole !== state.turn) {
      infoEl.textContent =
        myRole === "spectator" ? "観戦中です" : "相手の番です";
      return;
    }

    const { x, y } = hits[0].object.userData;

    if (!canPlace(x, y)) {
      infoEl.textContent = "この棒にはもう置けません";
      return;
    }

    handleSelect(x, y);
  }
}

function handleSelect(x, y) {
  if (
    selectedMove &&
    selectedMove.x === x &&
    selectedMove.y === y
  ) {
    socket.emit("place", { x, y });
    selectedMove = null;
    clearSelectedMarker();
    return;
  }

  selectedMove = { x, y };
  showSelectedMarker(x, y);
  showPreviewPiece(x, y);
  infoEl.textContent = "選択中：もう一度タップで確定";
}

renderer.domElement.addEventListener("click", (event) => {
  handleInput(event.clientX, event.clientY);
});

renderer.domElement.addEventListener("touchstart", (event) => {
  event.preventDefault();
  const touch = event.touches[0];
  handleInput(touch.clientX, touch.clientY);
}, { passive: false });

socket.on("role", (role) => {
  myRole = role;
});

socket.on("state", (s) => {
  oldBoard = state ? JSON.parse(JSON.stringify(state.board)) : null;
  state = s;
  winLine = state.winLine || [];

  updatePieces();

  if (oldBoard && JSON.stringify(oldBoard) !== JSON.stringify(state.board)) {
    putSound.currentTime = 0;
    putSound.play().catch(() => {});
  }

  if (state.winner) {
    infoEl.textContent = `${state.winner === "black" ? "黒" : "白"}の勝ち！`;

    if (turnEl) {
      turnEl.textContent = "ゲーム終了";
    }

    if (!winSoundPlayed) {
      bgm.pause();
      winSound.currentTime = 0;
      winSound.play().catch(() => {});
      winSoundPlayed = true;
    }
  } else {
    winSoundPlayed = false;

    if (turnEl) {
      turnEl.textContent =
        `あなた：${roleText(myRole)} / 今の番：${state.turn === "black" ? "黒" : "白"}`;
    }

    if (myRole === "spectator") {
      infoEl.textContent = "観戦中です";
    } else if (myRole === state.turn) {
      infoEl.textContent = "あなたの番です";
    } else {
      infoEl.textContent = "相手の番です";
    }
  }
});

function roleText(role) {
  if (role === "black") return "黒";
  if (role === "white") return "白";
  return "観戦者";
}

function isWinningPiece(x, y, z) {
  return winLine.some(([wx, wy, wz]) =>
    wx === x && wy === y && wz === z
  );
}

function updatePieces() {
  for (let z = 0; z < 4; z++) {
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const color = state.board[z][y][x];
        const key = `${x}-${y}-${z}`;

        if (color && !pieces[key]) {
          const p = pos(x, y, z);

          const material =
            color === "black" ? blackMat : whiteMat;

          const ball = new THREE.Mesh(
            new THREE.SphereGeometry(0.32, 32, 32),
            material
          );

          ball.position.set(p.x, 4.2, p.z);
          ball.castShadow = true;
          ball.receiveShadow = true;

          boardGroup.add(ball);
          pieces[key] = ball;

          fallingPieces.push({
            mesh: ball,
            targetY: p.y,
            velocity: 0,
            gravity: 0.035
          });
        }

        if (color && pieces[key]) {
          pieces[key].material = isWinningPiece(x, y, z)
            ? (color === "black" ? winBlackMat : winWhiteMat)
            : (color === "black" ? blackMat : whiteMat);
        }

        if (!color && pieces[key]) {
          boardGroup.remove(pieces[key]);
          delete pieces[key];
        }
      }
    }
  }
}

document.getElementById("reset").onclick = () => {
  selectedMove = null;
  clearSelectedMarker();

  winSoundPlayed = false;
  winSound.pause();
  winSound.currentTime = 0;

  if (bgmOn) bgm.play().catch(() => {});
  socket.emit("reset");
};

bgmToggleBtn.onclick = () => {
  bgmOn = !bgmOn;

  if (bgmOn) {
    bgm.play().catch(() => {});
    bgmToggleBtn.textContent = "BGM OFF";
  } else {
    bgm.pause();
    bgmToggleBtn.textContent = "BGM ON";
  }
};

function animate() {
  requestAnimationFrame(animate);

  fallingPieces = fallingPieces.filter(item => {
    item.velocity += item.gravity;
    item.mesh.position.y -= item.velocity;

    if (item.mesh.position.y <= item.targetY) {
      item.mesh.position.y = item.targetY;
      return false;
    }

    return true;
  });

  controls.update();
  renderer.render(scene, camera);
}

animate();

window.addEventListener("resize", () => {
  camera.aspect = area.clientWidth / area.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(area.clientWidth, area.clientHeight);
});