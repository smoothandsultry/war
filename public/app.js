const socket = io();
const GRID_SIZE = 20;
const DEFAULT_TANK_COLOR = "#0e37a8";
let selectedAction = null;
let playerName = "";
let playerColor = DEFAULT_TANK_COLOR;
let currentGameState = { tanks: [] };
let previousTankPositions = new Map();

function isCellOccupied(x, y, ignoreName = null) {
    const occupied = currentGameState.tanks.find((tank) => !tank.eliminated && tank.x === x && tank.y === y && tank.name !== ignoreName);
    return Boolean(occupied);
}

function getValidMoveCells(currentTank) {
    if (!currentTank) return [];
    const cells = [];
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const distance = Math.max(Math.abs(currentTank.x - x), Math.abs(currentTank.y - y));
            if (distance === 1 && !isCellOccupied(x, y, currentTank.name)) {
                cells.push({ x, y });
            }
        }
    }
    return cells;
}

function getDistanceFromTank(currentTank, x, y) {
    return Math.sqrt((currentTank.x - x) ** 2 + (currentTank.y - y) ** 2);
}

function getValidTargetCells(currentTank, actionType) {
    if (!currentTank) return [];
    const range = actionType === "SHOOT" ? (currentTank.range || 1) : (currentTank.range || 2);
    const cells = [];
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const distance = getDistanceFromTank(currentTank, x, y);
            if (distance <= range) {
                cells.push({ x, y });
            }
        }
    }
    return cells;
}

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

