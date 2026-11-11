const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const session = require("express-session");
const passport = require("passport");
const DiscordStrategy = require("passport-discord").Strategy;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const DISCORD_CLIENT_ID = "1569895104511082536";
const DISCORD_CLIENT_SECRET = "5S5RrO7oGZIY_fZ40UYRI7KEJb0foHx6";
const DISCORD_CALLBACK_URL = "http://localhost:3000/auth/discord/callback";

passport.use(
    new DiscordStrategy(
        {
            clientID: DISCORD_CLIENT_ID,
            clientSecret: DISCORD_CLIENT_SECRET,
            callbackURL: DISCORD_CALLBACK_URL,
            scope: ["identify"]
        },
        (accessToken, refreshToken, profile, done) => {
            return done(null, profile);
        }
    )
);

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

app.use(
    session({
        secret: "your-secret-key",
        resave: false, // Prevents resaving unchanged sessions
        saveUninitialized: false, // Prevents saving uninitialized sessions
        cookie: { secure: false } // Set to true if using HTTPS
    })
);
app.use(passport.initialize());
app.use(passport.session());

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
        case "GIFT":
            return 1;
        case "UPGRADE":
            return 3;
        default:
            return 0;
    }
}

// Routes
app.get("/auth/discord", passport.authenticate("discord"));
app.get(
    "/auth/discord/callback",
    passport.authenticate("discord", { failureRedirect: "/" }),
    (req, res) => {
        console.log("User authenticated:", req.user); // Debugging: Log the user object
        res.redirect("/game"); // Redirect to the game page after login
    }
);

app.get("/logout", (req, res) => {
    req.logout(() => {
        res.redirect("/");
    });
});

app.get("/user", (req, res) => {
    if (req.isAuthenticated()) {
        res.json(req.user);
    } else {
        res.status(401).json({ error: "Not authenticated" });
    }
});

app.get("/debug", (req, res) => {
    if (req.isAuthenticated()) {
        res.json({ message: "User is authenticated", user: req.user });
    } else {
        res.json({ message: "User is not authenticated" });
    }
});

app.get("/game", (req, res) => {
    if (req.isAuthenticated()) {
        res.sendFile(path.join(__dirname, "public", "game.html"));
    } else {
        res.redirect("/");
    }
});

// Socket.IO logic
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
            range: 2
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

        if (["HEAL", "GIFT"].includes(data.action)) {
            const target = gameState.tanks.find(t =>
                t.name !== tank.name &&
                t.x === data.target.x &&
                t.y === data.target.y
            );

            if (!target) {
                console.log(`Invalid ${data.action.toLowerCase()} target: ${data.name} attempted to use ${data.action} on ${data.target.x},${data.target.y}`);
                return;
            }

            const distance = getDistance(tank, target);
            if (distance > (tank.range || 2)) {
                console.log(`${data.action} target out of range: ${distance} spaces away`);
                return;
            }

            tank.ap -= actionCost;
            target.ap += 1;
            console.log(`Commander ${tank.name} used ${data.action} on ${target.name} (${distance} spaces away)`);
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