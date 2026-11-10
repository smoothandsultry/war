const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    next();
});

app.use(express.static(path.join(__dirname, "public")));

let gameState = {
    tanks: []
};

function getDistance(a, b) {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function getCircularDistance(a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function getActionCost(action) {
    switch (action) {
        case "MOVE":
        case "SHOOT":
        case "HEAL":
            return 1;
        case "UPGRADE":
            return 3;
        default:
            return 0;
    }
}

io.on("connection", (socket) => {
    console.log(`A user connected: ${socket.id}`);

    socket.emit("update-board", gameState);

    socket.on("player-join", (data) => {
        const randomX = Math.floor(Math.random() * 20);
        const randomY = Math.floor(Math.random() * 20);

        const newTank = {
            id: socket.id,
            name: data.name,
            color: data.color || "#0e37a8",
            x: randomX,
            y: randomY,
            hearts: 3,
            ap: 10,
            range: 1
        };

        gameState.tanks.push(newTank);
        console.log(`Commander ${data.name} spawned at (${randomX}, ${randomY}) with color ${newTank.color}`);

        io.emit("update-board", gameState);
    });

    socket.on("player-action", (data) => {
        console.log(`Action received from ${data.name}: ${data.action} at (${data.target.x}, ${data.target.y})`);

        const tank = gameState.tanks.find(t => t.name === data.name);
        if (!tank) return;

        const actionCost = getActionCost(data.action);
        if (tank.ap <= 0 || tank.ap < actionCost) {
            console.log(`Commander ${tank.name} does not have enough AP for ${data.action}`);
            return;
        }

        if (data.action === "MOVE") {
            const distance = getDistance(tank, data.target);
            if (distance !== 1) {
                console.log(`Move invalid: ${data.name} tried to move ${distance} spaces away`);
                return;
            }

            tank.x = data.target.x;
            tank.y = data.target.y;
            tank.ap -= actionCost;
            io.emit("update-board", gameState);
            return;
        }

        if (data.action === "UPGRADE") {
            tank.range = (tank.range || 2) + 1;
            tank.ap -= actionCost;
            console.log(`Commander ${tank.name} upgraded range to ${tank.range}`);
            io.emit("update-board", gameState);
            return;
        }

        if (data.action === "HEAL") {
            const target = gameState.tanks.find(t =>
                t.name !== tank.name &&
                t.x === data.target.x &&
                t.y === data.target.y
            );

            if (!target) {
                console.log(`Invalid heal target: ${data.name} attempted to give AP to ${data.target.x},${data.target.y}`);
                return;
            }

            const distance = getDistance(tank, target);
            if (distance > (tank.range || 2)) {
                console.log(`Heal target out of range: ${distance} spaces away`);
                return;
            }

            tank.ap -= actionCost;
            target.ap += 1;
            console.log(`Commander ${tank.name} gave 1 AP to ${target.name} (${distance} spaces away)`);
            io.emit("update-board", gameState);
            return;
        }

        if (data.action === "SHOOT") {
            const target = gameState.tanks.find(t =>
                t.name !== tank.name &&
                t.x === data.target.x &&
                t.y === data.target.y
            );

            if (!target) {
                console.log(`Invalid shoot target: ${data.name} attempted to shoot ${data.target.x},${data.target.y}`);
                return;
            }

            const distance = getCircularDistance(tank, target);
            if (distance > (tank.range || 2)) {
                console.log(`Shoot target out of range: ${distance} spaces away`);
                return;
            }

            tank.ap -= actionCost;
            target.hearts -= 1;
            console.log(`Commander ${tank.name} shot ${target.name} for 1 damage (${distance} spaces away)`);

            if (target.hearts <= 0) {
                console.log(`Commander ${target.name} was eliminated`);
                gameState.tanks = gameState.tanks.filter(t => t.name !== target.name);
            }

            io.emit("update-board", gameState);
        }
    });

    socket.on("disconnect", () => {
        console.log(`User disconnected: ${socket.id}`);
        gameState.tanks = gameState.tanks.filter(t => t.id !== socket.id);
        io.emit("update-board", gameState);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Tank Tactics server running at http://localhost:${PORT}`);
});