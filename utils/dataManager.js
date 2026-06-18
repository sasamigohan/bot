const fs = require('fs');
const { Pool } = require('pg');

const DATA_FILE = './data.json';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL が設定されていません。データ保護のためBotを停止します。");
    process.exit(1);
}

let cache = {
    users: {},
    mutedBombChannels: [],
    colorCooldowns: {},
    dailyReminderSentDate: null,
    logs: [],
    hourlyLogs: {},
    doubleUps: {},
    derbies: {},
    joinVotes: {},
    anonPolls: {},
    halfGames: {},
    colorRoleMap: {},
    detachedColorRoles: {}
};

function createDefaultData() {
    return {
        users: {},
        mutedBombChannels: [],
        colorCooldowns: {},
        dailyReminderSentDate: null,
        logs: [],
        hourlyLogs: {},
        doubleUps: {},
        derbies: {},
        joinVotes: {},
        anonPolls: {},
        halfGames: {},
        colorRoleMap: {},
        detachedColorRoles: {}
    };
}

function ensureUser(data, userId) {
    if (!data.users) data.users = {};
    if (!data.users[userId]) data.users[userId] = {};

    const user = data.users[userId];

    if (!user.favoriteColors) user.favoriteColors = [];
    if (user.lastManualColorChange === undefined) user.lastManualColorChange = 0;
    if (user.dailyReminderMuted === undefined) user.dailyReminderMuted = false;
    if (!user.purchasedDisplayRoles) user.purchasedDisplayRoles = [];

    if (user.points === undefined) user.points = 0;
    if (user.levelPoints === undefined) user.levelPoints = user.points || 0;
    if (user.level === undefined) user.level = 0;
    if (user.voiceMinutes === undefined) user.voiceMinutes = 0;
    if (user.vcSessionMinutes === undefined) user.vcSessionMinutes = 0;
    if (user.lastWorkCheck === undefined) user.lastWorkCheck = 0;
    if (user.lastDailyDate === undefined) user.lastDailyDate = null;
    if (user.tickets === undefined) user.tickets = 0;
    if (user.displayRole === undefined) user.displayRole = null;

    if (user.messageCount === undefined) user.messageCount = 0;
    if (user.explosionCount === undefined) user.explosionCount = 0;
    if (user.halfBest === undefined) user.halfBest = 0;
    if (user.reactionCount === undefined) user.reactionCount = 0;
    if (user.voiceMinutesTotal === undefined) user.voiceMinutesTotal = 0;
    if (user.voicePointMinutes === undefined) user.voicePointMinutes = 0;

    if (user.lastOmikujiDate === undefined) user.lastOmikujiDate = null;
}

function normalizeData(data) {
    if (!data.users) data.users = {};
    if (!data.mutedBombChannels) data.mutedBombChannels = [];
    if (!data.colorCooldowns) data.colorCooldowns = {};
    if (!('dailyReminderSentDate' in data)) data.dailyReminderSentDate = null;
    if (!data.logs) data.logs = [];
    if (!data.hourlyLogs) data.hourlyLogs = {};
    if (!data.doubleUps) data.doubleUps = {};
    if (!data.derbies) data.derbies = {};
    if (!data.joinVotes) data.joinVotes = {};
    if (!data.anonPolls) data.anonPolls = {};
    if (!data.halfGames) data.halfGames = {};
    if (!data.colorRoleMap)
        data.colorRoleMap = {};
    if (!data.colorRoleMap) data.colorRoleMap = {};
    if (!data.detachedColorRoles) data.detachedColorRoles = {};

    if (!data.detachedColorRoles)
        data.detachedColorRoles = {};
    for (const userId of Object.keys(data.users)) {
        ensureUser(data, userId);
    }

    return data;
}

async function initDataStore() {
    if (!pool) {
        if (!fs.existsSync(DATA_FILE)) {
            fs.writeFileSync(DATA_FILE, JSON.stringify(createDefaultData(), null, 2));
        }

        cache = normalizeData(JSON.parse(fs.readFileSync(DATA_FILE)));
        return;
    }

    await pool.query(`
        CREATE TABLE IF NOT EXISTS bot_data (
            id TEXT PRIMARY KEY,
            data JSONB NOT NULL
        )
    `);

    const result = await pool.query(
        `SELECT data FROM bot_data WHERE id = 'main'`
    );

    if (result.rows.length > 0) {
        cache = normalizeData(result.rows[0].data);
        return;
    }

    if (fs.existsSync(DATA_FILE)) {
        cache = normalizeData(JSON.parse(fs.readFileSync(DATA_FILE)));
    } else {
        cache = createDefaultData();
    }

    await pool.query(
        `
        INSERT INTO bot_data (id, data)
        VALUES ('main', $1)
        ON CONFLICT (id)
        DO UPDATE SET data = EXCLUDED.data
        `,
        [cache]
    );
}

function loadData() {
    cache = normalizeData(cache);
    return cache;
}

function saveData(data) {
    cache = normalizeData(data);

    if (!pool) {
        fs.writeFileSync(DATA_FILE, JSON.stringify(cache, null, 2));
        return;
    }

    pool.query(
        `
        INSERT INTO bot_data (id, data)
        VALUES ('main', $1)
        ON CONFLICT (id)
        DO UPDATE SET data = EXCLUDED.data
        `,
        [cache]
    ).catch(console.error);
}

function addPoints(data, userId, amount, options = {}) {
    ensureUser(data, userId);

    const addToLevel = options.addToLevel !== false;

    data.users[userId].points += amount;

    if (addToLevel) {
        data.users[userId].levelPoints += amount;
    }
}

function trimLogs(data) {
    if (!data.logs) data.logs = [];

    while (data.logs.length > 100) {
        data.logs.shift();
    }
}

function getJstHourKey(date = new Date()) {
    const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);

    const y = jst.getUTCFullYear();
    const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
    const d = String(jst.getUTCDate()).padStart(2, '0');
    const h = String(jst.getUTCHours()).padStart(2, '0');

    return `${y}-${m}-${d} ${h}:00`;
}

function getNextHourText(hourKey) {
    const h = Number(hourKey.slice(11, 13));
    return `${String((h + 1) % 24).padStart(2, '0')}:00`;
}

function addPointLog(data, {
    userId,
    type,
    amount,
    detail = '',
    hourly = false
}) {
    normalizeData(data);

    if (hourly) {
        const hourKey = getJstHourKey();
        const key = `${hourKey}:${userId}:${type}`;

        if (!data.hourlyLogs[key]) {
            data.hourlyLogs[key] = {
                time: hourKey,
                userId,
                type,
                amount: 0
            };
        }

        data.hourlyLogs[key].amount += amount;

        const logItem = {
            hourlyKey: key,
            time: hourKey,
            userId,
            type,
            amount: data.hourlyLogs[key].amount,
            detail: `${hourKey}~${getNextHourText(hourKey)} ${type}`
        };

        const index = data.logs.findIndex(log => log.hourlyKey === key);

        if (index >= 0) {
            data.logs[index] = logItem;
        } else {
            data.logs.push(logItem);
        }

        trimLogs(data);
        return;
    }

    data.logs.push({
        time: new Date().toISOString(),
        userId,
        type,
        amount,
        detail
    });

    trimLogs(data);
}

module.exports = {
    initDataStore,
    loadData,
    saveData,
    ensureUser,
    addPoints,
    addPointLog
};