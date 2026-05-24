const levels = require('../config/levels');

async function checkLevelUp(member, userData) {
    const oldLevel = userData.level || 0;
    let newLevel = oldLevel;
    const rolesToAdd = [];

    for (const lv of levels) {
        if (
            userData.levelPoints >= lv.points &&
            newLevel < lv.level
        ) {
            newLevel = lv.level;

            if (lv.roleId && !lv.roleId.includes("ROLE_ID")) {
                rolesToAdd.push(lv.roleId);
            }
        }
    }

    if (newLevel <= oldLevel) {
        return {
            leveledUp: false,
            oldLevel,
            newLevel: oldLevel
        };
    }

    userData.level = newLevel;

    for (const roleId of rolesToAdd) {
        try {
            if (!member.roles.cache.has(roleId)) {
                await member.roles.add(roleId);
            }
        } catch (err) {
            console.error(err);
        }
    }

    return {
        leveledUp: true,
        oldLevel,
        newLevel
    };
}

module.exports = checkLevelUp;