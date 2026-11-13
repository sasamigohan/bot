'use strict';

/**
 * サマータイム（Skyの更新時刻が JST 16:00 / 17:00 のどちらか）の共通処理。
 *
 * Skyの1日はアメリカ太平洋時間(PT)の0時に切り替わる。
 *   サマータイム中 : PT 0:00 = JST 16:00
 *   サマータイム後 : PT 0:00 = JST 17:00
 * 設定値は data.shardData.isSummerTime（true=サマータイム中）。
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const JST_OFFSET_MS = 9 * HOUR_MS;

function isSummerTime(data) {
    return Boolean(data && data.shardData ? data.shardData.isSummerTime : true);
}

/** 更新時刻（JSTの時）。サマータイム中=16、終了後=17 */
function getResetHourJst(data) {
    return isSummerTime(data) ? 16 : 17;
}

/** 破片セッション時刻のずらし量（分）。サマータイム中=0、終了後=+60 */
function getShardShiftMinutes(data) {
    return isSummerTime(data) ? 0 : 60;
}

function describeSummerTime(data) {
    return isSummerTime(data)
        ? 'サマータイム中（更新時刻 16:00 JST）'
        : 'サマータイム終了後（更新時刻 17:00 JST）';
}

/**
 * 登録済みイベントの開始・終了日時のうち、JSTでちょうど fromHour:00 のものを toHour:00 にずらす。
 * （/event-add で登録した「更新時刻」の日時だけが対象。それ以外の時刻は変更しない）
 * @returns {number} 変更した日時の数
 */
function shiftEventTimes(data, fromHour, toHour) {
    let count = 0;
    const events = data.dailyEvents ? Object.values(data.dailyEvents) : [];

    for (const ev of events) {
        for (const field of ['startAt', 'endAt']) {
            if (!ev[field]) continue;

            const ms = new Date(ev[field]).getTime();
            if (Number.isNaN(ms)) continue;

            const msOfDayJst = (((ms + JST_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS;

            if (msOfDayJst === fromHour * HOUR_MS) {
                ev[field] = new Date(ms + (toHour - fromHour) * HOUR_MS).toISOString();
                count++;
            }
        }
    }

    return count;
}

/**
 * サマータイムの開始/終了を反映する。
 * @param {object} data loadData()の戻り値（呼び出し側で saveData すること）
 * @param {boolean} summer true=サマータイム開始 / false=サマータイム終了
 * @returns {{changed: boolean, resetHour: number, shiftedCount: number, fromHour: number}}
 */
function applySummerTime(data, summer) {
    if (!data.shardData) {
        data.shardData = { isSummerTime: true, lastDailySentDate: null, sentSessionKeys: [] };
    }

    const wasSummer = Boolean(data.shardData.isSummerTime);
    const resetHour = summer ? 16 : 17;
    const fromHour = wasSummer ? 16 : 17;

    if (wasSummer === summer) {
        return { changed: false, resetHour, shiftedCount: 0, fromHour };
    }

    data.shardData.isSummerTime = summer;
    const shiftedCount = shiftEventTimes(data, fromHour, resetHour);

    return { changed: true, resetHour, shiftedCount, fromHour };
}

module.exports = {
    isSummerTime,
    getResetHourJst,
    getShardShiftMinutes,
    describeSummerTime,
    applySummerTime
};
