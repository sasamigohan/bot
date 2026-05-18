const levels = require('../config/levels');

async function checkLevelUp(member, userData) {
    const oldLevel = userData.level || 0;
    let newLevel = oldLevel;

    for (const lv of levels) {
        if (
            userData.levelPoints >= lv.points &&
            newLevel < lv.level
        ) {
            newLevel = lv.level;

            if (lv.roleId && !lv.roleId.includes("ROLE_ID")) {
                try {
                    await member.roles.add(lv.roleId);
                } catch (err) {
                    console.error(err);
                }
            }
        }
    }

    userData.level = newLevel;

    return {
        leveledUp: newLevel > oldLevel,
        oldLevel,
        newLevel
    };
}

module.exports = checkLevelUp;