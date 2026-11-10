const socket = io();
const GRID_SIZE = 16;
const DEFAULT_TANK_COLOR = "#0e37a8";
let selectedAction = null;
let playerName = "";
let playerColor = DEFAULT_TANK_COLOR;
let currentGameState = { tanks: [] };

function getReadableTextColor(hexColor) {
    const normalized = (hexColor || DEFAULT_TANK_COLOR).replace("#", "").trim();
    const safeHex = normalized.length === 3
        ? normalized.split("").map((char) => char + char).join("")
        : normalized;

    if (!/^[0-9a-fA-F]{6}$/.test(safeHex)) {
        return "#ffffff";
    }

    const red = parseInt(safeHex.substring(0, 2), 16);
    const green = parseInt(safeHex.substring(2, 4), 16);
    const blue = parseInt(safeHex.substring(4, 6), 16);
    const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;

    return luminance > 0.65 ? "#111111" : "#ffffff";
}

function joinGame() {
    const input = document.getElementById("username-input");
    const colorInput = document.getElementById("color-input");
    const name = input.value.trim();
    if (!name) return alert("Enter a name!");

    playerName = name;
    playerColor = colorInput.value || DEFAULT_TANK_COLOR;
    document.getElementById("user-name").textContent = playerName;

    document.getElementById("login-screen").style.display = "none";
    document.getElementById("game-container").style.display = "block";

    socket.emit("player-join", { name: playerName, color: playerColor });
}

socket.on("update-board", (gameState) => {
    currentGameState = gameState;
    buildGrid();
});

function buildGrid() {
    const board = document.getElementById("grid-board");
    board.innerHTML = "";

    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const cell = document.createElement("div");
            cell.classList.add("cell");
            cell.dataset.x = x;
            cell.dataset.y = y;

            const occupant = currentGameState.tanks.find(t => t.x === x && t.y === y);
            if (occupant) {
                const tankColor = occupant.color || DEFAULT_TANK_COLOR;
                cell.classList.add("has-tank");
                cell.textContent = occupant.name.substring(0, 3).toUpperCase();
                cell.title = `${occupant.name} (${x}, ${y})`;
                cell.style.backgroundColor = tankColor;
                cell.style.color = getReadableTextColor(tankColor);
                cell.style.fontWeight = "bold";
            } else {
                cell.textContent = `${x},${y}`;
                cell.style.backgroundColor = "";
                cell.style.color = "#222222";
                cell.style.fontWeight = "normal";
            }

            cell.addEventListener("click", () => handleCellClick(x, y));
            board.appendChild(cell);
        }
    }
}

function selectAction(actionType) {
    selectedAction = actionType;
    document.getElementById("action-instruction").textContent = `Selected: ${selectedAction}. Click a grid cell.`;
}

function handleCellClick(x, y) {
    if (!selectedAction) return alert("Select an action first.");

    socket.emit("player-action", { name: playerName, action: selectedAction, target: { x, y } });

    selectedAction = null;
    document.getElementById("action-instruction").textContent = "Select an action, then click a tile.";
}