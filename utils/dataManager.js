function loadData() {

    if (!fs.existsSync(DATA_FILE)) {

        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify({
                users: {},
                mutedBombChannels: [],
                colorCooldowns: {}
            }, null, 2)
        );
    }

    const data =
        JSON.parse(
            fs.readFileSync(DATA_FILE)
        );

    if (!data.users)
        data.users = {};

    if (!data.mutedBombChannels)
        data.mutedBombChannels = [];

    if (!data.colorCooldowns)
        data.colorCooldowns = {};

    return data;
}

function loadData() {
    if (!fs.existsSync(DATA_FILE)) {
        fs.writeFileSync(DATA_FILE, JSON.stringify(createDefaultData(), null, 2));
    }

    const raw = JSON.parse(fs.readFileSync(DATA_FILE));

    if (!raw.users) raw.users = {};
    if (!raw.mutedBombChannels) raw.mutedBombChannels = [];
    if (!raw.colorCooldowns) raw.colorCooldowns = {};
    if (!('dailyReminderSentDate' in raw)) raw.dailyReminderSentDate = null;

    return raw;
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function ensureUser(data, userId) {

    if (!data.users) {
        data.users = {};
    }

    if (!data.users[userId]) {
        data.users[userId] = {};
    }

    const user = data.users[userId];

    // 既存データを消さずに足りないものだけ追加

    if (user.points === undefined)
        user.points = 0;

    if (user.levelPoints === undefined)
        user.levelPoints = user.points || 0;

    if (user.level === undefined)
        user.level = 0;

    if (user.voiceMinutes === undefined)
        user.voiceMinutes = 0;

    if (user.vcSessionMinutes === undefined)
        user.vcSessionMinutes = 0;

    if (user.lastWorkCheck === undefined)
        user.lastWorkCheck = 0;

    if (user.lastDailyDate === undefined)
        user.lastDailyDate = null;

    if (user.dailyCount === undefined)
        user.dailyCount = 0;
}

function addPoints(data, userId, amount, options = {}) {
    ensureUser(data, userId);

    const addToLevel = options.addToLevel !== false;

    data.users[userId].points += amount;

    if (addToLevel) {
        data.users[userId].levelPoints += amount;
    }
}

module.exports = {
    loadData,
    saveData,
    ensureUser,
    addPoints
};