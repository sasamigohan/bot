const levels = require('../config/levels');

async function checkLevelUp(member, userData) {

    for (const lv of levels) {

        if (
            userData.points >= lv.points &&
            userData.level < lv.level
        ) {

            userData.level = lv.level;

            if (lv.roleId) {

                try {
                    await member.roles.add(lv.roleId);
                } catch (err) {
                    console.error(err);
                }
            }
        }
    }
}

module.exports = checkLevelUp;