function getTimeOfDayPalette() {
    const hour = new Date().getHours();

    if (hour >= 5 && hour < 10) {
        return {
            pageBgTop: "#eaf5ff",
            pageBgBottom: "#d5e6ff",
            boardBg: "rgba(255, 255, 255, 0.34)",
            gridGlow: "rgba(108, 147, 255, 0.16)",
            cellBase: "#eaf0fb",
            cellHover: "#d9e8ff",
            labelColor: "#4d627e",
            panelBg: "rgba(255, 255, 255, 0.22)",
            panelBorder: "rgba(255, 255, 255, 0.28)",
            panelInner: "rgba(227, 234, 250, 0.7)",
            panelText: "#182334",
            panelMuted: "#586b8e",
            userPillBg: "rgba(202, 214, 236, 0.9)",
            userPillText: "#243750",
            apBadgeBg: "rgba(196, 210, 240, 0.9)",
            apBadgeText: "#2d3c59",
            actionBg: "rgba(196, 208, 233, 0.9)",
            actionSelected: "rgba(145, 175, 235, 0.96)",
            actionBorder: "rgba(92, 122, 188, 0.32)",
            actionText: "#1c273a",
            actionSubtext: "#475b7d",
            actionCostBg: "rgba(57, 73, 101, 0.12)",
            actionCostText: "#3d4a63"
        };
    }

    if (hour >= 10 && hour < 16) {
        return {
            pageBgTop: "#dff7ff",
            pageBgBottom: "#cfe8ff",
            boardBg: "rgba(255, 255, 255, 0.28)",
            gridGlow: "rgba(65, 136, 203, 0.18)",
            cellBase: "#edf6ff",
            cellHover: "#dfeeff",
            labelColor: "#39607b",
            panelBg: "rgba(255, 255, 255, 0.22)",
            panelBorder: "rgba(255, 255, 255, 0.28)",
            panelInner: "rgba(227, 234, 250, 0.7)",
            panelText: "#1a2b3d",
            panelMuted: "#5b728e",
            userPillBg: "rgba(201, 215, 239, 0.9)",
            userPillText: "#243750",
            apBadgeBg: "rgba(195, 209, 236, 0.9)",
            apBadgeText: "#2d3c59",
            actionBg: "rgba(194, 207, 230, 0.9)",
            actionSelected: "rgba(142, 172, 232, 0.96)",
            actionBorder: "rgba(92, 122, 188, 0.32)",
            actionText: "#1c273a",
            actionSubtext: "#475b7d",
            actionCostBg: "rgba(57, 73, 101, 0.12)",
            actionCostText: "#3d4a63"
        };
    }

    if (hour >= 16 && hour < 20) {
        return {
            pageBgTop: "#fce6c6",
            pageBgBottom: "#f0b98a",
            boardBg: "rgba(255, 240, 219, 0.38)",
            gridGlow: "rgba(166, 101, 52, 0.2)",
            cellBase: "#f8e5d1",
            cellHover: "#f1cfac",
            labelColor: "#6d4d35",
            panelBg: "rgba(245, 233, 214, 0.36)",
            panelBorder: "rgba(146, 111, 74, 0.2)",
            panelInner: "rgba(239, 224, 201, 0.72)",
            panelText: "#31251b",
            panelMuted: "#6a4d3d",
            userPillBg: "rgba(217, 201, 172, 0.9)",
            userPillText: "#332b26",
            apBadgeBg: "rgba(214, 191, 153, 0.9)",
            apBadgeText: "#342a26",
            actionBg: "rgba(217, 200, 173, 0.9)",
            actionSelected: "rgba(186, 149, 96, 0.94)",
            actionBorder: "rgba(120, 89, 62, 0.24)",
            actionText: "#2f241d",
            actionSubtext: "#5f4d3d",
            actionCostBg: "rgba(69, 52, 35, 0.14)",
            actionCostText: "#493d2d"
        };
    }

    if (hour >= 20 && hour < 23) {
        return {
            pageBgTop: "#1e2b52",
            pageBgBottom: "#0c132f",
            boardBg: "rgba(12, 20, 35, 0.9)",
            gridGlow: "rgba(163, 182, 255, 0.18)",
            cellBase: "#1a2942",
            cellHover: "#223a5a",
            labelColor: "#d9e6ff",
            panelBg: "rgba(17, 24, 39, 0.72)",
            panelBorder: "rgba(121, 139, 178, 0.42)",
            panelInner: "rgba(29, 39, 59, 0.86)",
            panelText: "#edf2ff",
            panelMuted: "#c7d2ec",
            userPillBg: "rgba(31, 42, 58, 0.9)",
            userPillText: "#edf2ff",
            apBadgeBg: "rgba(42, 55, 74, 0.9)",
            apBadgeText: "#edf2ff",
            actionBg: "rgba(28, 39, 55, 0.96)",
            actionSelected: "rgba(69, 94, 145, 0.96)",
            actionBorder: "rgba(128, 153, 202, 0.42)",
            actionText: "#edf2ff",
            actionSubtext: "#c9d7ff",
            actionCostBg: "rgba(8, 14, 25, 0.64)",
            actionCostText: "#dfeaff"
        };
    }

    return {
        pageBgTop: "#0a1021",
        pageBgBottom: "#050b16",
        boardBg: "rgba(12, 20, 35, 0.9)",
        gridGlow: "rgba(120, 154, 255, 0.18)",
        cellBase: "#18263e",
        cellHover: "#21385a",
        labelColor: "#dfeaff",
        panelBg: "rgba(13, 21, 37, 0.72)",
        panelBorder: "rgba(127, 147, 189, 0.36)",
        panelInner: "rgba(20, 30, 47, 0.88)",
        panelText: "#edf2ff",
        panelMuted: "#cfe0ff",
        userPillBg: "rgba(25, 35, 52, 0.9)",
        userPillText: "#edf2ff",
        apBadgeBg: "rgba(22, 31, 46, 0.92)",
        apBadgeText: "#edf2ff",
        actionBg: "rgba(22, 34, 51, 0.96)",
        actionSelected: "rgba(55, 80, 118, 0.96)",
        actionBorder: "rgba(127, 147, 189, 0.42)",
        actionText: "#edf2ff",
        actionSubtext: "#cfe0ff",
        actionCostBg: "rgba(8, 16, 26, 0.68)",
        actionCostText: "#dfeaff"
    };
}

