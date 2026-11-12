const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const session = require('express-session');
const mongoose = require('mongoose');
const path = require('path');
const crypto = require('crypto');
const cron = require('node-cron');
const axios = require('axios');

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
    ap: { type: Number, default: 0 },
    range: { type: Number, default: 2 },
    damageDealt: { type: Number, default: 0 },
    tilesMoved: { type: Number, default: 0 },
    playerKills: { type: Number, default: 0 },
    eliminated: { type: Boolean, default: false }
});

const Tank = mongoose.model("Tank", tankSchema);

// Predefined user colors map
const userColors = {
    "smoothandsultry": "#941b00",
    "default": "#ffffff"
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
passport.deserializeUser((id, done) => done(null, id));

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
        case "SHOOT": return 1;
        case "UPGRADE": return 3;
        case "GIFT": return 1;
        default: return 1;
    }
}

function getDistance(a, b) {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function getCircularDistance(a, b) {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function formatDiscordDateTime(date = new Date()) {
    return new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    }).format(date);
}

async function sendDiscordActionWebhook(action, tank, details = {}) {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl || !tank) return;

    if (!['MOVE', 'SHOOT'].includes(action)) {
        return;
    }

    const actionStyles = {
        MOVE: {
            color: 5763719,
            title: "Movement",
            description: `${tank.name} repositioned to (${tank.x}, ${tank.y}).`,
            footer: "Tiles moved"
        },
        SHOOT: {
            color: 15548997,
            title: "Attack",
            description: details.result || `${tank.name} fired on the target.`,
            footer: "Damage dealt"
        }
    };

    const style = actionStyles[action];

    const embed = {
        title: `${style.title}: ${tank.name}`,
        description: style.description,
        color: style.color,
        footer: {
            text: `${style.footer} • ${formatDiscordDateTime()}`
        }
    };

    try {
        await axios.post(webhookUrl, {
            username: "war",
            embeds: [embed]
        }, {
            headers: { "Content-Type": "application/json" }
        });
    } catch (err) {
        console.error("Discord webhook error:", err.response ? err.response.data : err.message);
    }
}

io.on("connection", (socket) => {
    console.log(`A user connected: ${socket.id}`);

    async function sendUpdatedBoard() {
        const activeTanks = await Tank.find({ eliminated: false });
        io.emit("update-board", { tanks: activeTanks });
        console.log("Game state sent to clients:", { tanks: activeTanks });
    }

    sendUpdatedBoard();

    socket.on("player-join", async (data) => {
        try {
            let tank = await Tank.findOne({ name: data.name });
    
            if (tank) {
                if (tank.eliminated) {
                    console.log(`Commander ${data.name} attempted to join, but is already eliminated.`);
                    socket.emit("eliminated", { message: "you're dead" });
                    return;
                }
                tank.id = socket.id;
                await tank.save();
                console.log(`Commander ${data.name} reconnected at (${tank.x}, ${tank.y}) with ${tank.hearts} hearts.`);
            } else {
                let randomX = Math.floor(Math.random() * 20);
                let randomY = Math.floor(Math.random() * 20);
                let tries = 0;

                while (tries < 400) {
                    const occupiedTank = await Tank.findOne({
                        x: randomX,
                        y: randomY,
                        eliminated: false
                    });

                    if (!occupiedTank) break;

                    randomX = Math.floor(Math.random() * 20);
                    randomY = Math.floor(Math.random() * 20);
                    tries += 1;
                }
    
                tank = new Tank({
                    id: socket.id,
                    discordId: data.discordId,
                    name: data.name,
                    color: userColors[data.name] || userColors["default"],
                    x: randomX,
                    y: randomY,
                    hearts: 3,
                    ap: 0,
                    range: 2,
                    damageDealt: 0,
                    tilesMoved: 0,
                    playerKills: 0
                });
    
                await tank.save();
                console.log(`New tank created for ${data.name}:`, tank);
            }
    
            sendUpdatedBoard();
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

                const occupiedTarget = await Tank.findOne({
                    x: data.target.x,
                    y: data.target.y,
                    eliminated: false
                });

                if (occupiedTarget && occupiedTarget.name !== tank.name) {
                    console.log(`Move invalid: ${data.name} tried to move onto occupied cell (${data.target.x}, ${data.target.y})`);
                    return;
                }

                tank.x = data.target.x;
                tank.y = data.target.y;
                tank.tilesMoved = (tank.tilesMoved || 0) + 1;
                tank.ap -= actionCost;
                await tank.save();
                await sendDiscordActionWebhook("MOVE", tank, {
                    target: { x: tank.x, y: tank.y },
                    result: "Moved successfully"
                });
                await sendUpdatedBoard();
                return;
            }

            if (data.action === "UPGRADE") {
                tank.range = (tank.range || 2) + 1;
                tank.ap -= actionCost;
                await tank.save();
                console.log(`Commander ${tank.name} upgraded range to ${tank.range}`);
                await sendDiscordActionWebhook("UPGRADE", tank, {
                    result: `Range increased to ${tank.range}`
                });
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
                tank.giftsGiven = (tank.giftsGiven || 0) + 1;
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
                tank.damageDealt = (tank.damageDealt || 0) + 1;
                target.hearts -= 1;
                console.log(`Commander ${tank.name} shot ${target.name} for 1 damage`);

                if (target.hearts <= 0) {
                    console.log(`Commander ${target.name} was eliminated`);
                    target.eliminated = true;
                    tank.playerKills = (tank.playerKills || 0) + 1;
                }

                await tank.save();
                await target.save();
                await sendDiscordActionWebhook("SHOOT", tank, {
                    target: { x: target.x, y: target.y },
                    result: target.hearts <= 0
                        ? `${target.name} was eliminated`
                        : `${target.name} took 1 damage`
                });
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

cron.schedule('0 0 * * *', async () => {
    try {
        console.log("Running daily AP regeneration task (12:00 AM EST)...");

        await Tank.updateMany(
            { eliminated: false },
            { $inc: { ap: 1 } }
        );

        const activeTanks = await Tank.find({ eliminated: false });
        io.emit("update-board", { tanks: activeTanks });

        const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
        if (webhookUrl) {
            await axios.post(webhookUrl, {
                username: "war",
                content: "@everyone AP reset has arrived! Everyone has received their daily AP.",
                embeds: [{
                    title: "Daily AP Reset",
                    description: "Everybody has been given their daily AP.",
                    color: 5763719,
                    footer: {
                        text: `Date/Time: ${formatDiscordDateTime()}`
                    }
                }]
            }, {
                headers: { "Content-Type": "application/json" }
            });
        }

        console.log("Daily AP granted successfully to all active users.");
    } catch (err) {
        console.error("Error running daily AP cron job:", err);
    }
}, {
    scheduled: true,
    timezone: "EST"
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Tank Tactics server running on port ${PORT}`);
});