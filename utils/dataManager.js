const fs = require('fs');

const DATA_FILE = './data.json';

function loadData() {

    const raw =
        JSON.parse(
            fs.readFileSync(DATA_FILE)
        );

    if (!raw.users)
        raw.users = {};

    if (!raw.mutedBombChannels)
        raw.mutedBombChannels = [];

    if (!raw.colorCooldowns)
        raw.colorCooldowns = {};

    return raw;
}

function saveData(data) {

    fs.writeFileSync(

        DATA_FILE,

        JSON.stringify(
            data,
            null,
            2
        )
    );
}

function ensureUser(
    data,
    userId
) {

    if (!data.users[userId]) {

        data.users[userId] = {

            points: 0,
            level: 0,
            voiceJoin: null
        };
    }
}

module.exports = {

    loadData,
    saveData,
    ensureUser
};