function applyTimeOfDayTheme() {
    const palette = getTimeOfDayPalette();
    const root = document.documentElement;

    root.style.setProperty("--page-bg-top", palette.pageBgTop);
    root.style.setProperty("--page-bg-bottom", palette.pageBgBottom);
    root.style.setProperty("--board-bg", palette.boardBg);
    root.style.setProperty("--grid-glow", palette.gridGlow);
    root.style.setProperty("--cell-base", palette.cellBase);
    root.style.setProperty("--cell-hover", palette.cellHover);
    root.style.setProperty("--label-color", palette.labelColor);
    root.style.setProperty("--command-panel-bg", palette.panelBg);
    root.style.setProperty("--command-panel-border", palette.panelBorder);
    root.style.setProperty("--command-panel-inner", palette.panelInner);
    root.style.setProperty("--command-panel-text", palette.panelText);
    root.style.setProperty("--command-panel-muted", palette.panelMuted);
    root.style.setProperty("--user-pill-bg", palette.userPillBg);
    root.style.setProperty("--user-pill-text", palette.userPillText);
    root.style.setProperty("--ap-badge-bg", palette.apBadgeBg);
    root.style.setProperty("--ap-badge-text", palette.apBadgeText);
    root.style.setProperty("--action-card-bg", palette.actionBg);
    root.style.setProperty("--action-card-selected", palette.actionSelected);
    root.style.setProperty("--action-card-border", palette.actionBorder);
    root.style.setProperty("--action-card-text", palette.actionText);
    root.style.setProperty("--action-card-subtext", palette.actionSubtext);
    root.style.setProperty("--action-cost-bg", palette.actionCostBg);
    root.style.setProperty("--action-cost-text", palette.actionCostText);
}

function renderBoardRuler() {
    const topLabels = document.getElementById('board-top-labels');
    const sideLabels = document.getElementById('board-side-labels');
    
    topLabels.innerHTML = '';
    sideLabels.innerHTML = '';

    for (let i = 1; i <= 20; i++) {
        const topSpan = document.createElement('span');
        topSpan.textContent = i;
        topLabels.appendChild(topSpan);

        const sideSpan = document.createElement('span');
        sideSpan.textContent = i;
        sideLabels.appendChild(sideSpan);
    }
}

applyTimeOfDayTheme();
setInterval(applyTimeOfDayTheme, 60000);

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
    renderBoardRuler();

    socket.emit("player-join", { name: playerName, color: playerColor });
}

function getCurrentTank() {
    return currentGameState.tanks.find(t => t.name === playerName) || null;
}

function syncActionSelectionUI() {
    document.querySelectorAll(".action-card").forEach((button) => {
        const onclick = button.getAttribute("onclick") || "";
        const match = onclick.match(/selectAction\('([^']+)'\)/);
        const actionName = match ? match[1] : null;
        button.classList.toggle("selected", Boolean(selectedAction) && actionName === selectedAction);
    });
}

function renderHealthHearts(heartValue, maxHearts = 3) {
    const heartsEl = document.getElementById("stat-hearts");
    if (!heartsEl) return;

    const safeValue = Math.max(0, Number(heartValue) || 0);
    const safeMax = Math.max(1, Number(maxHearts) || 3);

    const hearts = [];
    for (let i = 0; i < safeMax; i++) {
        const heart = document.createElement("span");
        heart.textContent = "♥";
        heart.classList.toggle("is-empty", i >= safeValue);
        hearts.push(heart);
    }

    heartsEl.innerHTML = "";
    hearts.forEach((heart) => heartsEl.appendChild(heart));
}

function updateStatusUI() {
    const currentTank = getCurrentTank();
    const heartsEl = document.getElementById("stat-hearts");
    const apEl = document.getElementById("stat-ap");
    const rangeEl = document.getElementById("stat-range");

    const isEliminated = !currentTank;
    const currentAp = currentTank ? currentTank.ap : 0;

    if (heartsEl) {
        renderHealthHearts(currentTank ? currentTank.hearts : 0, 3);
    }
    if (apEl) apEl.textContent = currentAp;
    if (rangeEl) rangeEl.textContent = currentTank ? (currentTank.range || 2) : 0;

    const isOutOfAp = isEliminated || (currentTank && currentTank.ap <= 0);

    document.querySelectorAll("button[onclick^='selectAction'], .action-card").forEach((button) => {
        if (isOutOfAp) {
            button.disabled = true;
            button.style.opacity = "0.5";
            button.style.cursor = "not-allowed";
        } else {
            button.disabled = false;
            button.style.opacity = "1";
            button.style.cursor = "pointer";
        }
    });

    syncActionSelectionUI();
}

socket.on("update-board", (gameState) => {
    currentGameState = gameState;
    updateStatusUI();
    buildGrid();
});

