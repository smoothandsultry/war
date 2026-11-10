const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

let gameState = {
    tanks: []
};

io.on("connection", (socket) => {
    console.log(`A user connected: ${socket.id}`);

    socket.emit("update-board", gameState);

    socket.on("player-join", (data) => {
        const randomX = Math.floor(Math.random() * 16);
        const randomY = Math.floor(Math.random() * 16);

        const newTank = {
            id: socket.id,
            name: data.name,
            color: data.color || "#0e37a8",
            x: randomX,
            y: randomY,
            hearts: 3,
            ap: 0
        };

        gameState.tanks.push(newTank);
        console.log(`Commander ${data.name} spawned at (${randomX}, ${randomY}) with color ${newTank.color}`);

        io.emit("update-board", gameState);
    });

    socket.on("player-action", (data) => {
        console.log(`Action received from ${data.name}: ${data.action} at (${data.target.x}, ${data.target.y})`);
        
        const tank = gameState.tanks.find(t => t.name === data.name);
        if (tank && data.action === "MOVE") {
            tank.x = data.target.x;
            tank.y = data.target.y;
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