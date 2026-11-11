const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const session = require('express-session');
const mongoose = require('mongoose');
const path = require('path');
const crypto = require('crypto');

if (!global.crypto) {
    global.crypto = crypto;
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.set('trust proxy', 1);

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("Connected to MongoDB Atlas successfully"))
    .catch(err => console.error("MongoDB connection error:", err));

const tankSchema = new mongoose.Schema({
    id: String,
    discordId: String,
    name: { type: String, required: true, unique: true },
    color: String,
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
    hearts: { type: Number, default: 3 },
    ap: { type: Number, default: 10 },
    range: { type: Number, default: 2 },
    eliminated: { type: Boolean, default: false }
});

const Tank = mongoose.model("Tank", tankSchema);

// Predefined user colors map
const userColors = {
    "smoothandsultry": "#ff5733",
    "default": "#33ff57"
};

// Express Session Configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'tanktacticssecret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
    }
}));

app.use(passport.initialize());
app.use(passport.session());

// Passport Discord Strategy
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(obj, done));

passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.DISCORD_CALLBACK_URL || '/auth/discord/callback',
    scope: ['identify']
}, (accessToken, refreshToken, profile, done) => {
    return done(null, profile);
}));

// Auth Routes
app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback', passport.authenticate('discord', {
    failureRedirect: '/'
    }), (req, res) => {
        req.session.save((err) => {
            if (err) {
                console.error("Session save error:", err);
                return res.redirect('/');
            }
            res.redirect('/game');
        });
    });

app.get('/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) return next(err);
        res.redirect('/');
    });
});

app.get('/user', (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    res.json(req.user);
});

app.get('/', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

app.get('/game', (req, res) => {
    if (!req.isAuthenticated()) {
        return res.redirect('/');
    }
    try {
        res.sendFile(path.join(process.cwd(), 'public', 'game.html'));
    } catch (err) {
        console.error("Game route error:", err);
        res.status(500).send(`Error loading game: ${err.message}`);
    }
});

app.use(express.static(path.join(process.cwd(), 'public')));

function getActionCost(action) {
    switch (action) {
        case "MOVE": return 1;
        case "SHOOT": return 2;
        case "UPGRADE": return 3;
        case "GIFT": return 2;
        default: return 1;
    }
}

function getDistance(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function getCircularDistance(a, b) {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

io.on("connection", (socket) => {
    console.log(`A user connected: ${socket.id}`);

    async function sendUpdatedBoard() {
        const activeTanks = await Tank.find({ eliminated: false });
        io.emit("update-board", { tanks: activeTanks });
    }

    sendUpdatedBoard();

    socket.on("player-join", async (data) => {
        try {
            let tank = await Tank.findOne({ name: data.name });

            if (tank) {
                if (tank.eliminated) {
                    console.log(`Commander ${data.name} attempted to join, but is already eliminated.`);
                    socket.emit("eliminated", { message: "Your tank was destroyed! You cannot respawn until a new match begins." });
                    return;
                }
                tank.id = socket.id;
                await tank.save();
                console.log(`Commander ${data.name} reconnected at (${tank.x}, ${tank.y}) with ${tank.hearts} hearts.`);
            } else {
                const randomX = Math.floor(Math.random() * 20);
                const randomY = Math.floor(Math.random() * 20);
                const assignedColor = userColors[data.name] || userColors["default"];
            
                tank = new Tank({
                    id: socket.id,
                    discordId: data.discordId || data.name,
                    name: data.name,
                    color: assignedColor,
                    x: randomX,
                    y: randomY,
                    hearts: 3,
                    ap: 10,
                    range: 2,
                    eliminated: false
                });
            
                await tank.save();
                console.log(`New tank created in database for ${data.name}:`, tank);
            }
        
            await sendUpdatedBoard();
        } catch (err) {
            console.error("Error in player-join:", err);
        }
    });

    socket.on("player-action", async (data) => {
        try {
            const tank = await Tank.findOne({ name: data.name, eliminated: false });
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
                await tank.save();
                await sendUpdatedBoard();
                return;
            }

            if (data.action === "UPGRADE") {
                tank.range = (tank.range || 2) + 1;
                tank.ap -= actionCost;
                await tank.save();
                console.log(`Commander ${tank.name} upgraded range to ${tank.range}`);
                await sendUpdatedBoard();
                return;
            }

            if (["GIFT"].includes(data.action)) {
                const target = await Tank.findOne({
                    name: { $ne: tank.name },
                    x: data.target.x,
                    y: data.target.y,
                    eliminated: false
                });

                if (!target) {
                    console.log(`Invalid ${data.action.toLowerCase()} target at ${data.target.x},${data.target.y}`);
                    return;
                }

                const distance = getDistance(tank, target);
                if (distance > (tank.range || 2)) {
                    console.log(`${data.action} target out of range: ${distance} spaces away`);
                    return;
                }

                tank.ap -= actionCost;
                target.ap += 1;
                await tank.save();
                await target.save();
                console.log(`Commander ${tank.name} used ${data.action} on ${target.name}`);
                await sendUpdatedBoard();
                return;
            }

            if (data.action === "SHOOT") {
                const target = await Tank.findOne({
                    name: { $ne: tank.name },
                    x: data.target.x,
                    y: data.target.y,
                    eliminated: false
                });

                if (!target) {
                    console.log(`Invalid shoot target at ${data.target.x},${data.target.y}`);
                    return;
                }

                const distance = getCircularDistance(tank, target);
                if (distance > (tank.range || 2)) {
                    console.log(`Shoot target out of range: ${distance} spaces away`);
                    return;
                }

                tank.ap -= actionCost;
                target.hearts -= 1;
                console.log(`Commander ${tank.name} shot ${target.name} for 1 damage`);

                if (target.hearts <= 0) {
                    console.log(`Commander ${target.name} was eliminated`);
                    target.eliminated = true;
                }

                await tank.save();
                await target.save();
                await sendUpdatedBoard();
            }
        } catch (err) {
            console.error("Error processing player action:", err);
        }
    });

    socket.on("end-turn", async () => {
        try {
            await Tank.updateMany({ eliminated: false }, { $set: { ap: 10 } });
            console.log("Turn ended. All active tanks AP refilled to 10.");
            await sendUpdatedBoard();
        } catch (err) {
            console.error("Error ending turn:", err);
        }
    });

    socket.on("disconnect", async () => {
        console.log(`User disconnected: ${socket.id}`);
        await Tank.updateOne({ id: socket.id }, { $set: { id: null } });
        await sendUpdatedBoard();
    });
});

app.use((err, req, res, next) => {
    if (!(err instanceof Error)) {
        return next(err);
    }
    console.error("Server Error:", err);
    res.status(500).send(`<h1>Server Error</h1><p>${err.message}</p><a href='/'>Return Home</a>`);
});


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Tank Tactics server running on port ${PORT}`);
});