function buildGrid() {
    const board = document.getElementById("grid-board");
    board.innerHTML = "";

    const movedCells = new Map();
    const currentPositions = new Map();

    currentGameState.tanks.forEach((tank) => {
        const positionKey = `${tank.x},${tank.y}`;
        currentPositions.set(tank.name, { x: tank.x, y: tank.y });

        const previousPosition = previousTankPositions.get(tank.name);
        if (previousPosition && (previousPosition.x !== tank.x || previousPosition.y !== tank.y)) {
            const dx = tank.x - previousPosition.x;
            const dy = tank.y - previousPosition.y;
            movedCells.set(positionKey, {
                x: dx,
                y: dy
            });
        }
    });

    previousTankPositions = currentPositions;

    const currentTank = getCurrentTank();
    
    const validCells = selectedAction === "MOVE"
        ? getValidMoveCells(currentTank)
        : selectedAction && ["SHOOT", "HEAL", "GIFT"].includes(selectedAction)
            ? getValidTargetCells(currentTank, selectedAction)
            : [];
            
    const validCellSet = new Set(validCells.map(cell => `${cell.x},${cell.y}`));

    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const cell = document.createElement("div");
            cell.classList.add("cell");
            cell.dataset.x = x;
            cell.dataset.y = y;

            const isValidTarget = validCellSet.has(`${x},${y}`);
            if (isValidTarget) {
                cell.classList.add("valid-target");
            }

            const occupant = currentGameState.tanks.find(t => t.x === x && t.y === y);
            if (occupant) {
                const tankColor = occupant.color || DEFAULT_TANK_COLOR;
                cell.classList.add("has-tank");
                const moveDirection = movedCells.get(`${x},${y}`);
                if (moveDirection) {
                    cell.classList.add("tank-moved");
                    cell.style.setProperty("--bounce-x", `${moveDirection.x * 2}px`);
                    cell.style.setProperty("--bounce-y", `${moveDirection.y * 2}px`);
                }
                cell.textContent = occupant.name.substring(0, 3).toUpperCase();
                cell.title = occupant.name;
                cell.style.backgroundColor = tankColor;
                cell.style.color = getReadableTextColor(tankColor);
                cell.style.fontWeight = "bold";
            } else {
                cell.textContent = "";
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
    const currentTank = getCurrentTank();
    const costs = {
        "MOVE": 1,
        "SHOOT": 1,
        "UPGRADE": 3,
        "GIFT": 1
    };

    const actionCost = costs[actionType] || 1;

    if (currentTank && currentTank.ap < actionCost) {
        alert(`Not enough AP! ${actionType} requires ${actionCost} AP, but you only have ${currentTank.ap} AP.`);
        return;
    }

    if (selectedAction === actionType) {
        selectedAction = null;
        syncActionSelectionUI();
        buildGrid();
        document.getElementById("action-instruction").textContent = "Select an action, then click a tile.";
        return;
    }

    selectedAction = actionType;
    syncActionSelectionUI();

    if (actionType === "UPGRADE") {
        socket.emit("player-action", {
            name: playerName,
            action: actionType,
            target: { x: currentTank ? currentTank.x : 0, y: currentTank ? currentTank.y : 0 }
        });
        selectedAction = null;
        syncActionSelectionUI();
        buildGrid();
        document.getElementById("action-instruction").textContent = "Upgrade used.";
        return;
    }

    buildGrid();
    document.getElementById("action-instruction").textContent = `Selected: ${selectedAction}. Click a grid cell.`;
}

function handleCellClick(x, y) {
    const currentTank = getCurrentTank();
    if (!selectedAction) return alert("Select an action first.");
    if (!currentTank || currentTank.ap <= 0) {
        alert("You have no AP left. You cannot use actions.");
        return;
    }

    if (selectedAction === "UPGRADE") {
        selectedAction = null;
        syncActionSelectionUI();
        document.getElementById("action-instruction").textContent = "Select an action, then click a tile.";
        return;
    }
    
    const distance = currentTank ? Math.max(Math.abs(currentTank.x - x), Math.abs(currentTank.y - y)) : 1;

    if (selectedAction === "MOVE") {
        if (distance !== 1) {
            alert("Move only works 1 space away.");
            return;
        }

        if (isCellOccupied(x, y, currentTank.name)) {
            alert("You cannot move onto an occupied cell.");
            return;
        }
    }

    if (["SHOOT", "GIFT"].includes(selectedAction) && distance > (currentTank.range || 2)) {
        alert("That target is out of range.");
        return;
    }

    socket.emit("player-action", { name: playerName, action: selectedAction, target: { x, y } });

    selectedAction = null;
    syncActionSelectionUI();
    buildGrid();
    document.getElementById("action-instruction").textContent = "Select an action, then click a tile.";
}